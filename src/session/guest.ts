import { AudioEngine } from '../audio/engine';
import { TimingController } from '../audio/timing';
import type { LinearClockMap } from '../core/anchor';
import { ClockSyncEstimator, OffsetSmoother } from '../core/clockSync';
import { readPacketHeader } from '../core/packet';
import {
  parseControlMessage,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  sanitizeName,
  type ControlMessage,
  type RejectMessage,
  type RoomSnapshot,
  type WelcomeMessage,
} from '../core/protocol';
import type { RendererStats } from '../core/renderer';
import { hostPeerId, isValidRoomCode } from '../core/roomCode';
import { ActivityDetector, deriveSpeakerPhase } from '../core/status';
import { resolveConnectionConfig, type ConnectionConfig } from '../config';
import { rejectToJoinError, signalingErrorToJoinError, type JoinErrorKind } from '../net/errors';
import { createPeer, describeChannel, peerErrorType, waitForOpen, type DataConnection, type Peer } from '../net/peer';
import { loadPrefs, savePrefs } from './prefs';
import { Store } from './store';
import { perfAt } from '../core/anchor';
import type { GuestSnapshot, GuestStage, SpeakerView, SyncProbe } from './types';
import { WakeLock } from './wakeLock';

export type JoinResult = { ok: true } | { ok: false; error: JoinErrorKind };

const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000, 8000, 12000, 16000];
const MIN_CLOCK_SAMPLES = 8;
const SETTLE_MS = 10_000;
const CONNECT_TIMEOUT_MS = 15_000;
const WELCOME_TIMEOUT_MS = 8_000;

type Reply = { kind: 'welcome'; msg: WelcomeMessage } | { kind: 'reject'; msg: RejectMessage } | { kind: 'timeout' } | { kind: 'closed' };

export class GuestController {
  readonly store: Store<GuestSnapshot>;
  readonly code: string;
  private readonly name: string;
  private readonly clientId: string;
  private readonly config: ConnectionConfig;
  private peer: Peer | null = null;
  private control: DataConnection | null = null;
  private audioConn: DataConnection | null = null;
  private audioRetries = 0;
  private session: { sessionId: number; guestId: string; audioToken: string } | null = null;
  private room: RoomSnapshot | null = null;
  private stage: GuestStage = 'joining';
  private joinError: JoinErrorKind | null = null;
  private engine: AudioEngine | null = null;
  private timing: TimingController | null = null;
  private audioState: GuestSnapshot['audio'] = 'off';
  private readonly clock = new ClockSyncEstimator();
  private readonly offset = new OffsetSmoother();
  private syncStartedAt: number | null = null;
  private pingSeq = 0;
  private readonly pendingPings = new Map<number, number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private burstTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setInterval> | null = null;
  private hostMap: LinearClockMap | null = null;
  private volume: number;
  private muted = false;
  private stats: RendererStats | null = null;
  private readonly outputActivity = new ActivityDetector(1500);
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptToken = 0;
  private pendingReply: ((reply: Reply) => void) | null = null;
  private packetsReceived = 0;
  private lastPacketAt = 0;
  private emitQueued = false;
  private disposed = false;
  private outputChanged = false;
  private readonly unsubscribers: (() => void)[] = [];
  private readonly wakeLock = new WakeLock();

  private constructor(code: string, name: string) {
    const prefs = loadPrefs();
    this.code = code;
    this.name = sanitizeName(name, '');
    if (this.name) savePrefs({ deviceName: this.name });
    this.clientId = prefs.clientId;
    this.volume = prefs.volume;
    this.config = resolveConnectionConfig();
    this.store = new Store<GuestSnapshot>(this.buildSnapshot());
  }

  /** Starts a join attempt; the promise settles once the host admits or refuses us. */
  static join(code: string, name: string): { controller: GuestController; ready: Promise<JoinResult> } {
    const controller = new GuestController(code, name);
    const ready = isValidRoomCode(code) ? controller.firstAttempt() : Promise.resolve<JoinResult>({ ok: false, error: 'invalid-code' });
    return { controller, ready };
  }

  private async firstAttempt(): Promise<JoinResult> {
    const result = await this.attempt(false);
    if (!result.ok) {
      this.joinError = result.error;
      this.stage = 'rejected';
      this.queueEmit();
    }
    return result;
  }

  // -------------------------------------------------------------- connection

  private async ensurePeer(): Promise<{ ok: true; peer: Peer } | { ok: false; error: JoinErrorKind }> {
    let peer = this.peer;
    if (peer && !peer.destroyed && peer.disconnected) {
      try {
        peer.reconnect();
      } catch {
        peer.destroy();
        peer = null;
      }
    }
    if (!peer || peer.destroyed) {
      peer = createPeer(this.config);
      peer.on('error', () => undefined);
      this.peer = peer;
    }
    const outcome = await waitForOpen(peer, 10_000);
    if (outcome.kind === 'open') return { ok: true, peer };
    peer.destroy();
    if (this.peer === peer) this.peer = null;
    return { ok: false, error: outcome.kind === 'error' ? signalingErrorToJoinError(outcome.type === 'timeout' ? 'timeout' : outcome.type) : 'signaling' };
  }

  private waitForConnection(peer: Peer, conn: DataConnection, hostId: string): Promise<'open' | JoinErrorKind> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: 'open' | JoinErrorKind) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('error', onPeerError);
        resolve(v);
      };
      const onPeerError = (err: unknown) => {
        const type = peerErrorType(err);
        const message = String((err as { message?: string })?.message ?? '');
        if (type === 'peer-unavailable' && (message.includes(hostId) || !message)) finish('not-found');
        else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') finish('signaling');
        else if (type === 'webrtc') finish('timeout');
      };
      const timer = setTimeout(() => finish('timeout'), CONNECT_TIMEOUT_MS);
      peer.on('error', onPeerError);
      conn.on('open', () => finish('open'));
      conn.on('error', () => finish('timeout'));
      conn.on('close', () => finish('host-unavailable'));
    });
  }

  private waitForReply(): Promise<Reply> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReply = null;
        resolve({ kind: 'timeout' });
      }, WELCOME_TIMEOUT_MS);
      this.pendingReply = (reply) => {
        clearTimeout(timer);
        this.pendingReply = null;
        resolve(reply);
      };
    });
  }

  private async attempt(resume: boolean): Promise<JoinResult> {
    const token = ++this.attemptToken;
    const peerResult = await this.ensurePeer();
    if (this.disposed || token !== this.attemptToken) return { ok: false, error: 'signaling' };
    if (!peerResult.ok) return peerResult;
    const peer = peerResult.peer;
    const hostId = hostPeerId(this.config.namespace, this.code);
    const conn = peer.connect(hostId, { serialization: 'json', reliable: true, metadata: { kind: 'control' } });
    if (!conn) return { ok: false, error: 'signaling' };
    conn.on('data', (raw) => this.onControlData(conn, raw));
    const opened = await this.waitForConnection(peer, conn, hostId);
    if (this.disposed || token !== this.attemptToken) {
      conn.close();
      return { ok: false, error: 'signaling' };
    }
    if (opened !== 'open') {
      conn.close();
      return { ok: false, error: opened };
    }
    this.control = conn;
    conn.on('close', () => this.onControlClosed(conn));
    const replyPromise = this.waitForReply();
    this.send({
      t: 'hello',
      protocol: PROTOCOL_ID,
      version: PROTOCOL_VERSION,
      clientId: this.clientId,
      name: this.name,
      ...(resume && this.session ? { resume: { sessionId: this.session.sessionId, guestId: this.session.guestId } } : {}),
    });
    const reply = await replyPromise;
    if (this.disposed || token !== this.attemptToken) return { ok: false, error: 'signaling' };
    if (reply.kind !== 'welcome') {
      this.control = null;
      conn.close();
      if (reply.kind === 'reject') return { ok: false, error: rejectToJoinError(reply.msg.reason) };
      return { ok: false, error: reply.kind === 'timeout' ? 'host-unavailable' : 'host-unavailable' };
    }
    if (resume && this.session && reply.msg.sessionId !== this.session.sessionId) {
      // A new room now uses this code; the old session is over.
      conn.close();
      return { ok: false, error: 'ended' };
    }
    this.onWelcome(reply.msg, resume);
    return { ok: true };
  }

  private onWelcome(msg: WelcomeMessage, resumed: boolean): void {
    const sameSession = this.session?.sessionId === msg.sessionId;
    this.session = { sessionId: msg.sessionId, guestId: msg.guestId, audioToken: msg.audioToken };
    this.room = msg.room;
    this.stage = 'joined';
    this.joinError = null;
    this.reconnectAttempt = 0;
    if (!sameSession) {
      this.clock.reset();
      this.offset.reset();
      this.syncStartedAt = null;
      this.hostMap = null;
    }
    this.applyRoomToAudio();
    this.audioRetries = 0;
    this.openAudio();
    this.startClockSync(true);
    if (!this.statusTimer) this.statusTimer = setInterval(() => this.sendStatus(), 1000);
    if (!this.emitTimer) this.emitTimer = setInterval(() => this.queueEmit(), 500);
    if (resumed) this.engine?.resync();
    void this.wakeLock.acquire();
    window.addEventListener('pagehide', this.onPageHide);
    this.sendStatus();
    this.queueEmit();
  }

  private openAudio(): void {
    const peer = this.peer;
    const session = this.session;
    if (!peer || !session || this.disposed) return;
    const conn = peer.connect(hostPeerId(this.config.namespace, this.code), {
      serialization: 'raw',
      reliable: false,
      metadata: { kind: 'audio', sessionId: session.sessionId, guestId: session.guestId, audioToken: session.audioToken },
    });
    if (!conn) return;
    conn.on('open', () => {
      if (this.disposed || this.session !== session) {
        conn.close();
        return;
      }
      this.audioConn?.close();
      this.audioConn = conn;
      this.audioRetries = 0;
      this.queueEmit();
    });
    conn.on('data', (data) => this.onAudioData(data));
    conn.on('close', () => {
      if (this.audioConn === conn) this.audioConn = null;
      if (!this.disposed && this.stage === 'joined' && this.control?.open && this.session === session && this.audioRetries < 5) {
        this.audioRetries++;
        setTimeout(() => {
          if (!this.audioConn && this.stage === 'joined') this.openAudio();
        }, 1000 * this.audioRetries);
      }
      this.queueEmit();
    });
    conn.on('error', () => undefined);
  }

  private onAudioData(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) return;
    const head = readPacketHeader(data);
    if (!head.ok || head.header.sessionId !== this.session?.sessionId) return;
    this.packetsReceived++;
    this.lastPacketAt = performance.now();
    if (this.engine && this.audioState === 'on') this.engine.pushPacket(data);
    this.timing?.maybeTick(this.lastPacketAt);
    if (this.packetsReceived % 50 === 0 && !this.pingTimer) this.ping();
  }

  private onControlData(conn: DataConnection, raw: unknown): void {
    const receivedAt = performance.now();
    const msg = parseControlMessage(raw);
    if (!msg) return;
    if (msg.t === 'welcome' || msg.t === 'reject') {
      if (this.pendingReply && this.control === conn) {
        this.pendingReply(msg.t === 'welcome' ? { kind: 'welcome', msg } : { kind: 'reject', msg });
        return;
      }
      if (msg.t === 'reject' && conn === this.control) this.finish(msg.reason === 'removed' ? 'removed' : 'ended');
      return;
    }
    if (conn !== this.control) return;
    this.onControlMessage(msg, receivedAt);
  }

  private onControlMessage(msg: ControlMessage, receivedAt: number): void {
    switch (msg.t) {
      case 'room':
        if (msg.room.sessionId !== this.session?.sessionId) return;
        this.room = msg.room;
        this.applyRoomToAudio();
        this.queueEmit();
        break;
      case 'anchor':
        if (msg.sessionId !== this.session?.sessionId) return;
        this.hostMap = { refContextTime: msg.contextTime, refPerformanceTime: msg.performanceTime, slope: msg.slope };
        this.timing?.setHostMap(this.hostMap);
        break;
      case 'pong': {
        const c1 = this.pendingPings.get(msg.seq);
        if (c1 === undefined || c1 !== msg.c1) return;
        this.pendingPings.delete(msg.seq);
        if (!this.clock.add(c1, msg.h2, msg.h3, receivedAt)) return;
        const est = this.clock.estimate(receivedAt);
        // Playback waits for enough exchanges that the lowest-RTT ones dominate.
        if (est && est.total >= MIN_CLOCK_SAMPLES) {
          if (this.syncStartedAt === null) this.syncStartedAt = receivedAt;
          this.offset.update(est.theta, receivedAt - this.syncStartedAt < SETTLE_MS);
          this.timing?.setTheta(this.offset.value);
        }
        break;
      }
      case 'cmd':
        switch (msg.command.action) {
          case 'resync':
            this.resync();
            break;
          case 'mute':
            this.setMuted(msg.command.muted);
            break;
          case 'volume':
            this.setVolume(msg.command.volume);
            break;
          case 'remove':
            this.finish('removed');
            break;
        }
        break;
      case 'ended':
        this.finish('ended');
        break;
      default:
        break;
    }
  }

  private onControlClosed(conn: DataConnection): void {
    if (conn !== this.control) return;
    this.control = null;
    this.audioConn?.close();
    this.audioConn = null;
    this.stopClockSync();
    if (this.pendingReply) {
      this.pendingReply({ kind: 'closed' });
      return;
    }
    if (this.disposed || this.stage === 'ended' || this.stage === 'removed' || this.stage === 'rejected') return;
    if (this.stage === 'joined' || this.stage === 'reconnecting') this.beginReconnect();
  }

  private beginReconnect(): void {
    if (this.disposed) return;
    this.stage = 'reconnecting';
    this.queueEmit();
    this.sendStatus();
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectTimer = setTimeout(() => void this.runReconnect(), delay);
  }

  private async runReconnect(): Promise<void> {
    this.reconnectTimer = null;
    if (this.disposed || this.stage !== 'reconnecting') return;
    this.reconnectAttempt++;
    this.queueEmit();
    const result = await this.attempt(true);
    if (this.disposed || result.ok) return;
    if (result.error === 'ended' || result.error === 'removed' || result.error === 'protocol') {
      this.finish(result.error === 'removed' ? 'removed' : 'ended');
      return;
    }
    if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
      this.stage = 'failed';
      this.joinError = result.error;
      this.queueEmit();
      return;
    }
    this.beginReconnect();
  }

  /** User-initiated retry after automatic reconnection gave up. */
  retry(): void {
    if (this.stage !== 'failed') return;
    this.reconnectAttempt = 0;
    this.joinError = null;
    this.beginReconnect();
  }

  private finish(stage: 'ended' | 'removed'): void {
    if (this.stage === stage) return;
    this.stage = stage;
    this.queueEmit();
    void this.teardown();
  }

  // ------------------------------------------------------------- clock sync

  private startClockSync(burst: boolean): void {
    this.stopClockSync();
    if (burst) {
      let n = 0;
      this.burstTimer = setInterval(() => {
        this.ping();
        if (++n >= 12 && this.burstTimer) {
          clearInterval(this.burstTimer);
          this.burstTimer = null;
        }
      }, 110);
    }
    this.pingTimer = setInterval(() => this.ping(), 1000);
  }

  private stopClockSync(): void {
    if (this.burstTimer) clearInterval(this.burstTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.burstTimer = null;
    this.pingTimer = null;
    this.pendingPings.clear();
  }

  private ping(): void {
    if (!this.control?.open) return;
    const seq = ++this.pingSeq;
    const c1 = performance.now();
    this.pendingPings.set(seq, c1);
    if (this.pendingPings.size > 32) {
      const oldest = this.pendingPings.keys().next().value;
      if (oldest !== undefined) this.pendingPings.delete(oldest);
    }
    this.send({ t: 'ping', seq, c1 });
  }

  private send(msg: ControlMessage): void {
    const conn = this.control;
    if (!conn?.open) return;
    try {
      void conn.send(msg);
    } catch (err) {
      console.warn('Trip Speaker: control send failed', err);
    }
  }

  // ------------------------------------------------------------------- audio

  /** Call synchronously from the "Enable this speaker" click. */
  enableAudio(): void {
    if (this.disposed) return;
    if (this.engine) {
      const engine = this.engine;
      void engine.resume().then(() => {
        if (engine.state === 'running' && this.audioState === 'blocked') this.audioState = 'on';
        this.queueEmit();
      });
      return;
    }
    let engine: AudioEngine;
    try {
      engine = AudioEngine.createInGesture('guest');
    } catch (err) {
      console.error(err);
      this.audioState = 'blocked';
      this.queueEmit();
      return;
    }
    this.engine = engine;
    this.audioState = 'enabling';
    const timing = new TimingController(engine, 'guest');
    timing.setTrim(loadPrefs().trimMs);
    this.timing = timing;
    this.queueEmit();
    const session = this.session;
    void engine.init(session?.sessionId ?? 0, this.room?.epoch ?? 0).then(
      () => {
        if (this.disposed) return;
        engine.setVolume(this.volume);
        engine.setMuted(this.muted);
        this.applyRoomToAudio();
        if (this.hostMap) timing.setHostMap(this.hostMap);
        timing.setTheta(this.offset.value);
        this.unsubscribers.push(
          engine.stats.on((s) => this.onStats(s)),
          engine.contextState.on(() => this.onContextState()),
        );
        navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
        this.tickTimer = setInterval(() => timing.maybeTick(), 250);
        this.audioState = engine.state === 'running' ? 'on' : 'blocked';
        timing.tick(true);
        this.sendStatus();
        this.queueEmit();
      },
      (err: unknown) => {
        console.error(err);
        this.audioState = 'blocked';
        this.queueEmit();
      },
    );
  }

  private applyRoomToAudio(): void {
    const room = this.room;
    const session = this.session;
    if (!room || !session || !this.engine || !this.timing) return;
    this.engine.setSession(session.sessionId);
    this.timing.setStream({ sessionId: session.sessionId, epoch: room.epoch, sourceRate: room.sourceRate });
    this.timing.setCommonBuffer(room.commonBufferMs);
  }

  private onStats(stats: RendererStats): void {
    const before = this.phase();
    this.stats = stats;
    this.outputActivity.update(stats.level, performance.now());
    if (this.phase() !== before) this.sendStatus();
  }

  private onContextState(): void {
    const engine = this.engine;
    if (!engine) return;
    if (engine.state !== 'running') {
      this.timing?.invalidateLocal();
      if (this.audioState === 'on') this.audioState = 'blocked';
    } else {
      if (this.audioState === 'blocked') this.audioState = 'on';
      this.timing?.tick(true);
      engine.resync();
    }
    this.sendStatus();
    this.queueEmit();
  }

  private readonly onDeviceChange = (): void => {
    this.outputChanged = true;
    this.timing?.invalidateLocal();
    setTimeout(() => this.timing?.tick(true), 300);
    this.queueEmit();
  };

  private readonly onPageHide = (): void => {
    this.send({ t: 'leave' });
  };

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.engine?.setVolume(this.volume);
    savePrefs({ volume: this.volume });
    this.sendStatus();
    this.queueEmit();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.engine?.setMuted(muted);
    this.sendStatus();
    this.queueEmit();
  }

  setTrim(ms: number): void {
    this.timing?.setTrim(ms);
    savePrefs({ trimMs: this.timing?.trim ?? 0 });
    this.outputChanged = false;
    this.queueEmit();
  }

  resync(): void {
    this.startClockSync(true);
    this.timing?.tick(true);
    this.engine?.resync();
  }

  requestTestClicks(): void {
    this.send({ t: 'request', request: 'test-clicks' });
  }

  acknowledgeOutputChange(): void {
    this.outputChanged = false;
    this.queueEmit();
  }

  private phase() {
    return deriveSpeakerPhase({
      connection:
        this.stage === 'joined' ? 'connected' : this.stage === 'reconnecting' ? 'reconnecting' : this.stage === 'failed' ? 'failed' : 'connecting',
      audio: this.audioState,
      clockReady: Boolean(this.timing?.isValid),
      sharing: this.room?.sharing ?? 'idle',
      renderer: this.stats?.state ?? null,
      sourceActive: this.outputActivity.isActive(performance.now()),
    });
  }

  private sendStatus(): void {
    if (this.stage !== 'joined') return;
    this.send({
      t: 'status',
      phase: this.phase(),
      muted: this.muted,
      volume: this.volume,
      level: this.stats ? Math.min(1, this.stats.level) : null,
    });
  }

  // -------------------------------------------------------------- lifecycle

  async leave(): Promise<void> {
    this.send({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 150));
    await this.dispose();
  }

  private async teardown(): Promise<void> {
    this.attemptToken++;
    this.stopClockSync();
    for (const t of [this.statusTimer, this.tickTimer, this.emitTimer]) if (t) clearInterval(t);
    this.statusTimer = this.tickTimer = this.emitTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const u of this.unsubscribers.splice(0)) u();
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    window.removeEventListener('pagehide', this.onPageHide);
    void this.wakeLock.release();
    const control = this.control;
    this.control = null;
    control?.close();
    this.audioConn?.close();
    this.audioConn = null;
    this.peer?.destroy();
    this.peer = null;
    const engine = this.engine;
    this.engine = null;
    this.timing = null;
    if (engine) await engine.dispose();
    this.queueEmit();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.teardown();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  outputAnalyser(): AnalyserNode | null {
    return this.engine?.outputAnalyser ?? null;
  }

  probe(): SyncProbe | null {
    const stats = this.stats;
    const map = this.timing?.localMap();
    if (!stats || !map || stats.sourcePosition === null || !this.engine) return null;
    return {
      role: 'guest',
      timeOrigin: performance.timeOrigin,
      sourceRate: stats.sourceRate,
      outputRate: stats.outputRate,
      sourcePosition: stats.sourcePosition,
      heardAtPerf: perfAt(map, stats.outputFrame / stats.outputRate),
      anchorSource: this.timing?.diagnostics().anchorSource ?? null,
      thetaMs: this.offset.value,
      framesPlayed: stats.framesPlayed,
      level: stats.level,
      epoch: stats.epoch,
    };
  }

  /** Test hook: simulate a dropped network link without leaving the room. */
  simulateDrop(): void {
    this.control?.peerConnection?.close();
    this.audioConn?.peerConnection?.close();
    this.control?.close();
  }

  // ---------------------------------------------------------------- snapshot

  private queueEmit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.store.set(this.buildSnapshot());
    });
  }

  private buildSnapshot(): GuestSnapshot {
    const selfId = this.session?.guestId ?? null;
    const speakers: SpeakerView[] = (this.room?.speakers ?? []).map((s) => {
      const isSelf = s.id === selfId;
      return isSelf
        ? { ...s, isSelf, phase: this.phase(), muted: this.muted, volume: this.volume, level: this.stats ? Math.min(1, this.stats.level) : s.level }
        : { ...s, isSelf };
    });
    const est = this.clock.estimate();
    return {
      kind: 'guest',
      stage: this.stage,
      joinError: this.joinError,
      code: this.code,
      hostName: this.room?.hostName ?? null,
      selfId,
      speakers,
      audio: this.audioState,
      phase: this.phase(),
      sharing: this.room?.sharing ?? 'idle',
      sourceActive: this.outputActivity.isActive(performance.now()),
      local: {
        volume: this.volume,
        muted: this.muted,
        trimMs: this.timing?.trim ?? loadPrefs().trimMs,
        contextState: this.engine?.state ?? 'none',
        renderer: this.stats,
        timing: this.timing?.diagnostics() ?? null,
        outputGain: this.engine?.outputGainValue ?? 0,
      },
      clock: {
        thetaMs: this.offset.value,
        rttMs: est?.rtt ?? null,
        uncertaintyMs: est?.uncertainty ?? null,
        samples: this.clock.sampleCount,
      },
      reconnectAttempt: this.reconnectAttempt,
      maxReconnectAttempts: RECONNECT_DELAYS.length,
      audioChannel: describeChannel(this.audioConn),
      packetsReceived: this.packetsReceived,
      clicksActive: false,
      outputChanged: this.outputChanged,
      commonBufferMs: this.room?.commonBufferMs ?? 1200,
    };
  }
}

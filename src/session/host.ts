import { CaptureError, relaxProcessing, requestTabCapture, type CaptureResult } from '../audio/capture';
import { AudioEngine } from '../audio/engine';
import { TimingController } from '../audio/timing';
import { SendGate } from '../core/backpressure';
import {
  admitHello,
  MAX_SPEAKERS,
  parseAudioMetadata,
  parseControlMessage,
  randomId,
  randomUint32,
  sanitizeName,
  type AnchorMessage,
  type ControlMessage,
  type HelloMessage,
  type HostCommand,
  type RoomSnapshot,
  type SharingState,
  type SpeakerInfo,
  type SpeakerPhase,
} from '../core/protocol';
import type { RendererStats } from '../core/renderer';
import { buildInviteUrl, claimRoomCode, hostPeerId, RoomCodeUnavailableError } from '../core/roomCode';
import { ActivityDetector, deriveSpeakerPhase } from '../core/status';
import { clickScheduleEnd } from '../core/testSignal';
import { resolveConnectionConfig, type ConnectionConfig } from '../config';
import { bufferedAmount, createPeer, describeChannel, waitForOpen, type DataConnection, type Peer } from '../net/peer';
import { loadPrefs, savePrefs } from './prefs';
import { Store } from './store';
import { perfAt } from '../core/anchor';
import type { CaptureView, HostSnapshot, LinkDiagnostics, SpeakerView, SyncProbe } from './types';
import { WakeLock } from './wakeLock';

const GRACE_MS = 25_000;
const HELLO_TIMEOUT_MS = 10_000;

interface GuestRecord {
  id: string;
  clientId: string;
  name: string;
  order: number;
  control: DataConnection | null;
  audio: DataConnection | null;
  audioToken: string;
  gate: SendGate;
  connection: 'connected' | 'reconnecting';
  phase: SpeakerPhase;
  muted: boolean;
  volume: number;
  level: number | null;
  lastStatusAt: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  leaving: boolean;
}

export class HostController {
  readonly store: Store<HostSnapshot>;
  readonly engine: AudioEngine;
  readonly timing: TimingController;
  private readonly config: ConnectionConfig;
  private readonly sessionId = randomUint32();
  private readonly epoch = 1;
  private peer: Peer | null = null;
  private code: string | null = null;
  private stage: HostSnapshot['stage'] = 'starting';
  private failure: HostSnapshot['failure'] = null;
  private signaling: HostSnapshot['signaling'] = 'connecting';
  private readonly guests = new Map<string, GuestRecord>();
  private readonly controlOwners = new Map<DataConnection, GuestRecord>();
  private readonly removed = new Set<string>();
  private nextOrder = 1;
  private locked = false;
  private hostName: string;
  private capture: CaptureResult | null = null;
  private captureView: CaptureView = {
    status: 'idle',
    error: null,
    suppression: 'unknown',
    inputActive: false,
    trackMuted: false,
    sharingSince: null,
  };
  private captureRequest = 0;
  private readonly inputActivity = new ActivityDetector(1500);
  private readonly outputActivity = new ActivityDetector(1500);
  private localStats: RendererStats | null = null;
  private volume: number;
  private muted = false;
  private clicksUntil = 0;
  private lastAnchorAt = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private emitQueued = false;
  private disposed = false;
  private outputChanged = false;
  private readonly wakeLock = new WakeLock();

  /** Call from the "Start a room" click: the AudioContext is created under that gesture. */
  static start(name?: string): HostController {
    return new HostController(name);
  }

  private constructor(name?: string) {
    const prefs = loadPrefs();
    this.hostName = sanitizeName(name ?? prefs.deviceName, 'Host');
    this.volume = prefs.volume;
    this.engine = AudioEngine.createInGesture('host');
    this.timing = new TimingController(this.engine, 'host');
    this.timing.setTrim(prefs.trimMs);
    this.config = resolveConnectionConfig();
    this.store = new Store<HostSnapshot>(this.buildSnapshot());
    void this.wakeLock.acquire();
    void this.boot();
  }

  // ---------------------------------------------------------------- lifecycle

  private async boot(): Promise<void> {
    try {
      await this.engine.init(this.sessionId, this.epoch);
    } catch (err) {
      console.error(err);
      this.fail('audio');
      return;
    }
    if (this.disposed) return;
    this.engine.setVolume(this.volume);
    this.engine.setMuted(this.muted);
    this.timing.setStream({ sessionId: this.sessionId, epoch: this.epoch, sourceRate: this.engine.sampleRate });
    this.unsubscribers.push(
      this.engine.packets.on((p) => this.onPacket(p)),
      this.engine.stats.on((s) => this.onLocalStats(s)),
      this.engine.inputLevel.on((l) => this.onInputLevel(l.rms)),
      this.engine.clicksScheduled.on((s) => {
        const untilEndMs = ((clickScheduleEnd(s) - this.engine.context.currentTime * s.sampleRate) / s.sampleRate) * 1000;
        this.clicksUntil = performance.now() + untilEndMs + this.timing.commonBuffer + 400;
        this.queueEmit();
      }),
      this.engine.contextState.on(() => this.onContextState()),
    );
    this.timers.push(
      setInterval(() => this.timing.maybeTick(), 250),
      setInterval(() => this.broadcastAnchor(), 500),
      setInterval(() => this.queueEmit(), 500),
    );
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    window.addEventListener('pagehide', this.onPageHide);
    this.timing.tick(true);

    try {
      await claimRoomCode(async (code) => {
        if (this.disposed) return { ok: false, reason: 'error', error: new Error('disposed') };
        const peer = createPeer(this.config, hostPeerId(this.config.namespace, code));
        const outcome = await waitForOpen(peer, 12_000);
        if (outcome.kind === 'open') {
          this.peer = peer;
          this.code = code;
          return { ok: true };
        }
        peer.destroy();
        return outcome.kind === 'taken' ? { ok: false, reason: 'taken' } : { ok: false, reason: 'error', error: outcome.error };
      });
    } catch (err) {
      if (this.disposed) return;
      console.error(err);
      this.fail(err instanceof RoomCodeUnavailableError ? 'codes' : 'signaling');
      return;
    }
    if (this.disposed) {
      this.peer?.destroy();
      return;
    }
    this.attachPeer();
    this.stage = 'open';
    this.signaling = 'online';
    this.queueEmit();
  }

  private fail(kind: NonNullable<HostSnapshot['failure']>): void {
    this.stage = 'failed';
    this.failure = kind;
    this.queueEmit();
  }

  private attachPeer(): void {
    const peer = this.peer;
    if (!peer) return;
    peer.on('connection', (conn) => this.onIncoming(conn));
    peer.on('disconnected', () => {
      if (this.disposed) return;
      this.signaling = 'reconnecting';
      this.queueEmit();
      this.scheduleSignalingReconnect();
    });
    peer.on('open', () => {
      this.signaling = 'online';
      this.reconnectAttempts = 0;
      this.queueEmit();
    });
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      if (type === 'unavailable-id') {
        // Someone else registered this code while we were offline: existing
        // speakers keep playing, but nobody new can find the room.
        this.signaling = 'offline';
        this.queueEmit();
      }
    });
  }

  private scheduleSignalingReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    const delays = [1000, 2000, 4000, 8000, 15000, 30000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const peer = this.peer;
      if (!peer || peer.destroyed || this.disposed) return;
      if (!peer.disconnected) return;
      try {
        peer.reconnect();
      } catch {
        this.signaling = 'offline';
        this.queueEmit();
        return;
      }
      setTimeout(() => {
        if (this.peer?.disconnected && !this.disposed) this.scheduleSignalingReconnect();
      }, 5000);
    }, delay);
  }

  // -------------------------------------------------------------- connections

  private onIncoming(conn: DataConnection): void {
    if (this.disposed || this.stage !== 'open') {
      conn.close();
      return;
    }
    const meta = conn.metadata as { kind?: string } | undefined;
    if (meta?.kind === 'audio') {
      this.onAudioConnection(conn);
      return;
    }
    let helloTimer: ReturnType<typeof setTimeout> | null = null;
    conn.on('open', () => {
      helloTimer = setTimeout(() => {
        if (!this.controlOwners.has(conn)) conn.close();
      }, HELLO_TIMEOUT_MS);
    });
    conn.on('data', (raw) => {
      const receivedAt = performance.now();
      const msg = parseControlMessage(raw);
      if (!msg) return;
      const owner = this.controlOwners.get(conn);
      if (!owner) {
        if (msg.t === 'hello') {
          if (helloTimer) clearTimeout(helloTimer);
          this.onHello(conn, msg);
        }
        return;
      }
      this.onGuestMessage(owner, msg, receivedAt, conn);
    });
    conn.on('close', () => {
      if (helloTimer) clearTimeout(helloTimer);
      this.onControlClosed(conn);
    });
    conn.on('error', () => undefined);
  }

  private onHello(conn: DataConnection, incoming: HelloMessage): void {
    const resumable = new Set<string>();
    for (const g of this.guests.values()) if (g.connection === 'reconnecting' || g.clientId === incoming.clientId) resumable.add(g.id);
    // The same laptop rejoining (e.g. after a reload) takes back its own slot.
    const sameDevice = [...this.guests.values()].find((g) => g.clientId === incoming.clientId);
    const hello: HelloMessage =
      !incoming.resume && sameDevice ? { ...incoming, resume: { sessionId: this.sessionId, guestId: sameDevice.id } } : incoming;
    const verdict = admitHello(hello, {
      sessionId: this.sessionId,
      locked: this.locked,
      speakerCount: 1 + this.guests.size,
      ended: this.disposed,
      resumable,
      removed: this.removed,
    });
    if (!verdict.ok) {
      this.send(conn, { t: 'reject', reason: verdict.reason });
      setTimeout(() => conn.close(), 400);
      return;
    }
    let record = verdict.resumeGuestId ? this.guests.get(verdict.resumeGuestId) ?? null : null;
    if (record) {
      if (record.control && record.control !== conn) {
        this.controlOwners.delete(record.control);
        record.control.close();
      }
      record.audio?.close();
      record.audio = null;
      if (record.graceTimer) clearTimeout(record.graceTimer);
      record.graceTimer = null;
      record.control = conn;
      record.connection = 'connected';
      record.audioToken = randomId(12);
      record.gate = new SendGate();
      record.phase = 'connecting';
      if (hello.name) record.name = hello.name;
    } else {
      record = {
        id: randomId(8),
        clientId: hello.clientId,
        name: hello.name || `Speaker ${this.guests.size + 2}`,
        order: this.nextOrder++,
        control: conn,
        audio: null,
        audioToken: randomId(12),
        gate: new SendGate(),
        connection: 'connected',
        phase: 'connecting',
        muted: false,
        volume: 0.85,
        level: null,
        lastStatusAt: performance.now(),
        graceTimer: null,
        leaving: false,
      };
      this.guests.set(record.id, record);
    }
    this.controlOwners.set(conn, record);
    this.send(conn, {
      t: 'welcome',
      sessionId: this.sessionId,
      guestId: record.id,
      audioToken: record.audioToken,
      room: this.roomSnapshot(),
    });
    this.sendAnchor(conn);
    this.broadcastRoom();
  }

  private onAudioConnection(conn: DataConnection): void {
    const meta = parseAudioMetadata(conn.metadata);
    const record = meta ? this.guests.get(meta.guestId) : undefined;
    if (!meta || meta.sessionId !== this.sessionId || !record || record.audioToken !== meta.audioToken) {
      conn.on('open', () => conn.close());
      setTimeout(() => conn.close(), 2000);
      return;
    }
    conn.on('open', () => {
      if (record.audio && record.audio !== conn) record.audio.close();
      record.audio = conn;
      record.gate = new SendGate();
      this.queueEmit();
    });
    conn.on('close', () => {
      if (record.audio === conn) record.audio = null;
      this.queueEmit();
    });
    conn.on('error', () => undefined);
  }

  private onControlClosed(conn: DataConnection): void {
    const record = this.controlOwners.get(conn);
    this.controlOwners.delete(conn);
    if (!record || record.control !== conn) return;
    record.control = null;
    record.audio?.close();
    record.audio = null;
    if (record.leaving || this.disposed) {
      this.dropGuest(record);
      return;
    }
    record.connection = 'reconnecting';
    record.phase = 'reconnecting';
    record.graceTimer = setTimeout(() => this.dropGuest(record), GRACE_MS);
    this.broadcastRoom();
  }

  private dropGuest(record: GuestRecord): void {
    if (record.graceTimer) clearTimeout(record.graceTimer);
    record.graceTimer = null;
    if (record.control) {
      this.controlOwners.delete(record.control);
      record.control.close();
    }
    record.audio?.close();
    record.control = null;
    record.audio = null;
    if (this.guests.delete(record.id)) this.broadcastRoom();
  }

  private onGuestMessage(record: GuestRecord, msg: ControlMessage, receivedAt: number, conn: DataConnection): void {
    switch (msg.t) {
      case 'ping':
        this.send(conn, { t: 'pong', seq: msg.seq, c1: msg.c1, h2: receivedAt, h3: performance.now() });
        break;
      case 'status': {
        const changed = record.phase !== msg.phase || record.muted !== msg.muted || Math.abs(record.volume - msg.volume) > 0.001;
        record.phase = msg.phase;
        record.muted = msg.muted;
        record.volume = msg.volume;
        record.level = msg.level;
        record.lastStatusAt = receivedAt;
        if (changed) this.broadcastRoom();
        else this.queueEmit();
        break;
      }
      case 'request':
        if (msg.request === 'test-clicks') this.playTestClicks();
        else this.resyncAll();
        break;
      case 'leave':
        record.leaving = true;
        this.dropGuest(record);
        break;
      default:
        break;
    }
  }

  private send(conn: DataConnection | null, msg: ControlMessage): void {
    if (!conn?.open) return;
    try {
      void conn.send(msg);
    } catch (err) {
      console.warn('Trip Speaker: control send failed', err);
    }
  }

  private connectedGuests(): GuestRecord[] {
    return [...this.guests.values()].filter((g) => g.connection === 'connected' && g.control?.open);
  }

  private roomSnapshot(): RoomSnapshot {
    return {
      sessionId: this.sessionId,
      code: this.code ?? '0000',
      hostName: this.hostName,
      locked: this.locked,
      sharing: this.sharingState(),
      epoch: this.epoch,
      sourceRate: this.engine.sampleRate,
      commonBufferMs: this.timing.commonBuffer,
      speakers: this.speakerInfos(),
    };
  }

  private sharingState(): SharingState {
    if (this.captureView.status === 'sharing') return 'sharing';
    return this.captureView.status === 'stopped' ? 'stopped' : 'idle';
  }

  private speakerInfos(): SpeakerInfo[] {
    const host: SpeakerInfo = {
      id: 'host',
      name: this.hostName,
      role: 'host',
      phase: this.localPhase(),
      muted: this.muted,
      volume: this.volume,
      level: this.localStats ? Math.min(1, this.localStats.level) : null,
      order: 0,
    };
    const guests = [...this.guests.values()]
      .sort((a, b) => a.order - b.order)
      .map<SpeakerInfo>((g) => ({
        id: g.id,
        name: g.name,
        role: 'guest',
        phase: g.connection === 'reconnecting' ? 'reconnecting' : g.phase,
        muted: g.muted,
        volume: g.volume,
        level: g.level,
        order: g.order,
      }));
    return [host, ...guests];
  }

  private broadcastRoom(): void {
    const room = this.roomSnapshot();
    for (const g of this.connectedGuests()) this.send(g.control, { t: 'room', room });
    this.queueEmit();
  }

  private anchorMessage(): AnchorMessage | null {
    const map = this.timing.localMap();
    if (!map) return null;
    return {
      t: 'anchor',
      sessionId: this.sessionId,
      epoch: this.epoch,
      contextTime: map.refContextTime,
      performanceTime: map.refPerformanceTime,
      slope: map.slope,
      sourceRate: this.engine.sampleRate,
    };
  }

  private sendAnchor(conn: DataConnection): void {
    const msg = this.anchorMessage();
    if (msg) this.send(conn, msg);
  }

  private broadcastAnchor(): void {
    const now = performance.now();
    if (now - this.lastAnchorAt < 450) return;
    this.lastAnchorAt = now;
    const msg = this.anchorMessage();
    if (!msg) return;
    for (const g of this.connectedGuests()) this.send(g.control, msg);
  }

  // --------------------------------------------------------------- audio path

  private onPacket(packet: ArrayBuffer): void {
    // Event-driven upkeep: keeps working when background timers are throttled.
    this.timing.maybeTick();
    this.broadcastAnchor();
    for (const g of this.guests.values()) {
      const audio = g.audio;
      if (!audio?.open || g.connection !== 'connected') continue;
      if (g.phase === 'connecting' || g.phase === 'sound-off') continue;
      if (!g.gate.admit(bufferedAmount(audio))) continue;
      try {
        void audio.send(packet);
      } catch {
        /* closed mid-send; the close handler cleans up */
      }
    }
  }

  private onLocalStats(stats: RendererStats): void {
    const prevPhase = this.localPhase();
    this.localStats = stats;
    this.outputActivity.update(stats.level, performance.now());
    if (this.localPhase() !== prevPhase) this.broadcastRoom();
  }

  private onInputLevel(rms: number): void {
    const now = performance.now();
    const was = this.captureView.inputActive;
    const active = this.captureView.status === 'sharing' && this.inputActivity.update(rms, now);
    if (active !== was) {
      this.captureView = { ...this.captureView, inputActive: active };
      this.queueEmit();
    }
  }

  private localPhase(): SpeakerPhase {
    return deriveSpeakerPhase({
      connection: 'connected',
      audio: this.engine.state === 'running' ? 'on' : 'off',
      clockReady: this.timing.isValid,
      sharing: this.sharingState() === 'sharing' || this.clicksActive() ? 'sharing' : 'idle',
      renderer: this.localStats?.state ?? null,
      sourceActive: this.outputActivity.isActive(performance.now()),
    });
  }

  private clicksActive(): boolean {
    return performance.now() < this.clicksUntil;
  }

  private onContextState(): void {
    if (this.engine.state !== 'running') {
      this.timing.invalidateLocal();
    } else {
      this.timing.tick(true);
      this.engine.resync();
    }
    this.broadcastRoom();
  }

  private readonly onDeviceChange = (): void => {
    this.outputChanged = true;
    this.timing.invalidateLocal();
    setTimeout(() => this.timing.tick(true), 300);
    this.queueEmit();
  };

  private readonly onPageHide = (): void => {
    for (const g of this.connectedGuests()) this.send(g.control, { t: 'ended' });
  };

  // ------------------------------------------------------------- user actions

  /** Call synchronously from the click: getDisplayMedia runs before anything is awaited. */
  shareTab(): void {
    const request = ++this.captureRequest;
    const pending = requestTabCapture();
    const previous = this.captureView;
    this.captureView = { ...this.captureView, status: 'requesting', error: null };
    this.queueEmit();
    pending.then(
      (result) => {
        if (this.disposed || request !== this.captureRequest) {
          result.release();
          return;
        }
        this.startCapture(result);
      },
      (err: unknown) => {
        if (this.disposed || request !== this.captureRequest) return;
        const kind = err instanceof CaptureError ? err.kind : 'failed';
        // A dismissed picker leaves an existing share running.
        const keep = previous.status === 'sharing' && this.capture !== null;
        this.captureView = {
          ...previous,
          status: keep ? 'sharing' : kind === 'cancelled' && previous.status !== 'error' ? previous.status : 'error',
          error: kind,
        };
        this.queueEmit();
      },
    );
  }

  private startCapture(result: CaptureResult): void {
    this.capture = result;
    this.engine.attachCapture(result);
    this.inputActivity.reset();
    const track = result.audioTrack;
    const onEnded = () => {
      if (this.capture !== result) return;
      this.stopSharing('stopped');
    };
    const onMute = () => {
      if (this.capture !== result) return;
      this.captureView = { ...this.captureView, trackMuted: track.muted };
      this.queueEmit();
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onMute);
    result.videoTrack?.addEventListener('ended', onEnded);
    this.captureView = {
      status: 'sharing',
      error: null,
      suppression: result.suppression,
      inputActive: false,
      trackMuted: track.muted,
      sharingSince: performance.now(),
      processing: result.processing,
    };
    this.broadcastRoom();
    void relaxProcessing(result).then((processing) => {
      if (this.capture !== result) return;
      this.captureView = { ...this.captureView, processing };
      this.queueEmit();
    });
  }

  stopSharing(status: 'stopped' | 'idle' = 'stopped'): void {
    this.captureRequest++;
    this.capture = null;
    this.engine.detachCapture();
    this.inputActivity.reset();
    this.captureView = { ...this.captureView, status, inputActive: false, trackMuted: false, sharingSince: null };
    this.broadcastRoom();
  }

  dismissCaptureError(): void {
    if (this.captureView.status !== 'error' && !this.captureView.error) return;
    this.captureView = { ...this.captureView, status: this.capture ? 'sharing' : 'idle', error: null };
    this.queueEmit();
  }

  playTestClicks(): void {
    if (this.stage !== 'open' || this.clicksActive()) return;
    this.engine.scheduleClicks();
    this.clicksUntil = performance.now() + 9000;
    this.queueEmit();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.engine.setVolume(this.volume);
    savePrefs({ volume: this.volume });
    this.broadcastRoom();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.engine.setMuted(muted);
    this.broadcastRoom();
  }

  setTrim(ms: number): void {
    this.timing.setTrim(ms);
    savePrefs({ trimMs: this.timing.trim });
    this.outputChanged = false;
    this.queueEmit();
  }

  setCommonBuffer(ms: number): void {
    this.timing.setCommonBuffer(ms);
    this.broadcastRoom();
  }

  setHostName(name: string): void {
    this.hostName = sanitizeName(name, 'Host');
    savePrefs({ deviceName: this.hostName });
    this.broadcastRoom();
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.broadcastRoom();
  }

  resyncSelf(): void {
    this.timing.tick(true);
    this.engine.resync();
  }

  resyncAll(): void {
    this.resyncSelf();
    for (const g of this.connectedGuests()) this.send(g.control, { t: 'cmd', command: { action: 'resync' } });
  }

  private commandGuest(id: string, command: HostCommand): void {
    const g = this.guests.get(id);
    if (!g) return;
    this.send(g.control, { t: 'cmd', command });
  }

  setGuestMuted(id: string, muted: boolean): void {
    if (id === 'host') {
      this.setMuted(muted);
      return;
    }
    const g = this.guests.get(id);
    if (!g) return;
    g.muted = muted;
    this.commandGuest(id, { action: 'mute', muted });
    this.broadcastRoom();
  }

  setGuestVolume(id: string, volume: number): void {
    if (id === 'host') {
      this.setVolume(volume);
      return;
    }
    const g = this.guests.get(id);
    if (!g) return;
    g.volume = Math.max(0, Math.min(1, volume));
    this.commandGuest(id, { action: 'volume', volume: g.volume });
    this.queueEmit();
  }

  setAllMuted(muted: boolean): void {
    this.setMuted(muted);
    for (const g of this.guests.values()) {
      g.muted = muted;
      this.commandGuest(g.id, { action: 'mute', muted });
    }
    this.broadcastRoom();
  }

  removeGuest(id: string): void {
    const g = this.guests.get(id);
    if (!g) return;
    this.removed.add(id);
    this.commandGuest(id, { action: 'remove' });
    g.leaving = true;
    setTimeout(() => this.dropGuest(g), 300);
    this.guests.delete(id);
    this.broadcastRoom();
  }

  acknowledgeOutputChange(): void {
    this.outputChanged = false;
    this.queueEmit();
  }

  /** Ends the room for everyone and releases every resource. */
  async end(): Promise<void> {
    if (this.disposed) return;
    for (const g of this.connectedGuests()) this.send(g.control, { t: 'ended' });
    this.disposed = true;
    this.stage = 'ended';
    this.captureRequest++;
    for (const t of this.timers) clearInterval(t);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const u of this.unsubscribers) u();
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    window.removeEventListener('pagehide', this.onPageHide);
    void this.wakeLock.release();
    this.capture = null;
    await new Promise((r) => setTimeout(r, 250));
    for (const g of this.guests.values()) {
      if (g.graceTimer) clearTimeout(g.graceTimer);
      g.control?.close();
      g.audio?.close();
    }
    this.guests.clear();
    this.controlOwners.clear();
    this.peer?.destroy();
    this.peer = null;
    await this.engine.dispose();
    this.emitNow();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  probe(): SyncProbe | null {
    const stats = this.localStats;
    const map = this.timing.localMap();
    if (!stats || !map || stats.sourcePosition === null || this.disposed) return null;
    return {
      role: 'host',
      timeOrigin: performance.timeOrigin,
      sourceRate: stats.sourceRate,
      outputRate: stats.outputRate,
      sourcePosition: stats.sourcePosition,
      heardAtPerf: perfAt(map, stats.outputFrame / stats.outputRate),
      anchorSource: this.timing.diagnostics().anchorSource,
      thetaMs: 0,
      framesPlayed: stats.framesPlayed,
      level: stats.level,
      epoch: stats.epoch,
    };
  }

  // ----------------------------------------------------------------- snapshot

  private queueEmit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.emitNow();
    });
  }

  private emitNow(): void {
    this.store.set(this.buildSnapshot());
  }

  private buildSnapshot(): HostSnapshot {
    const speakers: SpeakerView[] = this.engine ? this.speakerInfos().map((s) => ({ ...s, isSelf: s.id === 'host' })) : [];
    const links: LinkDiagnostics[] = [...this.guests.values()].map((g) => ({
      id: g.id,
      name: g.name,
      sent: g.gate.sent,
      dropped: g.gate.dropped,
      backpressureEpisodes: g.gate.episodes,
      bufferedBytes: bufferedAmount(g.audio),
      channel: describeChannel(g.audio),
    }));
    const inviteUrl = this.code ? buildInviteUrl(location.origin, location.pathname, this.code) : null;
    return {
      kind: 'host',
      stage: this.stage,
      failure: this.failure,
      code: this.code,
      inviteUrl,
      sessionId: this.sessionId,
      locked: this.locked,
      signaling: this.signaling,
      hostName: this.hostName,
      speakers,
      capture: this.captureView,
      local: {
        volume: this.volume,
        muted: this.muted,
        trimMs: this.timing?.trim ?? 0,
        contextState: this.engine?.state ?? 'closed',
        renderer: this.localStats,
        timing: this.timing?.diagnostics() ?? null,
        outputGain: this.engine?.outputGainValue ?? 0,
      },
      mutedAll: speakers.length > 0 && speakers.every((s) => s.muted),
      commonBufferMs: this.timing?.commonBuffer ?? 1200,
      clicksActive: this.clicksActive(),
      links,
      maxSpeakers: MAX_SPEAKERS,
      outputChanged: this.outputChanged,
    };
  }
}

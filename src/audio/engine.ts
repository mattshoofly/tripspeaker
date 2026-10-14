import { readContextClock, type AnchorSource, type TimePair } from '../core/anchor';
import { packetFramesFor } from '../core/packetizer';
import type { RendererStats, TimingUpdate } from '../core/renderer';
import type { ClickSchedule } from '../core/testSignal';
import type { CaptureResult } from './capture';
import { captureWorkletUrl, rendererWorkletUrl } from './workletUrls';
import {
  CAPTURE_PROCESSOR,
  RENDERER_PROCESSOR,
  type CaptureInbound,
  type CaptureOutbound,
  type RendererInbound,
  type RendererOutbound,
} from './workletMessages';

export type EngineRole = 'host' | 'guest';

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly set = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.set.add(fn);
    return () => this.set.delete(fn);
  }
  emit(value: T): void {
    for (const fn of this.set) {
      try {
        fn(value);
      } catch (err) {
        console.error(err);
      }
    }
  }
  clear(): void {
    this.set.clear();
  }
}

export interface InputLevel {
  rms: number;
  peak: number;
}

/** Perceptual volume curve; 0.0–1.0 slider to linear gain. */
export function volumeToGain(volume: number): number {
  const v = Math.max(0, Math.min(1, volume));
  return v * v;
}

function createContext(role: EngineRole): AudioContext {
  const preferred = (globalThis as { __TRIP_SPEAKER_TEST__?: { sampleRate?: number } }).__TRIP_SPEAKER_TEST__?.sampleRate;
  if (role === 'host') {
    try {
      return new AudioContext({ latencyHint: 'interactive', sampleRate: preferred ?? 48000 });
    } catch {
      return new AudioContext({ latencyHint: 'interactive' });
    }
  }
  if (preferred) {
    try {
      return new AudioContext({ latencyHint: 'interactive', sampleRate: preferred });
    } catch {
      /* fall through to the device rate */
    }
  }
  return new AudioContext({ latencyHint: 'interactive' });
}

/**
 * Owns one AudioContext and its worklets for the lifetime of a room. It is
 * deliberately independent of React: UI transitions never recreate it.
 */
export class AudioEngine {
  readonly context: AudioContext;
  readonly role: EngineRole;
  readonly outputAnalyser: AnalyserNode;
  readonly inputAnalyser: AnalyserNode | null;
  private readonly outputGain: GainNode;
  private readonly silentSink: GainNode | null;
  private renderer: AudioWorkletNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private activeCapture: CaptureResult | null = null;
  private initPromise: Promise<void> | null = null;
  private volume = 1;
  private muted = false;
  private disposed = false;
  latestStats: RendererStats | null = null;

  readonly stats = new Emitter<RendererStats>();
  readonly packets = new Emitter<ArrayBuffer>();
  readonly inputLevel = new Emitter<InputLevel>();
  readonly clicksScheduled = new Emitter<ClickSchedule>();
  readonly contextState = new Emitter<AudioContextState | string>();

  /**
   * Must run synchronously inside a click handler: the context is created and
   * resumed under the user's gesture, before anything is awaited.
   */
  static createInGesture(role: EngineRole): AudioEngine {
    const context = createContext(role);
    void context.resume().catch(() => undefined);
    return new AudioEngine(context, role);
  }

  private constructor(context: AudioContext, role: EngineRole) {
    this.context = context;
    this.role = role;
    this.outputGain = context.createGain();
    this.outputGain.connect(context.destination);
    this.outputAnalyser = context.createAnalyser();
    this.outputAnalyser.fftSize = 2048;
    this.outputAnalyser.smoothingTimeConstant = 0;
    if (role === 'host') {
      this.inputAnalyser = context.createAnalyser();
      this.inputAnalyser.fftSize = 2048;
      this.inputAnalyser.smoothingTimeConstant = 0;
      this.silentSink = context.createGain();
      this.silentSink.gain.value = 0;
      this.silentSink.connect(context.destination);
    } else {
      this.inputAnalyser = null;
      this.silentSink = null;
    }
    context.addEventListener('statechange', this.onStateChange);
  }

  private readonly onStateChange = (): void => {
    this.contextState.emit(this.context.state);
  };

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get state(): AudioContextState | string {
    return this.context.state;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Resume after an interruption; call from a user gesture where possible. */
  resume(): Promise<void> {
    return this.context.resume().catch(() => undefined);
  }

  init(sessionId: number, epoch: number): Promise<void> {
    if (!this.initPromise) this.initPromise = this.build(sessionId, epoch);
    return this.initPromise;
  }

  private async build(sessionId: number, epoch: number): Promise<void> {
    const ctx = this.context;
    await ctx.audioWorklet.addModule(rendererWorkletUrl);
    if (this.role === 'host') await ctx.audioWorklet.addModule(captureWorkletUrl);
    if (this.disposed) return;

    const renderer = new AudioWorkletNode(ctx, RENDERER_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    renderer.port.onmessage = (e: MessageEvent<RendererOutbound>) => {
      if (e.data?.type === 'stats') {
        this.latestStats = e.data.stats;
        this.stats.emit(e.data.stats);
      }
    };
    renderer.onprocessorerror = () => console.error('Trip Speaker renderer stopped unexpectedly');
    renderer.connect(this.outputGain);
    renderer.connect(this.outputAnalyser);
    this.renderer = renderer;
    this.postRenderer({ type: 'session', sessionId });

    if (this.role === 'host' && this.silentSink) {
      const capture = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { sessionId, epoch, packetFrames: packetFramesFor(ctx.sampleRate) },
      });
      capture.port.onmessage = (e: MessageEvent<CaptureOutbound>) => {
        const msg = e.data;
        if (msg.type === 'packet') this.packets.emit(msg.packet);
        else if (msg.type === 'level') this.inputLevel.emit({ rms: msg.rms, peak: msg.peak });
        else if (msg.type === 'clicks-scheduled') this.clicksScheduled.emit(msg.schedule);
      };
      capture.onprocessorerror = () => console.error('Trip Speaker capture stopped unexpectedly');
      // Keeps the capture worklet pulled by the graph without making a sound.
      capture.connect(this.silentSink);
      // Host playback is fed straight from the capture thread into the same
      // delayed renderer guests use; there is no undelayed monitor path.
      const channel = new MessageChannel();
      capture.port.postMessage({ type: 'local-port', port: channel.port1 } satisfies CaptureInbound, [channel.port1]);
      renderer.port.postMessage({ type: 'input-port', port: channel.port2 } satisfies RendererInbound, [channel.port2]);
      this.capture = capture;
    }
    this.applyGain(true);
  }

  private postRenderer(msg: RendererInbound, transfer?: Transferable[]): void {
    if (!this.renderer) return;
    if (transfer) this.renderer.port.postMessage(msg, transfer);
    else this.renderer.port.postMessage(msg);
  }

  private postCapture(msg: CaptureInbound): void {
    this.capture?.port.postMessage(msg);
  }

  setSession(sessionId: number): void {
    this.postRenderer({ type: 'session', sessionId });
  }

  configureCapture(sessionId: number, epoch: number): void {
    this.postCapture({ type: 'configure', sessionId, epoch });
  }

  setTiming(timing: TimingUpdate | null): void {
    this.postRenderer({ type: 'timing', timing });
  }

  pushPacket(packet: ArrayBuffer): void {
    this.postRenderer({ type: 'packet', packet }, [packet]);
  }

  resync(): void {
    this.postRenderer({ type: 'resync' });
  }

  scheduleClicks(count = 8, intervalSeconds = 0.75, leadSeconds = 0.35): void {
    this.postCapture({ type: 'clicks', count, intervalSeconds, leadSeconds });
  }

  get hasCapture(): boolean {
    return this.activeCapture !== null;
  }

  attachCapture(capture: CaptureResult): void {
    this.detachCapture();
    if (!this.capture || this.disposed) {
      capture.release();
      return;
    }
    const source = this.context.createMediaStreamSource(new MediaStream([capture.audioTrack]));
    source.connect(this.capture);
    if (this.inputAnalyser) source.connect(this.inputAnalyser);
    this.source = source;
    this.activeCapture = capture;
    this.postCapture({ type: 'active', active: true });
  }

  detachCapture(): void {
    this.postCapture({ type: 'active', active: false });
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* already disconnected */
      }
      this.source = null;
    }
    if (this.activeCapture) {
      this.activeCapture.release();
      this.activeCapture = null;
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** Current output gain target (exposed for diagnostics and tests). */
  get outputGainValue(): number {
    return this.muted ? 0 : volumeToGain(this.volume);
  }

  private applyGain(immediate = false): void {
    const target = this.outputGainValue;
    const param = this.outputGain.gain;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    if (immediate) param.setValueAtTime(target, now);
    else param.setTargetAtTime(target, now, 0.015);
  }

  readOutputClock(): { pair: TimePair; source: AnchorSource } | null {
    const ctx = this.context;
    if (ctx.state !== 'running') return null;
    let ts: AudioTimestamp | undefined;
    try {
      ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : undefined;
    } catch {
      ts = undefined;
    }
    return readContextClock({
      outputTimestamp: ts,
      currentTime: ctx.currentTime,
      nowMs: performance.now(),
      baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.detachCapture();
    this.context.removeEventListener('statechange', this.onStateChange);
    for (const node of [this.renderer, this.capture]) {
      if (!node) continue;
      try {
        node.port.postMessage({ type: 'dispose' });
        node.port.onmessage = null;
        node.disconnect();
      } catch {
        /* node already gone */
      }
    }
    this.renderer = null;
    this.capture = null;
    for (const e of [this.stats, this.packets, this.inputLevel, this.clicksScheduled, this.contextState]) e.clear();
    try {
      await this.context.close();
    } catch {
      /* already closed */
    }
  }
}

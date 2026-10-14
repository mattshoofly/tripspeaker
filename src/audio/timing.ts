import { AnchorTracker, type AnchorSource, type LinearClockMap } from '../core/anchor';
import { buildRendererTiming, clampCommonBuffer, clampTrim, COMMON_BUFFER_DEFAULT_MS } from '../core/timeline';
import type { AudioEngine } from './engine';

export interface StreamInfo {
  sessionId: number;
  epoch: number;
  sourceRate: number;
}

export interface TimingDiagnostics {
  timingValid: boolean;
  anchorSource: AnchorSource | null;
  anchorResidualMs: number;
  localSlope: number | null;
  hostSlope: number | null;
  outputRate: number;
  sourceRate: number | null;
  commonBufferMs: number;
  trimMs: number;
  outputLatencyMs: number | null;
  baseLatencyMs: number | null;
}

/**
 * Turns the latest clock knowledge into the renderer's timing map. It runs on
 * the main thread a few times per second; audio rendering never waits on it.
 */
export class TimingController {
  private readonly local = new AnchorTracker();
  private hostMap: LinearClockMap | null = null;
  private stream: StreamInfo | null = null;
  private theta: number | null;
  private trimMs = 0;
  private commonBufferMs = COMMON_BUFFER_DEFAULT_MS;
  private promptNext = false;
  private lastTick = 0;
  private valid = false;
  private readonly engine: AudioEngine;
  private readonly role: 'host' | 'guest';

  constructor(engine: AudioEngine, role: 'host' | 'guest') {
    this.engine = engine;
    this.role = role;
    this.theta = role === 'host' ? 0 : null;
  }

  get isValid(): boolean {
    return this.valid;
  }

  /** The host's own output mapping (what it broadcasts as the anchor). */
  localMap(): LinearClockMap | null {
    return this.local.map();
  }

  setStream(info: StreamInfo): void {
    this.stream = info;
  }

  setHostMap(map: LinearClockMap): void {
    this.hostMap = map;
  }

  setTheta(theta: number | null): void {
    if (this.role === 'host') return;
    this.theta = theta;
  }

  setTrim(ms: number): void {
    const next = clampTrim(ms);
    if (next === this.trimMs) return;
    this.trimMs = next;
    this.promptNext = true;
    this.tick(true);
  }

  get trim(): number {
    return this.trimMs;
  }

  setCommonBuffer(ms: number): void {
    const next = clampCommonBuffer(ms);
    if (next === this.commonBufferMs) return;
    this.commonBufferMs = next;
    this.tick(true);
  }

  get commonBuffer(): number {
    return this.commonBufferMs;
  }

  /** Forget the local output mapping (suspension, device change, reconnect). */
  invalidateLocal(): void {
    this.local.reset();
    this.valid = false;
    this.engine.setTiming(null);
  }

  maybeTick(now = performance.now()): void {
    if (now - this.lastTick >= 240) this.tick();
  }

  tick(force = false): boolean {
    const now = performance.now();
    if (!force && now - this.lastTick < 50) return this.valid;
    this.lastTick = now;
    const reading = this.engine.readOutputClock();
    if (!reading) return this.valid;
    const update = this.local.add(reading.pair, reading.source);
    const localMap = this.local.map();
    const hostMap = this.role === 'host' ? localMap : this.hostMap;
    const stream = this.stream;
    if (!localMap || !hostMap || !stream || this.theta === null) return this.valid;
    // Two samples are required before trusting a fresh local mapping.
    if (this.local.sampleCount < 2 && update !== 'reset') return this.valid;

    const timing = buildRendererTiming(
      {
        host: hostMap,
        local: localMap,
        sourceRate: stream.sourceRate,
        outputRate: this.engine.sampleRate,
        thetaMs: this.theta,
        commonBufferMs: this.commonBufferMs,
        trimMs: this.trimMs,
      },
      this.engine.context.currentTime,
    );
    this.engine.setTiming({
      ...timing,
      sessionId: stream.sessionId,
      epoch: stream.epoch,
      sourceRate: stream.sourceRate,
      prompt: this.promptNext,
    });
    this.promptNext = false;
    this.valid = true;
    return true;
  }

  diagnostics(): TimingDiagnostics {
    const ctx = this.engine.context;
    const localMap = this.local.map();
    const hostMap = this.role === 'host' ? localMap : this.hostMap;
    return {
      timingValid: this.valid,
      anchorSource: this.local.source,
      anchorResidualMs: this.local.residualMs,
      localSlope: localMap?.slope ?? null,
      hostSlope: hostMap?.slope ?? null,
      outputRate: ctx.sampleRate,
      sourceRate: this.stream?.sourceRate ?? null,
      commonBufferMs: this.commonBufferMs,
      trimMs: this.trimMs,
      outputLatencyMs: Number.isFinite(ctx.outputLatency) ? ctx.outputLatency * 1000 : null,
      baseLatencyMs: Number.isFinite(ctx.baseLatency) ? ctx.baseLatency * 1000 : null,
    };
  }
}

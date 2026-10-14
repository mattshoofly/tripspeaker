import { decodePacket } from './packet';
import { SampleRing, nextPowerOfTwo } from './sampleRing';
import { sourceFrameAt, type RendererTiming } from './timeline';

/**
 * Deadline-driven renderer. Runs inside the playback AudioWorklet and is pure
 * TypeScript so it can be simulated deterministically in unit tests.
 *
 * Every output frame asks "which source frame should be heard now?" via the
 * timing map; audio is never played "when it arrives". Small errors are
 * corrected with a bounded resampling adjustment, larger ones with a short
 * crossfade jump, and discontinuities with a fade-out and rebuffer.
 */

export interface TimingUpdate extends RendererTiming {
  sessionId: number;
  epoch: number;
  sourceRate: number;
  /** Apply promptly (user trim) with a crossfade instead of a slow slew. */
  prompt?: boolean;
}

export type RendererState = 'waiting' | 'buffering' | 'playing' | 'starved';

export interface RendererStats {
  state: RendererState;
  sessionId: number;
  epoch: number;
  sourceRate: number;
  outputRate: number;
  packets: number;
  invalidPackets: number;
  staleSessionPackets: number;
  staleEpochPackets: number;
  latePackets: number;
  lateFrames: number;
  earlyFrames: number;
  duplicateFrames: number;
  framesPlayed: number;
  missingFrames: number;
  underruns: number;
  resyncs: number;
  jumps: number;
  bufferedMs: number | null;
  errorMs: number | null;
  correctionPpm: number;
  level: number;
  peak: number;
  /** Source position heard at `outputFrame` (instrumentation for sync checks). */
  sourcePosition: number | null;
  outputFrame: number;
}

export interface RendererOptions {
  outputRate: number;
  capacitySeconds?: number;
  maxSourceRate?: number;
  gapFadeMs?: number;
  crossfadeMs?: number;
  resetFadeMs?: number;
  jumpThresholdMs?: number;
  rebufferThresholdMs?: number;
  maxCorrection?: number;
  correctionTauSeconds?: number;
  starveMs?: number;
  activeStreamMs?: number;
}

export function hermite(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const c1 = 0.5 * (p2 - p0);
  const c2 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);
  return ((c3 * t + c2) * t + c1) * t + p1;
}

export class RendererCore {
  readonly outputRate: number;
  private readonly ring: SampleRing;
  private readonly gapFadeFrames: number;
  private readonly crossfadeFrames: number;
  private readonly resetFadeFrames: number;
  private readonly jumpThresholdMs: number;
  private readonly rebufferThresholdMs: number;
  private readonly maxCorrection: number;
  private readonly tau: number;
  private readonly starveFrames: number;
  private readonly activeStreamFrames: number;

  private sessionId = 0;
  private epoch = -1;
  private sourceRate = 0;
  private timing: TimingUpdate | null = null;
  private promptPending = false;

  private readPos: number | null = null;
  private env = 0;
  private correction = 0;
  private xfadeLeft = 0;
  private xfadeOldPos = 0;
  private xfadeOldEnv = 0;
  private readonly tail: Float32Array;
  private tailLen = 0;
  private tailPos = 0;

  private nextOutputFrame = 0;
  private lastPacketOutputFrame = Number.NEGATIVE_INFINITY;
  private invalidRun = 0;
  private holeCounted = false;
  private lastErrorFrames: number | null = null;

  private sumSq = 0;
  private sumCount = 0;
  private peakValue = 0;

  private counters = {
    packets: 0,
    invalidPackets: 0,
    staleSessionPackets: 0,
    staleEpochPackets: 0,
    latePackets: 0,
    lateFrames: 0,
    earlyFrames: 0,
    duplicateFrames: 0,
    framesPlayed: 0,
    missingFrames: 0,
    underruns: 0,
    resyncs: 0,
    jumps: 0,
  };

  constructor(opts: RendererOptions) {
    this.outputRate = opts.outputRate;
    const maxSourceRate = opts.maxSourceRate ?? 48000;
    this.ring = new SampleRing(nextPowerOfTwo(Math.ceil(maxSourceRate * (opts.capacitySeconds ?? 4))));
    this.gapFadeFrames = Math.max(8, Math.round(((opts.gapFadeMs ?? 3) * this.outputRate) / 1000));
    this.crossfadeFrames = Math.max(16, Math.round(((opts.crossfadeMs ?? 12) * this.outputRate) / 1000));
    this.resetFadeFrames = Math.max(16, Math.round(((opts.resetFadeMs ?? 8) * this.outputRate) / 1000));
    this.jumpThresholdMs = opts.jumpThresholdMs ?? 30;
    this.rebufferThresholdMs = opts.rebufferThresholdMs ?? 600;
    this.maxCorrection = opts.maxCorrection ?? 0.0025;
    this.tau = opts.correctionTauSeconds ?? 4;
    this.starveFrames = Math.round(((opts.starveMs ?? 400) * this.outputRate) / 1000);
    this.activeStreamFrames = Math.round(((opts.activeStreamMs ?? 500) * this.outputRate) / 1000);
    this.tail = new Float32Array(this.resetFadeFrames);
  }

  get ringCapacity(): number {
    return this.ring.capacity;
  }

  /** Adopt a session; switching sessions discards everything buffered. */
  setSession(sessionId: number): void {
    if (sessionId === this.sessionId) return;
    this.fadeOutAndClear();
    this.sessionId = sessionId;
    this.epoch = -1;
    this.sourceRate = 0;
    this.timing = null;
  }

  setTiming(update: TimingUpdate | null): void {
    if (update === null) {
      if (this.readPos !== null) this.captureTail();
      this.readPos = null;
      this.env = 0;
      this.xfadeLeft = 0;
      this.timing = null;
      return;
    }
    if (!Number.isFinite(update.refOutputFrame) || !Number.isFinite(update.refSourceFrame)) return;
    if (!(update.step > 0.05 && update.step < 20)) return;
    if (update.sessionId !== this.sessionId) return;
    if (this.epoch >= 0 && update.epoch !== this.epoch) {
      // Timing for a newer stream arrives before its first packet; adopt it.
      if (update.epoch < this.epoch) return;
      this.adoptEpoch(update.epoch, update.sourceRate);
    } else if (this.epoch < 0) {
      this.adoptEpoch(update.epoch, update.sourceRate);
    }
    if (update.sourceRate !== this.sourceRate) return;
    this.timing = update;
    if (update.prompt) this.promptPending = true;
  }

  /** Fade out and restart at the current target, keeping buffered audio. */
  resync(): void {
    if (this.readPos !== null) {
      this.captureTail();
      this.counters.resyncs++;
    }
    this.readPos = null;
    this.env = 0;
    this.xfadeLeft = 0;
    this.correction = 0;
  }

  push(buffer: ArrayBuffer): void {
    const decoded = decodePacket(buffer);
    if (!decoded.ok) {
      this.counters.invalidPackets++;
      return;
    }
    const h = decoded.header;
    if (this.sessionId === 0 || h.sessionId !== this.sessionId) {
      this.counters.staleSessionPackets++;
      return;
    }
    if (h.epoch < this.epoch) {
      this.counters.staleEpochPackets++;
      return;
    }
    if (h.epoch > this.epoch || h.sampleRate !== this.sourceRate) {
      this.adoptEpoch(h.epoch, h.sampleRate);
    }
    this.counters.packets++;
    this.lastPacketOutputFrame = this.nextOutputFrame;
    const window = this.writeWindow();
    const res = this.ring.write(h.firstFrame, decoded.pcm, window);
    this.counters.lateFrames += res.late;
    this.counters.earlyFrames += res.early;
    this.counters.duplicateFrames += res.duplicate;
    if (res.late === h.frames) this.counters.latePackets++;
  }

  private writeWindow(): { minFrame: number; maxFrame: number } | null {
    let pos: number | null = this.readPos;
    if (pos === null && this.timing) pos = sourceFrameAt(this.timing, this.nextOutputFrame);
    if (pos === null) return null;
    const floor = Math.floor(pos);
    return { minFrame: floor - 2, maxFrame: floor + this.ring.capacity - 4096 };
  }

  private adoptEpoch(epoch: number, sourceRate: number): void {
    this.fadeOutAndClear();
    this.epoch = epoch;
    this.sourceRate = sourceRate;
    if (this.timing && (this.timing.epoch !== epoch || this.timing.sourceRate !== sourceRate)) this.timing = null;
  }

  private fadeOutAndClear(): void {
    if (this.readPos !== null) this.captureTail();
    this.ring.clear();
    this.readPos = null;
    this.env = 0;
    this.xfadeLeft = 0;
    this.correction = 0;
    this.invalidRun = 0;
    this.holeCounted = false;
  }

  /** Pre-render a short fade-out from the current position so resets never click. */
  private captureTail(): void {
    if (this.readPos === null) return;
    const step = this.timing ? this.timing.step * (1 + this.correction) : 1;
    let pos = this.readPos;
    const len = this.tail.length;
    for (let j = 0; j < len; j++) {
      this.tail[j] = this.sampleAt(pos) * this.env * (1 - (j + 1) / len);
      pos += step;
    }
    this.tailLen = len;
    this.tailPos = 0;
  }

  private sampleAt(pos: number): number {
    const base = Math.floor(pos);
    const r = this.ring;
    return hermite(r.at(base - 1), r.at(base), r.at(base + 1), r.at(base + 2), pos - base);
  }

  render(out: Float32Array, outputFrame: number): void {
    const n = out.length;
    out.fill(0);
    if (this.tailLen > 0) {
      const count = Math.min(n, this.tailLen - this.tailPos);
      for (let i = 0; i < count; i++) out[i] += this.tail[this.tailPos + i];
      this.tailPos += count;
      if (this.tailPos >= this.tailLen) this.tailLen = 0;
    }
    this.nextOutputFrame = outputFrame + n;

    const timing = this.timing;
    if (!timing || this.sourceRate <= 0) {
      this.lastErrorFrames = null;
      this.holeCounted = false;
      return;
    }
    const target = sourceFrameAt(timing, outputFrame);
    const sr = this.sourceRate;
    const ring = this.ring;

    if (this.readPos !== null) {
      const errFrames = target - this.readPos;
      const errMs = (errFrames / sr) * 1000;
      if (Math.abs(errMs) > this.rebufferThresholdMs) {
        this.captureTail();
        this.readPos = null;
        this.env = 0;
        this.xfadeLeft = 0;
        this.correction = 0;
        this.counters.resyncs++;
      } else if (Math.abs(errMs) > this.jumpThresholdMs || (this.promptPending && Math.abs(errMs) > 0.5)) {
        this.xfadeOldPos = this.readPos;
        this.xfadeOldEnv = this.env;
        this.xfadeLeft = this.crossfadeFrames;
        this.readPos = target;
        this.correction = 0;
        this.counters.jumps++;
      } else {
        const desired = Math.max(-this.maxCorrection, Math.min(this.maxCorrection, errFrames / sr / this.tau));
        const maxDelta = 0.00005;
        this.correction += Math.max(-maxDelta, Math.min(maxDelta, desired - this.correction));
      }
      this.promptPending = false;
    }

    if (this.readPos === null) {
      const base = Math.floor(target);
      const lookahead = Math.ceil(this.gapFadeFrames * timing.step) + 2;
      if (ring.has(base) && ring.has(base + 1) && ring.has(base + lookahead)) {
        this.readPos = target;
        this.env = 0;
        this.correction = 0;
        this.invalidRun = 0;
        this.promptPending = false;
      } else {
        this.lastErrorFrames = null;
        this.holeCounted = false;
        return;
      }
    }

    const stepEff = timing.step * (1 + this.correction);
    const lookaheadSrc = this.gapFadeFrames * stepEff;
    const envStep = 1 / this.gapFadeFrames;
    const streamActive = this.nextOutputFrame - this.lastPacketOutputFrame <= this.activeStreamFrames + n;
    let pos = this.readPos;
    let env = this.env;
    let sumSq = 0;
    let peak = this.peakValue;

    for (let i = 0; i < n; i++) {
      const base = Math.floor(pos);
      const frac = pos - base;
      const p1Valid = ring.has(base);
      const validNow = p1Valid && ring.has(base + 1);
      const validAhead = ring.has(Math.floor(pos + lookaheadSrc));
      const envTarget = validNow && validAhead ? 1 : 0;
      if (env < envTarget) env = Math.min(1, env + envStep);
      else if (env > envTarget) env = Math.max(0, env - envStep);

      let v = 0;
      if (env > 0) v = hermite(ring.at(base - 1), ring.at(base), ring.at(base + 1), ring.at(base + 2), frac) * env;

      if (this.xfadeLeft > 0) {
        const w = this.xfadeLeft / this.crossfadeFrames;
        const old = this.sampleAt(this.xfadeOldPos) * this.xfadeOldEnv;
        v = v * (1 - w) + old * w;
        this.xfadeOldPos += stepEff;
        this.xfadeLeft--;
      }

      out[i] += v;
      sumSq += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;

      if (p1Valid) {
        this.counters.framesPlayed++;
        this.invalidRun = 0;
        this.holeCounted = false;
      } else {
        this.invalidRun++;
        // Only a hole in an active stream counts; a host that stopped sharing is not an underrun.
        if (streamActive && ring.newestEnd > base) {
          this.counters.missingFrames++;
          if (!this.holeCounted) {
            this.counters.underruns++;
            this.holeCounted = true;
          }
        }
      }
      pos += stepEff;
    }

    this.readPos = pos;
    this.env = env;
    this.lastErrorFrames = sourceFrameAt(timing, outputFrame + n) - pos;
    this.sumSq += sumSq;
    this.sumCount += n;
    this.peakValue = peak;
  }

  get state(): RendererState {
    if (!this.timing) return 'waiting';
    if (this.readPos === null) return 'buffering';
    if (this.invalidRun > this.starveFrames) return 'starved';
    return 'playing';
  }

  /** Snapshot for diagnostics; resets the level meter window. */
  stats(): RendererStats {
    const sr = this.sourceRate;
    const level = this.sumCount > 0 ? Math.sqrt(this.sumSq / this.sumCount) : 0;
    const peak = this.peakValue;
    this.sumSq = 0;
    this.sumCount = 0;
    this.peakValue = 0;
    let buffered: number | null = null;
    if (sr > 0 && this.ring.newestEnd >= 0) {
      const pos = this.readPos ?? (this.timing ? sourceFrameAt(this.timing, this.nextOutputFrame) : null);
      if (pos !== null) buffered = Math.max(0, ((this.ring.newestEnd - pos) / sr) * 1000);
    }
    return {
      state: this.state,
      sessionId: this.sessionId,
      epoch: this.epoch,
      sourceRate: sr,
      outputRate: this.outputRate,
      ...this.counters,
      bufferedMs: buffered,
      errorMs: this.lastErrorFrames !== null && sr > 0 ? (this.lastErrorFrames / sr) * 1000 : null,
      correctionPpm: this.correction * 1e6,
      level,
      peak,
      sourcePosition: this.readPos,
      outputFrame: this.nextOutputFrame,
    };
  }
}

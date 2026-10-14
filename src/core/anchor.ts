/**
 * Tracks the mapping between an AudioContext's timeline (seconds) and the
 * page's performance clock (milliseconds) at the *output*: "the sample at
 * context time T is heard at performance time P".
 *
 * Primary source: AudioContext.getOutputTimestamp(), which already includes
 * output latency. Fallback (reduced confidence): currentTime + now +
 * baseLatency + outputLatency. Latency is added only in the fallback; adding
 * it to an output timestamp would compensate twice.
 */

export interface TimePair {
  /** AudioContext time in seconds. */
  contextTime: number;
  /** performance.now() domain, milliseconds. */
  performanceTime: number;
}

export type AnchorSource = 'output-timestamp' | 'estimated';

export interface ContextClockReading {
  outputTimestamp: Partial<TimePair> | null | undefined;
  currentTime: number;
  nowMs: number;
  baseLatency: number | undefined;
  outputLatency: number | undefined;
}

/**
 * Returns a usable pair or null. Rejects zeros (suspended contexts report
 * {0, 0}), non-finite values, and stale or future readings.
 */
export function validateOutputTimestamp(
  ts: Partial<TimePair> | null | undefined,
  nowMs: number,
  currentTime: number,
): TimePair | null {
  if (!ts) return null;
  const { contextTime, performanceTime } = ts;
  if (typeof contextTime !== 'number' || typeof performanceTime !== 'number') return null;
  if (!Number.isFinite(contextTime) || !Number.isFinite(performanceTime)) return null;
  if (contextTime <= 0 || performanceTime <= 0) return null;
  // Output position cannot lead processing; more than a second behind means a stale reading.
  if (contextTime > currentTime + 0.05 || contextTime < currentTime - 1) return null;
  if (performanceTime > nowMs + 100 || performanceTime < nowMs - 1000) return null;
  return { contextTime, performanceTime };
}

export function estimatedPair(currentTime: number, nowMs: number, baseLatency = 0, outputLatency = 0): TimePair | null {
  if (!Number.isFinite(currentTime) || currentTime <= 0 || !Number.isFinite(nowMs)) return null;
  const latency = (Number.isFinite(baseLatency) ? baseLatency : 0) + (Number.isFinite(outputLatency) ? outputLatency : 0);
  return { contextTime: currentTime, performanceTime: nowMs + Math.max(0, latency) * 1000 };
}

export function readContextClock(r: ContextClockReading): { pair: TimePair; source: AnchorSource } | null {
  const valid = validateOutputTimestamp(r.outputTimestamp, r.nowMs, r.currentTime);
  if (valid) return { pair: valid, source: 'output-timestamp' };
  const est = estimatedPair(r.currentTime, r.nowMs, r.baseLatency, r.outputLatency);
  return est ? { pair: est, source: 'estimated' } : null;
}

export interface LinearClockMap {
  refContextTime: number;
  refPerformanceTime: number;
  /** ms of performance time per second of context time (nominally 1000). */
  slope: number;
}

export function perfAt(map: LinearClockMap, contextTime: number): number {
  return map.refPerformanceTime + (contextTime - map.refContextTime) * map.slope;
}

export function contextAt(map: LinearClockMap, performanceTime: number): number {
  return map.refContextTime + (performanceTime - map.refPerformanceTime) / map.slope;
}

export type AnchorUpdate = 'accepted' | 'stale' | 'outlier' | 'reset';

export interface AnchorTrackerOptions {
  windowSize?: number;
  maxPpm?: number;
  discontinuityMs?: number;
  confirmDiscontinuity?: number;
  minSpanForSlope?: number;
}

export class AnchorTracker {
  private pairs: TimePair[] = [];
  private fit: LinearClockMap | null = null;
  private pendingOutliers = 0;
  private lastSource: AnchorSource | null = null;
  private readonly windowSize: number;
  private readonly maxPpm: number;
  private readonly discontinuityMs: number;
  private readonly confirmDiscontinuity: number;
  private readonly minSpanForSlope: number;
  residualMs = 0;

  constructor({
    windowSize = 24,
    maxPpm = 1000,
    discontinuityMs = 15,
    confirmDiscontinuity = 2,
    minSpanForSlope = 2,
  }: AnchorTrackerOptions = {}) {
    this.windowSize = windowSize;
    this.maxPpm = maxPpm;
    this.discontinuityMs = discontinuityMs;
    this.confirmDiscontinuity = confirmDiscontinuity;
    this.minSpanForSlope = minSpanForSlope;
  }

  get ready(): boolean {
    return this.fit !== null;
  }

  get source(): AnchorSource | null {
    return this.lastSource;
  }

  get sampleCount(): number {
    return this.pairs.length;
  }

  map(): LinearClockMap | null {
    return this.fit;
  }

  reset(): void {
    this.pairs = [];
    this.fit = null;
    this.pendingOutliers = 0;
    this.residualMs = 0;
    this.lastSource = null;
  }

  add(pair: TimePair, source: AnchorSource = 'output-timestamp'): AnchorUpdate {
    if (this.lastSource !== null && source !== this.lastSource) {
      // Switching between measured and estimated mappings changes the latency model.
      this.reset();
    }
    this.lastSource = source;
    const last = this.pairs[this.pairs.length - 1];
    if (last && pair.contextTime <= last.contextTime) return 'stale';

    if (this.fit) {
      const residual = pair.performanceTime - perfAt(this.fit, pair.contextTime);
      if (Math.abs(residual) > this.discontinuityMs) {
        this.pendingOutliers++;
        if (this.pendingOutliers < this.confirmDiscontinuity) return 'outlier';
        this.pairs = [pair];
        this.pendingOutliers = 0;
        this.refit();
        return 'reset';
      }
    }
    this.pendingOutliers = 0;
    this.pairs.push(pair);
    if (this.pairs.length > this.windowSize) this.pairs.splice(0, this.pairs.length - this.windowSize);
    this.refit();
    return 'accepted';
  }

  private refit(): void {
    const n = this.pairs.length;
    if (n === 0) {
      this.fit = null;
      return;
    }
    const x0 = this.pairs[0].contextTime;
    const y0 = this.pairs[0].performanceTime;
    let mx = 0;
    let my = 0;
    for (const p of this.pairs) {
      mx += p.contextTime - x0;
      my += p.performanceTime - y0;
    }
    mx /= n;
    my /= n;
    let sxx = 0;
    let sxy = 0;
    for (const p of this.pairs) {
      const dx = p.contextTime - x0 - mx;
      sxx += dx * dx;
      sxy += dx * (p.performanceTime - y0 - my);
    }
    const span = this.pairs[n - 1].contextTime - x0;
    let slope = 1000;
    if (n >= 3 && span >= this.minSpanForSlope && sxx > 0) slope = sxy / sxx;
    const lo = 1000 * (1 - this.maxPpm / 1e6);
    const hi = 1000 * (1 + this.maxPpm / 1e6);
    slope = Math.min(hi, Math.max(lo, slope));

    // Intercept through the centroid, then re-reference at the newest sample.
    const cx = x0 + mx;
    const cy = y0 + my;
    const newest = this.pairs[n - 1].contextTime;
    this.fit = { refContextTime: newest, refPerformanceTime: cy + (newest - cx) * slope, slope };

    let sq = 0;
    for (const p of this.pairs) sq += (p.performanceTime - perfAt(this.fit, p.contextTime)) ** 2;
    this.residualMs = Math.sqrt(sq / n);
  }
}

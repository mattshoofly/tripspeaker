/**
 * Four-timestamp clock offset estimation (NTP style).
 *
 *   c1  client send        h2  host receive
 *   h3  host send          c4  client receive
 *
 *   theta = ((h2 - c1) + (h3 - c4)) / 2   host clock minus client clock
 *   rtt   = (c4 - c1) - (h3 - h2)
 *
 * Each sample's theta is off by at most rtt/2 (path asymmetry), so low-RTT
 * samples are preferred and outliers are rejected around their median.
 */

export interface ClockSample {
  theta: number;
  rtt: number;
  /** Client time the sample completed (c4). */
  at: number;
}

export function computeClockSample(c1: number, h2: number, h3: number, c4: number): ClockSample | null {
  if (![c1, h2, h3, c4].every(Number.isFinite)) return null;
  const rtt = c4 - c1 - (h3 - h2);
  if (c4 < c1 || h3 < h2 || rtt < 0) return null;
  return { theta: (h2 - c1 + (h3 - c4)) / 2, rtt, at: c4 };
}

export interface ClockEstimate {
  theta: number;
  /** Best (lowest) RTT among the samples used. */
  rtt: number;
  /** Bound on the offset error: the larger of sample spread and rttMin/2. */
  uncertainty: number;
  used: number;
  total: number;
}

export interface ClockSyncOptions {
  maxSamples?: number;
  maxAgeMs?: number;
  bestFraction?: number;
  minSamples?: number;
  maxRttMs?: number;
}

export class ClockSyncEstimator {
  private samples: ClockSample[] = [];
  private readonly maxSamples: number;
  private readonly maxAgeMs: number;
  private readonly bestFraction: number;
  readonly minSamples: number;
  private readonly maxRttMs: number;

  constructor({ maxSamples = 48, maxAgeMs = 45_000, bestFraction = 0.35, minSamples = 5, maxRttMs = 1500 }: ClockSyncOptions = {}) {
    this.maxSamples = maxSamples;
    this.maxAgeMs = maxAgeMs;
    this.bestFraction = bestFraction;
    this.minSamples = minSamples;
    this.maxRttMs = maxRttMs;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  add(c1: number, h2: number, h3: number, c4: number): ClockSample | null {
    const sample = computeClockSample(c1, h2, h3, c4);
    if (!sample || sample.rtt > this.maxRttMs) return null;
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
    return sample;
  }

  reset(): void {
    this.samples = [];
  }

  estimate(now: number = Number.POSITIVE_INFINITY): ClockEstimate | null {
    let pool = this.samples;
    if (Number.isFinite(now)) {
      const fresh = pool.filter((s) => now - s.at <= this.maxAgeMs);
      // Keep the most recent samples even if old, so a long quiet period does not lose sync.
      pool = fresh.length >= this.minSamples ? fresh : pool.slice(-this.minSamples);
    }
    if (pool.length < this.minSamples) return null;

    const byRtt = [...pool].sort((a, b) => a.rtt - b.rtt);
    const take = Math.min(byRtt.length, Math.max(3, Math.ceil(byRtt.length * this.bestFraction)));
    const best = byRtt.slice(0, take);
    const at = Number.isFinite(now) ? now : Math.max(...best.map((s) => s.at));

    // Performance clocks on two machines drift (tens of ppm), so theta is a
    // slow trend rather than a constant. Fit it robustly, then evaluate now.
    const span = Math.max(...best.map((s) => s.at)) - Math.min(...best.map((s) => s.at));
    const trend = best.length >= 6 && span >= 8000;
    const t0 = best[0].at;
    let slope = trend ? theilSenSlope(best) : 0;
    slope = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, slope));
    const detrended = best.map((s) => s.theta - slope * (s.at - t0));
    const med = median(detrended);
    const mad = median(detrended.map((d) => Math.abs(d - med))) * 1.4826;
    const tolerance = Math.max(3 * mad, 0.75);
    const kept = best.filter((_, i) => Math.abs(detrended[i] - med) <= tolerance);
    const used = kept.length > 0 ? kept : best;

    // Weight tighter samples more: a sample's error bound scales with its RTT.
    const fit = weightedLine(used, t0, trend);
    const theta = fit.intercept + fit.slope * (at - t0);
    const rttMin = used.reduce((m, s) => Math.min(m, s.rtt), Number.POSITIVE_INFINITY);
    const spread = Math.sqrt(used.reduce((acc, s) => acc + (s.theta - (fit.intercept + fit.slope * (s.at - t0))) ** 2, 0) / used.length);
    return { theta, rtt: rttMin, uncertainty: Math.max(spread, rttMin / 2), used: used.length, total: pool.length };
  }
}

/** Largest plausible relative drift of two performance clocks: 500 ppm, in ms per ms. */
const MAX_DRIFT = 500e-6;

function theilSenSlope(samples: ClockSample[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const dt = samples[j].at - samples[i].at;
      if (Math.abs(dt) >= 1000) slopes.push((samples[j].theta - samples[i].theta) / dt);
    }
  }
  return slopes.length ? median(slopes) : 0;
}

function weightedLine(samples: ClockSample[], t0: number, withSlope: boolean): { intercept: number; slope: number } {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const s of samples) {
    const w = 1 / (0.25 + s.rtt) ** 2;
    sw += w;
    sx += w * (s.at - t0);
    sy += w * s.theta;
  }
  const mx = sx / sw;
  const my = sy / sw;
  if (!withSlope) return { intercept: my, slope: 0 };
  let sxx = 0;
  let sxy = 0;
  for (const s of samples) {
    const w = 1 / (0.25 + s.rtt) ** 2;
    const dx = s.at - t0 - mx;
    sxx += w * dx * dx;
    sxy += w * dx * (s.theta - my);
  }
  const slope = sxx > 0 ? Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, sxy / sxx)) : 0;
  return { intercept: my - slope * mx, slope };
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface SmoothedOffset {
  value: number;
  /** True when the change was too large to slew and the timeline should resync. */
  jumped: boolean;
}

/**
 * Applies offset estimates gradually so small corrections never jump the
 * timeline. Large disagreements (reconnects, sleep) snap and request a resync.
 */
export class OffsetSmoother {
  private current: number | null = null;
  private readonly gain: number;
  private readonly maxStepMs: number;
  private readonly snapMs: number;

  constructor(gain = 0.3, maxStepMs = 2, snapMs = 25) {
    this.gain = gain;
    this.maxStepMs = maxStepMs;
    this.snapMs = snapMs;
  }

  get value(): number | null {
    return this.current;
  }

  update(estimate: number): SmoothedOffset {
    if (this.current === null || Math.abs(estimate - this.current) > this.snapMs) {
      const jumped = this.current !== null;
      this.current = estimate;
      return { value: estimate, jumped };
    }
    const step = Math.max(-this.maxStepMs, Math.min(this.maxStepMs, (estimate - this.current) * this.gain));
    this.current += step;
    return { value: this.current, jumped: false };
  }

  reset(): void {
    this.current = null;
  }
}

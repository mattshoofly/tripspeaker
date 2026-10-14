import { describe, expect, it } from 'vitest';
import {
  AnchorTracker,
  estimatedPair,
  perfAt,
  readContextClock,
  validateOutputTimestamp,
  type LinearClockMap,
} from '../../src/core/anchor';
import {
  buildRendererTiming,
  clampTrim,
  clientDeadlineMs,
  contextDeadline,
  frameContextDeadline,
  hostReferenceMs,
  sourceFrameAt,
} from '../../src/core/timeline';
import { mulberry32 } from './sim';

const map = (refContextTime: number, refPerformanceTime: number, slope = 1000): LinearClockMap => ({
  refContextTime,
  refPerformanceTime,
  slope,
});

describe('deadline formulas', () => {
  it('maps a source frame to host reference time through the host anchor', () => {
    // Host heard context time 10.0 s at performance time 50 000 ms.
    const host = map(10, 50_000);
    expect(hostReferenceMs(48000 * 10, 48000, host)).toBe(50_000);
    expect(hostReferenceMs(48000 * 10.5, 48000, host)).toBe(50_500);
  });

  it('converts host time to a client deadline with theta = host − client', () => {
    // Host clock reads 500 ms more than the client clock.
    expect(clientDeadlineMs(50_000, 1200, 500, 0)).toBe(50_700);
    expect(clientDeadlineMs(50_000, 1200, -300, 0)).toBe(51_500);
  });

  it('applies manual trim in the Later direction when positive', () => {
    expect(clientDeadlineMs(50_000, 1200, 0, 25)).toBe(51_225);
    expect(clientDeadlineMs(50_000, 1200, 0, -25)).toBe(51_175);
    expect(clampTrim(400)).toBe(250);
    expect(clampTrim(-400)).toBe(-250);
    expect(clampTrim(12.6)).toBe(13);
  });

  it('maps a client deadline into the local AudioContext via the output timestamp', () => {
    const local = map(5.0, 20_000);
    expect(contextDeadline(20_500, local)).toBeCloseTo(5.5, 12);
  });

  it('does not subtract output latency again when using output timestamps', () => {
    // getOutputTimestamp already pairs the *heard* context time with performance time.
    const now = 20_010;
    const reading = readContextClock({
      outputTimestamp: { contextTime: 5.0, performanceTime: 20_000 },
      currentTime: 5.04,
      nowMs: now,
      baseLatency: 0.01,
      outputLatency: 0.03,
    })!;
    expect(reading.source).toBe('output-timestamp');
    expect(reading.pair).toEqual({ contextTime: 5.0, performanceTime: 20_000 });
    const local = map(reading.pair.contextTime, reading.pair.performanceTime);
    expect(contextDeadline(20_500, local)).toBeCloseTo(5.5, 12);
  });

  it('adds latency only in the reduced-confidence fallback', () => {
    const reading = readContextClock({
      outputTimestamp: { contextTime: 0, performanceTime: 0 },
      currentTime: 5.04,
      nowMs: 20_010,
      baseLatency: 0.01,
      outputLatency: 0.03,
    })!;
    expect(reading.source).toBe('estimated');
    expect(reading.pair.contextTime).toBe(5.04);
    expect(reading.pair.performanceTime).toBeCloseTo(20_050, 9);
    expect(estimatedPair(0, 1)).toBeNull();
  });

  it('chains host capture → shared deadline → local context consistently', () => {
    const host = map(100, 1_000_000, 1000.02);
    const local = map(30, 400_000, 999.97);
    const inputs = { host, local, sourceRate: 48000, outputRate: 44100, thetaMs: 600_123.4, commonBufferMs: 1200, trimMs: 7, };
    const n = 48000 * 101.25;
    const t = frameContextDeadline(n, inputs);
    // Inverse: the timing map says that at output frame t·44100 the renderer is at n.
    const timing = buildRendererTiming(inputs, t);
    expect(sourceFrameAt(timing, t * 44100)).toBeCloseTo(n, 3);
    // And the linear map stays exact a few seconds away (step includes both slopes).
    const n2 = n + 48000 * 3;
    expect(sourceFrameAt(timing, frameContextDeadline(n2, inputs) * 44100)).toBeCloseTo(n2, 2);
    expect(timing.step).toBeCloseTo((48000 / 44100) * (999.97 / 1000.02), 12);
  });

  it('host playback uses the same engine with zero network offset', () => {
    const host = map(50, 70_000);
    const inputs = { host, local: host, sourceRate: 48000, outputRate: 48000, thetaMs: 0, commonBufferMs: 1200, trimMs: 0 };
    const t = frameContextDeadline(48000 * 52, inputs);
    expect(t).toBeCloseTo(52 + 1.2, 9);
  });

  it('places every speaker on the same physical schedule despite different clocks', () => {
    // Shared "true" time; each device's perf clock has its own origin.
    const hostOrigin = 1_000;
    const guestOrigins = [250_000, -40_000];
    const n = 48000 * 200;
    const hostPerfOfCapture = 300_000; // host perf time when frame n is heard on host output (no buffer)
    const host = map(200, hostPerfOfCapture);
    const trueHeardAt: number[] = [];
    for (const origin of guestOrigins) {
      const theta = (hostOrigin - origin) * -1; // host − client for the same instant
      // Guest output mapping: context time 10 heard at guest perf 9_000_000.
      const local = map(10, 9_000_000);
      const t = frameContextDeadline(n, { host, local, sourceRate: 48000, outputRate: 48000, thetaMs: theta, commonBufferMs: 1200, trimMs: 0 });
      const guestPerf = perfAt(local, t);
      trueHeardAt.push(guestPerf + origin);
    }
    expect(trueHeardAt[0]).toBeCloseTo(hostPerfOfCapture + hostOrigin + 1200, 6);
    expect(trueHeardAt[1]).toBeCloseTo(trueHeardAt[0], 6);
  });
});

describe('output timestamp validation and fitting', () => {
  it('rejects suspended, stale, and future readings', () => {
    expect(validateOutputTimestamp({ contextTime: 0, performanceTime: 0 }, 1000, 1)).toBeNull();
    expect(validateOutputTimestamp({ contextTime: 2, performanceTime: 990 }, 1000, 1)).toBeNull();
    expect(validateOutputTimestamp({ contextTime: 0.9, performanceTime: -5 }, 1000, 1)).toBeNull();
    expect(validateOutputTimestamp({ contextTime: 0.9, performanceTime: 5000 }, 1000, 1)).toBeNull();
    expect(validateOutputTimestamp({ contextTime: 0.9, performanceTime: 990 }, 1000, 1)).toEqual({ contextTime: 0.9, performanceTime: 990 });
    expect(validateOutputTimestamp(undefined, 1000, 1)).toBeNull();
  });

  it('fits a jittery mapping and recovers the audio-clock slope', () => {
    const rand = mulberry32(2);
    const tracker = new AnchorTracker({ windowSize: 40 });
    const slope = 1000.08; // audio clock 80 ppm slow vs perf clock
    for (let i = 0; i < 40; i++) {
      const ctx = 1 + i * 0.25;
      tracker.add({ contextTime: ctx, performanceTime: 5000 + ctx * slope + (rand() * 2 - 1) * 1.5 });
    }
    const fit = tracker.map()!;
    expect(fit.slope).toBeCloseTo(slope, 1);
    expect(Math.abs(perfAt(fit, 10) - (5000 + 10 * slope))).toBeLessThan(0.8);
  });

  it('ignores a single outlier but resets on a confirmed discontinuity', () => {
    const tracker = new AnchorTracker();
    for (let i = 0; i < 10; i++) tracker.add({ contextTime: 1 + i * 0.25, performanceTime: 1000 + (1 + i * 0.25) * 1000 });
    expect(tracker.add({ contextTime: 3.75, performanceTime: 1000 + 3750 + 80 })).toBe('outlier');
    expect(tracker.add({ contextTime: 4.0, performanceTime: 1000 + 4000 })).toBe('accepted');
    expect(tracker.add({ contextTime: 4.25, performanceTime: 1000 + 4250 + 300 })).toBe('outlier');
    expect(tracker.add({ contextTime: 4.5, performanceTime: 1000 + 4500 + 300 })).toBe('reset');
    expect(perfAt(tracker.map()!, 4.5)).toBeCloseTo(5800, 6);
  });

  it('treats a non-advancing context time as stale', () => {
    const tracker = new AnchorTracker();
    tracker.add({ contextTime: 2, performanceTime: 3000 });
    expect(tracker.add({ contextTime: 2, performanceTime: 3010 })).toBe('stale');
  });
});

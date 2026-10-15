import { describe, expect, it } from 'vitest';
import { ClockSyncEstimator, computeClockSample, OffsetSmoother } from '../../src/core/clockSync';
import { mulberry32 } from './sim';

describe('four-timestamp offset', () => {
  it('computes theta as host minus client, with RTT excluding host processing', () => {
    // Host clock is 500 ms ahead. 3 ms each way, 1 ms on the host.
    const c1 = 1000;
    const h2 = c1 + 3 + 500;
    const h3 = h2 + 1;
    const c4 = h3 - 500 + 3;
    const s = computeClockSample(c1, h2, h3, c4)!;
    expect(s.theta).toBeCloseTo(500, 10);
    expect(s.rtt).toBeCloseTo(6, 10);
  });

  it('has the opposite sign when the host clock is behind', () => {
    const s = computeClockSample(10_000, 10_002 - 250, 10_002 - 250, 10_004)!;
    expect(s.theta).toBeCloseTo(-250, 10);
  });

  it('rejects impossible samples', () => {
    expect(computeClockSample(10, 5, 4, 20)).toBeNull();
    expect(computeClockSample(10, 5, 50, 12)).toBeNull();
    expect(computeClockSample(Number.NaN, 1, 2, 3)).toBeNull();
  });
});

describe('ClockSyncEstimator', () => {
  function exchange(est: ClockSyncEstimator, clientNow: number, theta: number, up: number, down: number, hostProc = 0.2) {
    const c1 = clientNow;
    const h2 = c1 + up + theta;
    const h3 = h2 + hostProc;
    const c4 = h3 - theta + down;
    est.add(c1, h2, h3, c4);
    return c4;
  }

  it('prefers low-RTT samples and rejects asymmetric outliers', () => {
    const est = new ClockSyncEstimator();
    const rand = mulberry32(11);
    let t = 5000;
    for (let i = 0; i < 40; i++) {
      const spike = i % 4 === 0;
      // Spikes are one-way queueing delays: they bias theta by tens of ms.
      const up = 2 + rand() * 2 + (spike ? 40 + rand() * 40 : 0);
      const down = 2 + rand() * 2;
      t = exchange(est, t + 1000, 1234.5, up, down) ;
    }
    const e = est.estimate(t)!;
    expect(Math.abs(e.theta - 1234.5)).toBeLessThan(1);
    expect(e.rtt).toBeLessThan(6);
    expect(e.uncertainty).toBeLessThan(3);
  });

  it('needs a minimum number of samples before reporting', () => {
    const est = new ClockSyncEstimator({ minSamples: 5 });
    let t = 0;
    for (let i = 0; i < 4; i++) t = exchange(est, t + 100, 10, 2, 2);
    expect(est.estimate(t)).toBeNull();
    t = exchange(est, t + 100, 10, 2, 2);
    expect(est.estimate(t)).not.toBeNull();
  });

  it('tracks a slowly drifting offset (different clock rates)', () => {
    const est = new ClockSyncEstimator();
    const rand = mulberry32(5);
    const driftPpm = 120;
    let t = 0;
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const now = t + 1000;
      const theta = 300 + (now * driftPpm) / 1e6;
      t = exchange(est, now, theta, 1.5 + rand() * 3, 1.5 + rand() * 3);
      if (i > 30) worst = Math.max(worst, Math.abs(est.estimate(t)!.theta - theta));
    }
    // The trend fit follows 120 ppm drift instead of lagging behind a windowed mean.
    expect(worst).toBeLessThan(1);
  });
});

describe('OffsetSmoother', () => {
  it('slews small changes and snaps large ones', () => {
    const s = new OffsetSmoother(0.3, 2, 25);
    expect(s.update(100)).toEqual({ value: 100, jumped: false });
    const next = s.update(110);
    expect(next.value).toBeCloseTo(102, 10);
    expect(next.jumped).toBe(false);
    const big = s.update(400);
    expect(big).toEqual({ value: 400, jumped: true });
  });

  it('converges faster while a new sync is settling', () => {
    const slow = new OffsetSmoother(0.3, 2, 25);
    const fast = new OffsetSmoother(0.3, 2, 25);
    slow.update(0);
    fast.update(0);
    for (let i = 0; i < 5; i++) {
      slow.update(20);
      fast.update(20, true);
    }
    expect(slow.value).toBeCloseTo(10, 6);
    expect(fast.value!).toBeGreaterThan(19);
  });
});

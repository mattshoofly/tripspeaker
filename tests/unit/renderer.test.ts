import { describe, expect, it } from 'vitest';
import { encodePacket } from '../../src/core/packet';
import { RendererCore, hermite } from '../../src/core/renderer';
import { defaultSignal, maxStep, simulate } from './sim';

function settledErrorsMs(r: ReturnType<typeof simulate>, sr: number, fromS: number) {
  const errs: number[] = [];
  for (const p of r.positions) {
    if (p.played === null) continue;
    if (p.outputFrame / r.renderer.outputRate < fromS) continue;
    errs.push(((p.truth - p.played) / sr) * 1000);
  }
  return errs;
}

function expectedAt(r: ReturnType<typeof simulate>, sr: number, f: number) {
  return defaultSignal(r.truthAt(f), sr);
}

describe('RendererCore playback against the shared timeline', () => {
  it('starts at the deadline, not when packets arrive', () => {
    const r = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 3, bufferMs: 1200 });
    const firstAudible = r.output.findIndex((v) => Math.abs(v) > 1e-4);
    // The stream starts at source frame 0, which is due 1.2 s after capture.
    expect(firstAudible / 48000).toBeGreaterThan(1.19);
    expect(firstAudible / 48000).toBeLessThan(1.22);
    const s = r.renderer.stats();
    expect(s.state).toBe('playing');
    expect(s.missingFrames).toBe(0);
    expect(s.underruns).toBe(0);
  });

  it('reproduces the source accurately once playing', () => {
    const r = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 3 });
    let maxErr = 0;
    for (let f = 48000 * 1.5; f < 48000 * 2.9; f++) maxErr = Math.max(maxErr, Math.abs(r.output[f] - expectedAt(r, 48000, f)));
    // PCM16 quantisation plus interpolation of an on-grid read position.
    expect(maxErr).toBeLessThan(0.002);
  });

  it('handles reordering and duplicates without changing the output', () => {
    const base = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 3, seed: 3, jitterMs: 2 });
    const messy = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 3, seed: 3, jitterMs: 2, duplicate: 0.3, extraDelay: (seq) => (seq % 5 === 0 ? 60 : 0) });
    const stats = messy.renderer.stats();
    expect(stats.duplicateFrames).toBeGreaterThan(0);
    expect(stats.missingFrames).toBe(0);
    let diff = 0;
    for (let i = 0; i < base.output.length; i++) diff = Math.max(diff, Math.abs(base.output[i] - messy.output[i]));
    expect(diff).toBe(0);
  });

  it('skips through missing packets with short fades instead of replaying them late', () => {
    const lost = new Set([80, 81, 120]);
    const r = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 4, drop: (seq) => lost.has(seq) });
    const s = r.renderer.stats();
    expect(s.missingFrames).toBe(3 * 960);
    expect(s.underruns).toBe(2);
    expect(s.resyncs).toBe(0);
    // Position keeps following the clock across the gap.
    const errs = settledErrorsMs(r, 48000, 2);
    expect(Math.max(...errs.map(Math.abs))).toBeLessThan(0.01);
    // Gap region is silent; edges are faded (no step larger than the signal's own slope).
    const gapStart = Math.round(r.positions.find((p) => p.truth >= 80 * 960)!.outputFrame);
    const naturalStep = maxStep(r.output, 48000 * 3, 48000 * 3.5);
    expect(maxStep(r.output, gapStart - 2000, gapStart + 4000)).toBeLessThan(naturalStep * 1.6);
    expect(Math.abs(r.output[gapStart + 960])).toBeLessThan(1e-3);
  });

  it('discards packets that miss their deadline and counts them as late', () => {
    const r = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 4, extraDelay: (seq) => (seq === 100 ? 1500 : 0) });
    const s = r.renderer.stats();
    expect(s.latePackets).toBe(1);
    expect(s.lateFrames).toBe(960);
    expect(s.missingFrames).toBe(960);
  });

  it('converts 48 kHz sources to 44.1 kHz output', () => {
    const tone = (f: number, rate: number) => 0.6 * Math.sin((2 * Math.PI * 1000 * f) / rate);
    const r = simulate({ sourceRate: 48000, outputRate: 44100, durationS: 4, signal: tone });
    const from = 44100 * 2;
    const to = 44100 * 3;
    let crossings = 0;
    let sumSq = 0;
    for (let i = from; i < to; i++) {
      if (r.output[i - 1] < 0 && r.output[i] >= 0) crossings++;
      sumSq += r.output[i] ** 2;
    }
    expect(crossings).toBeGreaterThanOrEqual(999);
    expect(crossings).toBeLessThanOrEqual(1001);
    expect(Math.sqrt(sumSq / (to - from))).toBeCloseTo(0.6 / Math.SQRT2, 2);
    let maxErr = 0;
    for (let i = from; i < to; i++) maxErr = Math.max(maxErr, Math.abs(r.output[i] - tone(r.truthAt(i), 48000)));
    expect(maxErr).toBeLessThan(0.01);
  });

  it('converts 44.1 kHz sources to 48 kHz output', () => {
    const r = simulate({ sourceRate: 44100, outputRate: 48000, durationS: 3 });
    let maxErr = 0;
    for (let i = 48000 * 1.6; i < 48000 * 2.8; i++) maxErr = Math.max(maxErr, Math.abs(r.output[i] - defaultSignal(r.truthAt(i), 44100)));
    expect(maxErr).toBeLessThan(0.005);
  });

  it('tracks clock drift with bounded resampling and no resyncs', () => {
    const r = simulate({
      sourceRate: 48000,
      outputRate: 44100,
      hostPpm: 90,
      guestPpm: -70,
      durationS: 60,
      timingEvery: 0.5,
      timingNoiseMs: 0.4,
      jitterMs: 6,
    });
    const s = r.renderer.stats();
    expect(s.resyncs).toBe(0);
    expect(s.jumps).toBe(0);
    expect(s.missingFrames).toBe(0);
    const errs = settledErrorsMs(r, 48000, 20);
    expect(Math.max(...errs.map(Math.abs))).toBeLessThan(1);
    // Correction never exceeds its bound (0.25%).
    expect(Math.abs(s.correctionPpm)).toBeLessThanOrEqual(2500);
  });

  it('applies a manual trim later in time, and promptly with a crossfade', () => {
    const sr = 48000;
    let applied = false;
    const r = simulate({
      sourceRate: sr,
      outputRate: sr,
      durationS: 5,
      onQuantum: (q) => {
        if (!applied && q.realTime >= 3) {
          applied = true;
          q.setTrim(+20);
        }
      },
    });
    const s = r.renderer.stats();
    expect(s.jumps).toBe(1);
    const after = r.positions.filter((p) => p.outputFrame / sr > 3.2 && p.played !== null);
    expect(after.length).toBeGreaterThan(100);
    for (const p of after) {
      // Positive trim = Later: at any moment the speaker is 20 ms behind the untrimmed timeline.
      const untrimmed = (p.outputFrame / sr - 1.2) * sr;
      expect(untrimmed - p.played!).toBeCloseTo(0.02 * sr, 0);
    }
    const at = Math.round(3 * sr);
    expect(maxStep(r.output, at - 512, at + 2048)).toBeLessThan(maxStep(r.output, sr * 4, sr * 4.5) * 1.6);
  });

  it('keeps memory bounded and refuses packets too far in the future', () => {
    const renderer = new RendererCore({ outputRate: 48000, maxSourceRate: 48000, capacitySeconds: 4 });
    renderer.setSession(9);
    renderer.setTiming({ refOutputFrame: 0, refSourceFrame: 0, step: 1, sessionId: 9, epoch: 1, sourceRate: 48000 });
    const pcm = new Int16Array(960).fill(1000);
    renderer.push(encodePacket({ sessionId: 9, epoch: 1, sequence: 1, sampleRate: 48000, firstFrame: renderer.ringCapacity * 3 }, pcm));
    const s = renderer.stats();
    expect(s.earlyFrames).toBe(960);
    expect(renderer.ringCapacity).toBe(262144);
  });

  it('rejects stale sessions and older epochs, and resets on a newer epoch', () => {
    const renderer = new RendererCore({ outputRate: 48000 });
    renderer.setSession(5);
    const pcm = new Int16Array(960).fill(2000);
    renderer.push(encodePacket({ sessionId: 4, epoch: 1, sequence: 0, sampleRate: 48000, firstFrame: 0 }, pcm));
    expect(renderer.stats().staleSessionPackets).toBe(1);
    renderer.push(encodePacket({ sessionId: 5, epoch: 2, sequence: 0, sampleRate: 48000, firstFrame: 0 }, pcm));
    renderer.push(encodePacket({ sessionId: 5, epoch: 1, sequence: 1, sampleRate: 48000, firstFrame: 960 }, pcm));
    const s = renderer.stats();
    expect(s.staleEpochPackets).toBe(1);
    expect(s.epoch).toBe(2);
    expect(s.packets).toBe(1);
  });

  it('recovers from a long outage (reconnect) at the current timeline position', () => {
    const outage = (seq: number) => seq >= 150 && seq < 300; // 3 s with no packets
    const r = simulate({ sourceRate: 48000, outputRate: 48000, durationS: 9, drop: outage });
    const s = r.renderer.stats();
    expect(s.resyncs).toBe(0);
    expect(s.state).toBe('playing');
    const errs = settledErrorsMs(r, 48000, 7.5);
    expect(Math.max(...errs.map(Math.abs))).toBeLessThan(0.01);
    // Missing frames never exceed what was actually lost in the outage.
    expect(s.missingFrames).toBeGreaterThan(0);
    expect(s.missingFrames).toBeLessThanOrEqual(150 * 960);
    expect(s.underruns).toBe(1);
  });

  it('fades out cleanly when timing is withdrawn', () => {
    const renderer = new RendererCore({ outputRate: 48000 });
    renderer.setSession(1);
    renderer.setTiming({ refOutputFrame: 0, refSourceFrame: 0, step: 1, sessionId: 1, epoch: 1, sourceRate: 48000 });
    const pcm = new Int16Array(2400).fill(16000);
    renderer.push(encodePacket({ sessionId: 1, epoch: 1, sequence: 0, sampleRate: 48000, firstFrame: 0 }, pcm));
    renderer.push(encodePacket({ sessionId: 1, epoch: 1, sequence: 1, sampleRate: 48000, firstFrame: 2400 }, pcm));
    const out = new Float32Array(128);
    let last = 0;
    for (let f = 0; f < 2048; f += 128) {
      renderer.render(out, f);
      last = out[127];
    }
    expect(last).toBeGreaterThan(0.4);
    renderer.setTiming(null);
    renderer.render(out, 2048);
    expect(Math.abs(out[0] - last)).toBeLessThan(0.05);
    let maxJump = 0;
    for (let i = 1; i < out.length; i++) maxJump = Math.max(maxJump, Math.abs(out[i] - out[i - 1]));
    expect(maxJump).toBeLessThan(0.05);
  });

  it('interpolates with a cubic that passes through the samples', () => {
    expect(hermite(0, 1, 2, 3, 0)).toBe(1);
    expect(hermite(0, 1, 2, 3, 1)).toBe(2);
    expect(hermite(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5, 10);
  });
});

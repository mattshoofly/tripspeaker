import { Packetizer } from '../../src/core/packetizer';
import { RendererCore, type RendererOptions, type TimingUpdate } from '../../src/core/renderer';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimPacket {
  buffer: ArrayBuffer;
  firstFrame: number;
  sequence: number;
  /** Real time (seconds) the packet reaches the guest. */
  arrival: number;
}

export interface SimOptions {
  sourceRate: number;
  outputRate: number;
  /** Host audio clock error in ppm relative to real time. */
  hostPpm?: number;
  /** Guest audio clock error in ppm relative to real time. */
  guestPpm?: number;
  bufferMs?: number;
  trimMs?: number;
  durationS: number;
  seed?: number;
  packetMs?: number;
  baseDelayMs?: number;
  jitterMs?: number;
  loss?: number;
  duplicate?: number;
  /** Extra delay applied to specific packet sequences (ms). */
  extraDelay?: (sequence: number) => number;
  /** Drop specific sequences. */
  drop?: (sequence: number) => boolean;
  signal?: (frame: number, rate: number) => number;
  /** Error injected into each timing update (ms), e.g. clock-sync noise. */
  timingNoiseMs?: number;
  /** Timing update cadence in seconds. */
  timingEvery?: number;
  /** Use the true step (including drift) instead of the nominal rate ratio. */
  trueStep?: boolean;
  sessionId?: number;
  epoch?: number;
  rendererOptions?: Partial<RendererOptions>;
  onQuantum?: (ctx: QuantumContext) => void;
}

export interface QuantumContext {
  renderer: RendererCore;
  outputFrame: number;
  realTime: number;
  setTrim: (ms: number, prompt?: boolean) => void;
}

export const defaultSignal = (frame: number, rate: number) =>
  0.5 * Math.sin((2 * Math.PI * 440 * frame) / rate) + 0.2 * Math.sin((2 * Math.PI * 97 * frame) / rate);

export interface SimResult {
  renderer: RendererCore;
  output: Float32Array;
  /** Source position the renderer actually played at each quantum start. */
  positions: { outputFrame: number; played: number | null; truth: number }[];
  packets: SimPacket[];
  truthAt: (outputFrame: number) => number;
}

/**
 * Real time T drives both clocks: host frame n = T·sr·(1+hostPpm), guest
 * output frame f = T·outRate·(1+guestPpm). Source frame n must be heard at
 * T(n) + buffer + trim. The renderer only sees packets and noisy timing maps.
 */
export function simulate(o: SimOptions): SimResult {
  const sr = o.sourceRate;
  const outRate = o.outputRate;
  const hostK = 1 + (o.hostPpm ?? 0) / 1e6;
  const guestK = 1 + (o.guestPpm ?? 0) / 1e6;
  const bufferS = (o.bufferMs ?? 1200) / 1000;
  let trimS = (o.trimMs ?? 0) / 1000;
  const rand = mulberry32(o.seed ?? 1);
  const sessionId = o.sessionId ?? 7;
  const epoch = o.epoch ?? 1;
  const signal = o.signal ?? defaultSignal;

  const packets: SimPacket[] = [];
  const packetizer = new Packetizer({
    packetFrames: Math.round((sr * (o.packetMs ?? 20)) / 1000),
    sampleRate: sr,
    sessionId,
    epoch,
    emit: (buffer, firstFrame, sequence) => {
      if (o.drop?.(sequence)) return;
      if (o.loss && rand() < o.loss) return;
      const captureEnd = (firstFrame + Math.round((sr * (o.packetMs ?? 20)) / 1000)) / (sr * hostK);
      const delay = ((o.baseDelayMs ?? 4) + rand() * (o.jitterMs ?? 3) + (o.extraDelay?.(sequence) ?? 0)) / 1000;
      packets.push({ buffer, firstFrame, sequence, arrival: captureEnd + delay });
      if (o.duplicate && rand() < o.duplicate) packets.push({ buffer: buffer.slice(0), firstFrame, sequence, arrival: captureEnd + delay + rand() * 0.05 });
    },
  });
  const totalSourceFrames = Math.ceil(o.durationS * sr * hostK) + sr;
  const block = 128;
  const scratch = new Float32Array(block);
  for (let start = 0; start < totalSourceFrames; start += block) {
    for (let i = 0; i < block; i++) scratch[i] = signal(start + i, sr);
    packetizer.push(scratch, start);
  }
  packets.sort((a, b) => a.arrival - b.arrival);

  const renderer = new RendererCore({ outputRate: outRate, maxSourceRate: 48000, ...o.rendererOptions });
  renderer.setSession(sessionId);

  const truthAt = (f: number) => (f / (outRate * guestK) - bufferS - trimS) * sr * hostK;
  const step = o.trueStep ? (sr * hostK) / (outRate * guestK) : sr / outRate;
  let promptNext = false;
  const pushTiming = (f: number) => {
    const noise = o.timingNoiseMs ? (rand() * 2 - 1) * (o.timingNoiseMs / 1000) * sr : 0;
    const update: TimingUpdate = {
      refOutputFrame: f,
      refSourceFrame: truthAt(f) + noise,
      step,
      sessionId,
      epoch,
      sourceRate: sr,
      prompt: promptNext,
    };
    promptNext = false;
    renderer.setTiming(update);
  };

  const totalOutput = Math.floor(o.durationS * outRate * guestK);
  const output = new Float32Array(totalOutput);
  const positions: SimResult['positions'] = [];
  const timingEveryFrames = Math.round((o.timingEvery ?? 0.25) * outRate);
  let nextPacket = 0;
  let nextTimingAt = 0;
  const quantum = new Float32Array(block);
  for (let f = 0; f + block <= totalOutput; f += block) {
    const realTime = f / (outRate * guestK);
    while (nextPacket < packets.length && packets[nextPacket].arrival <= realTime) {
      renderer.push(packets[nextPacket].buffer.slice(0));
      nextPacket++;
    }
    if (f >= nextTimingAt) {
      pushTiming(f);
      nextTimingAt = f + timingEveryFrames;
    }
    o.onQuantum?.({
      renderer,
      outputFrame: f,
      realTime,
      setTrim: (ms, prompt = true) => {
        trimS = ms / 1000;
        promptNext = prompt;
        pushTiming(f);
      },
    });
    const before = renderer.stats();
    positions.push({ outputFrame: f, played: before.sourcePosition, truth: truthAt(f) });
    renderer.render(quantum, f);
    output.set(quantum, f);
  }
  return { renderer, output, positions, packets, truthAt };
}

/** Max absolute difference between consecutive samples (click detector). */
export function maxStep(samples: Float32Array, from = 0, to = samples.length): number {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(samples[i] - samples[i - 1]));
  return m;
}

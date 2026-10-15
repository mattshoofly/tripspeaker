import { encodePacket, floatToPcm16 } from './packet';

export interface PacketizerOptions {
  packetFrames: number;
  sampleRate: number;
  sessionId: number;
  epoch: number;
  emit: (packet: ArrayBuffer, firstFrame: number, sequence: number) => void;
}

/**
 * Collects capture-thread samples into fixed-size PCM16 packets stamped with
 * the capture timeline's frame index (AudioWorklet currentFrame), not with
 * main-thread arrival time.
 */
export class Packetizer {
  readonly packetFrames: number;
  readonly sampleRate: number;
  private sessionId: number;
  private epoch: number;
  private readonly emit: PacketizerOptions['emit'];
  private pcm: Int16Array;
  private fill = 0;
  private firstFrame = 0;
  private expectedNext = -1;
  private sequence = 0;
  /** Times the capture timeline jumped mid-packet (partial packet dropped). */
  discontinuities = 0;

  constructor(opts: PacketizerOptions) {
    this.packetFrames = Math.max(32, Math.min(4096, Math.round(opts.packetFrames)));
    this.sampleRate = opts.sampleRate;
    this.sessionId = opts.sessionId;
    this.epoch = opts.epoch;
    this.emit = opts.emit;
    this.pcm = new Int16Array(this.packetFrames);
  }

  get nextSequence(): number {
    return this.sequence;
  }

  configure(sessionId: number, epoch: number): void {
    if (sessionId !== this.sessionId || epoch !== this.epoch) this.reset();
    this.sessionId = sessionId;
    this.epoch = epoch;
  }

  /** Drop any partial packet; the next sample starts a fresh one. */
  reset(): void {
    this.fill = 0;
    this.expectedNext = -1;
  }

  push(samples: Float32Array, startFrame: number): void {
    if (this.expectedNext >= 0 && startFrame !== this.expectedNext) {
      // The audio clock skipped (e.g. an overloaded render thread). Ship what
      // we have as a short packet so only the skipped frames are lost.
      this.discontinuities++;
      if (this.fill > 0) this.flush();
    }
    for (let i = 0; i < samples.length; i++) {
      if (this.fill === 0) this.firstFrame = startFrame + i;
      this.pcm[this.fill++] = floatToPcm16(samples[i]);
      if (this.fill === this.packetFrames) this.flush();
    }
    this.expectedNext = startFrame + samples.length;
  }

  private flush(): void {
    const seq = this.sequence;
    this.sequence = (this.sequence + 1) >>> 0;
    const pcm = this.fill === this.packetFrames ? this.pcm : this.pcm.subarray(0, this.fill);
    const packet = encodePacket(
      { sessionId: this.sessionId, epoch: this.epoch, sequence: seq, sampleRate: this.sampleRate, firstFrame: this.firstFrame },
      pcm,
    );
    this.fill = 0;
    this.emit(packet, this.firstFrame, seq);
  }
}

export function packetFramesFor(sampleRate: number, packetMs = 20): number {
  return Math.round((sampleRate * packetMs) / 1000);
}

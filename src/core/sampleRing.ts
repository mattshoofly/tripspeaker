import { pcm16ToFloat } from './packet';

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export interface RingWriteWindow {
  /** Frames below this already played (or are past their deadline). */
  minFrame: number;
  /** Frames at or above this would overwrite audio still waiting to play. */
  maxFrame: number;
}

export interface RingWriteResult {
  written: number;
  late: number;
  early: number;
  duplicate: number;
}

/**
 * Fixed-size store of mono samples indexed by absolute source frame.
 * Each slot remembers which frame it holds, so stale laps never play.
 */
export class SampleRing {
  readonly capacity: number;
  private readonly samples: Float32Array;
  private readonly tags: Float64Array;
  newestEnd = -1;

  constructor(capacityFrames: number) {
    this.capacity = nextPowerOfTwo(Math.max(1024, capacityFrames));
    this.samples = new Float32Array(this.capacity);
    this.tags = new Float64Array(this.capacity).fill(-1);
  }

  clear(): void {
    this.tags.fill(-1);
    this.newestEnd = -1;
  }

  has(frame: number): boolean {
    return frame >= 0 && this.tags[frame % this.capacity] === frame;
  }

  /** Sample value at an integer frame, or 0 when missing. */
  at(frame: number): number {
    if (frame < 0) return 0;
    const slot = frame % this.capacity;
    return this.tags[slot] === frame ? this.samples[slot] : 0;
  }

  write(firstFrame: number, pcm: Int16Array, window: RingWriteWindow | null): RingWriteResult {
    const result: RingWriteResult = { written: 0, late: 0, early: 0, duplicate: 0 };
    let lastWritten = -1;
    for (let i = 0; i < pcm.length; i++) {
      const frame = firstFrame + i;
      if (window) {
        if (frame < window.minFrame) {
          result.late++;
          continue;
        }
        if (frame >= window.maxFrame) {
          result.early++;
          continue;
        }
      }
      const slot = frame % this.capacity;
      if (this.tags[slot] === frame) result.duplicate++;
      this.tags[slot] = frame;
      this.samples[slot] = pcm16ToFloat(pcm[i]);
      result.written++;
      lastWritten = frame;
    }
    if (lastWritten >= 0 && lastWritten + 1 > this.newestEnd) this.newestEnd = lastWritten + 1;
    return result;
  }
}

/**
 * Per-guest send gate with hysteresis on the data channel's bufferedAmount.
 * When a guest's link backs up, its packets are dropped at the sender (they
 * would miss their deadline anyway) instead of queueing without bound.
 */
export class SendGate {
  readonly highWaterBytes: number;
  readonly lowWaterBytes: number;
  private blocked = false;
  sent = 0;
  dropped = 0;
  /** Times the gate closed (backpressure episodes). */
  episodes = 0;

  constructor(highWaterBytes = 64 * 1024, lowWaterBytes = 24 * 1024) {
    this.highWaterBytes = highWaterBytes;
    this.lowWaterBytes = lowWaterBytes;
  }

  get isBlocked(): boolean {
    return this.blocked;
  }

  admit(bufferedAmount: number): boolean {
    if (this.blocked) {
      if (bufferedAmount <= this.lowWaterBytes) this.blocked = false;
    } else if (bufferedAmount >= this.highWaterBytes) {
      this.blocked = true;
      this.episodes++;
    }
    if (this.blocked) {
      this.dropped++;
      return false;
    }
    this.sent++;
    return true;
  }
}

export interface FanoutTarget {
  readonly gate: SendGate;
  bufferedAmount(): number;
  send(packet: ArrayBuffer): void;
}

/** Sends one packet to every target independently; a blocked target never delays the rest. */
export function fanOut(packet: ArrayBuffer, targets: Iterable<FanoutTarget>): number {
  let delivered = 0;
  for (const t of targets) {
    let ok = false;
    try {
      ok = t.gate.admit(t.bufferedAmount());
      if (ok) t.send(packet);
    } catch {
      ok = false;
    }
    if (ok) delivered++;
  }
  return delivered;
}

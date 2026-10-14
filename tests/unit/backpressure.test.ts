import { describe, expect, it } from 'vitest';
import { fanOut, SendGate, type FanoutTarget } from '../../src/core/backpressure';

class FakeChannel implements FanoutTarget {
  readonly gate = new SendGate(64 * 1024, 24 * 1024);
  buffered = 0;
  received = 0;
  constructor(private readonly drainPerTick: number) {}
  bufferedAmount() {
    return this.buffered;
  }
  send(packet: ArrayBuffer) {
    this.buffered += packet.byteLength;
    this.received++;
  }
  tick() {
    this.buffered = Math.max(0, this.buffered - this.drainPerTick);
  }
}

describe('backpressure', () => {
  it('closes above the high-water mark and reopens below the low-water mark', () => {
    const gate = new SendGate(100, 40);
    expect(gate.admit(0)).toBe(true);
    expect(gate.admit(99)).toBe(true);
    expect(gate.admit(100)).toBe(false);
    expect(gate.admit(60)).toBe(false);
    expect(gate.admit(40)).toBe(true);
    expect(gate.episodes).toBe(1);
    expect(gate.dropped).toBe(2);
  });

  it('keeps every queue bounded and never lets a slow guest stall the others', () => {
    const fast = new FakeChannel(4000);
    const slow = new FakeChannel(300);
    const packet = new ArrayBuffer(1952);
    let maxSlowBuffered = 0;
    for (let i = 0; i < 3000; i++) {
      fanOut(packet, [slow, fast]);
      fast.tick();
      slow.tick();
      maxSlowBuffered = Math.max(maxSlowBuffered, slow.buffered);
    }
    expect(fast.received).toBe(3000);
    expect(fast.gate.dropped).toBe(0);
    expect(slow.gate.dropped).toBeGreaterThan(2000);
    expect(maxSlowBuffered).toBeLessThan(64 * 1024 + 1952);
  });

  it('continues past a target that throws', () => {
    const ok = new FakeChannel(10_000);
    const broken: FanoutTarget = {
      gate: new SendGate(),
      bufferedAmount: () => 0,
      send: () => {
        throw new Error('closed');
      },
    };
    expect(fanOut(new ArrayBuffer(10), [broken, ok])).toBe(1);
    expect(ok.received).toBe(1);
  });
});

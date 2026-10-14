import { describe, expect, it } from 'vitest';
import {
  decodePacket,
  encodePacket,
  floatToPcm16,
  MAX_PACKET_FRAMES,
  PACKET_HEADER_BYTES,
  packetByteLength,
  pcm16ToFloat,
  readPacketHeader,
} from '../../src/core/packet';
import { Packetizer, packetFramesFor } from '../../src/core/packetizer';

const header = { sessionId: 0xdeadbeef, epoch: 3, sequence: 77, sampleRate: 44100, firstFrame: 2 ** 40 + 5 };

describe('audio packets', () => {
  it('round-trips header and PCM in a compact binary layout', () => {
    const pcm = Int16Array.from({ length: 882 }, (_, i) => (i * 37) % 65536 - 32768);
    const buf = encodePacket(header, pcm);
    expect(buf.byteLength).toBe(PACKET_HEADER_BYTES + 882 * 2);
    const d = decodePacket(buf);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.header).toMatchObject({ ...header, channels: 1, frames: 882, version: 1 });
    expect(Array.from(d.pcm)).toEqual(Array.from(pcm));
  });

  it('is about 768 kbit/s of payload at 48 kHz mono PCM16 in 20 ms packets', () => {
    const frames = packetFramesFor(48000);
    expect(frames).toBe(960);
    const bitsPerSecond = (frames * 2 * 8 * 1000) / 20;
    expect(bitsPerSecond).toBe(768_000);
    expect(packetByteLength(frames)).toBe(1952);
  });

  it('rejects malformed packets before allocating or playing', () => {
    const good = encodePacket(header, new Int16Array(10));
    const mutate = (fn: (v: DataView) => void, size = good.byteLength) => {
      const copy = good.slice(0, Math.min(size, good.byteLength));
      const view = new DataView(copy);
      fn(view);
      return copy;
    };
    expect(readPacketHeader(new ArrayBuffer(8))).toEqual({ ok: false, error: 'too-short' });
    expect(decodePacket(mutate((v) => v.setUint32(0, 0x12345678, true)))).toEqual({ ok: false, error: 'bad-magic' });
    expect(decodePacket(mutate((v) => v.setUint8(4, 9)))).toEqual({ ok: false, error: 'bad-version' });
    expect(decodePacket(mutate((v) => v.setUint8(5, 2)))).toEqual({ ok: false, error: 'unsupported-channels' });
    expect(decodePacket(mutate((v) => v.setUint16(6, 0, true)))).toEqual({ ok: false, error: 'bad-frame-count' });
    expect(decodePacket(mutate((v) => v.setUint16(6, MAX_PACKET_FRAMES + 1, true)))).toEqual({ ok: false, error: 'bad-frame-count' });
    expect(decodePacket(mutate(() => undefined, good.byteLength - 2))).toEqual({ ok: false, error: 'length-mismatch' });
    expect(decodePacket(mutate((v) => v.setUint32(20, 1000, true)))).toEqual({ ok: false, error: 'bad-sample-rate' });
    expect(decodePacket(mutate((v) => v.setFloat64(24, 1.5, true)))).toEqual({ ok: false, error: 'bad-frame-index' });
    expect(decodePacket(mutate((v) => v.setFloat64(24, Number.NaN, true)))).toEqual({ ok: false, error: 'bad-frame-index' });
    expect(decodePacket(mutate((v) => v.setFloat64(24, -960, true)))).toEqual({ ok: false, error: 'bad-frame-index' });
  });

  it('quantises floats symmetrically and clamps', () => {
    expect(floatToPcm16(1)).toBe(32767);
    expect(floatToPcm16(-1)).toBe(-32768);
    expect(floatToPcm16(4)).toBe(32767);
    expect(pcm16ToFloat(floatToPcm16(0.5))).toBeCloseTo(0.5, 4);
  });
});

describe('Packetizer', () => {
  it('stamps packets with the capture-thread frame index, not arrival time', () => {
    const got: { first: number; seq: number }[] = [];
    const p = new Packetizer({ packetFrames: 960, sampleRate: 48000, sessionId: 1, epoch: 1, emit: (_b, first, seq) => got.push({ first, seq }) });
    const block = new Float32Array(128);
    for (let f = 1_000_000; f < 1_000_000 + 128 * 30; f += 128) p.push(block, f);
    expect(got.map((g) => g.first)).toEqual([1_000_000, 1_000_960, 1_001_920, 1_002_880]);
    expect(got.map((g) => g.seq)).toEqual([0, 1, 2, 3]);
  });

  it('drops a partial packet on a timeline discontinuity', () => {
    const got: number[] = [];
    const p = new Packetizer({ packetFrames: 256, sampleRate: 48000, sessionId: 1, epoch: 1, emit: (_b, first) => got.push(first) });
    const block = new Float32Array(128);
    p.push(block, 0);
    p.push(block, 5000);
    p.push(block, 5128);
    expect(got).toEqual([5000]);
  });
});

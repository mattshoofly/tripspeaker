import { describe, expect, it } from 'vitest';
import {
  buildInviteUrl,
  claimRoomCode,
  extractRoomCodeFromPaste,
  generateRoomCode,
  hostPeerId,
  isValidRoomCode,
  normalizeNamespace,
  parseInviteCode,
  RoomCodeUnavailableError,
  sanitizeRoomCodeInput,
} from '../../src/core/roomCode';

describe('room codes', () => {
  it('formats with leading zeros and keeps them as strings', () => {
    const fixed = (v: number) => () => new Uint32Array([v, v, v, v]);
    expect(generateRoomCode(fixed(47))).toBe('0047');
    expect(generateRoomCode(fixed(0))).toBe('0000');
    expect(generateRoomCode(fixed(9999))).toBe('9999');
    expect(generateRoomCode(fixed(10047))).toBe('0047');
  });

  it('rejects biased values at the top of the 32-bit range', () => {
    const limit = Math.floor(0x1_0000_0000 / 10000) * 10000;
    let call = 0;
    const source = () => (call++ === 0 ? new Uint32Array([limit, limit + 5, 0xffffffff, limit + 9]) : new Uint32Array([1234, 0, 0, 0]));
    expect(generateRoomCode(source)).toBe('1234');
  });

  it('uses crypto randomness by default and always returns four digits', () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(/^\d{4}$/);
  });

  it('validates exactly four digits', () => {
    expect(isValidRoomCode('0047')).toBe(true);
    for (const bad of ['047', '00470', '00a7', ' 0047', '', '٠٠٤٧', 47 as unknown as string, null as unknown as string]) {
      expect(isValidRoomCode(bad)).toBe(false);
    }
  });

  it('sanitizes typed and pasted input', () => {
    expect(sanitizeRoomCodeInput('00 47')).toBe('0047');
    expect(sanitizeRoomCodeInput('0-0-4-7-9')).toBe('0047');
    expect(sanitizeRoomCodeInput('abc')).toBe('');
    expect(extractRoomCodeFromPaste('https://trip.example/?room=0047')).toBe('0047');
    expect(extractRoomCodeFromPaste('http://192.168.1.4:4417/?x=1&room=0815')).toBe('0815');
    expect(extractRoomCodeFromPaste('Room 0047')).toBe('0047');
  });

  it('parses invite links without losing leading zeros', () => {
    expect(parseInviteCode('?room=0047')).toBe('0047');
    expect(parseInviteCode('room=0007&x=1')).toBe('0007');
    expect(parseInviteCode('?room=47')).toBeNull();
    expect(parseInviteCode('?room=00470')).toBeNull();
    expect(buildInviteUrl('https://trip.example', '/', '0047')).toBe('https://trip.example/?room=0047');
  });

  it('derives deterministic namespaced host IDs that PeerJS accepts', () => {
    expect(hostPeerId('tripspeaker-v1-abc', '0047')).toBe('tripspeaker-v1-abc-0047');
    expect(hostPeerId('Trip Speaker!!', '1234')).toBe('trip-speaker-1234');
    expect(normalizeNamespace('')).toBe('tripspeaker');
    expect(() => hostPeerId('ns', '47')).toThrow();
    expect(hostPeerId('ns', '0047')).toMatch(/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/);
  });
});

describe('claiming a room code', () => {
  it('retries collisions with fresh codes', async () => {
    const taken = new Set(['1111', '2222']);
    const sequence = ['1111', '2222', '3333'];
    const tried: string[] = [];
    const code = await claimRoomCode(
      async (c) => {
        tried.push(c);
        return taken.has(c) ? { ok: false, reason: 'taken' } : { ok: true };
      },
      { generate: () => sequence.shift() ?? '9999' },
    );
    expect(code).toBe('3333');
    expect(tried).toEqual(['1111', '2222', '3333']);
  });

  it('never retries the same code twice', async () => {
    const pool = ['5555', '5555', '5555', '6666'];
    const tried: string[] = [];
    await claimRoomCode(
      async (c) => {
        tried.push(c);
        return c === '6666' ? { ok: true } : { ok: false, reason: 'taken' };
      },
      { generate: () => pool.shift() ?? '6666' },
    );
    expect(tried).toEqual(['5555', '6666']);
  });

  it('gives up after a bounded number of attempts', async () => {
    let n = 0;
    await expect(
      claimRoomCode(async () => ({ ok: false, reason: 'taken' }), { maxAttempts: 4, generate: () => String(1000 + n++) }),
    ).rejects.toBeInstanceOf(RoomCodeUnavailableError);
    expect(n).toBe(4);
  });

  it('surfaces signaling failures immediately instead of retrying', async () => {
    let calls = 0;
    const boom = new Error('socket closed');
    await expect(
      claimRoomCode(async () => {
        calls++;
        return { ok: false, reason: 'error', error: boom };
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });
});

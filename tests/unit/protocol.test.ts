import { describe, expect, it } from 'vitest';
import {
  admitHello,
  MAX_SPEAKERS,
  parseAudioMetadata,
  parseControlMessage,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  sanitizeName,
  type HelloMessage,
  type RoomAdmission,
} from '../../src/core/protocol';

const hello = (extra: Partial<HelloMessage> = {}): HelloMessage => ({
  t: 'hello',
  protocol: PROTOCOL_ID,
  version: PROTOCOL_VERSION,
  clientId: 'abcd1234ef',
  name: 'Maya',
  ...extra,
});

const room = (extra: Partial<RoomAdmission> = {}): RoomAdmission => ({
  sessionId: 42,
  locked: false,
  speakerCount: 1,
  ended: false,
  resumable: new Set(),
  removed: new Set(),
  ...extra,
});

describe('handshake admission', () => {
  it('admits a fresh guest into an open room', () => {
    expect(admitHello(hello(), room())).toEqual({ ok: true, resumeGuestId: null });
  });

  it('rejects protocol mismatches', () => {
    expect(admitHello(hello({ version: PROTOCOL_VERSION + 1 }), room())).toEqual({ ok: false, reason: 'protocol' });
  });

  it('rejects locked and full rooms', () => {
    expect(admitHello(hello(), room({ locked: true }))).toEqual({ ok: false, reason: 'locked' });
    expect(admitHello(hello(), room({ speakerCount: MAX_SPEAKERS }))).toEqual({ ok: false, reason: 'full' });
    expect(MAX_SPEAKERS).toBe(5);
  });

  it('lets a reconnecting guest back into a locked or full room, same session only', () => {
    const resume = { sessionId: 42, guestId: 'guest01' };
    const r = room({ locked: true, speakerCount: 5, resumable: new Set(['guest01']) });
    expect(admitHello(hello({ resume }), r)).toEqual({ ok: true, resumeGuestId: 'guest01' });
    // Stale session using the same code.
    expect(admitHello(hello({ resume: { sessionId: 41, guestId: 'guest01' } }), r)).toEqual({ ok: false, reason: 'ended' });
  });

  it('keeps removed guests out', () => {
    const r = room({ removed: new Set(['guest02']), resumable: new Set(['guest02']) });
    expect(admitHello(hello({ resume: { sessionId: 42, guestId: 'guest02' } }), r)).toEqual({ ok: false, reason: 'removed' });
  });

  it('refuses everyone once the room has ended', () => {
    expect(admitHello(hello(), room({ ended: true }))).toEqual({ ok: false, reason: 'ended' });
  });
});

describe('control message validation', () => {
  it('accepts well-formed messages', () => {
    expect(parseControlMessage({ t: 'ping', seq: 3, c1: 1234.5 })).toEqual({ t: 'ping', seq: 3, c1: 1234.5 });
    expect(parseControlMessage({ t: 'pong', seq: 3, c1: 1, h2: 10, h3: 11 })).toEqual({ t: 'pong', seq: 3, c1: 1, h2: 10, h3: 11 });
    expect(parseControlMessage(hello())).toMatchObject({ t: 'hello', clientId: 'abcd1234ef' });
  });

  it('rejects malformed or out-of-range payloads', () => {
    const bad: unknown[] = [
      null,
      'hello',
      { t: 'nope' },
      { t: 'ping', seq: -1, c1: 0 },
      { t: 'ping', seq: 1, c1: Number.NaN },
      { t: 'pong', seq: 1, c1: 0, h2: 10, h3: 9 },
      { t: 'anchor', sessionId: 1, epoch: 1, contextTime: 1, performanceTime: 1, slope: 2000, sourceRate: 48000 },
      { t: 'anchor', sessionId: 1, epoch: 1, contextTime: 1, performanceTime: 1, slope: 1000, sourceRate: 4 },
      { ...hello(), protocol: 'other-app' },
      { ...hello(), clientId: '<script>' },
      { t: 'status', phase: 'playing', muted: false, volume: 3, level: null },
      { t: 'cmd', command: { action: 'volume', volume: -1 } },
      { t: 'welcome', sessionId: 1, guestId: 'guest01', audioToken: 'token123', room: { sessionId: 2 } },
    ];
    for (const b of bad) expect(parseControlMessage(b)).toBeNull();
  });

  it('validates the room snapshot inside a welcome and its session id', () => {
    const roomSnap = {
      sessionId: 9,
      code: '0047',
      hostName: 'Ana',
      locked: false,
      sharing: 'idle',
      epoch: 1,
      sourceRate: 48000,
      commonBufferMs: 1200,
      speakers: [{ id: 'host', name: 'Ana', role: 'host', phase: 'ready', muted: false, volume: 1, level: null, order: 0 }],
    };
    expect(parseControlMessage({ t: 'welcome', sessionId: 9, guestId: 'guest01', audioToken: 'token123', room: roomSnap })).not.toBeNull();
    expect(parseControlMessage({ t: 'welcome', sessionId: 8, guestId: 'guest01', audioToken: 'token123', room: roomSnap })).toBeNull();
    expect(parseControlMessage({ t: 'room', room: { ...roomSnap, code: '47' } })).toBeNull();
    const tooMany = { ...roomSnap, speakers: Array.from({ length: 6 }, () => roomSnap.speakers[0]) };
    expect(parseControlMessage({ t: 'room', room: tooMany })).toBeNull();
  });

  it('validates audio connection metadata', () => {
    expect(parseAudioMetadata({ kind: 'audio', sessionId: 5, guestId: 'guest01', audioToken: 'tok12345' })).not.toBeNull();
    expect(parseAudioMetadata({ kind: 'audio', sessionId: 5, guestId: 'g', audioToken: 'tok12345' })).toBeNull();
    expect(parseAudioMetadata({ kind: 'control' })).toBeNull();
  });

  it('sanitizes display names', () => {
    expect(sanitizeName('  Maya\u0000’s   MacBook  ', 'x')).toBe('Maya ’s MacBook');
    expect(sanitizeName('', 'Guest')).toBe('Guest');
    expect(Array.from(sanitizeName('x'.repeat(80), '')).length).toBe(32);
  });
});

/**
 * Control-channel protocol. Every inbound message is parsed through
 * `parseControlMessage`, which rejects anything malformed or out of bounds
 * before the rest of the app sees it.
 */

export const PROTOCOL_ID = 'trip-speaker';
export const PROTOCOL_VERSION = 1;
export const MAX_SPEAKERS = 5;
export const MAX_NAME_LENGTH = 32;

export type SpeakerRole = 'host' | 'guest';

/** What a speaker reports about itself; the UI turns this into plain language. */
export type SpeakerPhase =
  | 'connecting'
  | 'sound-off'
  | 'syncing'
  | 'buffering'
  | 'ready'
  | 'playing'
  | 'reconnecting'
  | 'attention';

export interface SpeakerInfo {
  id: string;
  name: string;
  role: SpeakerRole;
  phase: SpeakerPhase;
  muted: boolean;
  volume: number;
  /** Output level 0..1 from the last status report, when available. */
  level: number | null;
  order: number;
}

export type SharingState = 'idle' | 'sharing' | 'stopped';

export interface RoomSnapshot {
  sessionId: number;
  code: string;
  hostName: string;
  locked: boolean;
  sharing: SharingState;
  epoch: number;
  sourceRate: number;
  commonBufferMs: number;
  speakers: SpeakerInfo[];
}

export type RejectReason = 'full' | 'locked' | 'protocol' | 'ended' | 'removed' | 'invalid';

export interface HelloMessage {
  t: 'hello';
  protocol: typeof PROTOCOL_ID;
  version: number;
  clientId: string;
  name: string;
  resume?: { sessionId: number; guestId: string };
}

export interface WelcomeMessage {
  t: 'welcome';
  sessionId: number;
  guestId: string;
  audioToken: string;
  room: RoomSnapshot;
}

export interface RejectMessage {
  t: 'reject';
  reason: RejectReason;
}

export interface RoomStateMessage {
  t: 'room';
  room: RoomSnapshot;
}

export interface PingMessage {
  t: 'ping';
  seq: number;
  c1: number;
}

export interface PongMessage {
  t: 'pong';
  seq: number;
  c1: number;
  h2: number;
  h3: number;
}

/** Host output-timestamp mapping: host context time ↔ host performance time. */
export interface AnchorMessage {
  t: 'anchor';
  sessionId: number;
  epoch: number;
  contextTime: number;
  performanceTime: number;
  /** Milliseconds of host performance time per second of host context time. */
  slope: number;
  sourceRate: number;
}

export type HostCommand =
  | { action: 'resync' }
  | { action: 'mute'; muted: boolean }
  | { action: 'volume'; volume: number }
  | { action: 'remove' };

export interface CommandMessage {
  t: 'cmd';
  command: HostCommand;
}

export interface StatusMessage {
  t: 'status';
  phase: SpeakerPhase;
  muted: boolean;
  volume: number;
  level: number | null;
}

export type GuestRequest = 'test-clicks' | 'resync-all';

export interface RequestMessage {
  t: 'request';
  request: GuestRequest;
}

export interface EndedMessage {
  t: 'ended';
}

export interface LeaveMessage {
  t: 'leave';
}

export type ControlMessage =
  | HelloMessage
  | WelcomeMessage
  | RejectMessage
  | RoomStateMessage
  | PingMessage
  | PongMessage
  | AnchorMessage
  | CommandMessage
  | StatusMessage
  | RequestMessage
  | EndedMessage
  | LeaveMessage;

const SPEAKER_PHASES: readonly SpeakerPhase[] = [
  'connecting',
  'sound-off',
  'syncing',
  'buffering',
  'ready',
  'playing',
  'reconnecting',
  'attention',
];
const REJECT_REASONS: readonly RejectReason[] = ['full', 'locked', 'protocol', 'ended', 'removed', 'invalid'];
const SHARING_STATES: readonly SharingState[] = ['idle', 'sharing', 'stopped'];
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isUint32(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff;
}
function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}
function inRange(v: unknown, min: number, max: number): v is number {
  return isFiniteNumber(v) && v >= min && v <= max;
}
function oneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // Strip control characters; keep the rest of Unicode (names are display-only text).
  // oxlint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('');
}

function parseSpeaker(v: unknown): SpeakerInfo | null {
  if (!isObj(v)) return null;
  if (!isId(v.id) || !oneOf(v.role, ['host', 'guest'] as const) || !oneOf(v.phase, SPEAKER_PHASES)) return null;
  if (typeof v.muted !== 'boolean' || !inRange(v.volume, 0, 1) || !inRange(v.order, 0, 1e9)) return null;
  const level = v.level === null ? null : inRange(v.level, 0, 1) ? v.level : undefined;
  if (level === undefined) return null;
  return {
    id: v.id,
    name: sanitizeName(v.name, 'Speaker'),
    role: v.role,
    phase: v.phase,
    muted: v.muted,
    volume: v.volume,
    level,
    order: v.order,
  };
}

function parseRoom(v: unknown): RoomSnapshot | null {
  if (!isObj(v)) return null;
  if (!isUint32(v.sessionId) || typeof v.code !== 'string' || !/^\d{4}$/.test(v.code)) return null;
  if (typeof v.locked !== 'boolean' || !oneOf(v.sharing, SHARING_STATES)) return null;
  if (!isUint32(v.epoch) || !inRange(v.sourceRate, 8000, 192000) || !inRange(v.commonBufferMs, 200, 5000)) return null;
  if (!Array.isArray(v.speakers) || v.speakers.length > MAX_SPEAKERS) return null;
  const speakers: SpeakerInfo[] = [];
  for (const s of v.speakers) {
    const parsed = parseSpeaker(s);
    if (!parsed) return null;
    speakers.push(parsed);
  }
  return {
    sessionId: v.sessionId,
    code: v.code,
    hostName: sanitizeName(v.hostName, 'Host'),
    locked: v.locked,
    sharing: v.sharing,
    epoch: v.epoch,
    sourceRate: v.sourceRate,
    commonBufferMs: v.commonBufferMs,
    speakers,
  };
}

/** Performance timestamps: non-negative and below ~11 days of uptime. */
const MAX_PERF_MS = 1e9;

function parseCommand(v: unknown): HostCommand | null {
  if (!isObj(v)) return null;
  switch (v.action) {
    case 'resync':
      return { action: 'resync' };
    case 'remove':
      return { action: 'remove' };
    case 'mute':
      return typeof v.muted === 'boolean' ? { action: 'mute', muted: v.muted } : null;
    case 'volume':
      return inRange(v.volume, 0, 1) ? { action: 'volume', volume: v.volume } : null;
    default:
      return null;
  }
}

export function parseControlMessage(raw: unknown): ControlMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'hello': {
      if (raw.protocol !== PROTOCOL_ID || !isFiniteNumber(raw.version) || !isId(raw.clientId)) return null;
      let resume: HelloMessage['resume'];
      if (raw.resume !== undefined) {
        if (!isObj(raw.resume) || !isUint32(raw.resume.sessionId) || !isId(raw.resume.guestId)) return null;
        resume = { sessionId: raw.resume.sessionId, guestId: raw.resume.guestId };
      }
      return {
        t: 'hello',
        protocol: PROTOCOL_ID,
        version: raw.version,
        clientId: raw.clientId,
        name: sanitizeName(raw.name, ''),
        ...(resume ? { resume } : {}),
      };
    }
    case 'welcome': {
      const room = parseRoom(raw.room);
      if (!room || !isUint32(raw.sessionId) || !isId(raw.guestId) || !isId(raw.audioToken)) return null;
      if (room.sessionId !== raw.sessionId) return null;
      return { t: 'welcome', sessionId: raw.sessionId, guestId: raw.guestId, audioToken: raw.audioToken, room };
    }
    case 'reject':
      return oneOf(raw.reason, REJECT_REASONS) ? { t: 'reject', reason: raw.reason } : null;
    case 'room': {
      const room = parseRoom(raw.room);
      return room ? { t: 'room', room } : null;
    }
    case 'ping':
      return isUint32(raw.seq) && inRange(raw.c1, 0, MAX_PERF_MS) ? { t: 'ping', seq: raw.seq, c1: raw.c1 } : null;
    case 'pong':
      if (!isUint32(raw.seq) || !inRange(raw.c1, 0, MAX_PERF_MS)) return null;
      if (!inRange(raw.h2, 0, MAX_PERF_MS) || !inRange(raw.h3, 0, MAX_PERF_MS) || raw.h3 < raw.h2) return null;
      return { t: 'pong', seq: raw.seq, c1: raw.c1, h2: raw.h2, h3: raw.h3 };
    case 'anchor':
      if (!isUint32(raw.sessionId) || !isUint32(raw.epoch)) return null;
      if (!inRange(raw.contextTime, 0, MAX_PERF_MS) || !inRange(raw.performanceTime, 0, MAX_PERF_MS)) return null;
      if (!inRange(raw.slope, 990, 1010) || !inRange(raw.sourceRate, 8000, 192000)) return null;
      return {
        t: 'anchor',
        sessionId: raw.sessionId,
        epoch: raw.epoch,
        contextTime: raw.contextTime,
        performanceTime: raw.performanceTime,
        slope: raw.slope,
        sourceRate: raw.sourceRate,
      };
    case 'cmd': {
      const command = parseCommand(raw.command);
      return command ? { t: 'cmd', command } : null;
    }
    case 'status': {
      if (!oneOf(raw.phase, SPEAKER_PHASES) || typeof raw.muted !== 'boolean' || !inRange(raw.volume, 0, 1)) return null;
      const level = raw.level === null ? null : inRange(raw.level, 0, 1) ? raw.level : undefined;
      if (level === undefined) return null;
      return { t: 'status', phase: raw.phase, muted: raw.muted, volume: raw.volume, level };
    }
    case 'request':
      return raw.request === 'test-clicks' || raw.request === 'resync-all' ? { t: 'request', request: raw.request } : null;
    case 'ended':
      return { t: 'ended' };
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}

export type HelloVerdict =
  | { ok: true; resumeGuestId: string | null }
  | { ok: false; reason: RejectReason };

export interface RoomAdmission {
  sessionId: number;
  locked: boolean;
  speakerCount: number;
  ended: boolean;
  /** Guest IDs that may resume (e.g. reconnecting within the grace period). */
  resumable: ReadonlySet<string>;
  /** Guest IDs the host removed during this session. */
  removed: ReadonlySet<string>;
}

/**
 * Host-side admission decision for a validated hello. A resume is honoured only
 * for the same session and a guest slot the host is still holding.
 */
export function admitHello(hello: HelloMessage, room: RoomAdmission): HelloVerdict {
  if (hello.version !== PROTOCOL_VERSION) return { ok: false, reason: 'protocol' };
  if (room.ended) return { ok: false, reason: 'ended' };
  if (hello.resume) {
    if (hello.resume.sessionId !== room.sessionId) return { ok: false, reason: 'ended' };
    if (room.removed.has(hello.resume.guestId)) return { ok: false, reason: 'removed' };
    if (room.resumable.has(hello.resume.guestId)) return { ok: true, resumeGuestId: hello.resume.guestId };
  }
  if (room.locked) return { ok: false, reason: 'locked' };
  if (room.speakerCount >= MAX_SPEAKERS) return { ok: false, reason: 'full' };
  return { ok: true, resumeGuestId: null };
}

export interface AudioConnectionMetadata {
  kind: 'audio';
  sessionId: number;
  guestId: string;
  audioToken: string;
}

export function parseAudioMetadata(raw: unknown): AudioConnectionMetadata | null {
  if (!isObj(raw) || raw.kind !== 'audio') return null;
  if (!isUint32(raw.sessionId) || !isId(raw.guestId) || !isId(raw.audioToken)) return null;
  return { kind: 'audio', sessionId: raw.sessionId, guestId: raw.guestId, audioToken: raw.audioToken };
}

export function randomId(bytes = 12, random: (n: number) => Uint8Array = defaultRandomBytes): string {
  const data = random(bytes);
  let out = '';
  for (const b of data) out += b.toString(16).padStart(2, '0');
  return out;
}

export function randomUint32(): number {
  const v = new Uint32Array(1);
  globalThis.crypto.getRandomValues(v);
  // Zero is reserved as "no session".
  return v[0] === 0 ? 1 : v[0];
}

function defaultRandomBytes(n: number): Uint8Array {
  const v = new Uint8Array(n);
  globalThis.crypto.getRandomValues(v);
  return v;
}

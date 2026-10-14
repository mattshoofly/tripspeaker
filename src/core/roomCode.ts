export const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_SPACE = 10 ** ROOM_CODE_LENGTH;
const ROOM_CODE_PATTERN = /^\d{4}$/;

export type RandomSource = (count: number) => Uint32Array;

export const cryptoRandom: RandomSource = (count) => {
  const values = new Uint32Array(count);
  globalThis.crypto.getRandomValues(values);
  return values;
};

/**
 * Uniform four-digit code from cryptographic randomness. Rejection sampling
 * avoids the modulo bias of 2^32 % 10000.
 */
export function generateRoomCode(random: RandomSource = cryptoRandom): string {
  const limit = Math.floor(0x1_0000_0000 / ROOM_CODE_SPACE) * ROOM_CODE_SPACE;
  for (;;) {
    const batch = random(4);
    for (const value of batch) {
      if (value < limit) {
        return String(value % ROOM_CODE_SPACE).padStart(ROOM_CODE_LENGTH, '0');
      }
    }
  }
}

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_PATTERN.test(value);
}

/** Keeps digits only, in order, capped at four. "00 47" and "0047x" both become "0047". */
export function sanitizeRoomCodeInput(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, ROOM_CODE_LENGTH);
}

/** Pasted text may be a full invite link; prefer its room parameter over stray digits. */
export function extractRoomCodeFromPaste(text: string): string {
  const fromLink = /[?&#]room=(\d{4})(?!\d)/.exec(text);
  if (fromLink) return fromLink[1];
  return sanitizeRoomCodeInput(text);
}

export function parseInviteCode(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const room = params.get('room');
  return isValidRoomCode(room) ? room : null;
}

export function buildInviteUrl(origin: string, pathname: string, code: string): string {
  const url = new URL(pathname || '/', origin);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

const PEER_ID_SAFE = /[^A-Za-z0-9]+/g;

/**
 * PeerJS IDs must be alphanumeric with single inner dashes/underscores.
 * The namespace keeps unrelated deployments on the shared public server apart.
 */
export function normalizeNamespace(namespace: string): string {
  const cleaned = namespace.replace(PEER_ID_SAFE, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return cleaned.length > 0 ? cleaned.slice(0, 48) : 'tripspeaker';
}

export function hostPeerId(namespace: string, code: string): string {
  if (!isValidRoomCode(code)) throw new Error(`Invalid room code: ${code}`);
  return `${normalizeNamespace(namespace)}-${code}`;
}

/** Small stable hash (FNV-1a) so a deployment host can become a short namespace suffix. */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export type ClaimOutcome = { ok: true } | { ok: false; reason: 'taken' } | { ok: false; reason: 'error'; error: unknown };

export class RoomCodeUnavailableError extends Error {
  readonly attempts: number;
  constructor(attempts: number) {
    super(`No free room code after ${attempts} attempts`);
    this.name = 'RoomCodeUnavailableError';
    this.attempts = attempts;
  }
}

export interface ClaimOptions {
  maxAttempts?: number;
  generate?: () => string;
  onAttempt?: (code: string, attempt: number) => void;
}

/**
 * Tries fresh codes until one registers. Only "taken" collisions are retried;
 * any other failure (signaling down, invalid key) is surfaced immediately.
 */
export async function claimRoomCode(
  tryClaim: (code: string) => Promise<ClaimOutcome>,
  { maxAttempts = 8, generate = () => generateRoomCode(), onAttempt }: ClaimOptions = {},
): Promise<string> {
  const tried = new Set<string>();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let code = generate();
    for (let guard = 0; tried.has(code) && guard < 32; guard++) code = generate();
    tried.add(code);
    onAttempt?.(code, attempt);
    const outcome = await tryClaim(code);
    if (outcome.ok) return code;
    if (outcome.reason === 'error') throw outcome.error;
  }
  throw new RoomCodeUnavailableError(maxAttempts);
}

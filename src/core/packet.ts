/**
 * Binary audio packet (little-endian):
 *
 *   0  uint32  magic 'TSP1'
 *   4  uint8   protocol version
 *   5  uint8   channel count
 *   6  uint16  sample frames in this packet
 *   8  uint32  session id
 *  12  uint32  stream epoch
 *  16  uint32  sequence number
 *  20  uint32  source sample rate (Hz)
 *  24  float64 first source sample-frame index (host capture timeline)
 *  32  int16[] PCM, interleaved when channels > 1
 */

export const PACKET_MAGIC = 0x31505354; // bytes "TSP1" read as little-endian uint32
export const PACKET_VERSION = 1;
export const PACKET_HEADER_BYTES = 32;
export const MAX_PACKET_FRAMES = 4096;
export const SUPPORTED_CHANNELS = 1;
export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 192000;

export interface PacketHeader {
  version: number;
  channels: number;
  frames: number;
  sessionId: number;
  epoch: number;
  sequence: number;
  sampleRate: number;
  firstFrame: number;
}

export type PacketError =
  | 'too-short'
  | 'bad-magic'
  | 'bad-version'
  | 'unsupported-channels'
  | 'bad-frame-count'
  | 'length-mismatch'
  | 'bad-sample-rate'
  | 'bad-frame-index';

export type DecodedPacket =
  | { ok: true; header: PacketHeader; pcm: Int16Array }
  | { ok: false; error: PacketError };

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function packetByteLength(frames: number, channels = SUPPORTED_CHANNELS): number {
  return PACKET_HEADER_BYTES + frames * channels * 2;
}

export function writePacketHeader(view: DataView, h: Omit<PacketHeader, 'version'>): void {
  view.setUint32(0, PACKET_MAGIC, true);
  view.setUint8(4, PACKET_VERSION);
  view.setUint8(5, h.channels);
  view.setUint16(6, h.frames, true);
  view.setUint32(8, h.sessionId >>> 0, true);
  view.setUint32(12, h.epoch >>> 0, true);
  view.setUint32(16, h.sequence >>> 0, true);
  view.setUint32(20, h.sampleRate >>> 0, true);
  view.setFloat64(24, h.firstFrame, true);
}

export function encodePacket(h: Omit<PacketHeader, 'version' | 'frames' | 'channels'>, pcm: Int16Array): ArrayBuffer {
  const frames = pcm.length;
  const buffer = new ArrayBuffer(packetByteLength(frames));
  writePacketHeader(new DataView(buffer), { ...h, frames, channels: 1 });
  writePcm(buffer, pcm);
  return buffer;
}

function writePcm(buffer: ArrayBuffer, pcm: Int16Array): void {
  if (LITTLE_ENDIAN) {
    new Int16Array(buffer, PACKET_HEADER_BYTES, pcm.length).set(pcm);
    return;
  }
  const view = new DataView(buffer, PACKET_HEADER_BYTES);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true);
}

/** Reads and validates only the fixed header; cheap enough for the main-thread relay. */
export function readPacketHeader(buffer: ArrayBuffer): { ok: true; header: PacketHeader } | { ok: false; error: PacketError } {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < PACKET_HEADER_BYTES) return { ok: false, error: 'too-short' };
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== PACKET_MAGIC) return { ok: false, error: 'bad-magic' };
  const version = view.getUint8(4);
  if (version !== PACKET_VERSION) return { ok: false, error: 'bad-version' };
  const channels = view.getUint8(5);
  if (channels !== SUPPORTED_CHANNELS) return { ok: false, error: 'unsupported-channels' };
  const frames = view.getUint16(6, true);
  if (frames < 1 || frames > MAX_PACKET_FRAMES) return { ok: false, error: 'bad-frame-count' };
  if (buffer.byteLength !== packetByteLength(frames, channels)) return { ok: false, error: 'length-mismatch' };
  const sampleRate = view.getUint32(20, true);
  if (sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) return { ok: false, error: 'bad-sample-rate' };
  const firstFrame = view.getFloat64(24, true);
  if (!Number.isFinite(firstFrame) || firstFrame < 0 || !Number.isInteger(firstFrame) || firstFrame > Number.MAX_SAFE_INTEGER - frames) {
    return { ok: false, error: 'bad-frame-index' };
  }
  return {
    ok: true,
    header: {
      version,
      channels,
      frames,
      sessionId: view.getUint32(8, true),
      epoch: view.getUint32(12, true),
      sequence: view.getUint32(16, true),
      sampleRate,
      firstFrame,
    },
  };
}

export function decodePacket(buffer: ArrayBuffer): DecodedPacket {
  const head = readPacketHeader(buffer);
  if (!head.ok) return head;
  const { frames, channels } = head.header;
  let pcm: Int16Array;
  if (LITTLE_ENDIAN) {
    pcm = new Int16Array(buffer, PACKET_HEADER_BYTES, frames * channels);
  } else {
    pcm = new Int16Array(frames * channels);
    const view = new DataView(buffer, PACKET_HEADER_BYTES);
    for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true);
  }
  return { ok: true, header: head.header, pcm };
}

export function floatToPcm16(sample: number): number {
  const s = sample > 1 ? 1 : sample < -1 ? -1 : sample;
  return s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
}

export function pcm16ToFloat(value: number): number {
  return value < 0 ? value / 32768 : value / 32767;
}

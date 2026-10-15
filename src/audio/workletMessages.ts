import type { RendererStats, TimingUpdate } from '../core/renderer';
import type { ClickSchedule } from '../core/testSignal';

export const CAPTURE_PROCESSOR = 'trip-speaker-capture';
export const RENDERER_PROCESSOR = 'trip-speaker-renderer';

export interface CaptureProcessorOptions {
  sessionId: number;
  epoch: number;
  packetFrames: number;
}

export type CaptureInbound =
  | { type: 'configure'; sessionId: number; epoch: number }
  | { type: 'active'; active: boolean }
  | { type: 'clicks'; leadSeconds: number; count: number; intervalSeconds: number }
  | { type: 'local-port'; port: MessagePort }
  | { type: 'dispose' };

export type CaptureOutbound =
  | { type: 'packet'; packet: ArrayBuffer; firstFrame: number; sequence: number }
  | { type: 'level'; rms: number; peak: number; frame: number; packets: number; discontinuities: number; frameGaps: number }
  | { type: 'clicks-scheduled'; schedule: ClickSchedule };

export type RendererInbound =
  | { type: 'session'; sessionId: number }
  | { type: 'timing'; timing: TimingUpdate | null }
  | { type: 'packet'; packet: ArrayBuffer }
  | { type: 'resync' }
  | { type: 'input-port'; port: MessagePort }
  | { type: 'dispose' };

export type RendererOutbound = { type: 'stats'; stats: RendererStats };

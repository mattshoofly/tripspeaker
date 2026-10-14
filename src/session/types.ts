import type { CaptureErrorKind, SuppressionState } from '../audio/capture';
import type { TimingDiagnostics } from '../audio/timing';
import type { SharingState, SpeakerPhase, SpeakerRole } from '../core/protocol';
import type { RendererStats } from '../core/renderer';
import type { JoinErrorKind } from '../net/errors';
import type { ChannelInfo } from '../net/peer';

export interface SpeakerView {
  id: string;
  name: string;
  role: SpeakerRole;
  phase: SpeakerPhase;
  muted: boolean;
  volume: number;
  level: number | null;
  order: number;
  isSelf: boolean;
}

export interface CaptureView {
  status: 'idle' | 'requesting' | 'sharing' | 'stopped' | 'error';
  error: CaptureErrorKind | null;
  suppression: SuppressionState;
  /** Audible input in the shared tab within the last moment. */
  inputActive: boolean;
  /** The browser reports the captured track as muted (no frames from the source). */
  trackMuted: boolean;
  sharingSince: number | null;
}

export interface LocalAudioView {
  volume: number;
  muted: boolean;
  trimMs: number;
  contextState: string;
  renderer: RendererStats | null;
  timing: TimingDiagnostics | null;
  outputGain: number;
}

export interface LinkDiagnostics {
  id: string;
  name: string;
  sent: number;
  dropped: number;
  backpressureEpisodes: number;
  bufferedBytes: number;
  channel: ChannelInfo | null;
}

export interface ClockView {
  thetaMs: number | null;
  rttMs: number | null;
  uncertaintyMs: number | null;
  samples: number;
}

export interface HostSnapshot {
  kind: 'host';
  stage: 'starting' | 'open' | 'ended' | 'failed';
  failure: 'signaling' | 'audio' | 'codes' | null;
  code: string | null;
  inviteUrl: string | null;
  sessionId: number;
  locked: boolean;
  signaling: 'connecting' | 'online' | 'reconnecting' | 'offline';
  hostName: string;
  speakers: SpeakerView[];
  capture: CaptureView;
  local: LocalAudioView;
  mutedAll: boolean;
  commonBufferMs: number;
  clicksActive: boolean;
  links: LinkDiagnostics[];
  maxSpeakers: number;
  outputChanged: boolean;
}

export type GuestStage = 'joining' | 'joined' | 'reconnecting' | 'failed' | 'ended' | 'removed' | 'rejected';

export interface GuestSnapshot {
  kind: 'guest';
  stage: GuestStage;
  joinError: JoinErrorKind | null;
  code: string;
  hostName: string | null;
  selfId: string | null;
  speakers: SpeakerView[];
  audio: 'off' | 'enabling' | 'on' | 'blocked';
  phase: SpeakerPhase;
  sharing: SharingState;
  sourceActive: boolean;
  local: LocalAudioView;
  clock: ClockView;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  audioChannel: ChannelInfo | null;
  packetsReceived: number;
  clicksActive: boolean;
  outputChanged: boolean;
  commonBufferMs: number;
}

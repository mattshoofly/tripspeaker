import type { SharingState, SpeakerPhase } from './protocol';
import type { RendererState } from './renderer';

/**
 * Speaker status is derived from independent facts so that, for example, an
 * open connection never reads as "Playing" by itself.
 */
export interface SpeakerDims {
  connection: 'connecting' | 'connected' | 'reconnecting' | 'failed';
  audio: 'off' | 'enabling' | 'on' | 'blocked';
  clockReady: boolean;
  sharing: SharingState;
  renderer: RendererState | null;
  /** Non-silent audio rendered recently. */
  sourceActive: boolean;
}

export function deriveSpeakerPhase(d: SpeakerDims): SpeakerPhase {
  if (d.connection === 'failed') return 'attention';
  if (d.connection === 'reconnecting') return 'reconnecting';
  if (d.connection === 'connecting') return 'connecting';
  if (d.audio === 'blocked') return 'attention';
  if (d.audio !== 'on') return 'sound-off';
  if (!d.clockReady) return 'syncing';
  if (d.sharing !== 'sharing') return 'ready';
  switch (d.renderer) {
    case null:
    case 'waiting':
      return 'syncing';
    case 'buffering':
    case 'starved':
      return 'buffering';
    case 'playing':
      return d.sourceActive ? 'playing' : 'ready';
  }
}

const PHASE_LABELS: Record<SpeakerPhase, string> = {
  connecting: 'Connecting',
  'sound-off': 'Sound not enabled',
  syncing: 'Getting in sync',
  buffering: 'Buffering',
  ready: 'Ready for music',
  playing: 'Playing together',
  reconnecting: 'Reconnecting',
  attention: 'Connection needs attention',
};

export function phaseLabel(phase: SpeakerPhase, muted = false): string {
  if (muted && (phase === 'ready' || phase === 'playing' || phase === 'buffering')) return 'Muted';
  return PHASE_LABELS[phase];
}

/** RMS above roughly -50 dBFS counts as audible source activity. */
export const ACTIVITY_THRESHOLD = 0.0032;

export class ActivityDetector {
  private lastActiveAt = Number.NEGATIVE_INFINITY;
  private readonly holdMs: number;

  constructor(holdMs = 1500) {
    this.holdMs = holdMs;
  }

  update(level: number, now: number): boolean {
    if (level >= ACTIVITY_THRESHOLD) this.lastActiveAt = now;
    return now - this.lastActiveAt <= this.holdMs;
  }

  isActive(now: number): boolean {
    return now - this.lastActiveAt <= this.holdMs;
  }

  reset(): void {
    this.lastActiveAt = Number.NEGATIVE_INFINITY;
  }
}

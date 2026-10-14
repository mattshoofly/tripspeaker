import type { RejectReason } from '../core/protocol';

export type JoinErrorKind =
  | 'invalid-code'
  | 'not-found'
  | 'full'
  | 'locked'
  | 'signaling'
  | 'timeout'
  | 'protocol'
  | 'removed'
  | 'ended'
  | 'host-unavailable';

export const JOIN_ERROR_COPY: Record<JoinErrorKind, { title: string; detail: string }> = {
  'invalid-code': { title: 'Enter all four digits.', detail: 'Room codes are four numbers, like 0047.' },
  'not-found': { title: 'No room found.', detail: 'Check the four-digit code and try again.' },
  full: { title: 'This room is full.', detail: 'A room holds five speakers, including the host.' },
  locked: { title: 'This room is locked.', detail: 'Ask your host to unlock it, then try again.' },
  signaling: {
    title: 'Can’t reach the connection service.',
    detail: 'Trip Speaker needs the internet to introduce laptops. Check your connection and try again.',
  },
  timeout: {
    title: 'Your network is blocking the connection.',
    detail: 'Try another Wi-Fi network or a hotspot that allows devices to connect.',
  },
  protocol: { title: 'This room runs a different version.', detail: 'Reload Trip Speaker on both laptops, then join again.' },
  removed: { title: 'The host removed this speaker.', detail: 'You can join again if the host unlocks the room.' },
  ended: { title: 'That room has ended.', detail: 'Ask your host for the new code.' },
  'host-unavailable': {
    title: 'The host isn’t answering.',
    detail: 'Make sure the host’s laptop is awake with Trip Speaker open, then try again.',
  },
};

export function rejectToJoinError(reason: RejectReason): JoinErrorKind {
  switch (reason) {
    case 'full':
      return 'full';
    case 'locked':
      return 'locked';
    case 'protocol':
      return 'protocol';
    case 'removed':
      return 'removed';
    case 'ended':
      return 'ended';
    case 'invalid':
      return 'protocol';
  }
}

export function signalingErrorToJoinError(type: string): JoinErrorKind {
  switch (type) {
    case 'peer-unavailable':
      return 'not-found';
    case 'timeout':
      return 'signaling';
    case 'webrtc':
    case 'negotiation-failed':
      return 'timeout';
    default:
      return 'signaling';
  }
}

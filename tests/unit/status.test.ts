import { describe, expect, it } from 'vitest';
import { ActivityDetector, deriveSpeakerPhase, phaseLabel, type SpeakerDims } from '../../src/core/status';

const base: SpeakerDims = {
  connection: 'connected',
  audio: 'on',
  clockReady: true,
  sharing: 'sharing',
  renderer: 'playing',
  sourceActive: true,
};

describe('speaker status', () => {
  it('never reports Playing just because a connection is open', () => {
    expect(deriveSpeakerPhase({ ...base, audio: 'off' })).toBe('sound-off');
    expect(deriveSpeakerPhase({ ...base, clockReady: false })).toBe('syncing');
    expect(deriveSpeakerPhase({ ...base, renderer: 'buffering' })).toBe('buffering');
    expect(deriveSpeakerPhase({ ...base, sourceActive: false })).toBe('ready');
    expect(deriveSpeakerPhase({ ...base, sharing: 'idle' })).toBe('ready');
    expect(deriveSpeakerPhase(base)).toBe('playing');
  });

  it('puts connection problems first', () => {
    expect(deriveSpeakerPhase({ ...base, connection: 'reconnecting' })).toBe('reconnecting');
    expect(deriveSpeakerPhase({ ...base, connection: 'failed' })).toBe('attention');
    expect(deriveSpeakerPhase({ ...base, connection: 'connecting' })).toBe('connecting');
  });

  it('keeps mute separate from the phase but shows it in the label', () => {
    expect(phaseLabel('playing', true)).toBe('Muted');
    expect(phaseLabel('reconnecting', true)).toBe('Reconnecting');
    expect(phaseLabel('ready')).toBe('Ready for music');
    expect(phaseLabel('syncing')).toBe('Getting in sync');
  });

  it('holds activity briefly so quiet passages do not flicker', () => {
    const a = new ActivityDetector(1500);
    expect(a.update(0.05, 0)).toBe(true);
    expect(a.update(0, 1000)).toBe(true);
    expect(a.update(0, 1600)).toBe(false);
  });
});

/**
 * Calibration clicks, generated on the capture thread at exact source-frame
 * positions so they travel through the same packets, transport, and
 * scheduled renderer as music.
 */

export interface ClickSchedule {
  startFrame: number;
  count: number;
  intervalFrames: number;
  sampleRate: number;
}

const CLICK_MS = 9;
const CLICK_HZ = 2600;
const ACCENT_HZ = 3500;
const DECAY_S = 0.0016;
const AMPLITUDE = 0.7;
/** Music level while clicks play, so the clicks stay easy to compare. */
export const CLICK_DUCK_GAIN = 0.15;
const DUCK_MARGIN_S = 0.12;

export function clickScheduleEnd(s: ClickSchedule): number {
  return s.startFrame + (s.count - 1) * s.intervalFrames + Math.ceil((CLICK_MS / 1000) * s.sampleRate);
}

/** Click waveform at an absolute source frame (0 outside clicks). Every fourth click is accented. */
export function clickSampleAt(frame: number, s: ClickSchedule): number {
  if (frame < s.startFrame) return 0;
  const offset = frame - s.startFrame;
  const index = Math.floor(offset / s.intervalFrames);
  if (index >= s.count) return 0;
  const t = (offset - index * s.intervalFrames) / s.sampleRate;
  if (t >= CLICK_MS / 1000) return 0;
  const hz = index % 4 === 0 ? ACCENT_HZ : CLICK_HZ;
  const attack = Math.min(1, t / 0.0002);
  return AMPLITUDE * attack * Math.exp(-t / DECAY_S) * Math.sin(2 * Math.PI * hz * t);
}

/** Smooth music gain around a click train: 1 outside, CLICK_DUCK_GAIN inside. */
export function duckGainAt(frame: number, s: ClickSchedule): number {
  const margin = DUCK_MARGIN_S * s.sampleRate;
  const ramp = 0.03 * s.sampleRate;
  const start = s.startFrame - margin;
  const end = clickScheduleEnd(s) + margin;
  if (frame <= start - ramp || frame >= end + ramp) return 1;
  let k = 1;
  if (frame < start) k = (start - frame) / ramp;
  else if (frame > end) k = (frame - end) / ramp;
  else k = 0;
  return CLICK_DUCK_GAIN + (1 - CLICK_DUCK_GAIN) * k;
}

export function makeClickSchedule(currentFrame: number, sampleRate: number, leadSeconds = 0.3, count = 8, intervalSeconds = 0.75): ClickSchedule {
  return {
    startFrame: Math.round(currentFrame + leadSeconds * sampleRate),
    count,
    intervalFrames: Math.round(intervalSeconds * sampleRate),
    sampleRate,
  };
}

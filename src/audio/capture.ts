/**
 * Tab-audio capture. `requestTabCapture` must be called synchronously from a
 * click handler: it invokes getDisplayMedia before any await so Chrome sees
 * the user gesture. Video is requested only because the API requires it; it
 * is never displayed, recorded, or sent.
 */

export type CaptureErrorKind = 'cancelled' | 'denied' | 'no-audio' | 'not-tab' | 'unsupported' | 'not-readable' | 'failed';

export class CaptureError extends Error {
  readonly kind: CaptureErrorKind;
  constructor(kind: CaptureErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'CaptureError';
    this.kind = kind;
  }
}

export type SuppressionState = 'on' | 'off' | 'unknown';

export interface AudioProcessing {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  channelCount: number | null;
}

export interface CaptureResult {
  stream: MediaStream;
  audioTrack: MediaStreamTrack;
  videoTrack: MediaStreamTrack | null;
  suppression: SuppressionState;
  surface: string | null;
  sampleRate: number | null;
  processing: AudioProcessing;
  /** Stops tracks and frees anything the capture created. */
  release: () => void;
}

type DisplayMediaOptions = DisplayMediaStreamOptions & Record<string, unknown>;

export type CaptureFixture = 'tone' | 'silent' | 'cancel' | 'denied' | 'no-audio' | 'window';

interface TestGlobals {
  __TRIP_SPEAKER_TEST__?: { capture?: CaptureFixture };
}

/**
 * Chrome 154 refuses to start tab audio when echoCancellation:false is
 * requested up front ("Could not start audio source"), so it is only
 * attempted afterwards via applyConstraints. Noise suppression and auto-gain
 * would damage music and are turned off where the browser allows it.
 */
let minimalAudioConstraints = false;

export function displayMediaOptions(controller?: unknown, minimal = minimalAudioConstraints): DisplayMediaOptions {
  return {
    video: {
      displaySurface: 'browser',
      frameRate: { max: 1 },
      width: { max: 320 },
      height: { max: 240 },
    } as MediaTrackConstraints,
    audio: (minimal
      ? { suppressLocalAudioPlayback: true }
      : { suppressLocalAudioPlayback: true, noiseSuppression: false, autoGainControl: false }) as unknown as MediaTrackConstraints,
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    systemAudio: 'exclude',
    windowAudio: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'exclude',
    ...(controller ? { controller } : {}),
  };
}

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function suppressionSupported(): boolean {
  try {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined;
    return Boolean(supported?.suppressLocalAudioPlayback);
  } catch {
    return false;
  }
}

export function mapCaptureError(err: unknown): CaptureError {
  if (err instanceof CaptureError) return err;
  const name = (err as { name?: string })?.name ?? '';
  const message = String((err as { message?: string })?.message ?? '');
  switch (name) {
    case 'NotAllowedError':
      return /system/i.test(message) ? new CaptureError('denied', message) : new CaptureError('cancelled', message);
    case 'NotReadableError':
      // Next attempt asks for nothing but tab audio.
      if (/audio/i.test(message)) minimalAudioConstraints = true;
      return new CaptureError('not-readable', message);
    case 'TypeError':
    case 'NotSupportedError':
      return new CaptureError('unsupported', message);
    default:
      return new CaptureError('failed', message || name);
  }
}

export function inspectCapture(stream: MediaStream): CaptureResult {
  const [audioTrack] = stream.getAudioTracks();
  const [videoTrack] = stream.getVideoTracks();
  const surface = (videoTrack?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface ?? null;
  if (!audioTrack || audioTrack.readyState !== 'live') {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError(surface && surface !== 'browser' ? 'not-tab' : 'no-audio');
  }
  const settings = audioTrack.getSettings() as MediaTrackSettings & { suppressLocalAudioPlayback?: boolean };
  const suppression: SuppressionState =
    settings.suppressLocalAudioPlayback === true ? 'on' : settings.suppressLocalAudioPlayback === false ? 'off' : 'unknown';
  return {
    stream,
    audioTrack,
    videoTrack: videoTrack ?? null,
    suppression,
    surface,
    sampleRate: typeof settings.sampleRate === 'number' ? settings.sampleRate : null,
    processing: readProcessing(audioTrack),
    release: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

export function readProcessing(track: MediaStreamTrack): AudioProcessing {
  const s = track.getSettings();
  return {
    echoCancellation: typeof s.echoCancellation === 'boolean' ? s.echoCancellation : null,
    noiseSuppression: typeof s.noiseSuppression === 'boolean' ? s.noiseSuppression : null,
    autoGainControl: typeof s.autoGainControl === 'boolean' ? s.autoGainControl : null,
    channelCount: typeof s.channelCount === 'number' ? s.channelCount : null,
  };
}

/** Best effort: voice processing is wrong for music, but some builds refuse to turn it off. */
export async function relaxProcessing(result: CaptureResult): Promise<AudioProcessing> {
  try {
    await result.audioTrack.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  } catch {
    try {
      await result.audioTrack.applyConstraints({ noiseSuppression: false, autoGainControl: false });
    } catch {
      /* keep the browser defaults */
    }
  }
  result.processing = readProcessing(result.audioTrack);
  return result.processing;
}

export function requestTabCapture(): Promise<CaptureResult> {
  const fixture = (globalThis as TestGlobals).__TRIP_SPEAKER_TEST__?.capture;
  if (fixture) return fixtureCapture(fixture);
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getDisplayMedia) return Promise.reject(new CaptureError('unsupported'));
  const Controller = (globalThis as { CaptureController?: new () => { setFocusBehavior?: (b: string) => void } }).CaptureController;
  const controller = Controller ? new Controller() : undefined;
  let pending: Promise<MediaStream>;
  try {
    pending = md.getDisplayMedia(displayMediaOptions(controller));
  } catch (err) {
    return Promise.reject(mapCaptureError(err));
  }
  return pending.then(
    (stream) => {
      try {
        // Keep Trip Speaker in front so the host sees whether audio arrived.
        controller?.setFocusBehavior?.('no-focus-change');
      } catch {
        /* only valid for tab/window surfaces; harmless otherwise */
      }
      return inspectCapture(stream);
    },
    (err) => {
      throw mapCaptureError(err);
    },
  );
}

/** Explicit test fixtures: never used unless a test sets __TRIP_SPEAKER_TEST__.capture. */
function fixtureCapture(kind: CaptureFixture): Promise<CaptureResult> {
  if (kind === 'cancel') return Promise.reject(new CaptureError('cancelled', 'Fixture: picker dismissed'));
  if (kind === 'denied') return Promise.reject(new CaptureError('denied', 'Fixture: Permission denied by system'));
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const video = canvas.captureStream(1).getVideoTracks()[0];
  if (kind === 'no-audio' || kind === 'window') {
    const stream = new MediaStream([video]);
    try {
      return Promise.resolve(inspectCapture(stream));
    } catch (err) {
      return Promise.reject(kind === 'window' ? new CaptureError('not-tab') : err);
    }
  }
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = kind === 'silent' ? 0 : 0.25;
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.15;
  lfo.connect(lfoGain).connect(gain.gain);
  osc.connect(gain).connect(dest);
  osc.start();
  lfo.start();
  void ctx.resume();
  const stream = new MediaStream([...dest.stream.getAudioTracks(), video]);
  const audioTrack = stream.getAudioTracks()[0];
  return Promise.resolve({
    stream,
    audioTrack,
    videoTrack: video,
    suppression: 'on',
    surface: 'browser',
    sampleRate: ctx.sampleRate,
    processing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
    release: () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  });
}

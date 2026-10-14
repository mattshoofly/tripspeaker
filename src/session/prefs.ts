import { clampTrim } from '../core/timeline';

const KEY = 'tripspeaker:prefs';

export type VisualizerMode = 'live' | 'calm' | 'off';

export interface Prefs {
  deviceName: string;
  volume: number;
  trimMs: number;
  visualizer: VisualizerMode;
  clientId: string;
}

function randomClientId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const DEFAULTS: Omit<Prefs, 'clientId'> = { deviceName: '', volume: 0.85, trimMs: 0, visualizer: 'live' };

let cache: Prefs | null = null;

export function loadPrefs(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    stored = {};
  }
  cache = {
    deviceName: typeof stored.deviceName === 'string' ? stored.deviceName.slice(0, 32) : DEFAULTS.deviceName,
    volume: typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1 ? stored.volume : DEFAULTS.volume,
    trimMs: typeof stored.trimMs === 'number' ? clampTrim(stored.trimMs) : DEFAULTS.trimMs,
    visualizer: stored.visualizer === 'calm' || stored.visualizer === 'off' ? stored.visualizer : 'live',
    clientId: typeof stored.clientId === 'string' && /^[a-f0-9]{8,64}$/.test(stored.clientId) ? stored.clientId : randomClientId(),
  };
  savePrefs(cache);
  return cache;
}

export function savePrefs(next: Partial<Prefs>): Prefs {
  const merged = { ...(cache ?? loadPrefs()), ...next };
  cache = merged;
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* private mode or full storage: keep in memory */
  }
  return merged;
}

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

export interface ParticipantOptions {
  namespace: string;
  capture?: 'tone' | 'silent' | 'cancel' | 'denied' | 'no-audio' | 'window';
  sampleRate?: number;
  reducedMotion?: 'reduce' | 'no-preference';
  viewport?: { width: number; height: number };
}

/** Each participant is its own browser context: separate storage, clock origin, and peer. */
export async function participant(browser: Browser, name: string, o: ParticipantOptions): Promise<Participant> {
  const context = await browser.newContext({ viewport: o.viewport ?? { width: 1280, height: 800 }, reducedMotion: o.reducedMotion ?? 'no-preference' });
  await context.addInitScript(
    ({ ns, capture, sampleRate }) => {
      localStorage.setItem(
        'tripspeaker:connection',
        JSON.stringify({ signaling: { host: '127.0.0.1', port: 9417, path: '/ts', secure: false }, iceServers: [], namespace: ns }),
      );
      if (capture || sampleRate) (window as unknown as { __TRIP_SPEAKER_TEST__: unknown }).__TRIP_SPEAKER_TEST__ = { capture, sampleRate };
    },
    { ns: o.namespace, capture: o.capture, sampleRate: o.sampleRate },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  return { name, context, page, errors };
}

export function uniqueNamespace(label: string): string {
  return `e2e-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function startRoom(host: Participant): Promise<string> {
  await host.page.getByRole('button', { name: 'Start a room' }).click();
  const code = host.page.getByTestId('room-code');
  await expect(code).toHaveAttribute('data-code', /^\d{4}$/, { timeout: 30_000 });
  return (await code.getAttribute('data-code')) as string;
}

export async function openJoin(p: Participant): Promise<void> {
  await p.page.getByRole('button', { name: 'Join a room' }).click();
  await expect(p.page.getByLabel('Room code, four digits')).toBeFocused();
}

export async function joinRoom(guest: Participant, code: string): Promise<void> {
  await openJoin(guest);
  await guest.page.getByLabel('Room code, four digits').pressSequentially(code);
  await guest.page.getByLabel('Device name (optional)').fill(guest.name);
  await guest.page.getByRole('button', { name: 'Join room' }).click();
  await expect(guest.page.getByTestId('guest-room')).toBeVisible({ timeout: 30_000 });
}

export async function enableSpeaker(guest: Participant): Promise<void> {
  await guest.page.getByTestId('enable-speaker').click();
  await expect(guest.page.getByTestId('guest-room')).toHaveAttribute('data-audio', 'on');
}

export async function snapshot<T = Record<string, unknown>>(page: Page): Promise<T> {
  return (await page.evaluate(() => window.__tripSpeaker?.snapshot())) as T;
}

export interface Probe {
  timeOrigin: number;
  sourceRate: number;
  sourcePosition: number;
  heardAtPerf: number;
  thetaMs: number | null;
  framesPlayed: number;
  level: number;
  anchorSource: string | null;
  epoch: number;
}

export async function probe(page: Page): Promise<Probe | null> {
  return (await page.evaluate(() => window.__tripSpeaker?.probe() ?? null)) as Probe | null;
}

/** Opens a tab titled "Fixture Music" that plays a generated tone; Chrome auto-selects it for capture. */
export async function openFixtureMusic(host: Participant): Promise<Page> {
  await host.context.route('**/__fixture/music', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Fixture Music</title></head><body style="background:#111;color:#eee;font:16px sans-serif">
<button id="play">Play fixture music</button>
<script>
document.getElementById('play').onclick = () => {
  const ctx = new AudioContext();
  const out = ctx.createGain(); out.gain.value = 0.35; out.connect(ctx.destination);
  const osc = ctx.createOscillator(); osc.frequency.value = 330;
  const amp = ctx.createGain(); amp.gain.value = 0.6;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 1.3;
  const depth = ctx.createGain(); depth.gain.value = 0.35;
  lfo.connect(depth).connect(amp.gain);
  osc.connect(amp).connect(out);
  osc.start(); lfo.start();
  window.__playing = true;
};
</script></body></html>`,
    }),
  );
  const music = await host.context.newPage();
  await music.goto('/__fixture/music');
  await music.getByRole('button', { name: 'Play fixture music' }).click();
  await expect.poll(() => music.evaluate(() => (window as unknown as { __playing?: boolean }).__playing)).toBe(true);
  await host.page.bringToFront();
  return music;
}

export interface SyncReport {
  /** Pairwise difference (ms) between the source position each device is heard at, at one shared instant. */
  maxSpreadMs: number;
  positionsMs: number[];
}

/**
 * Compares devices on one wall clock (timeOrigin + performance time). All
 * contexts share this machine's clock, so this checks the scheduling chain
 * end to end. It says nothing about physical speakers.
 */
export function compareProbes(probes: Probe[]): SyncReport {
  const wall = probes.map((p) => p.timeOrigin + p.heardAtPerf);
  const ref = Math.max(...wall);
  const positionsMs = probes.map((p, i) => ((p.sourcePosition + ((ref - wall[i]) / 1000) * p.sourceRate) / p.sourceRate) * 1000);
  const maxSpreadMs = Math.max(...positionsMs) - Math.min(...positionsMs);
  return { maxSpreadMs, positionsMs };
}

export async function closeAll(...ps: (Participant | undefined)[]): Promise<void> {
  for (const p of ps) await p?.context.close().catch(() => undefined);
}

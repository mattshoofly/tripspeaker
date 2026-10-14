import { expect, test } from '@playwright/test';
import { closeAll, compareProbes, enableSpeaker, joinRoom, participant, probe, snapshot, startRoom, uniqueNamespace, type Participant } from '../helpers';

interface Renderer {
  state: string;
  sourceRate: number;
  outputRate: number;
  underruns: number;
  missingFrames: number;
  latePackets: number;
  resyncs: number;
  framesPlayed: number;
  level: number;
}
type Snap = { local: { renderer: Renderer | null } };

async function waitPlaying(p: Participant) {
  await expect
    .poll(async () => {
      const r = (await snapshot<Snap>(p.page)).local.renderer;
      return r?.state === 'playing' && r.level > 0.005;
    }, { timeout: 40_000 })
    .toBe(true);
}

test('44.1 kHz source plays on 48 kHz output (and the reverse) on one timeline', async ({ browser }) => {
  const ns = uniqueNamespace('rates');
  const host = await participant(browser, 'Host 44.1k', { namespace: ns, capture: 'tone', sampleRate: 44100 });
  const g48 = await participant(browser, 'Guest 48k', { namespace: ns, sampleRate: 48000 });
  const host48 = await participant(browser, 'Host 48k', { namespace: `${ns}-b`, capture: 'tone', sampleRate: 48000 });
  const g441 = await participant(browser, 'Guest 44.1k', { namespace: `${ns}-b`, sampleRate: 44100 });
  try {
    for (const [h, g] of [
      [host, g48],
      [host48, g441],
    ] as const) {
      const code = await startRoom(h);
      await joinRoom(g, code);
      await enableSpeaker(g);
      await h.page.getByRole('button', { name: 'Share music tab' }).click();
      await waitPlaying(g);
      await g.page.waitForTimeout(2500);
      const r = (await snapshot<Snap>(g.page)).local.renderer!;
      expect([r.sourceRate, r.outputRate]).toEqual(h === host ? [44100, 48000] : [48000, 44100]);
      expect(r.underruns).toBe(0);
      expect(r.resyncs).toBe(0);
      const report = compareProbes([(await probe(h.page))!, (await probe(g.page))!]);
      test.info().annotations.push({ type: 'rates', description: `${r.sourceRate}→${r.outputRate} Hz: scheduled spread ${report.maxSpreadMs.toFixed(2)} ms` });
      expect(report.maxSpreadMs).toBeLessThan(20);
    }
  } finally {
    await closeAll(host, g48, host48, g441);
  }
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`playback stays clean while animated UI is used (motion: ${motion})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ns = uniqueNamespace(`motion-${motion}`);
    const host = await participant(browser, 'Host', { namespace: ns, capture: 'tone', reducedMotion: motion });
    const guest = await participant(browser, 'Guest', { namespace: ns, reducedMotion: motion });
    try {
      const code = await startRoom(host);
      await joinRoom(guest, code);
      await enableSpeaker(guest);
      await host.page.getByRole('button', { name: 'Share music tab' }).click();
      await waitPlaying(guest);
      const before = (await snapshot<Snap>(guest.page)).local.renderer!;
      const contextBefore = await guest.page.evaluate(() => performance.now());

      for (let i = 0; i < 4; i++) {
        await guest.page.getByRole('button', { name: 'Hear an echo?' }).click();
        await expect(guest.page.getByTestId('calibration-drawer')).toBeVisible();
        await guest.page.getByRole('button', { name: '1 millisecond later' }).click();
        await guest.page.keyboard.press('Escape');
        await expect(guest.page.getByTestId('calibration-drawer')).toBeHidden();
        await host.page.getByRole('button', { name: 'Sound settings' }).click();
        await host.page.getByTestId('settings-drawer').getByText('Advanced diagnostics').click();
        await host.page.keyboard.press('Escape');
        await expect(host.page.getByTestId('settings-drawer')).toBeHidden();
        await host.page.getByRole('button', { name: 'Volume for Guest, 85%' }).click();
        await host.page.keyboard.press('Escape');
        await guest.page.setViewportSize({ width: i % 2 ? 1280 : 900, height: 800 });
      }
      await guest.page.getByRole('button', { name: 'Hear an echo?' }).click();
      await guest.page.getByRole('button', { name: 'Reset' }).click();
      await guest.page.keyboard.press('Escape');
      await guest.page.waitForTimeout(1500);

      const after = (await snapshot<Snap>(guest.page)).local.renderer!;
      const elapsed = (await guest.page.evaluate(() => performance.now())) - contextBefore;
      const played = after.framesPlayed - before.framesPlayed;
      test.info().annotations.push({
        type: 'motion',
        description: `${motion}: ${(elapsed / 1000).toFixed(1)} s of UI activity, ${played} frames played, underruns +${after.underruns - before.underruns}, missing +${after.missingFrames - before.missingFrames}, late packets +${after.latePackets - before.latePackets}, resyncs +${after.resyncs - before.resyncs}`,
      });
      expect(after.underruns - before.underruns).toBe(0);
      expect(after.missingFrames - before.missingFrames).toBe(0);
      expect(after.resyncs - before.resyncs).toBe(0);
      // Drawers, resizes, and trim nudges never restart the stream.
      expect(played).toBeGreaterThan((elapsed / 1000) * 48000 * 0.9);
    } finally {
      await closeAll(host, guest);
    }
  });
}

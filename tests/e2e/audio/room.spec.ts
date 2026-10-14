import { expect, test } from '@playwright/test';
import {
  closeAll,
  compareProbes,
  enableSpeaker,
  joinRoom,
  openFixtureMusic,
  participant,
  probe,
  snapshot,
  startRoom,
  uniqueNamespace,
  type Participant,
  type Probe,
} from '../helpers';

interface RendererLike {
  state: string;
  framesPlayed: number;
  missingFrames: number;
  underruns: number;
  latePackets: number;
  level: number;
}
interface GuestSnap {
  stage: string;
  phase: string;
  audio: string;
  clock: { thetaMs: number | null; rttMs: number | null };
  local: { renderer: RendererLike | null; outputGain: number; muted: boolean; volume: number };
  packetsReceived: number;
  speakers: { id: string; name: string; order: number }[];
}
interface HostSnap {
  stage: string;
  code: string;
  speakers: { id: string; name: string; phase: string; order: number; muted: boolean }[];
  capture: { status: string; inputActive: boolean; suppression: string };
  local: { renderer: RendererLike | null };
  links: { id: string; sent: number; dropped: number; channel: { ordered: boolean | null; maxRetransmits: number | null } | null }[];
}

async function waitPlaying(p: Participant) {
  await expect
    .poll(async () => {
      const s = await snapshot<GuestSnap>(p.page);
      return s?.local.renderer?.state === 'playing' && (s.local.renderer.level ?? 0) > 0.005 ? 'playing' : `${s?.phase}/${s?.local.renderer?.state}`;
    }, { timeout: 40_000, intervals: [250] })
    .toBe('playing');
}

test.describe('real WebRTC room', () => {
  test('host and two guests play the same generated audio on one timeline', async ({ browser }) => {
    const ns = uniqueNamespace('room');
    const host = await participant(browser, 'Host Mac', { namespace: ns });
    const a = await participant(browser, 'Guest A', { namespace: ns });
    const b = await participant(browser, 'Guest B', { namespace: ns });
    let c: Participant | undefined;
    try {
      const code = await test.step('host creates a real room', async () => {
        const code = await startRoom(host);
        await expect(host.page.getByRole('heading', { name: 'Choose your music tab' })).toBeVisible();
        return code;
      });

      await test.step('two guests join with the displayed code and enable sound', async () => {
        await joinRoom(a, code);
        await joinRoom(b, code);
        await expect(a.page.getByTestId('listen-title')).toHaveText('Turn this Mac into a speaker');
        await enableSpeaker(a);
        await enableSpeaker(b);
        await expect(a.page.getByTestId('listen-title')).toHaveText('Waiting for your host to share music.', { timeout: 30_000 });
        await expect(host.page.getByTestId('speaker-strip').locator('[data-speaker]')).toHaveCount(3);
      });

      const music = await test.step('host shares a tab that plays generated audio', async () => {
        const music = await openFixtureMusic(host);
        await host.page.getByRole('button', { name: 'Share music tab' }).click();
        await expect(host.page.getByTestId('input-status')).toHaveText('Sound from your tab', { timeout: 20_000 });
        const hs = await snapshot<HostSnap>(host.page);
        expect(hs.capture.status).toBe('sharing');
        return music;
      });

      await test.step('every speaker renders the stream on schedule', async () => {
        await waitPlaying(a);
        await waitPlaying(b);
        await expect(a.page.getByTestId('listen-title')).toHaveText('Playing together');
        await expect.poll(async () => (await snapshot<HostSnap>(host.page)).local.renderer?.state, { timeout: 20_000 }).toBe('playing');
        await host.page.waitForTimeout(3000);
        const [ha, hb] = [await snapshot<GuestSnap>(a.page), await snapshot<GuestSnap>(b.page)];
        for (const s of [ha, hb]) {
          expect(s.packetsReceived).toBeGreaterThan(100);
          expect(s.local.renderer!.framesPlayed).toBeGreaterThan(48000);
          expect(s.local.renderer!.underruns).toBe(0);
        }
      });

      await test.step('clock offsets match the true difference between page clocks', async () => {
        const origins = await Promise.all([host, a, b].map((p) => p.page.evaluate(() => performance.timeOrigin)));
        for (const [i, g] of [a, b].entries()) {
          const s = await snapshot<GuestSnap>(g.page);
          const truth = origins[i + 1] - origins[0];
          test.info().annotations.push({ type: 'clock', description: `${g.name}: theta ${s.clock.thetaMs?.toFixed(2)} ms vs true ${truth.toFixed(2)} ms, rtt ${s.clock.rttMs?.toFixed(2)} ms` });
          expect(Math.abs((s.clock.thetaMs ?? 1e9) - truth)).toBeLessThan(5);
        }
      });

      await test.step('host and guests are scheduled to the same source position', async () => {
        const probes: Probe[] = [];
        for (const p of [host, a, b]) {
          const pr = await probe(p.page);
          expect(pr, `${p.name} probe`).not.toBeNull();
          probes.push(pr!);
        }
        const report = compareProbes(probes);
        test.info().annotations.push({ type: 'sync', description: `scheduled spread ${report.maxSpreadMs.toFixed(2)} ms (${probes.map((x) => x.anchorSource).join(', ')})` });
        expect(report.maxSpreadMs).toBeLessThan(20);
      });

      await test.step('host sees all speakers playing and inspects channel behaviour', async () => {
        await expect.poll(async () => (await snapshot<HostSnap>(host.page)).speakers.filter((s) => s.phase === 'playing').length, { timeout: 20_000 }).toBe(3);
        const hs = await snapshot<HostSnap>(host.page);
        for (const l of hs.links) {
          expect(l.sent).toBeGreaterThan(100);
          // PeerJS reliable:false means unordered; retransmissions stay enabled.
          expect(l.channel?.ordered).toBe(false);
          expect(l.channel?.maxRetransmits).toBeNull();
        }
      });

      await test.step('guest volume and mute change only that speaker', async () => {
        const slider = a.page.getByRole('slider', { name: 'Volume on this Mac' });
        await slider.focus();
        await slider.press('Home');
        for (let i = 0; i < 5; i++) await slider.press('ArrowRight');
        await expect.poll(async () => (await snapshot<GuestSnap>(a.page)).local.volume).toBeCloseTo(0.05, 2);
        await a.page.getByRole('button', { name: 'Mute this Mac' }).click();
        const before = (await snapshot<GuestSnap>(a.page)).local.renderer!.framesPlayed;
        await a.page.waitForTimeout(1200);
        const after = await snapshot<GuestSnap>(a.page);
        expect(after.local.muted).toBe(true);
        expect(after.local.outputGain).toBe(0);
        // Muting is a gain change; the renderer keeps its place on the timeline.
        expect(after.local.renderer!.framesPlayed).toBeGreaterThan(before + 30000);
        await expect(host.page.locator('[data-speaker][data-muted]')).toHaveCount(1);
        await a.page.getByRole('button', { name: 'Unmute this Mac' }).click();
        expect((await snapshot<GuestSnap>(b.page)).local.outputGain).toBeGreaterThan(0.5);
      });

      await test.step('a guest joining mid-song syncs without restarting the stream', async () => {
        const hostBefore = await probe(host.page);
        c = await participant(browser, 'Guest C', { namespace: ns });
        await joinRoom(c, code);
        await enableSpeaker(c);
        await waitPlaying(c);
        const hostAfter = await probe(host.page);
        expect(hostAfter!.epoch).toBe(hostBefore!.epoch);
        expect(hostAfter!.framesPlayed).toBeGreaterThan(hostBefore!.framesPlayed);
        await c.page.waitForTimeout(1500);
        const report = compareProbes([(await probe(host.page))!, (await probe(c.page))!]);
        expect(report.maxSpreadMs).toBeLessThan(20);
      });

      await test.step('a dropped guest reconnects into the same slot and resyncs', async () => {
        const before = await snapshot<HostSnap>(host.page);
        const slot = before.speakers.find((s) => s.name === 'Guest A')!;
        await a.page.evaluate(() => window.__tripSpeaker?.simulateDrop());
        await expect(a.page.getByTestId('guest-room')).toHaveAttribute('data-stage', 'reconnecting', { timeout: 10_000 });
        await expect(a.page.getByTestId('guest-room')).toHaveAttribute('data-stage', 'joined', { timeout: 30_000 });
        await waitPlaying(a);
        const after = await snapshot<HostSnap>(host.page);
        const again = after.speakers.find((s) => s.name === 'Guest A')!;
        expect(again.id).toBe(slot.id);
        expect(after.speakers.map((s) => s.name)).toEqual(before.speakers.map((s) => s.name));
      });

      await test.step('ending the room stops every guest', async () => {
        await music.close();
        await host.page.getByTestId('end-room').click();
        await host.page.getByTestId('confirm-end').getByRole('button', { name: 'End room' }).click();
        for (const g of [a, b, c!]) await expect(g.page.getByRole('heading', { name: 'The room has ended.' })).toBeVisible({ timeout: 15_000 });
        await expect(host.page.getByRole('heading', { name: 'Room ended.' })).toBeVisible();
      });

      for (const p of [host, a, b, c!]) expect(p.errors.filter((e) => !/favicon|WebSocket|ERR_/.test(e)), `${p.name} console errors`).toEqual([]);
    } finally {
      await closeAll(host, a, b, c);
    }
  });
});

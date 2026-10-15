import { chromium } from '@playwright/test';
const SITE = 'https://trip-speaker.netlify.app/';
const browser = await chromium.launch({ channel: 'chrome' });
const mk = async (label) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { window.__TRIP_SPEAKER_TEST__ = { capture: 'tone' }; });
  const p = await ctx.newPage();
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /PeerJS/.test(t)) console.log(`[${label} ${m.type()}]`, t.slice(0, 240)); });
  p.on('pageerror', (e) => console.log(`[${label} pageerror]`, e.message));
  await p.goto(SITE);
  return p;
};
const host = await mk('host');
const t0 = Date.now();
await host.getByRole('button', { name: 'Start a room' }).click();
const codeEl = host.getByTestId('room-code'); let code = '';
for (let i = 0; i < 60 && !/^\d{4}$/.test(code); i++) { code = (await codeEl.getAttribute('data-code').catch(() => '')) || ''; await host.waitForTimeout(500); }
console.log('host room', code || '(none)', 'after', Date.now() - t0, 'ms');
const guest = await mk('guest');
await guest.getByRole('button', { name: 'Join a room' }).click();
await guest.getByLabel('Room code, four digits').pressSequentially(code);
const t1 = Date.now();
await guest.getByRole('button', { name: 'Join room' }).click();
const result = await Promise.race([
  guest.getByTestId('guest-room').waitFor({ timeout: 40000 }).then(() => 'joined'),
  guest.getByTestId('join-error').waitFor({ timeout: 40000 }).then(async () => 'error: ' + (await guest.getByTestId('join-error').innerText())),
]).catch((e) => 'neither: ' + e.message);
console.log('guest result after', Date.now() - t1, 'ms ->', result.replace(/\n/g, ' | '));
await browser.close();

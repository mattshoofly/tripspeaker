import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { closeAll, enableSpeaker, joinRoom, openJoin, participant, snapshot, startRoom, uniqueNamespace, type Participant } from '../helpers';

async function attemptJoin(p: Participant, code: string) {
  await openJoin(p);
  await p.page.getByLabel('Room code, four digits').pressSequentially(code);
  await p.page.getByRole('button', { name: 'Join room' }).click();
}

test.describe('joining errors', () => {
  test('wrong code shows "No room found" and keeps the code for correction', async ({ browser }) => {
    const ns = uniqueNamespace('wrong');
    const g = await participant(browser, 'Guest', { namespace: ns });
    try {
      await attemptJoin(g, '0047');
      await expect(g.page.getByTestId('join-error')).toContainText('No room found.', { timeout: 20_000 });
      await expect(g.page.getByTestId('join-error')).toContainText('Check the four-digit code and try again.');
      await expect(g.page.getByLabel('Room code, four digits')).toHaveValue('0047');
      await expect(g.page.getByLabel('Room code, four digits')).toBeFocused();
    } finally {
      await closeAll(g);
    }
  });

  test('incomplete codes are rejected inline without contacting anyone', async ({ browser }) => {
    const g = await participant(browser, 'Guest', { namespace: uniqueNamespace('short') });
    try {
      await attemptJoin(g, '12');
      await expect(g.page.getByTestId('join-error')).toContainText('Enter all four digits.');
      await expect(g.page.getByLabel('Room code, four digits')).toHaveValue('12');
    } finally {
      await closeAll(g);
    }
  });

  test('signaling unavailable is explained in plain language', async ({ browser }) => {
    const g = await participant(browser, 'Guest', { namespace: uniqueNamespace('nosig') });
    try {
      await g.page.evaluate(() =>
        localStorage.setItem(
          'tripspeaker:connection',
          JSON.stringify({ signaling: { host: '127.0.0.1', port: 9, path: '/ts', secure: false }, iceServers: [], namespace: 'nosig' }),
        ),
      );
      await attemptJoin(g, '1234');
      await expect(g.page.getByTestId('join-error')).toContainText('Can’t reach the connection service.', { timeout: 30_000 });
    } finally {
      await closeAll(g);
    }
  });

  test('a host that never answers times out with network guidance', async ({ browser }) => {
    test.setTimeout(90_000);
    const ns = uniqueNamespace('zombie');
    // Registers the room's peer ID on the signaling server but never answers offers.
    const zombie = new WebSocket(`ws://127.0.0.1:9417/ts/peerjs?key=peerjs&id=${ns}-5150&token=zombie`);
    await new Promise((resolve) => zombie.once('message', resolve));
    const g = await participant(browser, 'Guest', { namespace: ns });
    try {
      await attemptJoin(g, '5150');
      await expect(g.page.getByRole('button', { name: 'Looking for the room…' })).toBeVisible();
      await expect(g.page.getByTestId('join-error')).toContainText('Your network is blocking the connection.', { timeout: 40_000 });
      await expect(g.page.getByTestId('join-error')).toContainText('Try another Wi-Fi network or a hotspot');
    } finally {
      zombie.close();
      await closeAll(g);
    }
  });

  test('locked and full rooms refuse new guests; removal and host exit end sessions', async ({ browser }) => {
    test.setTimeout(180_000);
    const ns = uniqueNamespace('limits');
    const host = await participant(browser, 'Host', { namespace: ns });
    const guests: Participant[] = [];
    let extra: Participant | undefined;
    try {
      const code = await startRoom(host);

      await test.step('locked room', async () => {
        await host.page.getByRole('button', { name: 'Lock room' }).click();
        await expect(host.page.getByRole('button', { name: 'Locked' })).toHaveAttribute('aria-pressed', 'true');
        extra = await participant(browser, 'Locked out', { namespace: ns });
        await attemptJoin(extra, code);
        await expect(extra.page.getByTestId('join-error')).toContainText('This room is locked.');
        await host.page.getByRole('button', { name: 'Locked' }).click();
        await extra.page.getByRole('button', { name: 'Join room' }).click();
        await expect(extra.page.getByTestId('guest-room')).toBeVisible({ timeout: 30_000 });
        guests.push(extra);
        extra = undefined;
      });

      await test.step('full room (five speakers including the host)', async () => {
        for (let i = 2; i <= 4; i++) {
          const g = await participant(browser, `Guest ${i}`, { namespace: ns });
          await joinRoom(g, code);
          guests.push(g);
        }
        await expect(host.page.getByTestId('speaker-pill')).toHaveText('5 of 5 speakers');
        extra = await participant(browser, 'Sixth', { namespace: ns });
        await attemptJoin(extra, code);
        await expect(extra.page.getByTestId('join-error')).toContainText('This room is full.');
        await closeAll(extra);
        extra = undefined;
      });

      await test.step('host removes a guest', async () => {
        const target = guests[guests.length - 1];
        await host.page.getByRole('button', { name: new RegExp(`^Volume for ${target.name}`) }).click();
        await host.page.getByRole('dialog', { name: `Volume for ${target.name}` }).getByRole('button', { name: 'Remove from room' }).click();
        await expect(target.page.getByRole('heading', { name: 'You’re out of the room.' })).toBeVisible({ timeout: 15_000 });
        await expect(host.page.getByTestId('speaker-pill')).toHaveText('4 of 5 speakers');
      });

      await test.step('closing the host tab ends the room for guests', async () => {
        await enableSpeaker(guests[0]);
        await host.page.close({ runBeforeUnload: true });
        await expect(guests[0].page.getByRole('heading', { name: 'The room has ended.' })).toBeVisible({ timeout: 30_000 });
        await expect(guests[0].page.getByRole('button', { name: 'Back to start' })).toBeVisible();
      });
    } finally {
      await closeAll(host, extra, ...guests);
    }
  });
});

test.describe('capture fixtures (explicit test doubles, not real Spotify)', () => {
  for (const [fixture, title, body] of [
    ['cancel', 'Nothing was shared.', 'The picker closed'],
    ['no-audio', 'No audio was shared.', 'Choose a Chrome tab and enable Share tab audio.'],
    ['window', 'That wasn’t a Chrome tab.', 'Windows and screens can’t share sound'],
  ] as const) {
    test(`capture ${fixture} is explained and nothing is sent`, async ({ browser }) => {
      const host = await participant(browser, 'Host', { namespace: uniqueNamespace(`cap-${fixture}`), capture: fixture });
      try {
        await startRoom(host);
        await host.page.getByRole('button', { name: 'Share music tab' }).click();
        await expect(host.page.getByTestId('capture-error')).toContainText(title);
        await expect(host.page.getByTestId('capture-error')).toContainText(body);
        const s = await snapshot<{ capture: { status: string } }>(host.page);
        expect(s.capture.status).not.toBe('sharing');
        await expect(host.page.getByRole('button', { name: 'Share music tab' })).toBeEnabled();
      } finally {
        await closeAll(host);
      }
    });
  }

  test('a silent shared tab is reported without guessing the cause', async ({ browser }) => {
    const host = await participant(browser, 'Host', { namespace: uniqueNamespace('cap-silent'), capture: 'silent' });
    try {
      await startRoom(host);
      await host.page.getByRole('button', { name: 'Share music tab' }).click();
      await expect(host.page.getByTestId('listen-title')).toHaveText('Your tab is shared');
      await expect(host.page.getByTestId('input-status')).toHaveText('No sound from the tab yet');
      await expect(host.page.getByText('Nothing is audible yet.')).toBeVisible();
    } finally {
      await closeAll(host);
    }
  });
});

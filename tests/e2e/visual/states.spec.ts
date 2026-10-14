import { expect, test, type Page } from '@playwright/test';

/**
 * Fixture-driven visual review. Screenshots land in test-results/visual for
 * inspection; these checks cover layout only and say nothing about audio.
 */

const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '390x844', width: 390, height: 844 },
];

const FIXTURES = [
  'host-starting',
  'host-setup',
  'host-guests-waiting',
  'host-capture-error',
  'host-active',
  'host-quiet-tab',
  'host-full',
  'host-ended',
  'guest-enable',
  'guest-syncing',
  'guest-waiting',
  'guest-active',
  'guest-reconnecting',
  'guest-failed',
  'guest-ended',
  'guest-removed',
];

async function settle(page: Page) {
  await page.waitForTimeout(1300);
}

async function checkLayout(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: horizontal overflow`).toBe(0);
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.room-code, .listen-title, .speaker-name, .btn span, .pill, .trim-value')) {
      if (el.closest('dialog:not([open])')) continue;
      if (el.classList.contains('speaker-name')) continue; // ellipsis is intentional for long device names
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className}: "${el.textContent?.trim()}"`);
    }
    return out;
  });
  expect(clipped, `${label}: clipped text`).toEqual([]);
}

for (const size of SIZES) {
  test.describe(`states at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('entry, join, and invalid code', async ({ page }) => {
      await page.goto('/');
      await settle(page);
      await checkLayout(page, 'entry');
      await page.screenshot({ path: `test-results/visual/${size.name}/entry.png` });
      await page.getByRole('button', { name: 'Join a room' }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/visual/${size.name}/join.png` });
      await page.getByLabel('Room code, four digits').pressSequentially('04');
      await page.getByRole('button', { name: 'Join room' }).click();
      await expect(page.getByTestId('join-error')).toBeVisible();
      await checkLayout(page, 'join-invalid');
      await page.screenshot({ path: `test-results/visual/${size.name}/join-invalid.png` });
      await page.getByLabel('Room code, four digits').focus();
      await page.screenshot({ path: `test-results/visual/${size.name}/join-focus.png` });
    });

    for (const fixture of FIXTURES) {
      test(fixture, async ({ page }) => {
        await page.goto(`/?fixture=${fixture}`);
        await settle(page);
        await checkLayout(page, fixture);
        await page.screenshot({ path: `test-results/visual/${size.name}/${fixture}.png`, fullPage: true });
      });
    }

    test('calibration drawer and settings', async ({ page }) => {
      await page.goto('/?fixture=guest-active');
      await settle(page);
      await page.getByRole('button', { name: 'Hear an echo?' }).click();
      const drawer = page.getByTestId('calibration-drawer');
      await expect(drawer).toBeVisible();
      const trim = drawer.getByRole('slider', { name: 'Timing for this Mac' });
      await trim.focus();
      for (let i = 0; i < 12; i++) await trim.press('ArrowRight');
      await expect(trim).toHaveAttribute('aria-valuetext', '12 milliseconds later');
      await page.waitForTimeout(350);
      await page.screenshot({ path: `test-results/visual/${size.name}/calibration.png` });
      await drawer.getByText('Advanced diagnostics').click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `test-results/visual/${size.name}/calibration-diagnostics.png` });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(page.getByRole('button', { name: 'Hear an echo?' })).toBeFocused();

      await page.goto('/?fixture=host-active');
      await settle(page);
      await page.getByRole('button', { name: 'Sound settings' }).click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `test-results/visual/${size.name}/host-settings.png` });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Room options' }).click();
      await expect(page.getByRole('menuitem', { name: 'Sound settings' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Hear an echo?' })).toBeFocused();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `test-results/visual/${size.name}/host-menu.png` });
      await page.keyboard.press('Escape');
      await page.getByTestId('end-room').click();
      await expect(page.getByTestId('confirm-end')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Keep playing' })).toBeFocused();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `test-results/visual/${size.name}/end-confirm.png` });
    });
  });
}

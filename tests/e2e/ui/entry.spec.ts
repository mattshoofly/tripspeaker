import { expect, test, type Page } from '@playwright/test';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  // 200% browser zoom on a 1440×900 MacBook viewport.
  { width: 720, height: 450 },
];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('entry screen', () => {
  for (const size of SIZES) {
    test(`no horizontal overflow and readable actions at ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      await page.waitForTimeout(900);
      expect(await horizontalOverflow(page)).toBe(0);
      const start = page.getByRole('button', { name: 'Start a room' });
      await expect(start).toBeVisible();
      if (size.width >= 1280) {
        const box = (await start.boundingBox())!;
        expect(box.y + box.height, 'primary action above the fold').toBeLessThan(size.height);
        const join = (await page.getByRole('button', { name: 'Join a room' }).boundingBox())!;
        expect(join.y + join.height).toBeLessThan(size.height);
      }
      await page.getByRole('button', { name: 'Join a room' }).click();
      await page.waitForTimeout(300);
      expect(await horizontalOverflow(page)).toBe(0);
      const slots = page.locator('.code-slot');
      await expect(slots).toHaveCount(4);
      const last = (await slots.nth(3).boundingBox())!;
      expect(last.x + last.width, 'code slots fit the viewport').toBeLessThanOrEqual(size.width);
    });
  }

  test('headline entrance plays once and is not replayed by unrelated state changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__tripSpeakerMotion?.entrances)).toBe(1);
    const heading = page.getByRole('heading', { level: 1, name: 'One track. Every Mac.' });
    await expect(heading).toBeAttached();
    await page.getByRole('button', { name: 'Join a room' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Join a room' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__tripSpeakerMotion?.entrances)).toBe(1);
    // Words end fully revealed after re-splits caused by the resize.
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('h1.display [aria-hidden="true"]')].filter((el) => getComputedStyle(el).transform !== 'none' && getComputedStyle(el).transform !== 'matrix(1, 0, 0, 1, 0, 0)').length,
    );
    expect(hidden).toBe(0);
  });

  test('reduced motion skips split text and movement but keeps content', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForTimeout(80);
    expect(await page.locator('.hl-line-mask').count()).toBe(0);
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll('[data-enter]')].filter((el) => {
        const t = getComputedStyle(el).transform;
        return t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
      }).length,
    );
    expect(moving).toBe(0);
    await expect(page.getByRole('heading', { level: 1, name: 'One track. Every Mac.' })).toBeVisible();
    await page.getByRole('button', { name: 'Join a room' }).click();
    await expect(page.getByLabel('Room code, four digits')).toBeFocused();
    await context.close();
  });

  test('invite link opens the join panel with the code as a string', async ({ page }) => {
    await page.goto('/?room=0047');
    const input = page.getByLabel('Room code, four digits');
    await expect(input).toHaveValue('0047');
    await expect(page.getByRole('heading', { name: 'Join your friends.' })).toBeVisible();
    await expect(page.locator('.code-slot').first()).toHaveText('0');
  });

  test('code field: typing, paste, leading zeros, arrows, backspace, selection, Enter', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Join a room' }).click();
    const input = page.getByLabel('Room code, four digits');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('inputmode', 'numeric');

    await input.pressSequentially('0a0-4 7');
    await expect(input).toHaveValue('0047');
    // No automatic join on the fourth digit.
    await expect(page.getByRole('button', { name: 'Join room' })).toBeEnabled();

    await input.press('ArrowLeft');
    await input.press('ArrowLeft');
    await input.press('Backspace');
    await expect(input).toHaveValue('047');
    await input.pressSequentially('9');
    await expect(input).toHaveValue('0947');

    await input.press('ControlOrMeta+a');
    await expect(page.locator('.code-slot[data-selected]')).toHaveCount(4);
    await input.pressSequentially('12');
    await expect(input).toHaveValue('12');

    await page.evaluate(() => {
      const el = document.getElementById('join-code') as HTMLInputElement;
      el.focus();
      el.setSelectionRange(0, el.value.length);
      const dt = new DataTransfer();
      dt.setData('text', 'Code: 00 47');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(input).toHaveValue('0047');

    await page.evaluate(() => {
      const el = document.getElementById('join-code') as HTMLInputElement;
      el.setSelectionRange(0, el.value.length);
      const dt = new DataTransfer();
      dt.setData('text', 'http://192.168.1.20:4417/?room=0815');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(input).toHaveValue('0815');

    await input.press('Backspace');
    await input.press('Enter');
    await expect(page.getByTestId('join-error')).toContainText('Enter all four digits.');
    await expect(input).toHaveValue('081');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  test('keyboard order follows the visual order', async ({ page }) => {
    await page.goto('/');
    const names: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      names.push(await page.evaluate(() => (document.activeElement as HTMLElement)?.innerText?.trim() || document.activeElement?.getAttribute('aria-label') || ''));
    }
    expect(names).toEqual(['Skip to content', 'Trip Speaker', 'How it works', 'Help', 'Start a room', 'Join a room']);
  });

  test('help drawer traps focus, closes on Escape, and returns focus', async ({ page }) => {
    await page.goto('/');
    const help = page.getByRole('button', { name: 'Help' });
    await help.click();
    const dialog = page.getByRole('dialog', { name: 'Help' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(help).toBeFocused();
  });

  test('FAQ expands with the keyboard and announces state', async ({ page }) => {
    await page.goto('/');
    const q = page.getByRole('button', { name: 'What if I hear an echo?' });
    await q.scrollIntoViewIfNeeded();
    await q.focus();
    await page.keyboard.press('Enter');
    await expect(q).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'What if I hear an echo?' })).toContainText('move its timing Earlier');
    await page.keyboard.press('Space');
    await expect(q).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('region', { name: 'What if I hear an echo?' })).toBeHidden();
  });

  test('every control has an accessible name and a 44px target', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(900);
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, [role="switch"]')) {
        if (el.closest('[inert], dialog:not([open]), [popover]:not(:popover-open)')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const label = el.getAttribute('aria-label') || el.innerText?.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) || '';
        if (!label) out.push(`unnamed ${el.tagName}.${el.className}`);
        const isSkip = el.classList.contains('skip-link');
        if (!isSkip && (r.height < 44 || r.width < 44)) out.push(`small ${el.tagName} "${label}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });
});

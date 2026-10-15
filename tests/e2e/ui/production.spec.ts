import { expect, test } from '@playwright/test';

test.describe('production build delivery', () => {
  test('AudioWorklet modules are served as JavaScript, not the SPA fallback', async ({ page, request }) => {
    const html = await (await request.get('/')).text();
    const entries = [...html.matchAll(/src="(\/assets\/index-[^"]+\.js)"/g)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(0);
    const bundle = await (await request.get(entries[0])).text();
    const worklets = [...new Set([...bundle.matchAll(/\/assets\/(capture|renderer)\.worklet-[\w-]+\.js/g)].map((m) => m[0]))];
    expect(worklets.sort().map((w) => w.split('/').pop()!.split('-')[0])).toEqual(['capture.worklet', 'renderer.worklet']);
    for (const url of worklets) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(200);
      expect(res.headers()['content-type'], url).toMatch(/javascript/);
      const body = await res.text();
      expect(body.trimStart().startsWith('<'), `${url} must not be HTML`).toBe(false);
      expect(body).toContain('registerProcessor');
      // Self-contained: AudioWorklet scopes cannot resolve bundler imports.
      expect(body).not.toMatch(/^\s*import\s/m);
    }
    // An unknown path still gets the SPA fallback, so a wrong worklet path would be caught above.
    const missing = await request.get('/assets/not-a-real.worklet.js');
    expect(await missing.text()).toMatch(/<!doctype html>/i);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'One track. Every Mac.' })).toBeVisible();
  });

  test('pages load without console errors and with no dev-only fixtures', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/?fixture=host-active');
    await expect(page.getByRole('button', { name: 'Start a room' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

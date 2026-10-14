import { chromium } from '@playwright/test';
const [,, width = '1440', height = '900', ...names] = process.argv;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
for (const n of names) {
  await page.goto(`http://127.0.0.1:4417/?fixture=${n}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/shots/${n}-${width}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(n, 'overflow', overflow);
}
console.log(errs.join('\n') || 'no errors');
await browser.close();

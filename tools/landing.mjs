import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });

for (const [i, t] of [600, 2200, 4200, 6500].entries()) {
  await page.waitForTimeout(i === 0 ? t : t - [600, 2200, 4200, 6500][i - 1]);
  await page.screenshot({ path: `shots/40-hero-${i}.png` });
}

const h = await page.evaluate(() => document.body.scrollHeight);
console.log('page height:', h);
let n = 0;
for (let y = 0; y < h; y += 900) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `shots/41-scroll-${String(n++).padStart(2, '0')}.png` });
}
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no console errors');
await browser.close();

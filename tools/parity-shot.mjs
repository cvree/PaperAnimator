import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  else if (/reduced motion|VIOLATION/i.test(m.text())) console.log(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:5175/tools/parity.html', { waitUntil: 'networkidle' });
await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
await page.waitForTimeout(1500);
const rows = await page.locator('.row').count();
console.log('rows:', rows);
/* One image per entrance, so a row is never cut in half by the viewport. */
for (let i = 0; i < rows; i++) {
  const row = page.locator('.row').nth(i);
  const name = (await row.locator('.name').textContent()).trim().toLowerCase().replace(/\W+/g, '-');
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await row.screenshot({ path: `shots/parity-${String(i).padStart(2, '0')}-${name}.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0,8).join('\n') : 'no console errors');
await browser.close();

import { chromium, devices } from 'playwright';

/** The gallery on a phone: a bottom sheet, no horizontal overflow. */
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 60000 });
await page.waitForTimeout(1200);
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click();

await page.getByRole('button', { name: 'Scenes' }).click();
await page.waitForTimeout(400);
const draft = page.getByRole('button', { name: 'Or draft one from the whole paper' });
if (await draft.count()) await draft.first().click();
await page.waitForTimeout(1600);
await page.screenshot({ path: 'shots/67-mobile-storyboard.png' });

await page.getByRole('button', { name: /^Animate scene 1/ }).first().click();
await page.waitForSelector('[role="dialog"][aria-label="Animation"]', { timeout: 5000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/68-mobile-gallery.png' });

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
console.log('mobile gallery horizontal overflow:', overflow + 'px');
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no console errors');
await browser.close();

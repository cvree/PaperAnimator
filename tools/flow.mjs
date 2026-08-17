import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

console.log('clicking sample…');
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();

// processing
await page.waitForTimeout(1400);
await page.screenshot({ path: 'shots/10-processing.png' });

// wait for setup
try {
  await page.waitForSelector('text=Your storyboard', { timeout: 30000 });
  console.log('reached setup');
} catch { console.log('DID NOT REACH SETUP'); }
await page.waitForTimeout(2200);
await page.screenshot({ path: 'shots/11-setup.png' });
await page.screenshot({ path: 'shots/11-setup-full.png', fullPage: true });

// into the editor
const openBtn = page.getByRole('button', { name: 'Open the editor' });
if (await openBtn.count()) {
  await openBtn.first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shots/12-editor.png' });
  console.log('reached editor');
}

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no console errors');
await browser.close();

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

// straight into the editor, on the paper, with an empty storyboard
try {
  await page.waitForSelector('.pa-reader', { timeout: 30000 });
  console.log('reached the editor');
} catch { console.log('DID NOT REACH THE EDITOR'); }
await page.waitForTimeout(2200);
await page.screenshot({ path: 'shots/11-editor-on-the-paper.png' });

const scenes = await page.evaluate(() => document.querySelectorAll('[data-drop^="scene:"]').length);
console.log('scenes on arrival (must be 0):', scenes);
await page.screenshot({ path: 'shots/12-editor.png' });

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no console errors');
await browser.close();

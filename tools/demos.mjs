import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });

const heading = page.getByText('You make the presentation');
await heading.scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/42-demos-idle.png' });

// 01 — read it aloud
await page.getByRole('button', { name: /Read it aloud/ }).click().catch(async () => {
  await page.locator('button:has-text("Read it aloud")').click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/43-demo-highlight-mid.png' });
await page.waitForTimeout(1600);

// 02 — drag the figure
const fig = page.getByRole('button', { name: /Drag Figure 3/ });
const slot = page.locator('text=Scene 4');
const a = await fig.boundingBox();
const b = await slot.boundingBox();
if (a && b) {
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 30, a.y + a.height / 2 - 8, { steps: 8 });
  await page.screenshot({ path: 'shots/44-demo-dragging.png' });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
} else console.log('!! drag targets missing', !!a, !!b);

// 03 — pull the thread
await page.getByRole('button', { name: /Show where this number came from/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/45-demos-active.png' });

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no console errors');
await browser.close();

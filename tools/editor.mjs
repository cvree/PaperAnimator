import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('· ' + name);
};

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 40000 });
await page.waitForSelector('.pa-reader', { timeout: 20000 });
await page.waitForTimeout(1500);

// dismiss onboarding
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click();
await page.waitForTimeout(400);
await shot('20-editor-simple');

// mark a sentence on the real page and make a scene from it
const spot = await page.evaluate(() => {
  const run = [...document.querySelectorAll('.pa-textlayer [data-run]')].find((r) =>
    r.textContent.includes('Extended sleep reduced recovery time'),
  );
  if (!run) return null;
  const b = run.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
if (spot) {
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(500);
  await shot('21-sentence-selected');
  const marker = page.locator('[data-coach="marker"]');
  if (await marker.count()) {
    await marker.locator('button').nth(1).click();
    await page.waitForTimeout(900);
    await shot('22-scene-made');
  } else console.log('!! no marker bar');
} else console.log('!! sentence not found');

// click a layer on the canvas → source thread
const layer = page.locator('[data-coach="stage"] [data-layer-id]').last();
if (await layer.count()) {
  await layer.click({ position: { x: 12, y: 12 } });
  await page.waitForTimeout(900);
  const thread = await page.locator('svg path[stroke="var(--accent)"]').count();
  console.log('  thread paths: ' + thread);
  await shot('23-source-thread');
} else console.log('!! no layer to click');

// studio mode: timeline + inspector
await page.getByRole('radio', { name: 'Studio' }).click();
await page.waitForTimeout(700);
await shot('24-studio');

await page.getByRole('radio', { name: 'Pro' }).click();
await page.waitForTimeout(700);
await shot('25-pro');

// integrity
await page.locator('button[title^="Source integrity"]').click();
await page.waitForTimeout(700);
await shot('26-integrity');
await page.locator('button[title^="Source integrity"]').click();
await page.waitForTimeout(400);

// export sheet
await page.getByRole('button', { name: 'Export' }).first().click();
await page.waitForTimeout(900);
await shot('27-export');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no console errors');
await browser.close();

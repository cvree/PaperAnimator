import { chromium } from 'playwright';

/**
 * The animation gallery, end to end: make a scene from the paper, open the
 * gallery from the storyboard, pick an entrance, and prove it actually moves —
 * by sampling the same frame at two different times and comparing.
 */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('· ' + name);
};

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 40000 });
await page.waitForTimeout(1200);

const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click();
await page.waitForTimeout(300);

/* ---- make a scene from a real sentence ------------------------------- */
const spot = await page.evaluate(() => {
  const run = [...document.querySelectorAll('.pa-textlayer [data-run]')].find((r) =>
    r.textContent.includes('Extended sleep reduced recovery time'),
  );
  if (!run) return null;
  const b = run.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
if (!spot) throw new Error('sentence not found on the page');
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(400);
await page.keyboard.press('s');
await page.waitForTimeout(900);

/* ---- a figure too, so the picture presets have something to act on ----- */
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const chart = await page.evaluate(() => {
  const runs = [...document.querySelectorAll('.pa-textlayer [data-run]')];
  const cap = runs.find((r) => r.textContent.includes('Figure 1.'));
  if (!cap) return null;
  const b = cap.getBoundingClientRect();
  // The plot sits directly above its caption.
  return { left: b.left, top: b.top - 260, right: b.right, bottom: b.top - 12 };
});
if (chart) {
  // The dock arms the crop; the letter keys only act on an existing mark.
  await page.getByRole('button', { name: /Figure/ }).first().click();
  await page.waitForTimeout(300);
  await page.mouse.move(chart.left + 4, chart.top);
  await page.mouse.down();
  await page.mouse.move(chart.right - 4, chart.bottom, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
}
const madeFigure = await page.evaluate(
  () => !!document.querySelector('[data-coach="stage"] img'),
);
console.log('figure scene made:', madeFigure);
await shot('59-figure-scene');

const scenes = await page.locator('[data-drop^="scene:"]').count();
console.log('scenes made:', scenes);
await shot('60-scene-made');

/* ---- open the gallery from the storyboard card ------------------------ */
const card = page.locator('[data-drop^="scene:"]').first();
await card.hover();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Animate scene/ }).first().click();
await page.waitForSelector('[role="dialog"][aria-label="Animation"]', { timeout: 5000 });
await page.waitForTimeout(1400);
await shot('61-gallery');

const tiles = await page.locator('[role="dialog"] button[aria-pressed]').count();
console.log('choices offered:', tiles);

/* ---- the tiles must actually be animating ----------------------------- */
const sample = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button[aria-pressed] p span')]
      .slice(0, 40)
      .map((el) => el.getAttribute('style') ?? '')
      .join('|'),
  );
const a = await sample();
await page.waitForTimeout(300);
const b = await sample();
console.log('gallery tiles animate:', a.length > 0 && a !== b);

/* ---- pick Cascade, then check the stage moves ------------------------- */
const cascade = page.locator('[role="dialog"] button', { hasText: 'Cascade' }).first();
if (await cascade.count()) {
  await cascade.click();
  await page.waitForTimeout(500);
  await shot('62-gallery-cascade-picked');
}

const iris = page.locator('[role="dialog"] button', { hasText: 'Slow zoom' }).first();
if (await iris.count()) await iris.click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(400);

/* Play, and watch the words arrive one at a time. */
await page.keyboard.press('Home');
await page.keyboard.press(' ');
await page.waitForTimeout(320);
await shot('63-stage-mid-entrance');
await page.waitForTimeout(1400);
await shot('64-stage-settled');
await page.keyboard.press(' ');

/* ---- the keyboard route ---------------------------------------------- */
await page.keyboard.press('m');
await page.waitForTimeout(700);
const opened = await page.locator('[role="dialog"][aria-label="Animation"]').count();
console.log('M opens the gallery:', opened === 1);
await shot('65-gallery-by-keyboard');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ---- the gallery for a picture, which offers picture presets first ---- */
const figCard = page.locator('[data-drop^="scene:"]').last();
await figCard.hover();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Animate scene 2/ }).first().click();
await page.waitForSelector('[role="dialog"][aria-label="Animation"]', { timeout: 5000 });
await page.waitForTimeout(1500);
await shot('66-gallery-figure');
const first = await page.evaluate(
  () => document.querySelector('[role="dialog"] button[aria-pressed] p')?.textContent ?? '',
);
console.log('first preset offered for a figure:', first);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ---- the inspector's motion tab, for the people who want the dials ---- */
await page.getByRole('radio', { name: 'Studio' }).click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: 'Inspector' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Motion', exact: true }).click();
await page.waitForTimeout(400);
await shot('67-inspector-motion');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no console errors');
await browser.close();

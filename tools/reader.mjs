import { chromium } from 'playwright';

/**
 * The reader: highlighting real page text, the marker bar, the dock, and
 * dragging a tool onto a sentence.
 */

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

const sceneCount = () =>
  page.evaluate(() => document.querySelectorAll('[data-drop^="scene:"]').length);

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 60000 });
await page.waitForSelector('.pa-reader', { timeout: 20000 });
await page.waitForTimeout(1600);

const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click();
await page.waitForTimeout(400);
await shot('30-reader');

/* ---- is the text layer really there and aligned? ---------------------- */
const layer = await page.evaluate(() => {
  const runs = document.querySelectorAll('.pa-textlayer [data-run]');
  const scaled = [...runs].filter((r) => (r.style.transform ?? '').includes('scaleX'));
  const first = runs[0];
  return {
    pages: document.querySelectorAll('[data-page]').length,
    runs: runs.length,
    scaled: scaled.length,
    sample: first ? first.textContent.slice(0, 40) : null,
  };
});
console.log('  text layer:', JSON.stringify(layer));

/* ---- drag across a line of text -------------------------------------- */
const before = await sceneCount();

const box = await page.evaluate(() => {
  // A run in a body paragraph, with a neighbour on the same line to drag to.
  const runs = [...document.querySelectorAll('.pa-textlayer [data-run]')];
  const wide = runs.filter((r) => {
    const b = r.getBoundingClientRect();
    return b.width > 60 && b.top > 160 && b.bottom < 900 && r.textContent.trim().length > 25;
  });
  const el = wide[Math.floor(wide.length / 3)] ?? wide[0];
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top + b.height / 2, w: b.width, text: el.textContent.slice(0, 60) };
});
if (!box) throw new Error('no runs to drag across');
console.log('  dragging across:', JSON.stringify(box.text));

await page.mouse.move(box.x + 2, box.y);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.5, box.y, { steps: 8 });
await page.mouse.move(box.x + box.w - 2, box.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(500);

const selected = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
console.log('  selection:', JSON.stringify(selected.slice(0, 70)));

const marker = await page.locator('[data-coach="marker"]').count();
console.log('  marker bar: ' + marker);
await shot('31-highlighted');

/* ---- the primary action on the marker bar ---------------------------- */
if (marker) {
  await page.locator('[data-coach="marker"] button').nth(1).click();
  await page.waitForTimeout(900);
  const after = await sceneCount();
  console.log(`  scenes ${before} → ${after} (marker bar)`);
  await shot('32-scene-from-marker');
}

/* ---- drag a tool from the dock onto a sentence ----------------------- */
const chip = page.locator('[data-instrument="quote"]').first();
const chipBox = await chip.boundingBox();
const target = await page.evaluate(() => {
  const runs = [...document.querySelectorAll('.pa-textlayer [data-run]')];
  const el = runs.find((r) => {
    const b = r.getBoundingClientRect();
    return b.width > 90 && b.top > 260 && b.bottom < 700;
  });
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});

if (chipBox && target) {
  const from = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 40, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 18 });
  await page.waitForTimeout(500);
  // The ghost carries a live ScenePreview of the scene the drop would make.
  const ghost = await page.evaluate(() => {
    const el = document.querySelector('[data-ghost]');
    if (!el) return 'no ghost';
    const words = (el.textContent ?? '').trim().slice(0, 40);
    return `${el.querySelectorAll('div').length} nodes · ${JSON.stringify(words)}`;
  });
  await shot('33-carrying-tool');
  console.log('  ghost preview: ' + ghost);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await sceneCount();
  console.log(`  scenes → ${after} (dropped tool)`);
  await shot('34-dropped');
} else {
  console.log('!! could not find dock chip or target');
}

/* ---- keyboard: mark a sentence by clicking, then press a key --------- */
await page.mouse.click(target.x, target.y + 40);
await page.waitForTimeout(400);
const clickedSelection = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
console.log('  click-to-select:', JSON.stringify(clickedSelection.slice(0, 60)));
await page.keyboard.press('b');
await page.waitForTimeout(800);
console.log(`  scenes → ${await sceneCount()} (keyboard B)`);
await shot('35-keyboard');

/* ---- keyboard only: walk the paper, widen, make --------------------- */
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(220);
}
const walked = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
console.log('  ⌥→ walked to:', JSON.stringify(walked.slice(0, 60)));
await shot('35b-keyboard-walk');

/* ---- widen the mark with ⌥↑ ----------------------------------------- */
await page.keyboard.press('Alt+ArrowUp');
await page.waitForTimeout(400);
const widened = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length);
console.log('  widened selection length: ' + widened);

/* ---- keep two passages and compare them ------------------------------ */
await page.keyboard.press('Shift+K');
await page.waitForTimeout(300);
const kept = await page.locator('[role="toolbar"][aria-label="Tools"] >> text=kept').count();
console.log('  tray shown: ' + kept);

const second = await page.evaluate(() => {
  const runs = [...document.querySelectorAll('.pa-textlayer [data-run]')];
  const el = runs.filter((r) => {
    const b = r.getBoundingClientRect();
    return b.width > 120 && b.top > 700 && b.bottom < 1000;
  })[1];
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
if (second) {
  await page.mouse.click(second.x, second.y);
  await page.waitForTimeout(400);
  await page.keyboard.press('c');
  await page.waitForTimeout(800);
  console.log(`  scenes → ${await sceneCount()} (side by side)`);
  await shot('36-compare');
}

/* ---- crop a figure --------------------------------------------------- */
await page.locator('[data-instrument="figure"]').first().click();
await page.waitForTimeout(400);
const fig = await page.evaluate(() => {
  const img = [...document.querySelectorAll('[data-page]')][0];
  const b = img.getBoundingClientRect();
  // The chart on page 1 sits in the right column, roughly here.
  return {
    x1: b.left + b.width * 0.52,
    y1: b.top + b.height * 0.44,
    x2: b.left + b.width * 0.92,
    y2: b.top + b.height * 0.64,
  };
});
await page.mouse.move(fig.x1, fig.y1);
await page.mouse.down();
await page.mouse.move((fig.x1 + fig.x2) / 2, (fig.y1 + fig.y2) / 2, { steps: 10 });
await page.mouse.move(fig.x2, fig.y2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1600);
console.log(`  scenes → ${await sceneCount()} (cropped figure)`);
await shot('37-figure');

/* ---- carry the passage into the storyboard --------------------------- */
const anySentence = await page.evaluate(() => {
  const runs = [...document.querySelectorAll('.pa-textlayer [data-run]')];
  const el = runs.find((r) => {
    const b = r.getBoundingClientRect();
    return b.width > 150 && b.top > 300 && b.bottom < 620;
  });
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
await page.mouse.click(anySentence.x, anySentence.y);
await page.waitForTimeout(400);
const grip = await page.locator('[data-coach="marker"] button').first().boundingBox();
const gap = await page.locator('[data-drop^="scene:"]').nth(1).boundingBox();
if (grip && gap) {
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 60, grip.y - 30, { steps: 5 });
  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2, { steps: 16 });
  await page.waitForTimeout(400);
  await shot('38-carrying-passage');
  await page.mouse.up();
  await page.waitForTimeout(900);
  console.log(`  scenes → ${await sceneCount()} (passage into storyboard)`);
  await shot('39-after-storyboard-drop');
}

console.log(errors.length ? '!! console errors:\n' + errors.join('\n') : '✓ no console errors');
await browser.close();

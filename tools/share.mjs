import { chromium } from 'playwright';

/**
 * Sharing, end to end.
 *
 * Builds a small board out of the sample paper, opens the share sheet at the
 * top right, and then does the only thing that proves the feature: takes the
 * link off the clipboard and opens it in a browser that has never seen this
 * app before. Once as a viewer — which must arrive at the talk, with nothing
 * movable — and once as an editor, which must arrive at the board with the
 * tools in reach and the cards where they were left.
 */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const context = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

const errors = [];
const watch = (p, tag) => {
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`);
  });
  p.on('pageerror', (e) => errors.push(`${tag} PAGEERROR: ${e.message}`));
};
watch(page, 'app');

const shot = async (name, target = page) => {
  await target.screenshot({ path: `shots/${name}.png` });
  console.log('· ' + name);
};

/* ---- a board worth sharing ---------------------------------------------- */
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 60000 });
await page.waitForTimeout(1500);
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click({ force: true }).catch(() => {});
await page.waitForTimeout(400);

await page.getByRole('tab', { name: 'Board' }).click();
await page.waitForSelector('.bx-root', { timeout: 20000 });
await page.waitForTimeout(600);

const drawer = page.locator('aside[aria-label="Content from the paper"]');
await drawer.getByRole('tab', { name: /^Text$/ }).click();
await page.waitForTimeout(200);
await drawer.getByRole('button', { name: 'Title' }).first().click();
await page.waitForTimeout(300);
await drawer.getByRole('tab', { name: /^Figures/ }).click();
await page.waitForTimeout(200);
const figure = drawer.locator('li button').first();
if (await figure.count()) await figure.click();
await page.waitForTimeout(400);

const surface = page.locator('.bx-root');
const box = await surface.boundingBox();
await page.keyboard.press('n');
await page.mouse.click(box.x + 300, box.y + 620);
await page.waitForTimeout(250);
await page.keyboard.type('Shared from the top right');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.keyboard.press('v');

await page.getByRole('button', { name: /Add stop|Stop around selection/ }).click();
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
const fit = page.getByTitle('Fit everything · ⌘0');
if (await fit.count()) await fit.click();
await page.waitForTimeout(900);

const built = await page.locator('.bx-card').count();
console.log(`  ${built} cards on the board`);
await shot('80-board-to-share');

/* ---- the share sheet ---------------------------------------------------- */
await page.getByRole('button', { name: 'Share' }).click();
const sheet = page.getByRole('dialog', { name: 'Share this board' });
await sheet.waitFor({ timeout: 10000 });
await page.waitForFunction(
  () => !!document.querySelector('input[aria-label$="link"]')?.value?.includes('#'),
  null,
  { timeout: 30000 },
);
await shot('81-share-viewer');

const readLink = async () => {
  await sheet.getByRole('button', { name: /Copy link|Copied/ }).click();
  await page.waitForTimeout(300);
  return page.evaluate(() => navigator.clipboard.readText());
};

const viewerLink = await readLink();
console.log(`  viewer link: ${(viewerLink.length / 1024).toFixed(1)} kB`);
if (!viewerLink.includes('#view=')) errors.push('viewer link is not a #view= address');

await sheet.getByRole('radio', { name: 'Editor' }).click();
await page.waitForFunction(
  () => !!document.querySelector('input[aria-label$="link"]')?.value?.includes('#edit='),
  null,
  { timeout: 30000 },
);
await shot('82-share-editor');
const editorLink = await readLink();
console.log(`  editor link: ${(editorLink.length / 1024).toFixed(1)} kB`);
if (!editorLink.includes('#edit=')) errors.push('editor link is not an #edit= address');

/* ---- what the other person gets ----------------------------------------- */
const viewer = await context.newPage();
watch(viewer, 'viewer');
await viewer.setViewportSize({ width: 1500, height: 950 });
await viewer.goto(viewerLink, { waitUntil: 'networkidle' });
await viewer.waitForSelector('.bx-root', { timeout: 20000 });
await viewer.waitForTimeout(1400);
await shot('83-opened-as-viewer', viewer);
if (await viewer.getByRole('button', { name: 'Share' }).count())
  errors.push('a viewer link offered the editing chrome');
await viewer.keyboard.press('ArrowRight');
await viewer.waitForTimeout(900);
await shot('84-viewer-advanced', viewer);

const editor = await context.newPage();
watch(editor, 'editor');
await editor.setViewportSize({ width: 1500, height: 950 });
await editor.goto(editorLink, { waitUntil: 'networkidle' });
await editor.waitForSelector('.bx-root', { timeout: 20000 });
await editor.waitForTimeout(1200);
const carried = await editor.locator('.bx-card').count();
console.log(`  ${carried} cards carried into the editor link`);
if (carried !== built) errors.push(`cards did not survive the link: ${built} → ${carried}`);
if (!(await editor.getByRole('button', { name: 'Share' }).count()))
  errors.push('an editor link did not offer a share button of its own');
/* 'Paper' is also the name of the white board colour, so the shelf is checked
   by the thing that opens it rather than by its label. */
if (await editor.getByTitle('Content from the paper').count())
  errors.push('an editor link offered a paper shelf it has no paper for');
await shot('85-opened-as-editor', editor);

/* It has to actually be editable, not merely look it. */
const ebox = await editor.locator('.bx-root').boundingBox();
await editor.keyboard.press('n');
await editor.mouse.click(ebox.x + 420, ebox.y + 300);
await editor.waitForTimeout(250);
await editor.keyboard.type('and edited by whoever opened it');
await editor.keyboard.press('Escape');
await editor.waitForTimeout(400);
const after = await editor.locator('.bx-card').count();
if (after !== carried + 1) errors.push('a note could not be added to a shared board');
await shot('86-editor-edited', editor);

console.log(errors.length ? `\n!! ${errors.length} problem(s)` : '\nclean');
for (const e of errors) console.log('   ' + e);
await browser.close();
process.exit(errors.length ? 1 : 0);

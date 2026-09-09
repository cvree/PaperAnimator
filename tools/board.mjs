import { chromium } from 'playwright';

/**
 * The board, on a real paper, in every room it offers.
 *
 * Builds a small talk out of the sample paper — a title, a finding, a figure and
 * a number — frames it as a stop, then photographs the board in each surface and
 * runs the presenter through its first two beats. The point is that the look is
 * something you can check rather than something you have to take on trust.
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

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 60000 });
await page.waitForTimeout(1500);
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click({ force: true }).catch(() => {});
await page.waitForTimeout(400);

/* ---- onto the board ----------------------------------------------------- */
await page.getByRole('tab', { name: 'Board' }).click();
await page.waitForSelector('.bx-root', { timeout: 20000 });
await page.waitForTimeout(600);
await shot('70-board-empty');

/* ---- put the paper on it ------------------------------------------------ */
const drawer = page.locator('aside[aria-label="Content from the paper"]');

await drawer.getByRole('tab', { name: /^Text$/ }).click();
await page.waitForTimeout(200);
await drawer.getByRole('button', { name: 'Title' }).first().click();
await page.waitForTimeout(300);
const finding = drawer.getByRole('button', { name: /^Finding 1$/ });
if (await finding.count()) {
  await finding.click();
  await page.waitForTimeout(300);
} else console.log('!! no finding to add');

await drawer.getByRole('tab', { name: /^Figures/ }).click();
await page.waitForTimeout(200);
const figure = drawer.locator('li button').first();
if (await figure.count()) {
  await figure.click();
  await page.waitForTimeout(400);
} else console.log('!! no figure to add');

await drawer.getByRole('tab', { name: /^Numbers/ }).click();
await page.waitForTimeout(200);
const number = drawer.locator('li button').first();
if (await number.count()) {
  await number.click();
  await page.waitForTimeout(400);
} else console.log('!! no number to add');

/* ---- and the things you make yourself ----------------------------------- */
const surface = page.locator('.bx-root');
const box = await surface.boundingBox();

// A note, dropped where there is room for it.
await page.keyboard.press('n');
await page.mouse.click(box.x + 240, box.y + 700);
await page.waitForTimeout(250);
await page.keyboard.type('Recovery, not sleep, is the outcome');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// And a stroke drawn by hand, which should draw itself when it arrives.
await page.keyboard.press('p');
await page.mouse.move(box.x + 240, box.y + 880);
await page.mouse.down();
for (let i = 0; i <= 20; i++) {
  await page.mouse.move(box.x + 240 + i * 14, box.y + 880 + Math.sin(i / 2.4) * 34);
}
await page.mouse.up();
await page.waitForTimeout(300);
await page.keyboard.press('v');

/* Frame the lot as one stop, then look at everything. */
await page.getByRole('button', { name: /Add stop|Stop around selection/ }).click();
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const fit = page.getByTitle('Fit everything · ⌘0');
if (await fit.count()) await fit.click();
await page.waitForTimeout(900);

const cards = await page.locator('.bx-card').count();
const stops = await page.locator('[data-stop-id]').count();
console.log(`  ${cards} cards · ${stops} stop elements`);
await shot('71-board-built');

/* ---- every room --------------------------------------------------------- */
const colours = page.locator('[role="group"][aria-label="Board colour"] button');
const surfaces = ['Paper', 'Sand', 'Slate', 'Chalk', 'Midnight', 'Blueprint'];
for (const [i, name] of surfaces.entries()) {
  await colours.nth(i).click();
  await page.waitForTimeout(450);
  await shot(`72-surface-${i + 1}-${name.toLowerCase()}`);
}

/* Back to something with lights off, which is what a talk gets recorded on. */
await colours.nth(4).click();
await page.waitForTimeout(400);

/* ---- presenting --------------------------------------------------------- */
await page.getByRole('button', { name: 'Present' }).click();
await page.waitForTimeout(200);
await shot('73-present-arriving');
await page.waitForTimeout(1800);
await shot('74-present-landed');

await page.mouse.move(800, 500);
await page.waitForTimeout(300);
await page.keyboard.press('o');
await page.waitForTimeout(1200);
await shot('75-present-overview');
await page.keyboard.press('o');
await page.waitForTimeout(1200);

await page.keyboard.press('s');
await page.mouse.move(700, 420);
await page.waitForTimeout(500);
await shot('76-present-spotlight');
await page.keyboard.press('s');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

/* ---- the file you hand out --------------------------------------------- */
await page.getByRole('button', { name: 'Get the link' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Build the page|Build it again/ }).click();
await page.waitForSelector('text=Open it now', { timeout: 60000 });
await page.waitForTimeout(400);
await shot('77-publish-sheet');

const download = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download' }).click();
/* The browser saves it without a suffix; a file:// URL needs one to be read as
   a page rather than as its own source. */
const file = process.cwd() + '/shots/talk.html';
await (await download).saveAs(file);
console.log('  published file: ' + file);

const talk = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const talkErrors = [];
talk.on('pageerror', (e) => talkErrors.push('PAGEERROR: ' + e.message));
await talk.goto('file://' + file);
await talk.waitForTimeout(400);
await talk.screenshot({ path: 'shots/78-published-arriving.png' });
console.log('· 78-published-arriving');
await talk.waitForTimeout(2000);
await talk.screenshot({ path: 'shots/79-published-landed.png' });
console.log('· 79-published-landed');
await talk.keyboard.press('o');
await talk.waitForTimeout(1200);
await talk.screenshot({ path: 'shots/80-published-overview.png' });
console.log('· 80-published-overview');
if (talkErrors.length) console.log('PUBLISHED PAGE ERRORS:\n' + talkErrors.join('\n'));
else console.log('  published page: no errors');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();

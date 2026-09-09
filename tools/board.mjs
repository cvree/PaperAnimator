import { chromium } from 'playwright';

/**
 * The board, on a real paper, in every room it offers — and every gesture you
 * can make over it while you are talking.
 *
 * Builds a small talk out of the sample paper — a title, a finding, a figure and
 * a number — frames it as a stop, photographs the board in each surface, then
 * performs the talk: ink, highlighter, a ring, a card made to jump, everything
 * else stepped back, a push-in, the timer, the key card. Then it publishes the
 * thing and does the same gestures again in the file you would hand out, which
 * is the only way to know the two really are one implementation.
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

/* ---- performing it ------------------------------------------------------ */
await page.getByRole('button', { name: 'Present' }).click();
await page.waitForTimeout(2200);
const stage = await page.locator('.bx-root').boundingBox();
const at = (fx, fy) => ({ x: stage.x + stage.width * fx, y: stage.y + stage.height * fy });

/* Draw a circle round the thing you are talking about. */
await page.keyboard.press('d');
await page.waitForTimeout(200);
const centre = at(0.5, 0.5);
await page.mouse.move(centre.x + 210, centre.y);
await page.mouse.down();
for (let i = 0; i <= 40; i++) {
  const a = (i / 40) * Math.PI * 2;
  await page.mouse.move(centre.x + Math.cos(a) * 210, centre.y + Math.sin(a) * 120);
}
await page.mouse.up();
await page.waitForTimeout(300);

/* And run the highlighter under it. */
await page.keyboard.press('h');
await page.keyboard.press('3');
await page.waitForTimeout(150);
const under = at(0.32, 0.68);
await page.mouse.move(under.x, under.y);
await page.mouse.down();
await page.mouse.move(under.x + 420, under.y + 8, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
await shot('81-live-ink');

const inked = await page.evaluate(() => document.querySelectorAll('.bx-slate').length);
const drawn = await page.evaluate(() => {
  const c = document.querySelector('.bx-slate-pen');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
  return lit;
});
console.log(`  ink surfaces: ${inked} · pixels actually inked: ${drawn}`);

/* The pen goes away; the talk carries on. */
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

/* A ring where you point, and a card told to make itself known. */
await page.mouse.move(centre.x + 60, centre.y - 40);
await page.keyboard.press('.');
await page.waitForTimeout(160);
await shot('82-live-ping');

/* Whatever is under the middle of the screen is what is being talked about. */
const modClick = async (mod) => {
  await page.keyboard.down(mod);
  await page.mouse.click(centre.x, centre.y);
  await page.keyboard.up(mod);
};
await modClick('Alt');
await page.waitForTimeout(200);
/* Counted before the screenshot: the pulse is over in a second, and a shot at
   two device pixels takes longer than that. */
console.log('  card made to jump: ' + (await page.locator('.bx-card[data-hit="1"]').count()));
await shot('83-live-emphasis');

/* Everything else steps back. */
await modClick('Shift');
await page.waitForTimeout(420);
await shot('84-live-solo');
console.log('  solo on the stage: ' + (await page.locator('.bx-root[data-solo="1"]').count()));
await modClick('Shift');
await page.waitForTimeout(300);
console.log(
  '  solo released: ' + ((await page.locator('.bx-root[data-solo="1"]').count()) === 0),
);

/* Push in on what the question was about. */
await page.mouse.move(centre.x - 120, centre.y + 60);
await page.keyboard.press('z');
await page.waitForTimeout(900);
console.log(
  '  cards on screen while pushed in: ' +
    (await page.evaluate(() => {
      const v = { w: innerWidth, h: innerHeight };
      return [...document.querySelectorAll('.bx-card')].filter((c) => {
        const b = c.getBoundingClientRect();
        return (
          getComputedStyle(c).opacity > 0.5 &&
          b.right > 0 && b.left < v.w && b.bottom > 0 && b.top < v.h
        );
      }).length;
    })),
);
await shot('85-live-magnify');
await page.keyboard.press('z');
await page.waitForTimeout(700);

/* The clock, and the card that says what every key does. */
await page.keyboard.press('t');
await page.keyboard.press('?');
await page.waitForTimeout(400);
await shot('86-live-help');
await page.keyboard.press('Escape');
await page.keyboard.press('t');
await page.waitForTimeout(200);

/* Ink belongs to the slide: leaving and coming back keeps it. */
await page.keyboard.press('x');
await page.waitForTimeout(200);
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
await talk.keyboard.press('o');
await talk.waitForTimeout(1200);

/* The same gestures, in the file — this is the whole point of one source. */
const talkStage = await talk.locator('.bx-root').boundingBox();
const tAt = (fx, fy) => ({
  x: talkStage.x + talkStage.width * fx,
  y: talkStage.y + talkStage.height * fy,
});
await talk.keyboard.press('d');
const tc = tAt(0.5, 0.52);
await talk.mouse.move(tc.x + 180, tc.y);
await talk.mouse.down();
for (let i = 0; i <= 36; i++) {
  const a = (i / 36) * Math.PI * 2;
  await talk.mouse.move(tc.x + Math.cos(a) * 180, tc.y + Math.sin(a) * 110);
}
await talk.mouse.up();
await talk.keyboard.press('Escape');
await talk.mouse.move(tc.x + 120, tc.y - 90);
await talk.keyboard.press('.');
await talk.keyboard.press('t');
await talk.waitForTimeout(260);
await talk.screenshot({ path: 'shots/87-published-live.png' });
console.log('· 87-published-live');

await talk.keyboard.press('?');
await talk.waitForTimeout(400);
await talk.screenshot({ path: 'shots/88-published-help.png' });
console.log('· 88-published-help');
await talk.keyboard.press('Escape');
console.log('  tools in the published file: ' + (await talk.locator('.bx-tool').count()));
if (talkErrors.length) console.log('PUBLISHED PAGE ERRORS:\n' + talkErrors.join('\n'));
else console.log('  published page: no errors');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();

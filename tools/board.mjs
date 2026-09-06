import { chromium } from 'playwright';

/**
 * The board: how it feels under the hand, and what the room can be made to
 * look like.
 *
 * Three things are hard to be sure of by reading the code. Whether momentum
 * actually carries and actually stops. Whether an edge that is meant to look
 * drawn by hand looks drawn by hand. And whether the published file — which
 * repeats all of this in a few hundred bytes of its own runtime — agrees with
 * the board it came from. This drives a real browser through all three.
 */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('· ' + name);
};

/* ---- into the editor, and onto the board -------------------------------- */

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('[role="tab"]', { timeout: 120000 });
await page.waitForTimeout(2000);
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click({ force: true }).catch(() => {});
await page.getByRole('tab', { name: 'Board', exact: true }).click();
await page.waitForSelector('.bx-root', { timeout: 30000 });
await page.waitForTimeout(800);

const box = await page.locator('.bx-root').boundingBox();
const at = (x, y) => [box.x + x, box.y + y];
const inspector = () => page.locator('aside[aria-label="The selected thing"]');

/* ---- every edge, side by side ------------------------------------------- */

const EDGES = ['hairline', 'sketch', 'marker', 'tape', 'glow', 'cut'];
for (const [i, edge] of EDGES.entries()) {
  const [x, y] = at(240 + (i % 3) * 320, 230 + Math.floor(i / 3) * 340);
  await page.keyboard.press('n');
  await page.mouse.click(x, y);
  await page.keyboard.type(edge);
  await page.keyboard.press('Escape');
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
  await inspector().locator('select').first().selectOption(edge);
  await page.waitForTimeout(150);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('60-board-edges');

/* ---- the alignment guides ----------------------------------------------- */

const [gx, gy] = at(240, 230);
await page.mouse.move(gx, gy);
await page.mouse.down();
await page.mouse.move(gx + 60, gy + 330, { steps: 14 });
await page.mouse.move(gx + 62, gy + 338, { steps: 4 });
await page.waitForTimeout(200);
const guides = await page.evaluate(
  () => document.querySelectorAll('.bx-world > div[style*="dashed"]').length,
);
await shot('61-board-guides');
await page.mouse.up();
console.log('alignment guides shown while dragging:', guides);

/* ---- momentum: a flick carries, and a pan that rests does not ----------- */

const world = () =>
  page.evaluate(() => document.querySelector('.bx-world')?.style.transform ?? '');

await page.keyboard.press('h');
await page.mouse.move(...at(1000, 560));
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(...at(1000 - i * 30, 560));
await page.mouse.up();
const flick0 = await world();
await page.waitForTimeout(140);
const flick1 = await world();
await page.waitForTimeout(1400);
const flick2 = await world();
await page.waitForTimeout(500);
const flick3 = await world();
console.log('flick carried after release:', flick0 !== flick1);
console.log('flick came to rest:', flick2 === flick3);

await page.mouse.move(...at(1000, 560));
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(...at(1000 - i * 30, 560));
await page.waitForTimeout(500); // the hand stops before it lets go
await page.mouse.up();
const rest0 = await world();
await page.waitForTimeout(400);
console.log('a pan that rested did not throw:', rest0 === (await world()));
await page.keyboard.press('v');

/* ---- zoom eases toward its target rather than stepping ------------------ */

const k = () =>
  page.evaluate(() => Number(document.querySelector('.bx-root').style.getPropertyValue('--bx-k')));
await page.mouse.move(...at(700, 460));
await page.keyboard.down('Control');
await page.mouse.wheel(0, -400);
await page.keyboard.up('Control');
const kNow = await k();
await page.waitForTimeout(500);
const kThen = await k();
console.log('zoom eased rather than jumped:', kNow !== kThen);

/* ---- the five rooms ----------------------------------------------------- */

/* The camera has been thrown around by the tests above; frame the work again so
   each room is photographed with something in it. */
await page.mouse.move(...at(700, 460));
await page.keyboard.press('Control+0');
await page.waitForTimeout(1200);

for (const room of ['Desk', 'Studio', 'Cinema', 'Neon']) {
  // The lights go out first: clicking the surface switch with the popover open
  // would count as clicking away from it.
  if (room === 'Neon') await page.getByTitle('Blackboard').click();
  await page.getByRole('button', { name: /Effects/ }).click();
  const rooms = page.getByRole('group', { name: 'The room' });
  await rooms.waitFor({ timeout: 5000 });
  await rooms.getByRole('button', { name: room, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.mouse.move(...at(560, 420));
  await page.waitForTimeout(700);
  await shot(`62-room-${room.toLowerCase()}`);
}

const spot = await page.evaluate(() => {
  const el = document.querySelector('.bx-spot');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { paints: cs.backgroundImage !== 'none', opacity: Number(cs.opacity) };
});
console.log('spotlight paints:', JSON.stringify(spot));

/* ---- depth: cards on different planes separate as the camera moves ------ */

/* Cards are found where they actually are rather than where they were put. */

const centreOf = (i) =>
  page.evaluate((n) => {
    const el = document.querySelectorAll('.bx-card')[n];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, i);

const setPlane = async (i, plane) => {
  const p = await centreOf(i);
  if (!p) return false;
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
  await inspector().locator('select').nth(1).selectOption(plane);
  await page.waitForTimeout(200);
  return true;
};
console.log('far card set:', await setPlane(0, '-1'), '| near card set:', await setPlane(2, '1'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const gap = () =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll('.bx-card')];
    if (cards.length < 3) return null;
    const a = cards[0].getBoundingClientRect();
    const b = cards[2].getBoundingClientRect();
    return Math.round(b.left - a.left);
  });
const before = await gap();
await page.keyboard.press('h');
await page.mouse.move(...at(800, 560));
await page.mouse.down();
await page.mouse.move(...at(340, 560), { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(1400);
const after = await gap();
await page.keyboard.press('v');
console.log('gap between the far and near card, before/after a pan:', before, after);
console.log('depth separated them:', before !== after);
await shot('63-board-depth');

/* ---- the published file says the same thing ----------------------------- */

await page.keyboard.press('f');
await page.mouse.move(...at(140, 150));
await page.mouse.down();
await page.mouse.move(...at(1150, 720), { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Get the link' }).click();
await page.getByRole('button', { name: 'Build the page' }).click();
await page.getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 120000 });
const opened = ctx.waitForEvent('page', { timeout: 60000 });
await page.getByRole('button', { name: 'Open', exact: true }).click();
const published = await opened;
const perrors = [];
published.on('pageerror', (e) => perrors.push('PAGEERROR: ' + e.message));
published.on('console', (m) => {
  if (m.type() === 'error') perrors.push(m.text());
});
await published.setViewportSize({ width: 1500, height: 940 });
await published.waitForTimeout(2500);
await published.mouse.move(520, 400);
await published.waitForTimeout(1200);
await published.screenshot({ path: 'shots/64-board-published.png' });
console.log('· 64-board-published');
console.log(
  'published page carries:',
  JSON.stringify(
    await published.evaluate(() => ({
      cards: document.querySelectorAll('.bx-card').length,
      atmosphereLayers: document.querySelectorAll('.bx-atmos').length,
      roughFilters: !!document.querySelector('#bx-rough') && !!document.querySelector('#bx-scrawl'),
      edges: [...document.querySelectorAll('.bx-card')]
        .map((c) => c.getAttribute('data-outline'))
        .join(','),
      parallaxApplied: [...document.querySelectorAll('.bx-card')].some((c) =>
        c.style.transform.includes('translate('),
      ),
    })),
  ),
);
console.log('published errors:', perrors.length, perrors.slice(0, 3));
console.log('editor errors:', errors.length, errors.slice(0, 3));

await browser.close();

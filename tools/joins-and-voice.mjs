import { chromium } from 'playwright';

/**
 * Two promises this build makes, checked against a running app.
 *
 *  1. The voice stays quiet. Nothing is spoken while you edit unless the voice
 *     has been turned on — so `speechSynthesis.speak` is wrapped before the app
 *     boots and every utterance counted. Playing a talk with the voice off must
 *     produce none at all.
 *  2. Scene joins are real. A transition is two scenes on the surface at once;
 *     parking the playhead either side of a boundary must show one stack, and
 *     inside the join must show two.
 */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
const shot = async (n) => { await page.screenshot({ path: `shots/${n}.png` }); console.log('· ' + n); };

// Anything the page tries to say out loud is a failure of the default.
await page.addInitScript(() => {
  window.__spoke = [];
  const real = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
  if (real) window.speechSynthesis.speak = (u) => { window.__spoke.push(u.text?.slice(0, 40)); return real(u); };
});

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 60000 });
await page.waitForTimeout(1500);
// Dismiss onboarding however it is presented.
await page.keyboard.press('Escape').catch(() => {});
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click({ force: true }).catch(() => {});
await page.waitForTimeout(400);

await page.getByRole('button', { name: /draft one from the whole paper/i }).click();
await page.waitForTimeout(1500);
const scenes = await page.locator('[data-drop^="scene:"]').count();
console.log('scenes drafted:', scenes);
await shot('90-editor');

/* ---------- the voice must be silent by default ---------- */
console.log('voice control says:', await page.locator('button[aria-pressed]', { hasText: /Voice/ }).first().textContent());
await page.keyboard.press('Home');
await page.keyboard.press(' ');
await page.waitForTimeout(4000);
console.log('spoke while playing (must be 0):', (await page.evaluate(() => window.__spoke.length)));
await shot('91-playing');
await page.keyboard.press(' ');
await page.waitForTimeout(300);

/* ---------- transitions actually render ---------- */
// Sit right on a scene join and confirm two scene stacks are on the surface.
const join = await page.evaluate(() => {
  const el = document.querySelector('[data-coach="stage"]');
  return el ? el.querySelectorAll(':scope > div > div > div.absolute.inset-0').length : -1;
});
console.log('stacks on the stage at rest:', join);

/* ---------- the gallery ---------- */
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(400);
await page.keyboard.press('m');
await page.waitForSelector('[role="dialog"][aria-label="Animation"]', { timeout: 5000 });
await page.waitForTimeout(1600);
await shot('92-gallery-top');

const headings = await page.locator('[role="dialog"] .label, [role="dialog"] p').allTextContents();
console.log('sections:', headings.filter((t) => /Look|How it arrives|Coming from|While it stays|Choreography|Volume/.test(t)).join(' | '));

const dlg = page.locator('[role="dialog"]');
await dlg.locator('button', { hasText: 'Keynote' }).first().click();
await page.waitForTimeout(700);
await shot('93-look-keynote');

// scroll to the transitions section
await page.evaluate(() => {
  const box = document.querySelector('[role="dialog"] .scroll-quiet');
  const heads = [...box.querySelectorAll('p')];
  const h = heads.find((p) => p.textContent.startsWith('Coming from'));
  box.scrollTop = h.offsetTop - 40;
});
await page.waitForTimeout(1800);
await shot('94-transitions');

await page.keyboard.press("Escape");
await page.waitForTimeout(300);

/* ---------- watch a real join on the stage ---------- */
// Park the playhead a few frames either side of the first scene boundary and
// prove the outgoing scene is still on the surface while the new one arrives.
const seekTo = async (ms) => {
  await page.evaluate((v) => {
    const el = document.querySelector('input[aria-label="Playhead"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, ms);
  await page.waitForTimeout(160);
};
const stacks = () =>
  page.evaluate(() => {
    const surface = document.querySelector('[data-coach="stage"] [data-layer-id]')?.closest('.relative.overflow-hidden');
    return surface ? surface.querySelectorAll(':scope > div.absolute.inset-0').length : -1;
  });

const boundary = await page.evaluate(() => {
  const t = [...document.querySelectorAll('[data-drop^="scene:"]')];
  return t.length;
});
console.log('storyboard cards:', boundary);

for (const [i, ms] of [8100, 8260, 8400, 8600, 9200].entries()) {
  await seekTo(ms);
  console.log(`  t=${ms}ms  stacks on surface: ${await stacks()}`);
  await shot(`95-join-${i}`);
}

/* ---------- turning the voice on ---------- */
await page.locator('button[aria-pressed]', { hasText: /Voice/ }).first().click();
await page.waitForTimeout(200);
console.log('voice control now says:', await page.locator('button[aria-pressed]', { hasText: /Voice/ }).first().textContent());
await page.keyboard.press('Home');
await page.keyboard.press(' ');
await page.waitForTimeout(2500);
console.log('spoke with voice on (must be > 0):', await page.evaluate(() => window.__spoke.length));
await page.keyboard.press(' ');
await shot('96-voice-on');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no console errors');
await browser.close();

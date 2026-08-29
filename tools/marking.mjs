import { chromium } from 'playwright';

/**
 * Marking by hand.
 *
 * The reader rounds a dragged mark out to the word it stopped short of. These
 * are the things that keep that from becoming an argument: a drag that ran past
 * a full stop stays where it was let go, quick or careful; a drag that stopped
 * a word short of one is rounded and offered back; refusing the offer restores
 * the mark to the character; and after a refusal nothing is rounded again.
 */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

// Straight into the reader: the coach marks are not what is under test.
await page.addInitScript(() => {
  try {
    localStorage.setItem('pa:onboarded', '1');
  } catch {
    /* private mode */
  }
});

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const selection = () => page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
const byHand = () =>
  page.evaluate(() => document.querySelector('.pa-reader')?.dataset.byhand === 'true');
const offered = () => page.locator('[role="status"] button', { hasText: 'Keep what I marked' });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 60000 });
await page.waitForTimeout(1800);

/**
 * Sentences to work on, taken from the reader's own idea of them: clicking one
 * marks the whole sentence, and walking back through the printed line under its
 * far end says where a drag would have to stop to leave a known number of its
 * words unmarked.
 */
const seeds = await page.evaluate(() =>
  [...document.querySelectorAll('.pa-textlayer [data-run]')]
    .map((r) => {
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, top: b.top };
    })
    .filter((c) => c.w > 60 && c.top > 220 && c.top < 820),
);

const sentences = [];
for (const seed of seeds) {
  await page.mouse.click(seed.x, seed.y);
  await page.waitForTimeout(110);
  const found = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const end = range.endContainer;
    if (end.nodeType !== Node.TEXT_NODE) return null;
    const rects = [...range.getClientRects()].filter((r) => r.width > 4 && r.height > 2);
    if (!rects.length) return null;
    const first = rects[0];
    const last = rects[rects.length - 1];
    const data = end.data;

    const short = (want) => {
      let at = range.endOffset;
      let taken = 0;
      while (taken < want && at > 0) {
        while (at > 0 && /\s/.test(data[at - 1])) at--;
        while (at > 0 && !/\s/.test(data[at - 1])) at--;
        taken++;
      }
      if (at <= 0 || taken < want) return null;
      const caret = document.createRange();
      caret.setStart(end, at);
      caret.collapse(true);
      const box = caret.getBoundingClientRect();
      if (!box || box.x <= 0) return null;
      const tail = data.slice(at, range.endOffset).trim();
      if (!tail) return null;
      return {
        x: box.x + 1,
        y: box.y + box.height / 2,
        tail,
        words: tail.split(/\s+/).filter(Boolean).length,
      };
    };

    // Does the printed line carry on past the full stop? Without that there is
    // nowhere for a drag to overshoot to.
    const runBox = end.parentElement?.closest('[data-run]')?.getBoundingClientRect();

    return {
      text: (sel.toString() ?? '').trim(),
      from: { x: first.left + 1.5, y: first.top + first.height / 2 },
      past: { x: last.right + 20, y: last.top + last.height / 2 },
      carriesOn: !!runBox && runBox.right - last.right > 30,
      short1: short(1),
      short4: short(4),
    };
  });
  if (!found || found.text.length < 70) continue;
  if (sentences.some((s) => s.text === found.text)) continue;
  sentences.push(found);
  if (sentences.length >= 8) break;
}
await page.keyboard.press('Escape');

/** A cut has to land inside the sentence, not back in the one before it. */
const usable = (s, cut) => !!cut && (cut.y > s.from.y + 2 || cut.x > s.from.x + 40);
const overshoots = sentences.filter((s) => s.carriesOn);
console.log(`sentences: ${sentences.length} · ${overshoots.length} on a line that carries on`);
if (sentences.length < 4 || overshoots.length < 2) {
  throw new Error('not enough sentences to test with');
}

const near = (a, b, slack) => Math.abs(a - b) <= slack;

/** Drag from one point to another, quickly or with the care of somebody aiming. */
async function drag(from, to, { aimed = false } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (aimed) {
    for (const t of [0.35, 0.6, 0.8, 0.95, 1]) {
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, {
        steps: 6,
      });
      await page.waitForTimeout(80);
    }
  } else {
    await page.mouse.move(to.x, to.y, { steps: 4 });
  }
  // Reading the selection before the release costs a round trip, and a round
  // trip is a pause — one of the things the reader watches for. So it is only
  // read early for the drags that are meant to look aimed anyway.
  const raw = aimed ? await selection() : null;
  if (aimed) await page.waitForTimeout(320);
  await page.mouse.up();
  await page.waitForTimeout(380);
  return { raw, mark: await selection() };
}

/** A drag that runs on past a full stop — the case the old rule swallowed whole. */
async function overshoot(from, options) {
  for (const s of overshoots.slice(from)) {
    const result = await drag(s.from, s.past, options);
    if (result.mark.length > s.text.length + 1) return { s, ...result };
    await page.keyboard.press('Escape');
  }
  return null;
}

/* ---- 1. a quick drag that ran past a full stop stays there ------------ */
{
  const run = await overshoot(0);
  check('a quick drag runs past a full stop', !!run);
  if (run) {
    // Rounded out, the mark would carry the whole of the sentence it ran into.
    check(
      '  · and stops a few words into the next sentence',
      run.mark.length < run.s.text.length + 40,
      `sentence ${run.s.text.length}, marked ${run.mark.length}`,
    );
    check('  · and nothing is offered', (await offered().count()) === 0);
  }
  await page.keyboard.press('Escape');
}

/* ---- 2. an aimed drag is kept, and counts as evidence ----------------- */
{
  const run = await overshoot(1, { aimed: true });
  check('an aimed drag past a full stop is kept as dragged', !!run);
  if (run) {
    check(
      '  · what was dragged is what was marked',
      near(run.mark.length, run.raw.length, 12),
      `dragged ${run.raw.length}, marked ${run.mark.length}`,
    );
  }
  check('one aimed mark is not yet a habit', (await byHand()) === false);
  await page.keyboard.press('Escape');
}

/* ---- 3. four words short is a decision, one word short is a slip ------ */
{
  const s = sentences.find((x) => usable(x, x.short4));
  check('a sentence long enough to stop well short of', !!s);
  const { mark } = await drag(s.from, s.short4);
  check(
    `a drag that stopped ${s.short4.words} words short is left alone`,
    near(mark.length, s.text.length - s.short4.tail.length - 1, 3),
    `sentence ${s.text.length}, without “${s.short4.tail}” ${mark.length}`,
  );
  check('  · and nothing is offered', (await offered().count()) === 0);
  await page.keyboard.press('Escape');
}

let slipped = '';
let slipSentence = null;
{
  slipSentence = sentences.find((x) => usable(x, x.short1) && x.short1.words === 1);
  check('a sentence ending in a word of its own to slip on', !!slipSentence);
  const { mark } = await drag(slipSentence.from, slipSentence.short1);
  slipped = mark;
  check(
    `a drag that stopped short of “${slipSentence.short1.tail}” takes the word`,
    near(mark.length, slipSentence.text.length, 4),
    `sentence ${slipSentence.text.length}, marked ${mark.length}`,
  );
  check('  · and the rounding is offered back', (await offered().count()) === 1);
}

/* ---- 4. refusing it restores the mark, to the character --------------- */
{
  await offered().click();
  await page.waitForTimeout(400);
  const back = await selection();
  check(
    'refusing it puts back what was marked',
    near(back.length, slipped.length - slipSentence.short1.tail.length - 1, 3),
    `${slipped.length} → ${back.length} chars`,
  );
  check('  · and the reader steps back for good', (await byHand()) === true);
  await page.keyboard.press('Escape');
}

/* ---- 5. after that, nothing is rounded ------------------------------- */
{
  const s = sentences.find(
    (x) => x !== slipSentence && usable(x, x.short1) && x.short1.words === 1,
  );
  check('another sentence to slip on', !!s);
  const { mark } = await drag(s.from, s.short1);
  check(
    'the same slip is now kept as dragged',
    near(mark.length, s.text.length - s.short1.tail.length - 1, 3),
    `sentence ${s.text.length}, without “${s.short1.tail}” ${mark.length}`,
  );
  check('  · and nothing is offered', (await offered().count()) === 0);
}

console.log(errors.length ? '!! console errors:\n' + errors.join('\n') : '✓ no console errors');
console.log(failures ? `!! ${failures} check(s) failed` : '✓ all checks passed');
await browser.close();
process.exit(failures || errors.length ? 1 : 0);

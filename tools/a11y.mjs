import { chromium, devices } from 'playwright';

/**
 * The non-negotiables: mobile layout, reduced motion, and a keyboard-only path
 * from the landing page to a finished scene.
 */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

const report = (label, errors) =>
  console.log(errors.length ? `${label}: ERRORS\n  ` + errors.slice(0, 6).join('\n  ') : `${label}: clean`);

/* ---------- mobile ---------- */
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/50-mobile-landing.png' });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log('mobile horizontal overflow:', overflow + 'px');

  await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
  await page.waitForSelector('text=Your storyboard', { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/51-mobile-setup.png' });
  await page.getByRole('button', { name: 'Open the editor' }).first().click();
  await page.waitForTimeout(2000);
  const skip = page.getByRole('button', { name: 'Skip' }).first();
  if (await skip.count()) await skip.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/52-mobile-editor.png' });
  for (const tab of ['Paper', 'Scenes', 'Review']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `shots/53-mobile-${tab.toLowerCase()}.png` });
  }
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log('mobile editor horizontal overflow:', overflow2 + 'px');
  report('mobile', errors);
  await ctx.close();
}

/* ---------- reduced motion ---------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/54-reduced-landing.png' });

  // Nothing should still be mid-animation: the hero must be readable at once.
  const heroVisible = await page.getByText('Turn a paper into').isVisible();
  console.log('reduced-motion hero visible immediately:', heroVisible);

  await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
  await page.waitForSelector('text=Your storyboard', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/55-reduced-setup.png' });
  await page.getByRole('button', { name: 'Open the editor' }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/56-reduced-editor.png' });
  report('reduced motion', errors);
  await ctx.close();
}

/* ---------- keyboard only ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Tab until the sample-paper control has focus, then activate it.
  let reached = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      return (el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 60);
    });
    if (/Try a sample paper/i.test(label)) {
      reached = true;
      console.log(`keyboard reached the sample control in ${i + 1} tabs`);
      break;
    }
  }
  if (!reached) console.log('!! keyboard never reached the sample control');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Your storyboard', { timeout: 60000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shots/57-keyboard-setup.png' });

  // Reach "Open the editor" and go in.
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() =>
      (document.activeElement?.textContent || '').trim().slice(0, 40),
    );
    if (/Open the editor/i.test(label)) break;
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);

  // Space plays, then pauses.
  await page.keyboard.press('Escape');
  await page.keyboard.press(' ');
  await page.waitForTimeout(900);
  const playing = await page.evaluate(() => !!document.querySelector('[aria-label="Pause"]'));
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => !!document.querySelector('[aria-label="Play"]'));
  console.log('space starts playback:', playing, '· space pauses again:', paused);

  await page.screenshot({ path: 'shots/58-keyboard-editor.png' });

  // Every focusable element must show a visible ring.
  const noRing = await page.evaluate(() => {
    const focusable = [...document.querySelectorAll('button, a[href], input, [tabindex="0"]')].slice(
      0,
      60,
    );
    const bad = [];
    for (const el of focusable) {
      el.focus();
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== 'none';
      if (!ring && !shadow && document.activeElement === el) {
        bad.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40));
      }
    }
    return bad;
  });
  console.log('focusable elements with no visible focus ring:', noRing.length, noRing.slice(0, 5));

  report('keyboard', errors);
  await ctx.close();
}

await browser.close();

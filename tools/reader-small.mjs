import { chromium } from 'playwright';

/** The reader at tablet and phone widths. */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

for (const [name, viewport, touch] of [
  ['tablet', { width: 1024, height: 820 }, false],
  ['phone', { width: 390, height: 844 }, true],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: touch });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
  await page.waitForSelector('text=Your storyboard', { timeout: 60000 });
  await page.getByRole('button', { name: 'Open the editor' }).first().click();
  await page.waitForSelector('.pa-reader', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const skip = page.getByRole('button', { name: 'Skip' }).first();
  if (await skip.count()) await skip.click();
  await page.waitForTimeout(400);

  const spot = await page.evaluate(() => {
    const run = [...document.querySelectorAll('.pa-textlayer [data-run]')].find(
      (r) => r.textContent.length > 40 && r.getBoundingClientRect().top > 120,
    );
    if (!run) return null;
    const b = run.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  if (spot) {
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `shots/4${name === 'tablet' ? 0 : 1}-${name}.png` });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const markerVisible = await page.locator('[data-coach="marker"]').count();
  console.log(`${name}: overflow ${overflow}px · marker bar ${markerVisible} · ${errors.length ? errors.join(' ') : 'clean'}`);
  await page.close();
}

await browser.close();

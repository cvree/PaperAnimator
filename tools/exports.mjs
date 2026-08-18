import { chromium } from 'playwright';
import { mkdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Runs every export for real and checks the bytes that come back.
 * A format that produces an unopenable file is a broken promise, not a nit.
 */

const OUT = 'exports-check';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample paper' }).first().click();
await page.waitForSelector('.pa-reader', { timeout: 40000 });
await page.waitForTimeout(1200);
const skip = page.getByRole('button', { name: 'Skip' }).first();
if (await skip.count()) await skip.click();

/* The storyboard now starts empty, so anything that needs scenes asks for the
   draft the same way a person would. */
const draftBtn = page.getByRole('button', { name: 'Or draft one from the whole paper' });
if (await draftBtn.count()) {
  await draftBtn.first().click();
  await page.waitForTimeout(1500);
}

await page.getByRole('button', { name: 'Export' }).first().click();
await page.waitForTimeout(600);

// open the individual-format picker
const disclosure = page.getByText('Pick formats individually');
if (await disclosure.count()) await disclosure.click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/28-export-formats.png', fullPage: true });

const FORMATS = [
  'WebM video',
  'PNG slides',
  'PowerPoint deck',
  'PDF',
  'SRT captions',
  'WebVTT captions',
  'Transcript',
  'Project file',
];

for (const name of FORMATS) {
  const b = page.getByRole('button', { name, exact: true });
  if (!(await b.count())) {
    console.log('!! format missing: ' + name);
    continue;
  }
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
}
await page.waitForTimeout(300);

const downloads = [];
page.on('download', async (d) => {
  const name = d.suggestedFilename();
  const path = `${OUT}/${name}`;
  await d.saveAs(path);
  downloads.push({ name, path });
  console.log('  \u2193 ' + name);
});

const go = page.getByRole('button', { name: /^Export \d+ files?$/ });
await go.click();
console.log('exporting…');

const wanted = FORMATS.length;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(2000);
  if ((await page.getByRole('button', { name: 'Download' }).count()) >= wanted) break;
}
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/29-export-done.png', fullPage: true });

const buttons = page.getByRole('button', { name: 'Download' });
const count = await buttons.count();
console.log(`ready files: ${count} of ${wanted}`);
for (let i = 0; i < count; i++) {
  await buttons.nth(i).click();
  await page.waitForTimeout(700);
}
await page.waitForTimeout(2500);

console.log('\n--- files ---');
for (const d of downloads) {
  const size = statSync(d.path).size;
  let verdict = `${size} bytes`;
  try {
    const type = execFileSync('file', ['-b', d.path]).toString().trim();
    verdict += ' · ' + type;
  } catch {
    /* file(1) may be absent */
  }
  const head = readFileSync(d.path).subarray(0, 8);
  verdict += ' · magic ' + [...head].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`${d.name.padEnd(38)} ${verdict}`);
}
console.log(
  '\n' + (errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no console errors'),
);
await browser.close();

import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';

/** Plays the exported video in a real browser and samples frames from it. */
const dir = 'exports-check';
const file = readdirSync(dir).find((f) => f.endsWith('.mp4') || f.endsWith('.webm'));
const mime = file.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
const b64 = readFileSync(`${dir}/${file}`).toString('base64');
console.log('playing:', file);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.setContent('<body style="margin:0;background:#111"><video id="v" controls style="width:100%"></video></body>');
await page.evaluate(
  ({ data, type }) => {
    const v = document.getElementById('v');
    v.src = `data:${type};base64,` + data;
  },
  { data: b64, type: mime },
);

const meta = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const v = document.getElementById('v');
      v.onloadedmetadata = () =>
        resolve({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => resolve({ error: String(v.error?.message ?? v.error?.code) });
      setTimeout(() => resolve({ error: 'timeout' }), 20000);
    }),
);
console.log('video:', JSON.stringify(meta));

for (const t of [0.35, 0.7, 1.1, 2, 12, 40]) {
  const ok = await page.evaluate(
    (time) =>
      new Promise((resolve) => {
        const v = document.getElementById('v');
        v.onseeked = () => resolve(true);
        v.currentTime = time;
        setTimeout(() => resolve(false), 8000);
      }),
    t,
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/30-video-${String(t).replace('.', 'p')}s.png` });
  console.log(`  t=${t}s seek ${ok ? 'ok' : 'FAILED'}`);
}
await browser.close();

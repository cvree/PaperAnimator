import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || 'shots/landing.png';
const w = Number(process.argv[4] || 1440);
const h = Number(process.argv[5] || 900);
const wait = Number(process.argv[6] || 5200);
const full = process.argv[7] === 'full';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: full });
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();

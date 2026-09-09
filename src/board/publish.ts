import type { Project } from '@/core/types';
import {
  boardCss,
  cardBody,
  cardTransform,
  countPlan,
  edgesSvg,
  escapeHtml,
  motionOf,
  paletteOf,
  surfaceVars,
} from './paint';
import { stopSteps } from './board';
/* The live layer, as source. The presenter imports the same file as a module,
   so a gesture behaves identically whether the talk is being given from the app
   or from this one file — there is one implementation, not two. */
import liveSource from './live.js?raw';
import type { Board, Card } from './types';

/**
 * The finished thing, as one file.
 *
 * A talk you cannot hand to somebody is not finished, and every route to
 * handing it over that depends on us staying up is a promise we should not
 * make. So publishing writes a single HTML document with the images inside it
 * and a few hundred bytes of its own runtime: open it from a USB stick, mail
 * it, drop it in any static host, and it is the same presentation. Nothing
 * phones home, because there is nothing to phone.
 */

export interface PublishOptions {
  includeNotes: boolean;
  autoplay: boolean;
  onProgress?: (stage: string, progress: number) => void;
}

export interface Published {
  html: string;
  blob: Blob;
  /** Good for the length of this browser session — enough to open it now. */
  objectUrl: string;
  bytes: number;
  /** A copy-and-paste link back into this app, when the board is small enough. */
  hashUrl: string | null;
  hashBytes: number;
  assetsInlined: number;
  assetsFailed: number;
}

/* ============================================================================
   Assets
   ========================================================================== */

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function cardAssets(board: Board): string[] {
  const urls = new Set<string>();
  for (const card of board.cards) {
    if (card.kind === 'image' && card.src) urls.add(card.src);
    if (card.kind === 'table' && card.src) urls.add(card.src);
  }
  return [...urls];
}

/** Object URLs die with the tab, so every image is carried inside the file. */
export async function inlineAssets(
  board: Board,
  onProgress?: (stage: string, progress: number) => void,
): Promise<{ map: Map<string, string>; failed: number }> {
  const urls = cardAssets(board);
  const map = new Map<string, string>();
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    onProgress?.('Packing images', urls.length ? (i + 1) / urls.length : 1);
    if (url.startsWith('data:')) {
      map.set(url, url);
      continue;
    }
    const data = await toDataUrl(url);
    if (data) map.set(url, data);
    else failed++;
  }
  return { map, failed };
}

/* ============================================================================
   The document
   ========================================================================== */

interface TalkModel {
  title: string;
  surface: string;
  /** Whether the board's lights are off — the live layer's ink reads off it. */
  dark: boolean;
  motion: string;
  stops: { title: string; rect: number[]; notes: string; auto: number; steps: number }[];
  cards: {
    rect: number[];
    step: number;
    action: unknown;
    note: string;
    stop: number;
    /** The figure this card counts up to, when it is a statistic that can. */
    count: string | null;
  }[];
  notes: boolean;
  autoplay: boolean;
}

/**
 * Stop ids mean nothing to the published page, so a jump is resolved to its
 * position in the run before it leaves here.
 */
function publishedAction(board: Board, card: Card): unknown {
  const action = card.action;
  if (!action) return null;
  if (action.kind !== 'stop') return action;
  return { kind: 'stop', index: board.stops.findIndex((s) => s.id === action.stopId) };
}

/**
 * The order the cards of a stop arrive in: reading order, within the click they
 * belong to. A stop then builds down the way an eye goes, and a card that waits
 * for a click still leads its own group instead of inheriting a long delay.
 */
function arrivalOrder(board: Board, cards: Card[]): Map<string, number> {
  const order = new Map<string, number>();
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const key = `${stopIndexFor(board, card)}:${card.step}`;
    const list = groups.get(key) ?? [];
    list.push(card);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list
      .slice()
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .forEach((card, i) => order.set(card.id, i));
  }
  return order;
}

/**
 * Which stop a card belongs to for the purpose of speaker notes. Stops nest —
 * one wide stop can hold several narrower ones — so a card belongs to the
 * tightest frame around it, which is the one somebody was talking about when
 * they drew it.
 */
function stopIndexFor(board: Board, card: Card): number {
  const cx = card.rect.x + card.rect.w / 2;
  const cy = card.rect.y + card.rect.h / 2;
  let best = -1;
  let bestArea = Infinity;
  board.stops.forEach((s, i) => {
    const inside =
      cx >= s.rect.x && cx <= s.rect.x + s.rect.w && cy >= s.rect.y && cy <= s.rect.y + s.rect.h;
    const area = s.rect.w * s.rect.h;
    if (inside && area < bestArea) {
      best = i;
      bestArea = area;
    }
  });
  return best;
}

export function buildStandalone(
  project: Project,
  assets: Map<string, string>,
  options: PublishOptions,
): string {
  const board = project.board;
  const palette = paletteOf(board.surface);
  const resolve = (src: string | null) => (src ? (assets.get(src) ?? src) : null);
  const cards = [...board.cards].sort((a, b) => a.z - b.z);
  const order = arrivalOrder(board, cards);

  const model: TalkModel = {
    title: project.title,
    surface: board.surface,
    dark: palette.dark,
    motion: motionOf(board),
    stops: board.stops.map((s) => ({
      title: s.title,
      rect: [s.rect.x, s.rect.y, s.rect.w, s.rect.h],
      notes: options.includeNotes ? s.notes : '',
      auto: s.autoAdvanceMs,
      steps: stopSteps(board, s),
    })),
    cards: cards.map((c) => ({
      rect: [c.rect.x, c.rect.y, c.rect.w, c.rect.h],
      step: c.step,
      // Stop ids mean nothing to the published page, so a jump is resolved to
      // its position in the run before it leaves here.
      action: publishedAction(board, c),
      note: options.includeNotes ? c.note : '',
      stop: stopIndexFor(board, c),
      count: c.kind === 'stat' && countPlan(c.value) ? c.value : null,
    })),
    notes: options.includeNotes,
    autoplay: options.autoplay,
  };

  const body = cards
    .map(
      (card, i) =>
        `<div class="bx-card bx-fade" data-i="${i}"${card.raised ? ' data-raised="1"' : ''} style="${escapeHtml(
          `${cardTransform(card)};--bx-i:${order.get(card.id) ?? 0}`,
        )}">${cardBody(card, board.surface, resolve)}</div>`,
    )
    .join('\n');

  /* The frames are the map, and the map is what stops an audience getting lost
     when the whole board comes into view. */
  const frames = board.stops
    .map(
      (s, i) =>
        `<div class="bx-frame" data-f="${i}" style="left:${s.rect.x}px;top:${s.rect.y}px;width:${s.rect.w}px;height:${s.rect.h}px"><span>${
          i + 1
        }. ${escapeHtml(s.title)}</span></div>`,
    )
    .join('\n');

  const vars = Object.entries(surfaceVars(board.surface))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const description = `${project.paper.meta.title ?? project.title}${
    project.paper.meta.year ? ` (${project.paper.meta.year})` : ''
  }`;

  return `<!doctype html>
<html lang="${escapeHtml(project.paper.meta.language || 'en')}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="${palette.dark ? 'dark' : 'light'}" />
<title>${escapeHtml(project.title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:${palette.ground};}
:root{${vars};color-scheme:${palette.dark ? 'dark' : 'light'}}
${boardCss()}
${chromeCss()}
</style>
</head>
<body>
<div class="bx-root" id="bx-stage" data-present="1" data-motion="${escapeHtml(motionOf(board))}">
  <div class="bx-world" id="bx-world">
${frames}
${edgesSvg(board)}
${body}
  </div>
  <div class="bx-black" id="bx-black" hidden></div>
  <aside class="bx-notes" id="bx-notes" hidden></aside>
  <div class="bx-bar"><i id="bx-fill"></i></div>
  <p class="bx-title" id="bx-title"></p>
  <div class="bx-chrome">
    <div class="bx-group">
      <button id="bx-prev" title="Back">&lsaquo;</button>
      <button id="bx-next" title="Forward">&rsaquo;</button>
      <span class="bx-count" id="bx-count"></span>
    </div>
    <div class="bx-group">
      <button id="bx-over" title="Overview (O)">&#9638;</button>
      ${options.includeNotes ? '<button id="bx-note" title="Notes (N)">&#8801;</button>' : ''}
      <button id="bx-full" title="Full screen (F)">&#9974;</button>
    </div>
  </div>
  <p class="bx-hint" id="bx-hint">Click, or use &larr; and &rarr;. O for the whole board.</p>
</div>
<script id="bx-talk" type="application/json">${json}</script>
<script>
${liveSource.replace('export { createLive };', '')}
${runtime()}
</script>
</body>
</html>`;
}

function chromeCss(): string {
  return `
.bx-chrome{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;
  align-items:flex-end;padding:14px 16px;gap:12px;pointer-events:none;z-index:20;
  font:400 13px/1 system-ui,-apple-system,sans-serif;opacity:0;transform:translateY(10px);
  transition:opacity 320ms ease,transform 320ms ease}
.bx-chrome:focus-within,.bx-chrome[data-show="1"]{opacity:1;transform:none}
.bx-group{display:flex;align-items:center;gap:6px;pointer-events:auto;padding:6px;border-radius:999px;
  background:color-mix(in oklch,var(--bx-ground) 62%,transparent);
  border:1px solid color-mix(in oklch,var(--bx-ink) 10%,transparent);
  -webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%);
  box-shadow:0 2px 6px var(--bx-shadow),0 18px 40px -20px var(--bx-shadow-deep)}
.bx-chrome button{width:32px;height:32px;border:none;border-radius:999px;cursor:pointer;font-size:15px;
  background:color-mix(in oklch,var(--bx-ink) 8%,transparent);color:var(--bx-ink-soft);
  transition:transform 160ms ease,background 160ms ease,color 160ms ease}
.bx-chrome button:hover{background:color-mix(in oklch,var(--bx-ink) 16%,transparent);
  color:var(--bx-ink);transform:scale(1.06)}
.bx-chrome button[data-on="1"]{background-image:linear-gradient(140deg,var(--bx-accent),var(--bx-accent-alt));
  color:var(--bx-accent-ink);box-shadow:0 0 16px var(--bx-glow)}
.bx-count{padding:0 8px;color:var(--bx-ink-faint);font-variant-numeric:tabular-nums}
.bx-title{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);margin:0;z-index:20;
  max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;
  padding:7px 16px;border-radius:999px;color:var(--bx-ink-soft);letter-spacing:0.02em;
  font:500 12px/1.2 system-ui,-apple-system,sans-serif;opacity:0;transition:opacity 320ms ease;
  background:color-mix(in oklch,var(--bx-ground) 62%,transparent);
  border:1px solid color-mix(in oklch,var(--bx-ink) 10%,transparent);
  -webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%)}
.bx-title[data-show="1"]{opacity:1}
.bx-bar{position:absolute;left:0;right:0;bottom:0;height:3px;z-index:21;
  background:color-mix(in oklch,var(--bx-ink) 12%,transparent)}
.bx-bar i{display:block;height:100%;width:0;
  background:linear-gradient(90deg,var(--bx-accent),var(--bx-accent-alt));
  box-shadow:0 0 12px var(--bx-glow),0 0 3px var(--bx-glow);
  transition:width 480ms cubic-bezier(.2,.7,.2,1)}
.bx-black{position:absolute;inset:0;background:#000;z-index:30}
.bx-notes{position:absolute;left:16px;bottom:64px;width:26rem;max-width:80vw;max-height:40vh;
  overflow:auto;padding:16px;border-radius:10px;background:var(--bx-ground-edge);color:var(--bx-ink);
  border:1px solid var(--bx-rule);white-space:pre-wrap;z-index:22;
  font:400 14px/1.6 system-ui,-apple-system,sans-serif;box-shadow:0 20px 60px var(--bx-shadow)}
.bx-hint{position:absolute;left:50%;bottom:56px;transform:translateX(-50%);margin:0;z-index:20;
  color:var(--bx-ink-faint);font:400 13px/1 system-ui,sans-serif;transition:opacity 600ms}
.bx-hint[hidden]{display:none}
.bx-card[data-act="1"]{cursor:pointer}
/* The frames only exist when the whole board is in view. */
.bx-frame{position:absolute;border:3px solid var(--bx-accent);border-radius:8px;opacity:0;
  pointer-events:none;z-index:2;transition:opacity 320ms ease}
.bx-frame[data-show="1"]{opacity:.36}
.bx-frame[data-here="1"]{opacity:.95;box-shadow:0 0 60px var(--bx-glow)}
.bx-frame span{position:absolute;left:0;top:-32px;display:flex;align-items:center;height:26px;
  padding:0 10px;border-radius:999px;white-space:nowrap;
  background:var(--bx-accent);color:var(--bx-accent-ink);
  font:600 15px/1 system-ui,-apple-system,sans-serif}
@media (prefers-reduced-motion:reduce){.bx-fade{transition:none}.bx-bar i{transition:none}}
`.trim();
}

/**
 * The published page's own runtime. It repeats the camera arithmetic from
 * `board.ts` rather than importing it, because the whole point of this file is
 * that it has no dependencies — including on us.
 */
function runtime(): string {
  return String.raw`
(function () {
  var talk = JSON.parse(document.getElementById('bx-talk').textContent);
  var stage = document.getElementById('bx-stage');
  var world = document.getElementById('bx-world');
  var cards = [].slice.call(world.querySelectorAll('.bx-card'));
  var frames = [].slice.call(world.querySelectorAll('.bx-frame'));
  var fill = document.getElementById('bx-fill');
  var count = document.getElementById('bx-count');
  var black = document.getElementById('bx-black');
  var notesEl = document.getElementById('bx-notes');
  var titleEl = document.getElementById('bx-title');
  var hint = document.getElementById('bx-hint');
  var chrome = document.querySelector('.bx-chrome');

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var still = talk.motion === 'none' || reduced;
  var index = 0, step = 0, overview = false;
  var raf = 0, timer = 0, idleTimer = 0;
  var live = null;
  var was = [];
  var pointer = { x: 0, y: 0 };
  var cam = { x: 0, y: 0, zoom: 1 };

  function size() { return { w: stage.clientWidth, h: stage.clientHeight }; }

  function bounds() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var all = talk.cards.concat(talk.stops);
    for (var i = 0; i < all.length; i++) {
      var r = all[i].rect;
      x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]);
      x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]);
    }
    if (!isFinite(x0)) return [0, 0, 1600, 900];
    return [x0, y0, x1 - x0, y1 - y0];
  }

  function cameraFor(rect, margin) {
    var v = size();
    var zoom = Math.min(v.w / rect[2], v.h / rect[3]) * (margin || 0.97);
    return { x: rect[0] + rect[2] / 2, y: rect[1] + rect[3] / 2, zoom: Math.max(0.02, Math.min(8, zoom)) };
  }

  function draw() {
    var v = size();
    world.style.transform =
      'translate(' + v.w / 2 + 'px,' + v.h / 2 + 'px) scale(' + cam.zoom + ') translate(' +
      -cam.x + 'px,' + -cam.y + 'px)';
    if (live) live.moved();
  }

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* Travelling far pulls back on the way, so the audience keeps its bearings. */
  function flyTo(to, ms) {
    cancelAnimationFrame(raf);
    if (reduced || !ms) { cam = to; draw(); return; }
    var from = { x: cam.x, y: cam.y, zoom: cam.zoom };
    var span = (1 / from.zoom + 1 / to.zoom) / 2;
    var leaps = Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, span);
    var arc = Math.min(0.55, leaps * 0.22);
    var start = performance.now();
    (function tick(now) {
      var t = Math.min(1, (now - start) / ms), e = ease(t);
      var inv = (1 / from.zoom + (1 / to.zoom - 1 / from.zoom) * e) * (1 + arc * Math.sin(Math.PI * e));
      cam = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: Math.max(0.02, Math.min(8, 1 / inv))
      };
      draw();
      if (t < 1) raf = requestAnimationFrame(tick);
    })(performance.now());
  }

  /* A card is part of the stop that frames it — the same test the editor uses,
     so a published talk dims exactly what the board dimmed. */
  function inStop(rect, stop) {
    if (!stop) return true;
    var cx = rect[0] + rect[2] / 2, cy = rect[1] + rect[3] / 2;
    return cx >= stop.rect[0] && cx <= stop.rect[0] + stop.rect[2] &&
           cy >= stop.rect[1] && cy <= stop.rect[1] + stop.rect[3];
  }

  /* An entrance is a CSS animation, so playing it a second time means taking it
     away and putting it back with a reflow in between. Going back a slide and
     forward again should look exactly like the first pass. */
  function play(el, model) {
    if (still) return;
    var anim = el.querySelector('.bx-anim');
    if (!anim) return;
    var parts = [anim];
    var extra = el.querySelectorAll('.bx-w, .bx-ink path');
    for (var j = 0; j < extra.length; j++) parts.push(extra[j]);
    for (var j = 0; j < parts.length; j++) parts[j].style.animation = 'none';
    void anim.offsetWidth;
    for (var j = 0; j < parts.length; j++) parts[j].style.animation = '';
    runUp(el, model);
  }

  /* A statistic that lands on its figure is a slide; one that runs up to it is
     the reason the figure is on screen at that size. */
  function parseCount(value) {
    var m = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)([\s\S]*)$/.exec(value);
    if (!m) return null;
    var plain = m[2].replace(/,/g, '');
    var target = parseFloat(plain);
    if (!isFinite(target) || Math.abs(target) > 1e12) return null;
    var dot = plain.indexOf('.');
    return {
      p: m[1], s: m[3], t: target,
      d: dot < 0 ? 0 : plain.length - dot - 1,
      g: m[2].indexOf(',') >= 0
    };
  }

  function countFrame(plan, t) {
    var parts = (plan.t * t).toFixed(plan.d).split('.');
    var whole = plan.g ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : parts[0];
    return plan.p + whole + (parts[1] ? '.' + parts[1] : '') + plan.s;
  }

  function runUp(el, model) {
    if (!model.count) return;
    var b = el.querySelector('.bx-num');
    if (!b) return;
    var plan = parseCount(model.count);
    if (!plan) { b.textContent = model.count; return; }
    if (b.bxRaf) cancelAnimationFrame(b.bxRaf);
    var delay = (parseFloat(el.style.getPropertyValue('--bx-i')) || 0) * 74;
    var start = performance.now() + delay;
    b.textContent = countFrame(plan, 0);
    (function tick(now) {
      var t = Math.max(0, Math.min(1, (now - start) / 900));
      b.textContent = countFrame(plan, 1 - Math.pow(1 - t, 3));
      if (t < 1) b.bxRaf = requestAnimationFrame(tick);
    })(performance.now());
  }

  function render() {
    var here = talk.stops[index];
    for (var i = 0; i < cards.length; i++) {
      var model = talk.cards[i];
      var mine = overview || inStop(model.rect, here);
      var shown = overview || model.step === 0 || (mine && model.step <= step);
      var el = cards[i];
      el.style.opacity = shown ? '1' : '0';
      el.setAttribute('data-focus', mine || overview ? '1' : '0');
      if (!mine && !overview && shown) el.style.opacity = '0.22';
      el.style.pointerEvents = shown && model.action ? 'auto' : 'none';
      if (model.action) el.setAttribute('data-act', '1');
      if (shown && !was[i]) play(el, model);
      was[i] = shown;
    }
    for (var f = 0; f < frames.length; f++) {
      if (overview) frames[f].setAttribute('data-show', '1');
      else frames[f].removeAttribute('data-show');
      if (overview && f === index) frames[f].setAttribute('data-here', '1');
      else frames[f].removeAttribute('data-here');
    }
    if (titleEl) titleEl.textContent = here && !overview ? here.title : '';
    if (live) live.slide(overview ? 'overview' : index);
    var stop = here;
    var steps = stop ? stop.steps : 0;
    count.textContent = talk.stops.length
      ? (index + 1) + ' / ' + talk.stops.length + (steps ? ' · ' + step + '/' + steps : '')
      : '';
    var progress = talk.stops.length
      ? (index + (steps ? step / (steps + 1) : 0) + 1) / talk.stops.length
      : 0;
    fill.style.width = (progress * 100) + '%';
    if (notesEl && !notesEl.hidden) notesEl.textContent = notesFor(index) || 'No notes for this stop.';
    if (location.hash !== '#' + (index + 1)) history.replaceState(null, '', '#' + (index + 1));
    clearTimeout(timer);
    if (stop && stop.auto && !overview) timer = setTimeout(function () { go(1); }, stop.auto);
  }

  function notesFor(i) {
    var parts = [];
    if (talk.stops[i] && talk.stops[i].notes) parts.push(talk.stops[i].notes);
    for (var c = 0; c < talk.cards.length; c++) {
      if (talk.cards[c].stop === i && talk.cards[c].note) parts.push(talk.cards[c].note);
    }
    return parts.join('\n\n');
  }

  function frame() {
    if (overview) { flyTo(cameraFor(bounds(), 0.88), 620); return; }
    var stop = talk.stops[index];
    flyTo(stop ? cameraFor(stop.rect, 0.97) : cameraFor(bounds(), 0.88), 780);
  }

  function goTo(i, s) {
    index = Math.max(0, Math.min(talk.stops.length - 1, i));
    step = s || 0;
    overview = false;
    document.getElementById('bx-over').removeAttribute('data-on');
    frame();
    render();
  }

  function go(delta) {
    var stop = talk.stops[index];
    var steps = stop ? stop.steps : 0;
    if (delta > 0) {
      if (step < steps) { step++; render(); return; }
      if (index < talk.stops.length - 1) { goTo(index + 1, 0); return; }
      if (talk.autoplay) { goTo(0, 0); }
      return;
    }
    if (step > 0) { step--; render(); return; }
    if (index > 0) {
      var prev = talk.stops[index - 1];
      goTo(index - 1, prev ? prev.steps : 0);
    }
  }

  stage.addEventListener('click', function (e) {
    if (live && live.busy()) return;
    if (e.target.closest('.bx-chrome') || e.target.closest('.bx-tools')) return;
    var card = e.target.closest('.bx-card');
    var model = card ? talk.cards[+card.getAttribute('data-i')] : null;
    var action = model && model.action;
    if (action && action.kind === 'stop') {
      if (typeof action.index === 'number' && action.index >= 0) { goTo(action.index, 0); return; }
      go(1);
      return;
    }
    if (action && action.kind === 'zoom' && model) { flyTo(cameraFor(model.rect, 0.85), 620); return; }
    if (action && action.kind === 'link' && action.href) {
      window.open(action.href, '_blank', 'noopener');
      return;
    }
    go(1);
  });

  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); go(-1); });

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); go(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(-1); }
    else if (k === 'Home') goTo(0, 0);
    else if (k === 'End') goTo(talk.stops.length - 1, 0);
    else if (k === 'o' || k === 'O' || k === 'Escape') toggleOverview();
    else if (k === 'b' || k === 'B') { black.hidden = !black.hidden; }
    else if (k === 'n' || k === 'N') { toggleNotes(); }
    else if (k === 'f' || k === 'F') { toggleFull(); }
  });

  /* A phone gets the same talk: swipe is the same as an arrow key. */
  var touch = null;
  stage.addEventListener('touchstart', function (e) {
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (!touch) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); e.preventDefault(); }
    touch = null;
  });

  function toggleOverview() {
    overview = !overview;
    var b = document.getElementById('bx-over');
    if (overview) b.setAttribute('data-on', '1'); else b.removeAttribute('data-on');
    frame(); render();
  }
  function toggleNotes() {
    if (!notesEl) return;
    notesEl.hidden = !notesEl.hidden;
    var b = document.getElementById('bx-note');
    if (b) { if (notesEl.hidden) b.removeAttribute('data-on'); else b.setAttribute('data-on', '1'); }
    render();
  }
  /* The controls are for the presenter, not the audience: they leave when the
     hand does, so nothing of ours ends up in the recording. */
  function wake() {
    chrome.setAttribute('data-show', '1');
    if (titleEl) titleEl.setAttribute('data-show', '1');
    if (live) live.chrome(true);
    stage.style.cursor = '';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      chrome.removeAttribute('data-show');
      if (titleEl) titleEl.removeAttribute('data-show');
      if (live) live.chrome(false);
      stage.style.cursor = 'none';
    }, 2600);
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  }

  stage.addEventListener('pointermove', function (e) {
    wake();
    var r = stage.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
  });

  document.getElementById('bx-prev').addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
  document.getElementById('bx-next').addEventListener('click', function (e) { e.stopPropagation(); go(1); });
  document.getElementById('bx-over').addEventListener('click', function (e) { e.stopPropagation(); toggleOverview(); });
  document.getElementById('bx-full').addEventListener('click', function (e) { e.stopPropagation(); toggleFull(); });
  var noteBtn = document.getElementById('bx-note');
  if (noteBtn) noteBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleNotes(); });

  addEventListener('resize', function () { frame(); });
  addEventListener('hashchange', function () {
    var n = parseInt(location.hash.slice(1), 10);
    if (n && n - 1 !== index) goTo(n - 1, 0);
  });

  setTimeout(function () { if (hint) hint.hidden = true; }, 6000);

  var start = parseInt(location.hash.slice(1), 10);
  index = start && start > 0 ? Math.min(start - 1, Math.max(0, talk.stops.length - 1)) : 0;
  if (!talk.stops.length) { overview = true; }
  cam = talk.stops.length ? cameraFor(talk.stops[index].rect, 0.97) : cameraFor(bounds(), 0.88);
  draw();

  /* The live layer, from the same file the presenter imports. */
  live = createLive({
    host: stage,
    getCamera: function () { return cam; },
    setCamera: function (next) { cancelAnimationFrame(raf); cam = next; draw(); },
    refit: function () { frame(); },
    dark: !!talk.dark,
    reduced: reduced
  });

  render();
  wake();
})();
`.trim();
}

/* ============================================================================
   Publishing
   ========================================================================== */

/** Roughly what a link can carry before mail clients start breaking it. */
const HASH_BUDGET = 900_000;

export async function publish(project: Project, options: PublishOptions): Promise<Published> {
  options.onProgress?.('Packing images', 0.05);
  const { map, failed } = await inlineAssets(project.board, options.onProgress);

  options.onProgress?.('Writing the page', 0.7);
  const html = buildStandalone(project, map, options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });

  options.onProgress?.('Making the link', 0.9);
  const hash = await encodeTalkLink(project, map);

  options.onProgress?.('Done', 1);
  return {
    html,
    blob,
    objectUrl: URL.createObjectURL(blob),
    bytes: blob.size,
    hashUrl: hash && hash.length < HASH_BUDGET ? hash : null,
    hashBytes: hash ? hash.length : 0,
    assetsInlined: map.size,
    assetsFailed: failed,
  };
}

/* ============================================================================
   The address-bar link
   ========================================================================== */

/**
 * A board small enough to travel in a URL travels in one. It is gzipped and
 * base64url'd into the fragment, which never leaves the browser it is pasted
 * into — no server sees the talk, and no server has to.
 */
export async function encodeTalkLink(
  project: Project,
  assets: Map<string, string>,
): Promise<string | null> {
  const board = project.board;
  const packed: Board = {
    ...board,
    cards: board.cards.map((card) => {
      if (card.kind === 'image' || card.kind === 'table') {
        return { ...card, src: card.src ? (assets.get(card.src) ?? null) : null };
      }
      return card;
    }),
  };
  const payload = JSON.stringify({ v: 1, title: project.title, board: packed });

  try {
    const bytes = new TextEncoder().encode(payload);
    let compressed: Uint8Array;
    if (typeof CompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
      compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      compressed = bytes;
    }
    const encoded = base64Url(compressed, typeof CompressionStream === 'function');
    const base = `${location.origin}${location.pathname}`;
    return `${base}#talk=${encoded}`;
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array, gzipped: boolean): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${gzipped ? 'z' : 'r'}.${b64}`;
}

/** The other half of {@link encodeTalkLink}, used when the app opens on a link. */
export async function decodeTalkLink(
  hash: string,
): Promise<{ title: string; board: Board } | null> {
  const raw = hash.startsWith('#talk=') ? hash.slice(6) : hash.startsWith('talk=') ? hash.slice(5) : null;
  if (!raw) return null;
  try {
    const [flag, body] = raw.split('.');
    if (!body) return null;
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    let json: string;
    if (flag === 'z' && typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      json = await new Response(stream).text();
    } else {
      json = new TextDecoder().decode(bytes);
    }
    const parsed = JSON.parse(json) as { v: number; title: string; board: Board };
    if (!parsed?.board?.cards) return null;
    return { title: parsed.title, board: parsed.board };
  } catch {
    return null;
  }
}

/** Save the published file to disk. */
export function downloadPublished(published: Published, title: string): void {
  const a = document.createElement('a');
  a.href = published.objectUrl;
  a.download = `${title || 'talk'}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

import type { Project } from '@/core/types';
import {
  boardCss,
  cardHtml,
  cardShellStyle,
  cardTransform,
  edgesSvg,
  escapeHtml,
  SURFACES,
} from './paint';
import { normaliseBoard, stopSteps } from './board';
import {
  atmosphereHtml,
  effectDefsSvg,
  effectVars,
  effectsAreOff,
  normaliseEffects,
} from './effects';
import type { Board, BoardEffects, Card } from './types';

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
  stops: { title: string; rect: number[]; notes: string; auto: number; steps: number }[];
  cards: {
    rect: number[];
    step: number;
    action: unknown;
    note: string;
    stop: number;
    /** −1 to 1. The runtime turns this into parallax and into focus. */
    depth: number;
    /** Carried so the runtime can compose a transform without losing it. */
    rot: number;
  }[];
  /** The room, so a published talk looks like the board it was built on. */
  fx: BoardEffects;
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
  const palette = SURFACES[board.surface];
  const fx = normaliseEffects(board.effects);
  const plain = effectsAreOff(fx);
  const resolve = (src: string | null) => (src ? (assets.get(src) ?? src) : null);
  const cards = [...board.cards].sort((a, b) => a.z - b.z);

  const model: TalkModel = {
    title: project.title,
    surface: board.surface,
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
      depth: c.depth ?? 0,
      rot: c.rotation ?? 0,
    })),
    fx,
    notes: options.includeNotes,
    autoplay: options.autoplay,
  };

  const body = cards
    .map(
      (card, i) =>
        `<div class="bx-card bx-fade" data-i="${i}" data-outline="${card.outline ?? 'none'}" style="${escapeHtml(
          `${cardTransform(card)};${cardShellStyle(card, board.surface)}`,
        )}">${cardHtml(card, board.surface, resolve)}</div>`,
    )
    .join('\n');

  const vars = Object.entries({
    '--bx-ground': palette.ground,
    '--bx-ground-edge': palette.groundEdge,
    '--bx-ink': palette.ink,
    '--bx-ink-soft': palette.inkSoft,
    '--bx-ink-faint': palette.inkFaint,
    '--bx-rule': palette.rule,
    '--bx-accent': palette.accent,
    '--bx-mat': palette.mat,
    '--bx-mat-ink': palette.matInk,
    '--bx-shadow': palette.shadow,
    ...effectVars(fx, board.surface),
  })
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
<meta name="color-scheme" content="${board.surface === 'black' ? 'dark' : 'light'}" />
<title>${escapeHtml(project.title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:${palette.ground};}
:root{${vars};color-scheme:${board.surface === 'black' ? 'dark' : 'light'}}
${boardCss()}
${chromeCss()}
</style>
</head>
<body>
<div class="bx-root" id="bx-stage" data-mode="present" data-bloom="${fx.bloom > 0 ? 1 : 0}" data-reveal="${
    fx.reveal ? 1 : 0
  }">
${plain ? '' : effectDefsSvg()}
${fx.aurora > 0 ? `<div class="bx-atmos bx-atmos-back" aria-hidden="true">${atmosphereHtml(fx, 'back')}</div>` : ''}
  <div class="bx-world" id="bx-world">
${edgesSvg(board)}
${body}
  </div>
${plain ? '' : `<div class="bx-atmos bx-atmos-front" aria-hidden="true">${atmosphereHtml(fx, 'front')}</div>`}
  <div class="bx-laser" id="bx-laser" hidden></div>
  <div class="bx-black" id="bx-black" hidden></div>
  <aside class="bx-notes" id="bx-notes" hidden></aside>
  <div class="bx-bar"><i id="bx-fill"></i></div>
  <div class="bx-chrome">
    <div class="bx-group">
      <button id="bx-prev" title="Back">&lsaquo;</button>
      <button id="bx-next" title="Forward">&rsaquo;</button>
      <span class="bx-count" id="bx-count"></span>
    </div>
    <div class="bx-group">
      <button id="bx-over" title="Overview (O)">&#9638;</button>
      <button id="bx-point" title="Pointer (L)">&#9673;</button>
      ${options.includeNotes ? '<button id="bx-note" title="Notes (N)">&#8801;</button>' : ''}
      <button id="bx-full" title="Full screen (F)">&#9974;</button>
    </div>
  </div>
  <p class="bx-hint" id="bx-hint">Click, or use &larr; and &rarr;. O for the whole board.</p>
</div>
<script id="bx-talk" type="application/json">${json}</script>
<script>
${runtime()}
</script>
</body>
</html>`;
}

function chromeCss(): string {
  return `
.bx-chrome{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;
  align-items:flex-end;padding:14px 16px;gap:12px;pointer-events:none;z-index:100;
  font:400 13px/1 system-ui,-apple-system,sans-serif;opacity:0;transition:opacity 260ms}
.bx-root:hover .bx-chrome,.bx-chrome:focus-within,.bx-chrome[data-show="1"]{opacity:1}
.bx-group{display:flex;align-items:center;gap:6px;pointer-events:auto}
.bx-chrome button{width:32px;height:32px;border:none;border-radius:4px;cursor:pointer;font-size:15px;
  background:color-mix(in oklch,var(--bx-ink) 9%,transparent);color:var(--bx-ink-soft)}
.bx-chrome button:hover{background:color-mix(in oklch,var(--bx-ink) 16%,transparent);color:var(--bx-ink)}
.bx-chrome button[data-on="1"]{background:var(--bx-accent);color:var(--bx-ground)}
.bx-count{padding:0 6px;color:var(--bx-ink-faint);font-variant-numeric:tabular-nums}
.bx-bar{position:absolute;left:0;right:0;bottom:0;height:3px;z-index:96;
  background:color-mix(in oklch,var(--bx-ink) 12%,transparent)}
.bx-bar i{display:block;height:100%;width:0;background:var(--bx-accent);
  transition:width 420ms cubic-bezier(.2,.7,.2,1)}
.bx-black{position:absolute;inset:0;background:#000;z-index:99}
.bx-laser{position:absolute;width:18px;height:18px;border-radius:50%;pointer-events:none;z-index:98;
  background:radial-gradient(circle,rgba(255,64,64,.95) 0%,rgba(255,64,64,.35) 55%,transparent 70%);
  box-shadow:0 0 18px rgba(255,64,64,.7)}
.bx-notes{position:absolute;left:16px;bottom:64px;width:26rem;max-width:80vw;max-height:40vh;
  overflow:auto;padding:16px;border-radius:6px;background:var(--bx-ground-edge);color:var(--bx-ink);
  border:1px solid var(--bx-rule);white-space:pre-wrap;z-index:97;
  font:400 14px/1.6 system-ui,-apple-system,sans-serif;box-shadow:0 20px 60px var(--bx-shadow)}
.bx-hint{position:absolute;left:50%;bottom:56px;transform:translateX(-50%);margin:0;z-index:96;
  color:var(--bx-ink-faint);font:400 13px/1 system-ui,sans-serif;transition:opacity 600ms}
.bx-hint[hidden]{display:none}
.bx-card[data-act="1"]{cursor:pointer}
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
  var fill = document.getElementById('bx-fill');
  var count = document.getElementById('bx-count');
  var laser = document.getElementById('bx-laser');
  var black = document.getElementById('bx-black');
  var notesEl = document.getElementById('bx-notes');
  var hint = document.getElementById('bx-hint');
  var chrome = document.querySelector('.bx-chrome');

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var index = 0, step = 0, overview = false, pointing = false, raf = 0, timer = 0;
  var cam = { x: 0, y: 0, zoom: 1 };

  /* The room, and what it costs. A talk published with every dial at zero pays
     for none of this: the lists below come out empty and the loops never run. */
  var fx = talk.fx || {};
  var GAIN = 0.16;
  var shown = [];
  var moved = [];   /* cards whose depth makes them move with the camera */
  for (var d = 0; d < talk.cards.length; d++) {
    var depth = talk.cards[d].depth || 0;
    talk.cards[d].m = fx.parallax ? Math.max(-1, Math.min(1, depth)) * fx.parallax * GAIN : 0;
    shown.push(true);
    if (talk.cards[d].m) moved.push(d);
  }

  /* How soft a card is, in screen pixels: depth alone a little, being outside
     the point under discussion a lot. Same arithmetic as the editor's. */
  function blurOf(i, mine) {
    if (!fx.focus) return 0;
    var depth = Math.abs(Math.max(-1, Math.min(1, talk.cards[i].depth || 0)));
    return Math.min(13, (depth * 5 + (mine ? 0 : 7)) * fx.focus);
  }

  /**
   * Where a card is drawn. Rotation lives here rather than in the style
   * attribute because a transform written by hand would otherwise wipe it, and
   * a card that lost its angle the moment the talk started would be a bug
   * nobody could explain.
   */
  function place(i) {
    var model = talk.cards[i], el = cards[i], t = '';
    if (model.m) {
      var r = model.rect;
      t += 'translate(' + ((r[0] + r[2] / 2 - cam.x) * model.m).toFixed(1) + 'px,' +
        ((r[1] + r[3] / 2 - cam.y) * model.m).toFixed(1) + 'px) ';
    }
    if (!shown[i]) t += 'translateY(24px) scale(0.965) ';
    if (model.rot) t += 'rotate(' + model.rot + 'deg)';
    el.style.transform = t;
  }

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
    /* Parallax is a function of where the camera is, so it is recomputed with
       the camera and not with the slide. Only the cards that have a depth. */
    for (var i = 0; i < moved.length; i++) place(moved[i]);
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

  function render() {
    var here = talk.stops[index];
    for (var i = 0; i < cards.length; i++) {
      var model = talk.cards[i];
      var mine = overview || inStop(model.rect, here);
      var el = cards[i];
      shown[i] = overview || model.step === 0 || (mine && model.step <= step);
      el.style.opacity = shown[i] ? (mine || overview ? '1' : '0.22') : '0';
      el.style.pointerEvents = shown[i] && model.action ? 'auto' : 'none';
      el.setAttribute('data-shown', shown[i] ? '1' : '0');
      if (model.action) el.setAttribute('data-act', '1');
      /* Blur is held in world units, so it deepens as the camera pushes in —
         which is what a lens does, and costs nothing per frame to say. */
      var b = blurOf(i, mine);
      el.style.filter = b ? 'blur(' + (b / Math.max(0.02, cam.zoom)).toFixed(2) + 'px)' : '';
      place(i);
    }
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
    if (e.target.closest('.bx-chrome')) return;
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
    else if (k === 'l' || k === 'L') { togglePointer(); }
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
  function togglePointer() {
    pointing = !pointing;
    laser.hidden = !pointing;
    stage.style.cursor = pointing ? 'none' : '';
    var b = document.getElementById('bx-point');
    if (pointing) b.setAttribute('data-on', '1'); else b.removeAttribute('data-on');
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  }

  stage.addEventListener('pointermove', function (e) {
    chrome.setAttribute('data-show', '1');
    var r = stage.getBoundingClientRect();
    if (fx.spotlight) {
      stage.style.setProperty('--bx-spot-x', ((e.clientX - r.left) / r.width * 100).toFixed(2) + '%');
      stage.style.setProperty('--bx-spot-y', ((e.clientY - r.top) / r.height * 100).toFixed(2) + '%');
    }
    if (!pointing) return;
    laser.style.left = (e.clientX - r.left - 9) + 'px';
    laser.style.top = (e.clientY - r.top - 9) + 'px';
  });

  document.getElementById('bx-prev').addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
  document.getElementById('bx-next').addEventListener('click', function (e) { e.stopPropagation(); go(1); });
  document.getElementById('bx-over').addEventListener('click', function (e) { e.stopPropagation(); toggleOverview(); });
  document.getElementById('bx-point').addEventListener('click', function (e) { e.stopPropagation(); togglePointer(); });
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
  render();
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
    // A link written before a field existed still opens, as the board it was.
    return { title: parsed.title, board: normaliseBoard(parsed.board) };
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

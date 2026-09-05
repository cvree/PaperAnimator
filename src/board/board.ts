import { newId } from '@/core/id';
import type { Figure, PaperTable, SourceRef, Statistic } from '@/core/types';
import {
  GRID_UNIT,
  MAX_ZOOM,
  MIN_ZOOM,
  STOP_H,
  STOP_W,
  type Board,
  type Camera,
  type Card,
  type CardBase,
  type CardId,
  type CardKind,
  type Stop,
  type WorldPoint,
  type WorldRect,
} from './types';

/**
 * Everything the board knows how to compute without a DOM: where things are,
 * what contains what, and where the camera has to be for a region to fill the
 * screen. Kept pure so the editor, the presenter and the published page can all
 * agree — a talk that framed differently once exported would be a different talk.
 */

/* ============================================================================
   Geometry
   ========================================================================== */

export function rectCenter(r: WorldRect): WorldPoint {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectContains(outer: WorldRect, inner: WorldRect): boolean {
  const c = rectCenter(inner);
  return c.x >= outer.x && c.x <= outer.x + outer.w && c.y >= outer.y && c.y <= outer.y + outer.h;
}

export function rectHit(r: WorldRect, p: WorldPoint): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsOverlap(a: WorldRect, b: WorldRect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function unionRect(rects: WorldRect[]): WorldRect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function padRect(r: WorldRect, pad: number): WorldRect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export function snap(value: number, on: boolean, unit = GRID_UNIT / 4): number {
  return on ? Math.round(value / unit) * unit : value;
}

/* ============================================================================
   Camera
   ========================================================================== */

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function worldToScreen(p: WorldPoint, cam: Camera, vw: number, vh: number): WorldPoint {
  return { x: (p.x - cam.x) * cam.zoom + vw / 2, y: (p.y - cam.y) * cam.zoom + vh / 2 };
}

export function screenToWorld(p: WorldPoint, cam: Camera, vw: number, vh: number): WorldPoint {
  return { x: (p.x - vw / 2) / cam.zoom + cam.x, y: (p.y - vh / 2) / cam.zoom + cam.y };
}

/** The camera that puts `rect` on screen with a margin, without distorting it. */
export function cameraFor(rect: WorldRect, vw: number, vh: number, margin = 0.92): Camera {
  const c = rectCenter(rect);
  if (rect.w <= 0 || rect.h <= 0 || vw <= 0 || vh <= 0) return { x: c.x, y: c.y, zoom: 1 };
  const zoom = clampZoom(Math.min(vw / rect.w, vh / rect.h) * margin);
  return { x: c.x, y: c.y, zoom };
}

/** What the camera can currently see, in world units. */
export function viewportRect(cam: Camera, vw: number, vh: number): WorldRect {
  const w = vw / cam.zoom;
  const h = vh / cam.zoom;
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h };
}

/** Zoom about a fixed screen point, so the thing under the cursor stays there. */
export function zoomAt(cam: Camera, screen: WorldPoint, factor: number, vw: number, vh: number): Camera {
  const before = screenToWorld(screen, cam, vw, vh);
  const zoom = clampZoom(cam.zoom * factor);
  const after = screenToWorld(screen, { ...cam, zoom }, vw, vh);
  return { x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y), zoom };
}

/**
 * Prezi's one good trick: travelling between two distant places pulls back far
 * enough to see both, so the audience keeps their bearings instead of being
 * teleported. `t` is eased progress, 0 → 1.
 */
export function flyCamera(from: Camera, to: Camera, t: number): Camera {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const meanSpan = (1 / from.zoom + 1 / to.zoom) / 2;
  // How far apart the two frames are, measured in screenfuls.
  const leaps = distance / Math.max(1, meanSpan);
  const arc = Math.min(0.55, leaps * 0.22);
  const zoom = 1 / (lerp(1 / from.zoom, 1 / to.zoom, t) * (1 + arc * Math.sin(Math.PI * t)));
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), zoom: clampZoom(zoom) };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Slow in, slow out, no overshoot — the only easing a camera should ever use. */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/* ============================================================================
   Board & card construction
   ========================================================================== */

export function createBoard(): Board {
  return {
    id: newId('board'),
    surface: 'white',
    grid: 'dots',
    cards: [],
    edges: [],
    stops: [],
    stopAspect: 16 / 9,
  };
}

function base(rect: WorldRect, z: number, source: SourceRef | null = null): CardBase {
  return {
    id: newId('card'),
    rect,
    rotation: 0,
    z,
    scale: 1,
    tone: 'plain',
    locked: false,
    step: 0,
    action: null,
    note: '',
    source,
  };
}

export function topZ(board: Board): number {
  return board.cards.reduce((max, c) => Math.max(max, c.z), 0) + 1;
}

/** The default size a fresh card of each kind gets dropped at. */
export const CARD_SIZE: Record<CardKind, { w: number; h: number }> = {
  text: { w: 620, h: 160 },
  sticky: { w: 300, h: 300 },
  image: { w: 720, h: 480 },
  table: { w: 800, h: 420 },
  stat: { w: 460, h: 300 },
  shape: { w: 400, h: 260 },
  ink: { w: 200, h: 200 },
};

/**
 * Somewhere near where you asked, but not on top of what is already there.
 *
 * Dropping five things from the paper in a row should leave you with five
 * things to arrange, not one pile to dig through. The search spirals outward
 * from the point you meant, so the first free spot is still the nearest one.
 */
export function placeNear(
  board: Board,
  at: WorldPoint,
  size: { w: number; h: number },
  gap = 48,
): WorldPoint {
  const taken = board.cards.map((c) => padRect(c.rect, gap / 2));
  const fits = (p: WorldPoint) =>
    !taken.some((r) => rectsOverlap(r, { x: p.x - size.w / 2, y: p.y - size.h / 2, ...size }));
  if (fits(at)) return at;

  const stepX = size.w + gap;
  const stepY = size.h + gap;
  for (let ring = 1; ring <= 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const p = { x: at.x + dx * stepX, y: at.y + dy * stepY };
        if (fits(p)) return p;
      }
    }
  }
  return { x: at.x + Math.random() * 200, y: at.y + Math.random() * 200 };
}

export function makeCard(kind: CardKind, at: WorldPoint, z: number): Card {
  const size = CARD_SIZE[kind];
  const rect: WorldRect = { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h };
  const b = base(rect, z);
  switch (kind) {
    case 'text':
      return { ...b, kind: 'text', text: 'New text', role: 'heading', align: 'start' };
    case 'sticky':
      return { ...b, kind: 'sticky', tone: 'yellow', text: 'Note' };
    case 'image':
      return { ...b, kind: 'image', src: null, caption: null, alt: '', fit: 'contain' };
    case 'table':
      return { ...b, kind: 'table', grid: null, src: null, caption: null };
    case 'stat':
      return { ...b, kind: 'stat', value: '00', caption: null, qualifiers: [] };
    case 'shape':
      return { ...b, kind: 'shape', shape: 'rect', label: '', filled: false, tone: 'ink' };
    case 'ink':
      return { ...b, kind: 'ink', strokes: [], weight: 4 };
  }
}

export function textCard(
  text: string,
  role: 'title' | 'heading' | 'body' | 'quote' | 'label' | 'mono',
  rect: WorldRect,
  z: number,
  source: SourceRef | null = null,
): Card {
  return { ...base(rect, z, source), kind: 'text', text, role, align: 'start' };
}

export function figureCard(figure: Figure, at: WorldPoint, z: number): Card {
  const ratio = figure.quad.h > 0 ? figure.quad.w / figure.quad.h : 1.4;
  const w = CARD_SIZE.image.w;
  const h = Math.round(w / Math.max(0.4, Math.min(3, ratio || 1.4)));
  return {
    ...base({ x: at.x - w / 2, y: at.y - h / 2, w, h }, z, figure.ref),
    kind: 'image',
    src: figure.image,
    caption: figure.caption ?? figure.label,
    alt: figure.altText || figure.label,
    fit: 'contain',
  };
}

export function tableCard(table: PaperTable, at: WorldPoint, z: number): Card {
  const w = CARD_SIZE.table.w;
  const rows = table.grid?.cells.length ?? 6;
  const h = Math.min(900, Math.max(220, 60 + rows * 44));
  return {
    ...base({ x: at.x - w / 2, y: at.y - h / 2, w, h }, z, table.ref),
    kind: 'table',
    grid: table.grid,
    src: table.image,
    caption: table.caption ?? table.label,
  };
}

export function statCard(stat: Statistic, at: WorldPoint, z: number): Card {
  const { w, h } = CARD_SIZE.stat;
  return {
    ...base({ x: at.x - w / 2, y: at.y - h / 2, w, h }, z, stat.ref),
    kind: 'stat',
    tone: 'accent',
    value: stat.raw,
    caption: null,
    qualifiers: stat.qualifiers.map((q) => q.raw),
  };
}

/* ============================================================================
   Stops
   ========================================================================== */

export function makeStop(board: Board, at: WorldPoint, title?: string): Stop {
  const w = STOP_W;
  const h = Math.round(w / (board.stopAspect || 16 / 9));
  return {
    id: newId('stop'),
    title: title ?? `Stop ${board.stops.length + 1}`,
    rect: { x: at.x - w / 2, y: at.y - h / 2, w, h },
    notes: '',
    autoAdvanceMs: 0,
  };
}

/** A stop framing exactly what is selected, with room to breathe. */
export function stopAround(board: Board, rects: WorldRect[]): WorldRect {
  const union = unionRect(rects);
  const aspect = board.stopAspect || 16 / 9;
  if (!union) return { x: 0, y: 0, w: STOP_W, h: STOP_H };
  const padded = padRect(union, Math.max(union.w, union.h) * 0.12 + 40);
  // Grow, never crop: the shorter side stretches to meet the aspect.
  let w = padded.w;
  let h = padded.h;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const c = rectCenter(padded);
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

/** The cards a stop is responsible for, back to front. */
export function cardsInStop(board: Board, stop: Stop): Card[] {
  return board.cards
    .filter((c) => rectContains(stop.rect, c.rect))
    .sort((a, b) => a.z - b.z);
}

/** How many clicks a stop takes before it is finished. */
export function stopSteps(board: Board, stop: Stop): number {
  return cardsInStop(board, stop).reduce((max, c) => Math.max(max, c.step), 0);
}

/** Everything on the board, so ⌘0 can frame the lot. */
export function boardBounds(board: Board): WorldRect | null {
  return unionRect([...board.cards.map((c) => c.rect), ...board.stops.map((s) => s.rect)]);
}

export function cardById(board: Board, id: CardId): Card | undefined {
  return board.cards.find((c) => c.id === id);
}

/** Topmost card under a world point, which is what a click means. */
export function pickCard(board: Board, p: WorldPoint): Card | null {
  let hit: Card | null = null;
  for (const c of board.cards) {
    if (rectHit(c.rect, p) && (!hit || c.z > hit.z)) hit = c;
  }
  return hit;
}

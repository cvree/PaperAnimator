import type { Board, CardId, WorldRect } from './types';

/**
 * Alignment, while you are still holding the thing.
 *
 * A board where everything is nearly lined up is worse than one where nothing
 * is, because the eye reads the near-miss as a mistake rather than as a choice.
 * The fix is not a menu of alignment commands after the fact: it is that the
 * card you are dragging *tells you* when it has found an edge, and then stays
 * on it. Six lines per axis — the two outer edges and the middle, on both the
 * thing you are moving and everything you are not — is the whole vocabulary,
 * and it covers almost every arrangement anybody actually makes.
 *
 * Pure arithmetic, like the rest of the board: no DOM, no camera, no state.
 */

/** A line to draw while a drag is live. */
export interface Guide {
  axis: 'x' | 'y';
  /** Where the line sits, in world units, on its own axis. */
  at: number;
  /** How far it runs on the other axis, so it reaches both things it relates. */
  from: number;
  to: number;
}

export interface Aligned {
  dx: number;
  dy: number;
  guides: Guide[];
}

/** The three interesting values on one axis of a rectangle. */
function edgesX(r: WorldRect): number[] {
  return [r.x, r.x + r.w / 2, r.x + r.w];
}

function edgesY(r: WorldRect): number[] {
  return [r.y, r.y + r.h / 2, r.y + r.h];
}

function union(rects: WorldRect[]): WorldRect | null {
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

/**
 * Nudge a drag onto the nearest alignment it is already close to.
 *
 * `tolerance` arrives in world units — the caller divides a fixed number of
 * screen pixels by the zoom, so the guides feel the same size at every scale
 * instead of becoming impossible to hit when you pull back.
 *
 * Only rectangles near the moving one are considered, because a board is
 * unbounded and lining up with something four screens away is a coincidence,
 * not an intention.
 */
export function alignDrag(
  board: Board,
  moving: CardId[],
  dx: number,
  dy: number,
  tolerance: number,
  extra: WorldRect | null = null,
): Aligned {
  const held = board.cards.filter((c) => moving.includes(c.id)).map((c) => c.rect);
  const source = union(extra ? [...held, extra] : held);
  if (!source || tolerance <= 0) return { dx, dy, guides: [] };

  const box: WorldRect = { ...source, x: source.x + dx, y: source.y + dy };
  const reach = Math.max(box.w, box.h) * 2 + tolerance * 40;

  const targets: WorldRect[] = [];
  for (const card of board.cards) {
    if (moving.includes(card.id)) continue;
    if (near(card.rect, box, reach)) targets.push(card.rect);
  }
  for (const stop of board.stops) {
    if (near(stop.rect, box, reach)) targets.push(stop.rect);
  }
  if (!targets.length) return { dx, dy, guides: [] };

  const x = bestOn(edgesX(box), targets.map(edgesX), tolerance);
  const y = bestOn(edgesY(box), targets.map(edgesY), tolerance);

  const guides: Guide[] = [];
  const snapped: WorldRect = {
    ...box,
    x: box.x + (x?.delta ?? 0),
    y: box.y + (y?.delta ?? 0),
  };

  if (x) {
    const other = targets[x.target];
    guides.push({
      axis: 'x',
      at: x.at,
      from: Math.min(snapped.y, other.y),
      to: Math.max(snapped.y + snapped.h, other.y + other.h),
    });
  }
  if (y) {
    const other = targets[y.target];
    guides.push({
      axis: 'y',
      at: y.at,
      from: Math.min(snapped.x, other.x),
      to: Math.max(snapped.x + snapped.w, other.x + other.w),
    });
  }

  return { dx: dx + (x?.delta ?? 0), dy: dy + (y?.delta ?? 0), guides };
}

function near(a: WorldRect, b: WorldRect, reach: number): boolean {
  return (
    a.x < b.x + b.w + reach &&
    a.x + a.w > b.x - reach &&
    a.y < b.y + b.h + reach &&
    a.y + a.h > b.y - reach
  );
}

/**
 * The closest of nine pairings — three edges of the moving box against three of
 * each candidate — or nothing, if none of them is close enough to mean it.
 */
function bestOn(
  mine: number[],
  theirs: number[][],
  tolerance: number,
): { delta: number; at: number; target: number } | null {
  let best: { delta: number; at: number; target: number } | null = null;
  for (let t = 0; t < theirs.length; t++) {
    for (const line of theirs[t]) {
      for (const edge of mine) {
        const delta = line - edge;
        if (Math.abs(delta) > tolerance) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, at: line, target: t };
        }
      }
    }
  }
  return best;
}

/**
 * Is this person marking by hand?
 *
 * The reader assumes what you meant: a drag that stops a word short of the end
 * of a sentence is rounded out to the whole sentence. That assumption is a gift
 * when the gesture was a swipe and an insult when it was not — someone who
 * slowed down, backed up and let go on the exact word they wanted has already
 * said what they meant, and rounding it out throws away the only part of the
 * work that was theirs.
 *
 * The pointer says which of the two happened. A swipe is quick, straight, and
 * released while still moving; an aimed mark stops before it lets go, or pulls
 * back to fix an end, or simply takes its time. Nothing here looks at the
 * words — it is the *gesture* being read, so the same numbers mean the same
 * thing on every paper.
 */

export interface DragTrace {
  readonly kind: string;
  readonly x0: number;
  readonly y0: number;
  readonly t0: number;
  x: number;
  y: number;
  /** When the pointer last moved further than the hand's own shake. */
  still: number;
  travel: number;
  samples: { x: number; y: number; t: number }[];
}

export interface DragIntent {
  /** Total path walked, in px. */
  travel: number;
  /** Straight-line distance from where the press began to where it ended. */
  span: number;
  duration: number;
  /** How long the pointer sat still before it was released. */
  dwell: number;
  /** How far the pointer came back on itself while aiming the far end. */
  pullback: number;
  /** px per ms across the whole gesture. */
  pace: number;
  /** True when the gesture reads as aimed rather than swiped. */
  deliberate: boolean;
}

/**
 * A finger is never as still as a mouse, so it is not held to the same
 * stillness. The dwell is a fifth of a second longer than a hand takes to let
 * go of a button: stopping for that long is aiming, not lag.
 */
interface Thresholds {
  jitter: number;
  dwell: number;
  pullback: number;
}

const FINE: Thresholds = { jitter: 1.5, dwell: 240, pullback: 6 };
const COARSE: Thresholds = { jitter: 3, dwell: 320, pullback: 12 };

/** Below this, a press shook — it did not drag. */
const MIN_TRAVEL = 8;
/** A sweep this slow was being aimed, however smooth its path. */
const SLOW_MS = 550;
const SLOW_PACE = 0.5;
/** A path that walked this much further than the ground it covered was hunting. */
const WANDER = 1.8;
const WANDER_MIN = 50;
/**
 * Corrections happen at the end of a gesture. Earlier reversals are line
 * breaks — a drag down a paragraph goes right, then left and down, then right
 * again — and reading those as second thoughts would call every long mark aimed.
 */
const AIM_WINDOW = 600;
/** Enough samples to cover the aim window several times over at any input rate. */
const MAX_SAMPLES = 160;

function thresholds(kind: string): Thresholds {
  return kind === 'touch' ? COARSE : FINE;
}

export function beginTrace(x: number, y: number, t: number, kind: string): DragTrace {
  return { kind, x0: x, y0: y, t0: t, x, y, still: t, travel: 0, samples: [{ x, y, t }] };
}

export function traceMove(trace: DragTrace, x: number, y: number, t: number): void {
  const step = Math.hypot(x - trace.x, y - trace.y);
  if (step < thresholds(trace.kind).jitter) return;
  trace.x = x;
  trace.y = y;
  trace.still = t;
  trace.travel += step;
  trace.samples.push({ x, y, t });
  if (trace.samples.length > MAX_SAMPLES) trace.samples.shift();
}

export function readIntent(trace: DragTrace, now: number): DragIntent {
  const duration = Math.max(0, now - trace.t0);
  const travel = trace.travel;
  const span = Math.hypot(trace.x - trace.x0, trace.y - trace.y0);
  const dwell = Math.max(0, now - trace.still);
  const pace = duration > 0 ? travel / duration : 0;
  const pullback = againstHeading(trace.samples, now - AIM_WINDOW);
  const limit = thresholds(trace.kind);

  const deliberate =
    travel >= MIN_TRAVEL &&
    (dwell >= limit.dwell ||
      pullback >= limit.pullback ||
      (duration >= SLOW_MS && pace <= SLOW_PACE) ||
      (travel >= span * WANDER && travel >= WANDER_MIN));

  return { travel, span, duration, dwell, pullback, pace, deliberate };
}

/**
 * How far the pointer moved against where it had been going, near the end.
 *
 * Measured against a smoothed heading rather than against an axis, because a
 * mark is dragged in whatever direction the words run — down a column, across a
 * line, diagonally to a point two paragraphs away. Coming back on yourself is
 * the same act in all three.
 */
function againstHeading(samples: { x: number; y: number; t: number }[], since: number): number {
  let hx = 0;
  let hy = 0;
  let against = 0;

  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dy = samples[i].y - samples[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;

    if ((hx !== 0 || hy !== 0) && samples[i].t >= since) {
      const along = dx * hx + dy * hy;
      if (along < 0) against -= along;
    }

    const w = 0.45;
    hx = hx * (1 - w) + (dx / len) * w;
    hy = hy * (1 - w) + (dy / len) * w;
    const n = Math.hypot(hx, hy) || 1;
    hx /= n;
    hy /= n;
  }
  return against;
}

/**
 * When the reader should stop rounding marks for the rest of the session.
 *
 * Two aimed marks are a habit. One aimed mark that redoes a mark the reader has
 * just rounded is a complaint, and one complaint is enough — nobody should have
 * to make the same point twice to software.
 */
export function marksByHand(aimed: number, corrected: boolean): boolean {
  return corrected || aimed >= 2;
}

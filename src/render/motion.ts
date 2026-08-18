import type { HoldPreset, Layer, MotionPreset } from '@/core/types';

/**
 * The motion catalogue.
 *
 * Every entrance and every sustained motion in the product is defined here,
 * once, as a pure function of progress. resolveFrame calls it, so the live
 * canvas, the storyboard thumbnails, the picker's animated tiles and the
 * exported video all read the same definition. An animation therefore cannot
 * look one way while you are choosing it and another way once it is chosen.
 *
 * Units are deliberately resolution-independent:
 *   tx, ty, blur  — fractions of canvas height
 *   scale         — multiplier
 *   rotate        — degrees
 *   trackingEm    — extra letter-spacing, in em of the layer's own type
 * A reveal's per-unit offsets are in em, because a word that lifts by a fixed
 * fraction of the frame lifts too far at caption size and not far enough at
 * display size.
 */

/* ============================================================================
   What a motion produces
   ========================================================================== */

export type ResolvedMask =
  /** Fractions of the layer's own box trimmed from each side. */
  | { kind: 'inset'; top: number; right: number; bottom: number; left: number }
  /** Centre and radius as fractions of the box; r is against the half-diagonal. */
  | { kind: 'circle'; cx: number; cy: number; r: number }
  /** Fractions of the box, wound clockwise. */
  | { kind: 'poly'; points: [number, number][] };

export interface RevealUnit {
  opacity: number;
  /** em of the layer's font size. */
  tx: number;
  ty: number;
  scale: number;
  /** em, rendered as a blur radius. */
  blur: number;
  rotate: number;
}

export interface ResolvedReveal {
  unit: 'word' | 'char';
  units: RevealUnit[];
}

/** What a unit of a reveal comes *from*, in em. Progress interpolates it away. */
export interface RevealPlan {
  unit: 'word' | 'char';
  /** Share of the entrance a single unit takes, 0–1. */
  span: number;
  order: 'forward' | 'backward' | 'centre' | 'alternate' | 'scatter';
  from: { tx: number; ty: number; scale: number; blur: number; rotate: number };
  ease: EaseName;
}

export interface MotionOutput {
  /** Multiplier on the layer's own opacity. */
  opacity: number;
  tx: number;
  ty: number;
  scale: number;
  rotate: number;
  blur: number;
  trackingEm: number;
  mask: ResolvedMask | null;
  reveal: RevealPlan | null;
}

const STILL: MotionOutput = {
  opacity: 1,
  tx: 0,
  ty: 0,
  scale: 1,
  rotate: 0,
  blur: 0,
  trackingEm: 0,
  mask: null,
  reveal: null,
};

export function stillMotion(): MotionOutput {
  return { ...STILL };
}

/* ============================================================================
   Easing
   ========================================================================== */

export type EaseName = 'out' | 'expo' | 'back' | 'soft' | 'linear' | 'sine';

const EASES: Record<EaseName, (t: number) => number> = {
  /** Matches --ease-out: cubic-bezier(0.16, 1, 0.3, 1) closely enough. */
  out: (t) => 1 - Math.pow(1 - t, 3.2),
  expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -11 * t)),
  /** A little past the mark, then back — used sparingly, never on body text. */
  back: (t) => {
    const c = 1.34;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  soft: (t) => t * t * (3 - 2 * t),
  linear: (t) => t,
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
};

export function ease(name: EaseName, t: number): number {
  return EASES[name](clamp01(t));
}

/* ============================================================================
   The entrances
   ========================================================================== */

/** Which kinds of content an entrance was designed for. */
export type MotionAffinity = 'text' | 'image' | 'number' | 'any';

export interface MotionDef {
  id: MotionPreset;
  name: string;
  /** Written as what the viewer sees, not as what the code does. */
  blurb: string;
  affinity: MotionAffinity[];
  ease: EaseName;
  /** Sensible entrance length for this preset, in ms. */
  durationMs: number;
  /** What it becomes when the machine is set to reduce motion. */
  reducedMotion: 'fade' | 'none';
  /**
   * p is the eased 0–1 entrance progress, k the intensity multiplier.
   * Presets that stagger their own units read `raw` instead, and hand back a
   * plan rather than a finished transform.
   */
  resolve(p: number, k: number, raw: number): MotionOutput;
}

function out(patch: Partial<MotionOutput>): MotionOutput {
  return { ...STILL, ...patch };
}

export const MOTIONS: MotionDef[] = [
  /* ---- quiet workhorses ------------------------------------------------ */
  {
    id: 'rise',
    name: 'Rise',
    blurb: 'Lifts into place out of a soft focus.',
    affinity: ['any'],
    ease: 'out',
    durationMs: 620,
    reducedMotion: 'fade',
    resolve: (p, k) => out({ opacity: p, ty: (1 - p) * 0.028 * k, blur: (1 - p) * 0.0016 * k }),
  },
  {
    id: 'settle',
    name: 'Settle',
    blurb: 'Eases down to its final size, as if landing.',
    affinity: ['any'],
    ease: 'out',
    durationMs: 640,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({ opacity: p, scale: 1 + (1 - p) * 0.035 * k, blur: (1 - p) * 0.0016 * k }),
  },
  {
    id: 'slide',
    name: 'Slide',
    blurb: 'Comes in from the left and stops.',
    affinity: ['any'],
    ease: 'out',
    durationMs: 620,
    reducedMotion: 'fade',
    resolve: (p, k) => out({ opacity: p, tx: (1 - p) * -0.03 * k }),
  },
  {
    id: 'none',
    name: 'Cut',
    blurb: 'Simply there, from the first frame.',
    affinity: ['any'],
    ease: 'linear',
    durationMs: 1,
    reducedMotion: 'none',
    resolve: () => stillMotion(),
  },

  /* ---- word and letter work — the text presets -------------------------- */
  {
    id: 'cascade',
    name: 'Cascade',
    blurb: 'Word after word, each one lifting into the line.',
    affinity: ['text'],
    ease: 'out',
    durationMs: 1100,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          span: 0.34,
          order: 'forward',
          from: { tx: 0, ty: 0.62 * k, scale: 1, blur: 0.1 * k, rotate: 0 },
          ease: 'out',
        },
      }),
  },
  {
    id: 'typeset',
    name: 'Typeset',
    blurb: 'Letter by letter, the way type is set by hand.',
    affinity: ['text', 'number'],
    ease: 'linear',
    durationMs: 1250,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'char',
          span: 0.16,
          order: 'forward',
          from: { tx: 0, ty: 0.12 * k, scale: 0.94, blur: 0.05 * k, rotate: 0 },
          ease: 'soft',
        },
      }),
  },
  {
    id: 'scatter',
    name: 'Scatter',
    blurb: 'Words find their places from around the frame.',
    affinity: ['text'],
    ease: 'out',
    durationMs: 1300,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          span: 0.46,
          order: 'scatter',
          from: { tx: 1.1 * k, ty: 0.9 * k, scale: 0.86, blur: 0.14 * k, rotate: 7 * k },
          ease: 'out',
        },
      }),
  },
  {
    id: 'tumble',
    name: 'Tumble',
    blurb: 'Words drop in from above, alternating side to side.',
    affinity: ['text'],
    ease: 'back',
    durationMs: 1150,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          span: 0.38,
          order: 'alternate',
          from: { tx: 0.5 * k, ty: -0.8 * k, scale: 0.9, blur: 0.08 * k, rotate: -5 * k },
          ease: 'back',
        },
      }),
  },
  {
    id: 'weigh-in',
    name: 'Open out',
    blurb: 'Letters start tight and open out to their set width.',
    affinity: ['text', 'number'],
    ease: 'out',
    durationMs: 900,
    reducedMotion: 'fade',
    // The tracking opens *towards* the composed width and never past it. Going
    // the other way — wide, then closing — can push a line one word over the
    // measure mid-entrance, and a headline that re-wraps as it arrives looks
    // like a fault rather than a flourish.
    resolve: (p, k) => out({ opacity: p, trackingEm: -(1 - p) * 0.11 * k, blur: (1 - p) * 0.001 * k }),
  },

  /* ---- whole-block entrances ------------------------------------------- */
  {
    id: 'focus-pull',
    name: 'Focus pull',
    blurb: 'Out of focus, then sharp — the lens finding it.',
    affinity: ['any'],
    ease: 'out',
    durationMs: 900,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({ opacity: clamp01(p * 1.5), blur: (1 - p) * 0.012 * k, scale: 1 + (1 - p) * 0.05 * k }),
  },
  {
    id: 'ink-bleed',
    name: 'Ink bleed',
    blurb: 'Blooms onto the page heavy and blurred, then crisps.',
    affinity: ['text', 'number'],
    ease: 'out',
    durationMs: 1000,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: clamp01(p * 1.8),
        blur: (1 - p) * 0.009 * k,
        scale: 1 - (1 - p) * 0.02 * k,
        trackingEm: (1 - p) * -0.05 * k,
      }),
  },
  {
    id: 'sweep',
    name: 'Sweep',
    blurb: 'A hand passes across and leaves it behind, word by word.',
    affinity: ['text', 'any'],
    ease: 'out',
    durationMs: 1000,
    reducedMotion: 'none',
    resolve: (p, k) =>
      out({
        mask: { kind: 'inset', top: 0, right: 1 - clamp01(p * 1.08), bottom: 0, left: 0 },
        reveal: {
          unit: 'word',
          span: 0.22,
          order: 'forward',
          from: { tx: -0.28 * k, ty: 0, scale: 1, blur: 0, rotate: 0 },
          ease: 'out',
        },
      }),
  },
  {
    id: 'push',
    name: 'Push',
    blurb: 'Enters from the edge with weight behind it.',
    affinity: ['any', 'image'],
    ease: 'expo',
    durationMs: 780,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({ opacity: clamp01(p * 2), tx: (1 - p) * 0.09 * k, scale: 1 - (1 - p) * 0.03 * k }),
  },
  {
    id: 'draw-on',
    name: 'Draw on',
    blurb: 'Drawn across from left to right, like a ruled line.',
    affinity: ['any'],
    ease: 'out',
    durationMs: 520,
    reducedMotion: 'none',
    resolve: (p) => out({ mask: { kind: 'inset', top: 0, right: 1 - p, bottom: 0, left: 0 } }),
  },
  {
    id: 'trace',
    name: 'Trace',
    blurb: 'Uncovered left to right as it fades up.',
    affinity: ['any'],
    ease: 'out',
    durationMs: 620,
    reducedMotion: 'none',
    resolve: (p) =>
      out({
        opacity: clamp01(p * 3),
        mask: { kind: 'inset', top: 0, right: 1 - p, bottom: 0, left: 0 },
      }),
  },
  {
    id: 'unfold',
    name: 'Unfold',
    blurb: 'Opens downward from its top edge.',
    affinity: ['any', 'image'],
    ease: 'out',
    durationMs: 760,
    reducedMotion: 'fade',
    resolve: (p) =>
      out({ opacity: p, mask: { kind: 'inset', top: 0, right: 0, bottom: 1 - p, left: 0 } }),
  },

  /* ---- masked entrances, at their best on figures ----------------------- */
  {
    id: 'crop-in',
    name: 'Crop in',
    blurb: 'The crop opens outward from the middle of the picture.',
    affinity: ['image', 'any'],
    ease: 'out',
    durationMs: 780,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: clamp01(p * 1.6),
        scale: 1 + (1 - p) * 0.02 * k,
        mask: {
          kind: 'inset',
          top: (1 - p) * 0.14 * k,
          right: (1 - p) * 0.14 * k,
          bottom: (1 - p) * 0.14 * k,
          left: (1 - p) * 0.14 * k,
        },
      }),
  },
  {
    id: 'iris',
    name: 'Iris',
    blurb: 'Opens from the centre outward, like a shutter.',
    affinity: ['image', 'any'],
    ease: 'out',
    durationMs: 900,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: clamp01(p * 2.4),
        scale: 1 + (1 - p) * 0.04 * k,
        mask: { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.08 + p * 0.96 },
      }),
  },
  {
    id: 'wipe',
    name: 'Wipe',
    blurb: 'A diagonal edge travels across and uncovers it.',
    affinity: ['image', 'any'],
    ease: 'out',
    durationMs: 820,
    reducedMotion: 'none',
    resolve: (p) => out({ mask: diagonalWipe(p) }),
  },
  {
    id: 'shutter',
    name: 'Shutter',
    blurb: 'Opens from the middle, top and bottom together.',
    affinity: ['image', 'any'],
    ease: 'expo',
    durationMs: 760,
    reducedMotion: 'fade',
    resolve: (p) =>
      out({
        opacity: clamp01(p * 3),
        mask: {
          kind: 'inset',
          top: (1 - p) * 0.5,
          right: 0,
          bottom: (1 - p) * 0.5,
          left: 0,
        },
      }),
  },
  {
    id: 'develop',
    name: 'Develop',
    blurb: 'Resolves out of a blur, the way a print comes up.',
    affinity: ['image'],
    ease: 'soft',
    durationMs: 1200,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: clamp01(p * 1.35),
        blur: Math.pow(1 - p, 1.7) * 0.028 * k,
        scale: 1 + (1 - p) * 0.045 * k,
      }),
  },
];

export const MOTION_BY_ID = new Map<MotionPreset, MotionDef>(MOTIONS.map((m) => [m.id, m]));

export function motionDef(id: MotionPreset): MotionDef {
  return MOTION_BY_ID.get(id) ?? MOTION_BY_ID.get('rise')!;
}

/** The diagonal edge of a wipe, as a polygon over the layer's box. */
function diagonalWipe(p: number): ResolvedMask {
  // The edge is a line of slope 1 sweeping from off the left to off the right,
  // so the corner it uncovers last is the opposite one to the corner it started.
  const a = p * 2; // where the edge meets the top edge, in box widths
  const b = a - 1; // where it meets the bottom edge
  return {
    kind: 'poly',
    points: [
      [-0.02, -0.02],
      [Math.min(1.02, a), -0.02],
      [Math.min(1.02, b), 1.02],
      [-0.02, 1.02],
    ],
  };
}

/* ============================================================================
   Sustained motion
   ========================================================================== */

export interface HoldDef {
  id: HoldPreset;
  name: string;
  blurb: string;
  /**
   * True when the motion belongs to the picture rather than the frame: on a
   * figure the frame holds still and the image moves inside it, which is what
   * makes a slow zoom read as cinematography instead of as a wobble.
   */
  prefersImage: boolean;
  /** cycle is 0–1 over the layer's whole time on screen. */
  resolve(cycle: number, k: number): { tx: number; ty: number; scale: number; rotate: number };
}

export const HOLDS: HoldDef[] = [
  {
    id: 'none',
    name: 'Hold still',
    blurb: 'Nothing moves once it has arrived.',
    prefersImage: false,
    resolve: () => ({ tx: 0, ty: 0, scale: 1, rotate: 0 }),
  },
  {
    id: 'ken-burns',
    name: 'Slow zoom',
    blurb: 'Creeps in and across for as long as it is on screen.',
    prefersImage: true,
    resolve: (c, k) => ({
      tx: (c - 0.5) * 0.05 * k,
      ty: (c - 0.5) * -0.035 * k,
      scale: 1.045 + c * 0.075 * k,
      rotate: 0,
    }),
  },
  {
    id: 'drift',
    name: 'Drift',
    blurb: 'Travels gently sideways, never settling.',
    prefersImage: true,
    resolve: (c, k) => ({ tx: (c - 0.5) * 0.06 * k, ty: 0, scale: 1.05, rotate: 0 }),
  },
  {
    id: 'breathe',
    name: 'Breathe',
    blurb: 'Swells and relaxes, slowly, like something alive.',
    prefersImage: false,
    resolve: (c, k) => ({
      tx: 0,
      ty: 0,
      scale: 1 + Math.sin(c * Math.PI * 2) * 0.012 * k,
      rotate: 0,
    }),
  },
  {
    id: 'float',
    name: 'Float',
    blurb: 'Rides up and down on a long, quiet swell.',
    prefersImage: false,
    resolve: (c, k) => ({
      tx: 0,
      ty: Math.sin(c * Math.PI * 2) * 0.008 * k,
      scale: 1,
      rotate: 0,
    }),
  },
  {
    id: 'sway',
    name: 'Sway',
    blurb: 'Tips a degree one way and back again.',
    prefersImage: false,
    resolve: (c, k) => ({
      tx: 0,
      ty: 0,
      scale: 1,
      rotate: Math.sin(c * Math.PI * 2) * 0.8 * k,
    }),
  },
];

export const HOLD_BY_ID = new Map<HoldPreset, HoldDef>(HOLDS.map((h) => [h.id, h]));

export function holdDef(id: HoldPreset): HoldDef {
  return HOLD_BY_ID.get(id) ?? HOLD_BY_ID.get('none')!;
}

/* ============================================================================
   Reveals
   ========================================================================== */

/**
 * Expand a plan into one entry per word or letter. Order decides which unit
 * starts when; `scatter` uses a hash of the index rather than a random number,
 * so the same text scatters the same way in the editor and in the export.
 */
export function expandReveal(plan: RevealPlan, count: number, raw: number): ResolvedReveal {
  const units: RevealUnit[] = new Array(count);
  const span = Math.max(0.02, Math.min(1, plan.span));
  const lead = 1 - span;

  for (let i = 0; i < count; i++) {
    const slot = orderSlot(plan.order, i, count);
    const start = lead * slot;
    const up = ease(plan.ease, (raw - start) / span);
    const away = 1 - up;
    const jitter = plan.order === 'scatter' ? hash(i) : 1;
    const side = plan.order === 'alternate' ? (i % 2 === 0 ? 1 : -1) : 1;

    units[i] = {
      opacity: clamp01(up * 1.4),
      tx: away * plan.from.tx * side * (plan.order === 'scatter' ? jitter * 2 - 1 : 1),
      ty: away * plan.from.ty * (plan.order === 'scatter' ? (hash(i + 91) * 2 - 1) * 1.2 : 1),
      scale: 1 + away * (plan.from.scale - 1),
      blur: away * plan.from.blur,
      rotate: away * plan.from.rotate * (plan.order === 'scatter' ? jitter * 2 - 1 : side),
    };
  }

  return { unit: plan.unit, units };
}

function orderSlot(order: RevealPlan['order'], i: number, count: number): number {
  if (count <= 1) return 0;
  const t = i / (count - 1);
  switch (order) {
    case 'backward':
      return 1 - t;
    case 'centre':
      return Math.abs(t - 0.5) * 2;
    case 'scatter':
      return hash(i + 17);
    case 'alternate':
    case 'forward':
    default:
      return t;
  }
}

/** Deterministic 0–1 from an integer. Same everywhere, every time. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 43.7) * 43758.5453;
  return x - Math.floor(x);
}

/** A layer settled: every unit fully arrived. Used past the end of a reveal. */
export function settledReveal(unit: 'word' | 'char', count: number): ResolvedReveal {
  return {
    unit,
    units: new Array(count).fill(null).map(() => ({
      opacity: 1,
      tx: 0,
      ty: 0,
      scale: 1,
      blur: 0,
      rotate: 0,
    })),
  };
}

/* ============================================================================
   Choosing for a layer
   ========================================================================== */

export function affinityOf(layer: Layer): MotionAffinity {
  switch (layer.type) {
    case 'text':
    case 'quote':
    case 'citation':
      return 'text';
    case 'figure':
    case 'table':
      return 'image';
    case 'stat':
      return 'number';
    default:
      return 'any';
  }
}

/** The presets worth offering for a layer, best first. */
export function motionsFor(affinity: MotionAffinity): MotionDef[] {
  const primary = MOTIONS.filter((m) => m.affinity[0] === affinity);
  const secondary = MOTIONS.filter((m) => m.affinity[0] !== affinity && m.affinity.includes(affinity));
  const general = MOTIONS.filter((m) => !m.affinity.includes(affinity) && m.affinity.includes('any'));
  return [...primary, ...secondary, ...general];
}

/** Text-only presets do nothing legible on a picture; say so rather than hide it. */
export function unsuitedReason(def: MotionDef, affinity: MotionAffinity): string | null {
  if (def.affinity.includes(affinity) || def.affinity.includes('any')) return null;
  if (def.affinity.includes('text')) return 'Needs words to work on';
  if (def.affinity.includes('image')) return 'Meant for pictures';
  return null;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

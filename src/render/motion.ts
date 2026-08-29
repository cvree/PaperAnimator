import type { HoldPreset, Layer, MotionPreset, Scene } from '@/core/types';

/**
 * The motion catalogue.
 *
 * Every entrance, every sustained motion and every scene transition in the
 * product is defined here, once, as a pure function of progress. resolveFrame
 * calls it, so the live canvas, the storyboard thumbnails, the picker's animated
 * tiles and the exported video all read the same definition. An animation
 * therefore cannot look one way while you are choosing it and another way once
 * it is chosen.
 *
 * Units are deliberately resolution-independent:
 *   tx, ty, blur  — fractions of canvas height
 *   scale         — multiplier
 *   rotate        — degrees
 *   trackingEm    — extra letter-spacing, in em of the layer's own type
 * A reveal's per-unit offsets are in em, because a word that lifts by a fixed
 * fraction of the frame lifts too far at caption size and not far enough at
 * display size.
 *
 * The house rules, which every preset below obeys:
 *
 *   1. Nothing travels far. Entrances move a few percent of the frame; the
 *      motion is there to give the eye an order to read in, not to be watched.
 *   2. Everything decelerates. Content arrives on a curve that is fast at the
 *      start and slow at the finish, so it looks placed rather than thrown.
 *   3. Blur is a garnish. It is capped hard, because blurred type at 30fps
 *      reads as a rendering fault, and it costs more than it gives.
 *   4. Nothing overshoots except by a hair, and never on body text.
 *   5. Staggers are measured in milliseconds, not in fractions of a duration,
 *      and they are capped — so a forty-word paragraph and a four-word headline
 *      both arrive at a pace a person can read.
 */

/* ============================================================================
   Easing — real cubic-béziers, the same curves the interface itself uses
   ========================================================================== */

export type EaseName =
  /** The house deceleration. Matches --ease-out exactly. */
  | 'out'
  /** Firmer, for weight: matches --ease-lift. */
  | 'lift'
  /** Long tail — things that glide to rest. */
  | 'expo'
  /** Symmetrical, for anything that both starts and stops on screen. */
  | 'inOut'
  /** Gentle S, for slow whole-frame moves. */
  | 'soft'
  /** A hair past the mark, then back. Matches --ease-settle. */
  | 'settle'
  | 'sine'
  | 'linear';

/**
 * A cubic-bézier solver, so a curve written as CSS and the same curve resolved
 * on the canvas are the identical function rather than two approximations of
 * one. Newton–Raphson with a bisection fallback: fast, and it cannot diverge.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      t -= err / d;
    }

    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v > x) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

const EASES: Record<EaseName, (t: number) => number> = {
  out: cubicBezier(0.16, 1, 0.3, 1), // --ease-out
  lift: cubicBezier(0.22, 0.61, 0.36, 1), // --ease-lift
  expo: cubicBezier(0.19, 1, 0.22, 1),
  inOut: cubicBezier(0.65, 0, 0.35, 1), // --ease-in-out
  soft: cubicBezier(0.4, 0, 0.2, 1),
  settle: cubicBezier(0.34, 1.26, 0.64, 1), // --ease-settle
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  linear: (t) => t,
};

export function ease(name: EaseName, t: number): number {
  return (EASES[name] ?? EASES.out)(clamp01(t));
}

/**
 * Opacity should be finished well before the movement is.
 *
 * A layer that is still 30% transparent while it has all but stopped moving
 * looks unresolved; the professional shape is for it to become fully opaque in
 * the first half of the entrance and spend the rest of the time settling.
 */
function fade(p: number, over = 0.55): number {
  return clamp01(p / over);
}

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
  /**
   * The gap between one unit starting and the next, in milliseconds. Time, not
   * a fraction of the entrance: a stagger a person can read is a fact about
   * reading, not about how long this particular entrance happens to be.
   */
  stepMs: number;
  /**
   * However many units there are, the whole stagger never spans longer than
   * this. Past the cap the units simply crowd closer together, which is what
   * keeps a long paragraph from taking eight seconds to arrive.
   */
  maxSpreadMs: number;
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

/**
 * The hard ceiling on entrance blur, as a fraction of canvas height.
 *
 * Roughly three pixels at 1080p. Past that, type stops being type: it smears
 * across the frame, it costs a full-frame filter pass on every rasterised
 * frame of the export, and on a slow machine it is the first thing to drop.
 * Every preset below is written to sit under this; the clamp is the guarantee.
 */
const MAX_BLUR = 0.0028;

function out(patch: Partial<MotionOutput>): MotionOutput {
  const o = { ...STILL, ...patch };
  o.opacity = clamp01(o.opacity);
  o.blur = Math.min(MAX_BLUR, Math.max(0, o.blur));
  return o;
}

/* ============================================================================
   The entrances
   ========================================================================== */

/** Which kinds of content an entrance was designed for. */
export type MotionAffinity = 'text' | 'image' | 'number' | 'any';

/**
 * How the catalogue is shelved.
 *
 * `core` is the short list that is right almost always and wrong almost never;
 * it leads the gallery so that the fastest choice is also the safest one.
 * `accent` is where the louder moves live, behind a heading that says so.
 */
export type MotionGroup = 'core' | 'text' | 'figure' | 'accent';

export const GROUP_LABEL: Record<MotionGroup, { title: string; hint: string }> = {
  core: { title: 'Essentials', hint: 'Quiet, fast, right nearly always.' },
  text: { title: 'Word and letter', hint: 'The line arrives a piece at a time.' },
  figure: { title: 'Pictures and tables', hint: 'Reveals that suit an image.' },
  accent: { title: 'Accents', hint: 'Louder. Worth one moment in a talk, not ten.' },
};

export interface MotionDef {
  id: MotionPreset;
  name: string;
  /** Written as what the viewer sees, not as what the code does. */
  blurb: string;
  affinity: MotionAffinity[];
  group: MotionGroup;
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

/**
 * Durations come off one scale rather than being invented per preset.
 *
 * A deck whose entrances last 620ms, 780ms, 900ms and 1250ms has no rhythm;
 * one built from a handful of related lengths does, and the difference is
 * most of what separates a professional edit from a competent one.
 */
const T = {
  snap: 320,
  quick: 420,
  base: 560,
  easy: 700,
  long: 900,
  reveal: 1000,
} as const;

export const MOTIONS: MotionDef[] = [
  /* ---- the short list -------------------------------------------------- */
  {
    id: 'rise',
    name: 'Rise',
    blurb: 'Lifts a little into place as it fades up.',
    affinity: ['any'],
    group: 'core',
    ease: 'out',
    durationMs: T.base,
    reducedMotion: 'fade',
    resolve: (p, k) => out({ opacity: fade(p), ty: (1 - p) * 0.022 * k }),
  },
  {
    id: 'settle',
    name: 'Settle',
    blurb: 'Eases down to its final size, as if landing.',
    affinity: ['any'],
    group: 'core',
    ease: 'out',
    durationMs: T.base,
    reducedMotion: 'fade',
    resolve: (p, k) => out({ opacity: fade(p), scale: 1 + (1 - p) * 0.024 * k }),
  },
  {
    id: 'slide',
    name: 'Slide',
    blurb: 'Comes in from the left and stops.',
    affinity: ['any'],
    group: 'core',
    ease: 'out',
    durationMs: T.base,
    reducedMotion: 'fade',
    resolve: (p, k) => out({ opacity: fade(p), tx: (1 - p) * -0.024 * k }),
  },
  {
    id: 'focus-pull',
    name: 'Focus pull',
    blurb: 'Out of focus, then sharp — the lens finding it.',
    affinity: ['any'],
    group: 'core',
    ease: 'out',
    durationMs: T.easy,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({ opacity: fade(p, 0.4), blur: (1 - p) * 0.0026 * k, scale: 1 + (1 - p) * 0.022 * k }),
  },
  {
    id: 'none',
    name: 'Cut',
    blurb: 'Simply there, from the first frame.',
    affinity: ['any'],
    group: 'core',
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
    group: 'text',
    ease: 'linear',
    durationMs: T.reveal,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          stepMs: 46,
          maxSpreadMs: 620,
          order: 'forward',
          from: { tx: 0, ty: 0.42 * k, scale: 1, blur: 0.06 * k, rotate: 0 },
          ease: 'out',
        },
      }),
  },
  {
    id: 'typeset',
    name: 'Typeset',
    blurb: 'Letter by letter, the way type is set by hand.',
    affinity: ['text', 'number'],
    group: 'text',
    ease: 'linear',
    durationMs: T.reveal,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'char',
          stepMs: 15,
          maxSpreadMs: 700,
          order: 'forward',
          from: { tx: 0, ty: 0.08 * k, scale: 0.96, blur: 0.03 * k, rotate: 0 },
          ease: 'soft',
        },
      }),
  },
  {
    id: 'sweep',
    name: 'Sweep',
    blurb: 'A hand passes across and leaves the words behind it.',
    affinity: ['text', 'any'],
    group: 'text',
    ease: 'linear',
    durationMs: T.long,
    reducedMotion: 'none',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          stepMs: 34,
          maxSpreadMs: 520,
          order: 'forward',
          from: { tx: -0.2 * k, ty: 0, scale: 1, blur: 0, rotate: 0 },
          ease: 'out',
        },
      }),
  },
  {
    id: 'weigh-in',
    name: 'Open out',
    blurb: 'Letters start tight and open out to their set width.',
    affinity: ['text', 'number'],
    group: 'text',
    ease: 'out',
    durationMs: T.easy,
    reducedMotion: 'fade',
    // The tracking opens *towards* the composed width and never past it. Going
    // the other way — wide, then closing — can push a line one word over the
    // measure mid-entrance, and a headline that re-wraps as it arrives looks
    // like a fault rather than a flourish.
    resolve: (p, k) => out({ opacity: fade(p), trackingEm: -(1 - p) * 0.07 * k }),
  },
  {
    id: 'ink-bleed',
    name: 'Ink bleed',
    blurb: 'Blooms onto the page soft, then crisps.',
    affinity: ['text', 'number'],
    group: 'text',
    ease: 'out',
    durationMs: T.easy,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: fade(p, 0.35),
        blur: (1 - p) * 0.0022 * k,
        trackingEm: (1 - p) * -0.03 * k,
      }),
  },

  /* ---- pictures and tables --------------------------------------------- */
  {
    id: 'crop-in',
    name: 'Crop in',
    blurb: 'The crop opens outward from the middle of the picture.',
    affinity: ['image', 'any'],
    group: 'figure',
    ease: 'out',
    durationMs: T.easy,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: fade(p, 0.3),
        scale: 1 + (1 - p) * 0.016 * k,
        mask: {
          kind: 'inset',
          top: (1 - p) * 0.1 * k,
          right: (1 - p) * 0.1 * k,
          bottom: (1 - p) * 0.1 * k,
          left: (1 - p) * 0.1 * k,
        },
      }),
  },
  {
    id: 'unfold',
    name: 'Unfold',
    blurb: 'Opens downward from its top edge.',
    affinity: ['any', 'image'],
    group: 'figure',
    ease: 'out',
    durationMs: T.easy,
    reducedMotion: 'fade',
    resolve: (p) =>
      out({ opacity: fade(p, 0.25), mask: { kind: 'inset', top: 0, right: 0, bottom: 1 - p, left: 0 } }),
  },
  {
    id: 'shutter',
    name: 'Shutter',
    blurb: 'Opens from the middle, top and bottom together.',
    affinity: ['image', 'any'],
    group: 'figure',
    ease: 'expo',
    durationMs: T.easy,
    reducedMotion: 'fade',
    resolve: (p) =>
      out({
        opacity: fade(p, 0.25),
        mask: { kind: 'inset', top: (1 - p) * 0.5, right: 0, bottom: (1 - p) * 0.5, left: 0 },
      }),
  },
  {
    id: 'develop',
    name: 'Develop',
    blurb: 'Resolves out of a blur, the way a print comes up.',
    affinity: ['image'],
    group: 'figure',
    ease: 'soft',
    durationMs: T.long,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: fade(p, 0.45),
        blur: Math.pow(1 - p, 1.6) * 0.0028 * k,
        scale: 1 + (1 - p) * 0.03 * k,
      }),
  },
  {
    id: 'draw-on',
    name: 'Draw on',
    blurb: 'Drawn across from left to right, like a ruled line.',
    affinity: ['any'],
    group: 'figure',
    ease: 'out',
    durationMs: T.quick,
    reducedMotion: 'none',
    resolve: (p) => out({ mask: { kind: 'inset', top: 0, right: 1 - p, bottom: 0, left: 0 } }),
  },
  {
    id: 'trace',
    name: 'Trace',
    blurb: 'Uncovered left to right as it fades up.',
    affinity: ['any'],
    group: 'figure',
    ease: 'out',
    durationMs: T.base,
    reducedMotion: 'none',
    resolve: (p) =>
      out({
        opacity: fade(p, 0.3),
        mask: { kind: 'inset', top: 0, right: 1 - p, bottom: 0, left: 0 },
      }),
  },

  /* ---- accents: louder, and shelved as such ----------------------------- */
  {
    id: 'push',
    name: 'Push',
    blurb: 'Enters from the edge with weight behind it.',
    affinity: ['any', 'image'],
    group: 'accent',
    ease: 'expo',
    durationMs: T.easy,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({ opacity: fade(p, 0.3), tx: (1 - p) * 0.06 * k, scale: 1 - (1 - p) * 0.02 * k }),
  },
  {
    id: 'iris',
    name: 'Iris',
    blurb: 'Opens from the centre outward, like a shutter.',
    affinity: ['image', 'any'],
    group: 'accent',
    ease: 'out',
    durationMs: T.long,
    reducedMotion: 'fade',
    resolve: (p, k) =>
      out({
        opacity: fade(p, 0.25),
        scale: 1 + (1 - p) * 0.026 * k,
        mask: { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.08 + p * 0.96 },
      }),
  },
  {
    id: 'wipe',
    name: 'Wipe',
    blurb: 'A diagonal edge travels across and uncovers it.',
    affinity: ['image', 'any'],
    group: 'accent',
    ease: 'out',
    durationMs: T.easy,
    reducedMotion: 'none',
    resolve: (p) => out({ mask: diagonalWipe(p) }),
  },
  {
    id: 'tumble',
    name: 'Tumble',
    blurb: 'Words drop in from above, alternating side to side.',
    affinity: ['text'],
    group: 'accent',
    ease: 'linear',
    durationMs: T.reveal,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          stepMs: 52,
          maxSpreadMs: 620,
          order: 'alternate',
          from: { tx: 0.22 * k, ty: -0.5 * k, scale: 0.94, blur: 0.04 * k, rotate: -2.2 * k },
          ease: 'settle',
        },
      }),
  },
  {
    id: 'scatter',
    name: 'Scatter',
    blurb: 'Words find their places from around the frame.',
    affinity: ['text'],
    group: 'accent',
    ease: 'linear',
    durationMs: T.reveal,
    reducedMotion: 'fade',
    resolve: (_p, k) =>
      out({
        reveal: {
          unit: 'word',
          stepMs: 40,
          maxSpreadMs: 700,
          order: 'scatter',
          from: { tx: 0.5 * k, ty: 0.42 * k, scale: 0.9, blur: 0.06 * k, rotate: 3 * k },
          ease: 'out',
        },
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

/**
 * Sustained motion is the easiest thing in the product to overdo, so the
 * amounts here are deliberately below the threshold at which a viewer can
 * name what is happening. They should feel the frame is alive and be unable
 * to point at the movement.
 */
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
    resolve: (c, k) => {
      // Linear in time. An eased slow zoom accelerates visibly in the middle,
      // which is the one thing a slow zoom must never do.
      const t = clamp01(c);
      return {
        tx: (t - 0.5) * 0.03 * k,
        ty: (t - 0.5) * -0.02 * k,
        scale: 1.03 + t * 0.05 * k,
        rotate: 0,
      };
    },
  },
  {
    id: 'drift',
    name: 'Drift',
    blurb: 'Travels gently sideways, never settling.',
    prefersImage: true,
    resolve: (c, k) => ({ tx: (clamp01(c) - 0.5) * 0.04 * k, ty: 0, scale: 1.035, rotate: 0 }),
  },
  {
    id: 'breathe',
    name: 'Breathe',
    blurb: 'Swells and relaxes, slowly, like something alive.',
    prefersImage: false,
    resolve: (c, k) => ({
      tx: 0,
      ty: 0,
      // Starts and ends at rest, so the layer neither pops on nor pops off.
      scale: 1 + (1 - Math.cos(c * Math.PI * 2)) * 0.005 * k,
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
      ty: -(1 - Math.cos(c * Math.PI * 2)) * 0.004 * k,
      scale: 1,
      rotate: 0,
    }),
  },
  {
    id: 'sway',
    name: 'Sway',
    blurb: 'Tips a fraction of a degree one way and back again.',
    prefersImage: false,
    resolve: (c, k) => ({
      tx: 0,
      ty: 0,
      scale: 1,
      rotate: (1 - Math.cos(c * Math.PI * 2)) * 0.22 * k,
    }),
  },
];

export const HOLD_BY_ID = new Map<HoldPreset, HoldDef>(HOLDS.map((h) => [h.id, h]));

export function holdDef(id: HoldPreset): HoldDef {
  return HOLD_BY_ID.get(id) ?? HOLD_BY_ID.get('none')!;
}

/* ============================================================================
   Scene transitions
   ========================================================================== */

/**
 * Where one scene meets the next.
 *
 * A pose is applied to a whole scene, so its offsets are fractions of the
 * frame's own width and height rather than of the layer box — a push that
 * travelled a fraction of the *height* would fall short on a widescreen frame
 * and overshoot on a vertical one.
 */
export interface ScenePose {
  opacity: number;
  tx: number;
  ty: number;
  scale: number;
}

export const SCENE_AT_REST: ScenePose = { opacity: 1, tx: 0, ty: 0, scale: 1 };

export type TransitionKind = Scene['transitionIn'];

export interface TransitionDef {
  id: TransitionKind;
  name: string;
  blurb: string;
  durationMs: number;
  /** p is raw 0–1 across the transition; each definition eases what it needs. */
  resolve(p: number): { from: ScenePose; to: ScenePose };
}

/**
 * Cross-fades are timed against a mid-point, not against each other.
 *
 * Fading one scene out over the same window the next fades in dips the whole
 * frame towards the ground colour in the middle — the "muddy middle" that
 * makes an amateur cut visible. The outgoing scene therefore leaves in the
 * first two-thirds and the incoming arrives over the last two-thirds, so the
 * frame is always carrying something.
 */
function crossFade(p: number): { outAlpha: number; inAlpha: number } {
  return {
    outAlpha: 1 - clamp01(p / 0.66),
    inAlpha: clamp01((p - 0.34) / 0.66),
  };
}

export const TRANSITIONS: TransitionDef[] = [
  {
    id: 'cut',
    name: 'Cut',
    blurb: 'Straight to the next scene.',
    durationMs: 0,
    resolve: () => ({ from: { ...SCENE_AT_REST, opacity: 0 }, to: { ...SCENE_AT_REST } }),
  },
  {
    id: 'dissolve',
    name: 'Dissolve',
    blurb: 'One scene fades through into the next.',
    durationMs: 420,
    resolve: (p) => {
      const e = ease('inOut', p);
      const { outAlpha, inAlpha } = crossFade(e);
      return {
        from: { opacity: outAlpha, tx: 0, ty: 0, scale: 1 },
        to: { opacity: inAlpha, tx: 0, ty: 0, scale: 1 },
      };
    },
  },
  {
    id: 'crop',
    name: 'Push in',
    blurb: 'The frame steps forward onto the next scene.',
    durationMs: 520,
    resolve: (p) => {
      const e = ease('out', p);
      const { outAlpha, inAlpha } = crossFade(e);
      return {
        from: { opacity: outAlpha, tx: 0, ty: 0, scale: 1 + e * 0.05 },
        to: { opacity: inAlpha, tx: 0, ty: 0, scale: 1.05 - e * 0.05 },
      };
    },
  },
  {
    id: 'turn',
    name: 'Turn',
    blurb: 'The page is turned: out to the left, in from the right.',
    durationMs: 560,
    resolve: (p) => {
      const e = ease('expo', p);
      return {
        // Opaque the whole way. A slide that also fades reads as two effects
        // fighting; a page that is turned simply leaves.
        from: { opacity: 1, tx: -e * 0.18, ty: 0, scale: 1 - e * 0.015 },
        to: { opacity: 1, tx: (1 - e) * 0.26, ty: 0, scale: 1 },
      };
    },
  },
  {
    id: 'recompose',
    name: 'Recompose',
    blurb: 'The old scene sinks away as the new one lifts in.',
    durationMs: 520,
    resolve: (p) => {
      const e = ease('out', p);
      const { outAlpha, inAlpha } = crossFade(e);
      return {
        from: { opacity: outAlpha, tx: 0, ty: e * 0.03, scale: 1 - e * 0.02 },
        to: { opacity: inAlpha, tx: 0, ty: (1 - e) * 0.035, scale: 1 },
      };
    },
  },
];

export const TRANSITION_BY_ID = new Map<TransitionKind, TransitionDef>(
  TRANSITIONS.map((t) => [t.id, t]),
);

export function transitionDef(id: TransitionKind): TransitionDef {
  return TRANSITION_BY_ID.get(id) ?? TRANSITION_BY_ID.get('dissolve')!;
}

/* ============================================================================
   Reveals
   ========================================================================== */

/**
 * Expand a plan into one entry per word or letter.
 *
 * The stagger is laid out in real time and then capped: units are `stepMs`
 * apart until the whole spread would exceed `maxSpreadMs`, past which they
 * crowd evenly into the cap. Whatever is left of the entrance is what a single
 * unit gets to travel in, and that is never allowed below MIN_UNIT_MS — a word
 * that arrives in two frames has not arrived, it has appeared.
 *
 * `scatter` uses a hash of the index rather than a random number, so the same
 * text scatters the same way in the editor and in the export.
 */
const MIN_UNIT_MS = 260;

export function expandReveal(
  plan: RevealPlan,
  count: number,
  raw: number,
  durationMs: number,
): ResolvedReveal {
  const total = Math.max(1, durationMs);
  const wanted = Math.max(0, count - 1) * plan.stepMs;
  // Leave room for one unit to actually perform its move.
  const room = Math.max(0, total - MIN_UNIT_MS);
  const spread = Math.min(wanted, plan.maxSpreadMs, room);
  const unitMs = Math.max(MIN_UNIT_MS, total - spread);

  const elapsed = clamp01(raw) * total;
  const units: RevealUnit[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const slot = orderSlot(plan.order, i, count);
    const start = slot * spread;
    const up = ease(plan.ease, (elapsed - start) / unitMs);
    const away = 1 - up;
    const side = plan.order === 'alternate' ? (i % 2 === 0 ? 1 : -1) : 1;
    const jx = plan.order === 'scatter' ? hash(i) * 2 - 1 : 1;
    const jy = plan.order === 'scatter' ? hash(i + 91) * 2 - 1 : 1;
    const jr = plan.order === 'scatter' ? hash(i + 17) * 2 - 1 : side;

    units[i] = {
      // A unit is opaque well before it has stopped moving, for the same
      // reason a whole layer is: half-transparent type reads as broken.
      opacity: fade(up, 0.5),
      tx: away * plan.from.tx * side * jx,
      ty: away * plan.from.ty * jy,
      scale: 1 + away * (plan.from.scale - 1),
      blur: away * plan.from.blur,
      rotate: away * plan.from.rotate * jr,
    };
  }

  return { unit: plan.unit, units };
}

/** Where in the stagger unit `i` sits, 0–1. */
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

/**
 * The presets worth offering for a layer, best first.
 *
 * Within a group the catalogue order is kept — it was written best-first — and
 * the groups themselves are ordered so that the ones this content can actually
 * perform come before the ones it cannot.
 */
export function motionsFor(affinity: MotionAffinity): MotionDef[] {
  const rank = (m: MotionDef) => {
    if (m.group === 'core') return 0;
    if (m.affinity[0] === affinity) return 1;
    if (m.affinity.includes(affinity)) return 2;
    if (m.affinity.includes('any')) return 3;
    return 4;
  };
  return MOTIONS.map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map(({ m }) => m);
}

/**
 * The same list, shelved by group, empty groups dropped.
 *
 * The shelf this content belongs on comes second, right after the essentials:
 * offering a picture the word-by-word reveals before the picture reveals — all
 * of them greyed out as unsuitable — is a gallery arguing with itself.
 */
export function motionGroupsFor(
  affinity: MotionAffinity,
): { group: MotionGroup; motions: MotionDef[] }[] {
  const home: MotionGroup | null =
    affinity === 'image' ? 'figure' : affinity === 'text' || affinity === 'number' ? 'text' : null;
  const rest: MotionGroup[] = (['text', 'figure', 'accent'] as MotionGroup[]).filter(
    (g) => g !== home,
  );
  const order: MotionGroup[] = ['core', ...(home ? [home] : []), ...rest];

  const ranked = motionsFor(affinity);
  return order
    .map((group) => ({ group, motions: ranked.filter((m) => m.group === group) }))
    .filter((g) => g.motions.length > 0);
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

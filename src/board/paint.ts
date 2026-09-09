import type { Board, Card, Motion, Reveal, Surface, Tone } from './types';

/**
 * How a card looks — written once, in HTML and CSS, and read by two places:
 * the board you edit and the page you publish. A published talk that did not
 * match the board it came from would make the board a guess, so there is only
 * one renderer and the editor uses it too.
 *
 * Nothing in here touches React or the DOM. It returns strings.
 */

export interface Palette {
  /** What the surface is called where a person has to choose one. */
  label: string;
  /** True when the room's lights are off, which is what every contrast decision keys off. */
  dark: boolean;
  ground: string;
  groundEdge: string;
  /**
   * The light in the room: a couple of very wide gradients painted under the
   * cards. A flat fill reads as a screenshot; a lit ground reads as a place.
   */
  ambient: string;
  /** Darkening at the corners while presenting, so the eye goes to the middle. */
  vignette: string;
  gridDot: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  rule: string;
  accent: string;
  /** The far end of every accent gradient — a hue away, never a shade of the same. */
  accentAlt: string;
  /** Text that sits on top of the accent. */
  accentInk: string;
  /** The accent again, at the transparency a glow wants. */
  glow: string;
  /** A mat behind figures, which arrive from the paper on white and need it. */
  mat: string;
  matInk: string;
  shadow: string;
  /** The long, soft half of a two-part shadow. */
  shadowDeep: string;
  scrim: string;
}

/**
 * Six rooms, one of them with the lights off.
 *
 * The dark boards are not the light ones inverted — chalk is warmer and quieter
 * than ink, and pure white on pure black vibrates. Each of these is a full set
 * of colours that someone can read for an hour, and each carries its own accent
 * because an accent borrowed from another room always looks borrowed.
 */
export const SURFACES: Record<Surface, Palette> = {
  white: {
    label: 'Paper',
    dark: false,
    ground: '#fbfaf7',
    groundEdge: '#f1efe9',
    ambient:
      'radial-gradient(120% 80% at 50% -12%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 62%),' +
      'radial-gradient(80% 60% at 8% 4%, rgba(27,75,143,0.055) 0%, rgba(27,75,143,0) 68%),' +
      'radial-gradient(90% 70% at 96% 100%, rgba(184,120,60,0.055) 0%, rgba(184,120,60,0) 66%)',
    vignette: 'radial-gradient(125% 105% at 50% 45%, rgba(24,22,18,0) 52%, rgba(24,22,18,0.14) 100%)',
    gridDot: 'rgba(27,26,24,0.13)',
    ink: '#171614',
    inkSoft: '#4a4741',
    inkFaint: '#8c887f',
    rule: '#d9d5cb',
    accent: '#1b4b8f',
    accentAlt: '#2f8fbe',
    accentInk: '#ffffff',
    glow: 'rgba(27,75,143,0.30)',
    mat: '#ffffff',
    matInk: '#171614',
    shadow: 'rgba(27,26,24,0.16)',
    shadowDeep: 'rgba(27,26,24,0.13)',
    scrim: 'rgba(251,250,247,0.82)',
  },

  sand: {
    label: 'Sand',
    dark: false,
    ground: '#f6eee1',
    groundEdge: '#eee2cf',
    ambient:
      'radial-gradient(110% 85% at 50% -14%, rgba(255,252,244,0.96) 0%, rgba(255,252,244,0) 60%),' +
      'radial-gradient(75% 60% at 6% 96%, rgba(178,86,42,0.09) 0%, rgba(178,86,42,0) 66%),' +
      'radial-gradient(85% 65% at 98% 6%, rgba(120,102,52,0.07) 0%, rgba(120,102,52,0) 64%)',
    vignette: 'radial-gradient(125% 105% at 50% 45%, rgba(58,38,18,0) 50%, rgba(58,38,18,0.16) 100%)',
    gridDot: 'rgba(72,52,30,0.14)',
    ink: '#241a10',
    inkSoft: '#5b4832',
    inkFaint: '#9a8367',
    rule: '#ddcdb2',
    accent: '#b0552a',
    accentAlt: '#d98f2b',
    accentInk: '#fff8ee',
    glow: 'rgba(176,85,42,0.30)',
    mat: '#fffdf8',
    matInk: '#241a10',
    shadow: 'rgba(80,52,24,0.18)',
    shadowDeep: 'rgba(80,52,24,0.14)',
    scrim: 'rgba(246,238,225,0.84)',
  },

  slate: {
    label: 'Slate',
    dark: true,
    ground: '#1c2128',
    groundEdge: '#151a20',
    ambient:
      'radial-gradient(95% 70% at 50% -10%, rgba(120,160,200,0.14) 0%, rgba(120,160,200,0) 62%),' +
      'radial-gradient(70% 60% at 4% 100%, rgba(80,200,190,0.10) 0%, rgba(80,200,190,0) 62%),' +
      'radial-gradient(80% 65% at 100% 8%, rgba(150,120,220,0.10) 0%, rgba(150,120,220,0) 60%)',
    vignette: 'radial-gradient(125% 105% at 50% 45%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.42) 100%)',
    gridDot: 'rgba(214,228,242,0.13)',
    ink: '#eef2f6',
    inkSoft: '#b3bec9',
    inkFaint: '#75818d',
    rule: '#333c46',
    accent: '#5ad3c8',
    accentAlt: '#7aa2ff',
    accentInk: '#0a1518',
    glow: 'rgba(90,211,200,0.34)',
    mat: '#f7f6f2',
    matInk: '#171614',
    shadow: 'rgba(0,0,0,0.46)',
    shadowDeep: 'rgba(0,0,0,0.40)',
    scrim: 'rgba(28,33,40,0.84)',
  },

  black: {
    label: 'Chalk',
    dark: true,
    ground: '#14171a',
    groundEdge: '#0e1013',
    ambient:
      'radial-gradient(100% 75% at 50% -12%, rgba(180,205,225,0.10) 0%, rgba(180,205,225,0) 60%),' +
      'radial-gradient(70% 55% at 3% 98%, rgba(92,201,221,0.08) 0%, rgba(92,201,221,0) 60%)',
    vignette: 'radial-gradient(125% 105% at 50% 45%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.46) 100%)',
    gridDot: 'rgba(240,244,248,0.14)',
    ink: '#f2f4f6',
    inkSoft: '#b9c1c8',
    inkFaint: '#79828a',
    rule: '#2c3238',
    accent: '#5cc9dd',
    accentAlt: '#9ad9a0',
    accentInk: '#0b1417',
    glow: 'rgba(92,201,221,0.32)',
    mat: '#f7f6f2',
    matInk: '#171614',
    shadow: 'rgba(0,0,0,0.5)',
    shadowDeep: 'rgba(0,0,0,0.42)',
    scrim: 'rgba(20,23,26,0.82)',
  },

  midnight: {
    label: 'Midnight',
    dark: true,
    ground: '#0b0a14',
    groundEdge: '#07060e',
    ambient:
      'radial-gradient(85% 65% at 18% -6%, rgba(124,58,237,0.26) 0%, rgba(124,58,237,0) 64%),' +
      'radial-gradient(80% 62% at 88% 4%, rgba(236,72,153,0.18) 0%, rgba(236,72,153,0) 60%),' +
      'radial-gradient(95% 70% at 50% 108%, rgba(56,189,248,0.20) 0%, rgba(56,189,248,0) 62%)',
    vignette: 'radial-gradient(125% 105% at 50% 45%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.58) 100%)',
    gridDot: 'rgba(196,190,255,0.15)',
    ink: '#f4f2ff',
    inkSoft: '#bdb6de',
    inkFaint: '#7d76a0',
    rule: '#2a2542',
    accent: '#a78bfa',
    accentAlt: '#38bdf8',
    accentInk: '#0b0a14',
    glow: 'rgba(167,139,250,0.42)',
    mat: '#f8f7ff',
    matInk: '#14121f',
    shadow: 'rgba(0,0,0,0.62)',
    shadowDeep: 'rgba(40,10,80,0.40)',
    scrim: 'rgba(11,10,20,0.84)',
  },

  blueprint: {
    label: 'Blueprint',
    dark: true,
    ground: '#0d2440',
    groundEdge: '#091b31',
    ambient:
      'radial-gradient(100% 78% at 50% -12%, rgba(120,190,255,0.16) 0%, rgba(120,190,255,0) 60%),' +
      'radial-gradient(75% 60% at 0% 100%, rgba(255,214,120,0.09) 0%, rgba(255,214,120,0) 58%)',
    vignette: 'radial-gradient(125% 105% at 50% 45%, rgba(1,10,22,0) 46%, rgba(1,10,22,0.50) 100%)',
    gridDot: 'rgba(158,206,255,0.22)',
    ink: '#eaf3ff',
    inkSoft: '#a9c6e6',
    inkFaint: '#6c8cae',
    rule: '#1d4066',
    accent: '#ffd166',
    accentAlt: '#7fd8ff',
    accentInk: '#0d2440',
    glow: 'rgba(255,209,102,0.34)',
    mat: '#f4f8fd',
    matInk: '#0d2440',
    shadow: 'rgba(2,12,26,0.55)',
    shadowDeep: 'rgba(2,12,26,0.45)',
    scrim: 'rgba(13,36,64,0.84)',
  },
};

/** A surface saved before the others existed, or one from a newer version. */
export function paletteOf(surface: Surface): Palette {
  return SURFACES[surface] ?? SURFACES.white;
}

interface ToneColors {
  /** Text and stroke colour. */
  ink: string;
  /** Card fill. `transparent` means the card is written straight on the board. */
  fill: string;
  /** The far end of the fill, when the fill is a gradient's near end. */
  fillAlt: string;
  edge: string;
}

const TONE_HUES: Record<Exclude<Tone, 'plain' | 'ink' | 'accent'>, [string, string, string, string]> = {
  /*         light near, light far,  dark near, dark far */
  yellow: ['#ffe9a8', '#ffd775', '#6b5410', '#87691a'],
  mint: ['#c9ecd2', '#a8e0c4', '#1c5238', '#1f6444'],
  sky: ['#cfe4f7', '#b3d6f5', '#1a4165', '#1c4f7c'],
  rose: ['#f8d5d8', '#f6bcc4', '#5f2730', '#75303c'],
  lilac: ['#e2d9f6', '#d0c2f2', '#3d3169', '#4b3b83'],
};

export function toneColors(tone: Tone, surface: Surface): ToneColors {
  const p = paletteOf(surface);
  if (tone === 'plain') return { ink: p.ink, fill: 'transparent', fillAlt: 'transparent', edge: p.rule };
  if (tone === 'ink') return { ink: p.ground, fill: p.ink, fillAlt: p.ink, edge: p.ink };
  if (tone === 'accent')
    return { ink: p.accentInk, fill: p.accent, fillAlt: p.accentAlt, edge: p.accent };
  const hues = TONE_HUES[tone];
  const [fill, fillAlt] = p.dark ? [hues[2], hues[3]] : [hues[0], hues[1]];
  return { ink: p.dark ? '#f2f4f6' : '#171614', fill, fillAlt, edge: fill };
}

/* ============================================================================
   Type
   ========================================================================== */

const SERIF = "'Newsreader Variable', Newsreader, Georgia, 'Times New Roman', serif";
const SANS = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

interface RoleType {
  family: string;
  weight: number;
  /** World px at scale 1. */
  size: number;
  leading: number;
  tracking: string;
  transform: string;
  italic: boolean;
}

export const TEXT_ROLES: Record<string, RoleType> = {
  title: { family: SERIF, weight: 500, size: 92, leading: 1.02, tracking: '-0.03em', transform: 'none', italic: false },
  heading: { family: SERIF, weight: 470, size: 54, leading: 1.14, tracking: '-0.018em', transform: 'none', italic: false },
  body: { family: SANS, weight: 400, size: 30, leading: 1.5, tracking: '0', transform: 'none', italic: false },
  quote: { family: SERIF, weight: 420, size: 46, leading: 1.28, tracking: '-0.012em', transform: 'none', italic: true },
  label: { family: SANS, weight: 570, size: 22, leading: 1.25, tracking: '0.14em', transform: 'uppercase', italic: false },
  mono: { family: MONO, weight: 420, size: 26, leading: 1.5, tracking: '0', transform: 'none', italic: false },
};

/* ============================================================================
   Arrivals
   ========================================================================== */

export type RevealName = Exclude<Reveal, 'auto'>;

/** The most words `auto` will read in one at a time. */
const CASCADE_LIMIT = 16;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * What `auto` means for each kind of card.
 *
 * A headline reads in a word at a time because that is how it is read aloud; a
 * figure focuses because that is what a projector does; a drawn stroke draws
 * itself because somebody drew it. Set a card's own reveal and this steps aside.
 */
export function revealFor(card: Card): RevealName {
  const chosen = card.reveal;
  if (chosen && chosen !== 'auto') return chosen;
  switch (card.kind) {
    case 'text':
      /* A cascade is a headline device. Past a headline's worth of words the
         audience is waiting on the animation rather than reading, so the
         paragraph arrives whole. */
      if (
        (card.role === 'title' || card.role === 'heading' || card.role === 'quote') &&
        countWords(card.text) <= CASCADE_LIMIT
      )
        return 'cascade';
      if (card.role === 'label') return 'wipe';
      return 'rise';
    case 'sticky':
      return 'drop';
    case 'image':
      return 'zoom';
    case 'table':
      return 'rise';
    case 'stat':
      return 'pop';
    case 'shape':
      return 'pop';
    case 'ink':
      return 'draw';
  }
}

export function motionOf(board: Board): Motion {
  return board.motion ?? 'lively';
}

/**
 * The number inside a statistic, so it can be counted up to.
 *
 * A stat card that lands on its final figure is a slide. A stat card that runs
 * up to it is a moment — and the moment is the whole reason the number is on
 * screen at that size. Anything that is not a number ("n.s.", "≈") returns null
 * and simply appears, because counting up to a non-number is nonsense.
 */
export interface CountPlan {
  prefix: string;
  suffix: string;
  target: number;
  decimals: number;
  grouped: boolean;
}

export function countPlan(value: string): CountPlan | null {
  const match = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(value);
  if (!match) return null;
  const [, prefix, body, suffix] = match;
  const grouped = body.includes(',');
  const plain = body.replace(/,/g, '');
  const target = Number(plain);
  if (!Number.isFinite(target)) return null;
  const dot = plain.indexOf('.');
  const decimals = dot < 0 ? 0 : plain.length - dot - 1;
  // Counting to a twelve-digit figure reads as a bug, not as a build.
  if (Math.abs(target) > 1e12) return null;
  return { prefix, suffix, target, decimals, grouped };
}

export function countFrame(plan: CountPlan, t: number): string {
  const now = plan.target * Math.min(1, Math.max(0, t));
  const fixed = now.toFixed(plan.decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = plan.grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${plan.prefix}${grouped}${fraction ? `.${fraction}` : ''}${plan.suffix}`;
}

/* ============================================================================
   The stylesheet, shared by the editor and the published page
   ========================================================================== */

export function boardCss(): string {
  return `
.bx-root{position:absolute;inset:0;overflow:hidden;background:var(--bx-ground);color:var(--bx-ink);
  -webkit-font-smoothing:antialiased;touch-action:none;isolation:isolate;
  --bx-dur:640ms;--bx-stagger:74ms;--bx-lift:40px;--bx-ease:cubic-bezier(.16,.86,.3,1);
  --bx-word:44ms;}
.bx-root[data-motion="calm"]{--bx-dur:520ms;--bx-stagger:46ms;--bx-lift:22px;--bx-word:32ms;}
.bx-root[data-motion="lively"]{--bx-dur:640ms;--bx-stagger:74ms;--bx-lift:40px;--bx-word:44ms;}
.bx-root[data-motion="cinematic"]{--bx-dur:940ms;--bx-stagger:118ms;--bx-lift:58px;--bx-word:62ms;}

/* The light in the room, painted under everything. */
.bx-root::before{content:'';position:absolute;inset:0;background-image:var(--bx-ambient);
  pointer-events:none;}
/* And the fall-off at its corners, over everything but the controls. */
.bx-root[data-present="1"]::after{content:'';position:absolute;inset:0;pointer-events:none;
  background-image:var(--bx-vignette);z-index:6;}

.bx-grid{position:absolute;inset:0;pointer-events:none;}
.bx-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform;}
.bx-card{position:absolute;transform-origin:50% 50%;box-sizing:border-box;}
.bx-card[data-hidden="1"]{opacity:0;pointer-events:none;}
.bx-fade{transition:opacity 480ms cubic-bezier(.2,.7,.2,1),filter 480ms cubic-bezier(.2,.7,.2,1);}
.bx-in{opacity:0;transform:translateY(22px);}
.bx-card[data-raised="1"]{filter:drop-shadow(0 5px 9px var(--bx-shadow)) drop-shadow(0 28px 52px var(--bx-shadow-deep));}
/* Out of the frame, out of focus: depth is what tells an audience where to look. */
.bx-card[data-focus="0"]{filter:blur(2.5px) saturate(0.55);}

/* ---- arrivals ---------------------------------------------------------- */

.bx-anim{width:100%;height:100%;transform-origin:50% 62%;
  animation-duration:var(--bx-dur);animation-timing-function:var(--bx-ease);
  animation-fill-mode:both;animation-delay:calc(var(--bx-i,0) * var(--bx-stagger));}
.bx-anim[data-reveal="fade"]{animation-name:bx-fade-in;}
.bx-anim[data-reveal="rise"]{animation-name:bx-rise;}
.bx-anim[data-reveal="pop"]{animation-name:bx-pop;animation-timing-function:cubic-bezier(.2,1.5,.4,1);}
.bx-anim[data-reveal="zoom"]{animation-name:bx-zoom;}
.bx-anim[data-reveal="blur"]{animation-name:bx-blur;}
.bx-anim[data-reveal="wipe"]{animation-name:bx-wipe;}
.bx-anim[data-reveal="flip"]{animation-name:bx-flip;}
.bx-anim[data-reveal="drop"]{animation-name:bx-drop;animation-timing-function:cubic-bezier(.2,1.3,.35,1);}
.bx-anim[data-reveal="cascade"]{animation-name:bx-hold;}
.bx-anim[data-reveal="draw"]{animation-name:bx-hold;}

@keyframes bx-hold{from{opacity:1}to{opacity:1}}
@keyframes bx-fade-in{from{opacity:0}to{opacity:1}}
@keyframes bx-rise{from{opacity:0;transform:translate3d(0,var(--bx-lift),0)}
  to{opacity:1;transform:none}}
@keyframes bx-pop{0%{opacity:0;transform:scale(.82)}
  100%{opacity:1;transform:scale(1)}}
@keyframes bx-zoom{from{opacity:0;transform:scale(1.06);filter:blur(12px)}
  to{opacity:1;transform:scale(1);filter:blur(0)}}
@keyframes bx-blur{from{opacity:0;filter:blur(18px) saturate(.5)}
  to{opacity:1;filter:blur(0) saturate(1)}}
@keyframes bx-wipe{from{opacity:1;clip-path:inset(0 100% 0 0)}
  to{opacity:1;clip-path:inset(0 0 0 0)}}
@keyframes bx-flip{from{opacity:0;transform:perspective(1600px) rotateX(-34deg) translate3d(0,var(--bx-lift),0)}
  to{opacity:1;transform:perspective(1600px) rotateX(0) translate3d(0,0,0)}}
@keyframes bx-drop{0%{opacity:0;transform:translate3d(0,calc(var(--bx-lift) * -1.6),0) rotate(-3.5deg) scale(.94)}
  100%{opacity:1;transform:none}}

/* A headline reads in the way it is read out: a word at a time. */
.bx-w{white-space:pre-wrap;}
[data-reveal="cascade"] .bx-w{display:inline-block;opacity:0;
  animation:bx-word var(--bx-dur) var(--bx-ease) both;
  animation-delay:calc(var(--bx-i,0) * var(--bx-stagger) + var(--bx-wi,0) * var(--bx-word));}
@keyframes bx-word{from{opacity:0;transform:translate3d(0,0.42em,0);filter:blur(6px)}
  to{opacity:1;transform:none;filter:blur(0)}}

/* Ink draws itself, at the speed a hand draws. */
[data-reveal="draw"] .bx-ink path{stroke-dasharray:1;stroke-dashoffset:1;
  animation:bx-draw calc(var(--bx-dur) * 1.5) cubic-bezier(.4,.05,.25,1) both;
  animation-delay:calc(var(--bx-i,0) * var(--bx-stagger));}
[data-reveal="draw"] .bx-ink path:nth-child(2){animation-delay:calc(var(--bx-i,0) * var(--bx-stagger) + 160ms);}
[data-reveal="draw"] .bx-ink path:nth-child(3){animation-delay:calc(var(--bx-i,0) * var(--bx-stagger) + 320ms);}
[data-reveal="draw"] .bx-ink path:nth-child(n+4){animation-delay:calc(var(--bx-i,0) * var(--bx-stagger) + 480ms);}
@keyframes bx-draw{to{stroke-dashoffset:0}}

.bx-root[data-motion="none"] .bx-anim,
.bx-root[data-motion="none"] .bx-w,
.bx-root[data-motion="none"] .bx-ink path{animation:none!important;opacity:1!important;
  transform:none!important;filter:none!important;clip-path:none!important;stroke-dashoffset:0!important;}

/* ---- text -------------------------------------------------------------- */

.bx-text{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;
  white-space:pre-wrap;overflow-wrap:break-word;text-wrap:pretty;}
/* One block, so a text card's words stay a paragraph: inline children of a
   column flex container would each become a row of their own. */
.bx-text>.bx-body{width:100%;}
.bx-mark{box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0.06em 0.2em;
  margin:0 -0.06em;border-radius:3px;}

/* ---- sticky ------------------------------------------------------------ */

.bx-sticky{position:relative;width:100%;height:100%;padding:30px 32px;display:flex;align-items:flex-start;
  font-family:${SANS};font-size:30px;line-height:1.4;white-space:pre-wrap;overflow-wrap:break-word;
  border-radius:3px 3px 4px 3px;
  box-shadow:0 1px 1px var(--bx-shadow),0 12px 24px -8px var(--bx-shadow),
    0 34px 60px -26px var(--bx-shadow-deep);}
/* The gloss of a paper square, and the shade under its lifted corner. A white
   sheen that reads as light on paper reads as grey wash on a dark board, so
   the card carries how strong its own highlight should be. */
.bx-sticky::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(158deg,rgba(255,255,255,var(--bx-sheen,0.30)) 0%,
    rgba(255,255,255,0) 46%,rgba(0,0,0,0.07) 100%);}
.bx-sticky::after{content:'';position:absolute;right:0;bottom:0;width:0;height:0;pointer-events:none;
  border-style:solid;border-width:0 0 30px 30px;
  border-color:transparent transparent rgba(0,0,0,0.11) transparent;
  border-bottom-right-radius:4px;}

/* ---- shapes ------------------------------------------------------------ */

.bx-shape{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:24px;font-family:${SANS};font-weight:500;font-size:28px;line-height:1.3;}
.bx-shape[data-shape="ellipse"]{border-radius:50%;}
.bx-shape[data-shape="diamond"]{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);}

/* ---- figures ----------------------------------------------------------- */

.bx-image{width:100%;height:100%;display:flex;flex-direction:column;gap:14px;}
.bx-image figure{position:relative;margin:0;flex:1;min-height:0;background:var(--bx-mat);
  border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 1px var(--bx-rule),0 2px 6px -2px var(--bx-shadow),
    0 24px 48px -20px var(--bx-shadow-deep);}
/* A single soft highlight along the top edge: the mat catches the light. */
.bx-image figure::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;
  background:linear-gradient(180deg,rgba(255,255,255,0.28) 0%,rgba(255,255,255,0) 34%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.16);}
.bx-image img{width:100%;height:100%;display:block;}
.bx-image figcaption{font-family:${SANS};font-size:20px;line-height:1.4;color:var(--bx-ink-soft);
  padding-left:14px;border-left:3px solid var(--bx-accent);}
.bx-missing{font-family:${SANS};font-size:18px;color:var(--bx-ink-faint);padding:16px;text-align:center;}

/* ---- tables ------------------------------------------------------------ */

.bx-table{width:100%;height:100%;display:flex;flex-direction:column;gap:12px;
  background:var(--bx-mat);color:var(--bx-mat-ink);border-radius:8px;padding:20px 22px;
  box-shadow:0 0 0 1px var(--bx-rule),0 2px 6px -2px var(--bx-shadow),
    0 24px 48px -20px var(--bx-shadow-deep);}
.bx-table table{border-collapse:collapse;width:100%;font-family:${SANS};font-size:22px;
  font-variant-numeric:tabular-nums;}
.bx-table th,.bx-table td{border-bottom:1px solid rgba(0,0,0,0.10);padding:10px 14px;text-align:left;
  vertical-align:top;}
.bx-table thead th{font-weight:640;border-bottom:2px solid var(--bx-accent);
  letter-spacing:0.01em;padding-bottom:12px;}
.bx-table tbody tr:nth-child(even){background:rgba(0,0,0,0.028);}
.bx-table tbody tr:last-child td{border-bottom:none;}
.bx-table .bx-cap{font-size:19px;color:rgba(0,0,0,0.6);font-family:${SANS};margin:0;}

/* ---- statistics -------------------------------------------------------- */

.bx-stat{position:relative;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;
  gap:12px;padding:32px 36px;border-radius:10px;overflow:hidden;}
.bx-stat[data-plain="0"]{box-shadow:0 2px 6px -2px var(--bx-shadow),0 28px 56px -24px var(--bx-shadow-deep);}
.bx-stat[data-plain="0"]::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(152deg,rgba(255,255,255,0.20) 0%,rgba(255,255,255,0) 52%);}
.bx-stat b{position:relative;font-family:${SANS};font-weight:660;font-size:96px;line-height:0.98;
  letter-spacing:-0.035em;font-variant-numeric:tabular-nums lining-nums;display:block;}
.bx-stat span{position:relative;font-family:${SANS};font-size:24px;line-height:1.4;opacity:0.84;}
.bx-stat em{position:relative;font-family:${MONO};font-style:normal;font-size:20px;opacity:0.72;
  letter-spacing:0.01em;}
/* The rule under a plain figure carries the accent the fill would have. */
.bx-stat[data-plain="1"] b::after{content:'';position:absolute;left:0;bottom:-0.14em;height:0.06em;
  width:2.2em;border-radius:99px;background:linear-gradient(90deg,var(--bx-accent),var(--bx-accent-alt));}

/* ---- ink --------------------------------------------------------------- */

.bx-ink{width:100%;height:100%;display:block;overflow:visible;}

/* ---- connections ------------------------------------------------------- */

.bx-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}
.bx-edge{stroke:var(--bx-ink-faint);fill:none;stroke-width:3;stroke-linecap:round;}
.bx-edge[stroke-dasharray]{animation:bx-flow 1.4s linear infinite;}
@keyframes bx-flow{to{stroke-dashoffset:-26}}
.bx-edge-label{font-family:${SANS};font-size:20px;fill:var(--bx-ink-soft);}

.bx-cite{font-family:${MONO};font-size:17px;color:var(--bx-ink-faint);letter-spacing:0.02em;}

/* ============================================================================
   The live layer — what a person does with their hands while talking.
   Shared by the presenter and the published page; driven by live.js.
   ========================================================================== */

.bx-live{position:absolute;inset:0;z-index:8;pointer-events:none;}
/* Named for the surface, not for the ink: bx-ink is already a card somebody drew. */
.bx-slate{position:absolute;left:0;top:0;pointer-events:none;}
.bx-catch{position:absolute;inset:0;pointer-events:auto;}
.bx-catch[hidden]{display:none;}
.bx-root[data-tool="pen"] .bx-catch{cursor:crosshair;}
.bx-root[data-tool="mark"] .bx-catch{cursor:cell;}
.bx-root[data-tool="erase"] .bx-catch{cursor:grab;}

/* A ring where you pointed: the gesture for "this, here, now". */
.bx-ping{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;
  border:3px solid var(--bx-accent);pointer-events:none;
  animation:bx-ping 1100ms cubic-bezier(.16,.84,.3,1) forwards;}
.bx-ping::after{content:'';position:absolute;inset:-3px;border-radius:50%;
  border:3px solid var(--bx-accent);animation:bx-ping 1100ms cubic-bezier(.16,.84,.3,1) 180ms forwards;}
@keyframes bx-ping{from{transform:scale(0.4);opacity:0.95}
  to{transform:scale(5.6);opacity:0}}

/* A card told to make itself known, for the sentence that is about it. */
.bx-card[data-hit="1"]>.bx-anim,.bx-card[data-hit="1"]>*:first-child{
  animation:bx-hit 900ms cubic-bezier(.22,1.2,.32,1) both;}
@keyframes bx-hit{0%{transform:scale(1)}22%{transform:scale(1.075)}
  48%{transform:scale(0.985)}70%{transform:scale(1.022)}100%{transform:scale(1)}}
.bx-card[data-hit="1"]{filter:drop-shadow(0 0 26px var(--bx-glow)) drop-shadow(0 0 70px var(--bx-glow));}

/* Everything but one card steps back, so a question can be answered. */
.bx-root[data-solo="1"] .bx-card:not([data-solo="1"]){opacity:0.1!important;filter:blur(4px);}
.bx-card[data-solo="1"]{filter:drop-shadow(0 10px 26px var(--bx-shadow)) drop-shadow(0 0 60px var(--bx-glow));}

.bx-laser{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
  pointer-events:none;z-index:31;
  background:radial-gradient(circle,rgba(255,255,255,0.95) 0%,rgba(255,72,72,0.95) 34%,
    rgba(255,64,64,0.28) 62%,transparent 72%);
  box-shadow:0 0 26px rgba(255,64,64,0.75),0 0 60px rgba(255,64,64,0.35);}
.bx-spot{position:absolute;inset:0;pointer-events:none;z-index:7;}
.bx-laser[hidden],.bx-spot[hidden],.bx-help[hidden],.bx-timer[hidden]{display:none;}

/* The tools, down the right-hand edge, where a hand rests. */
.bx-tools{position:absolute;right:14px;top:50%;transform:translateY(-50%);z-index:24;
  display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 6px;
  border-radius:999px;opacity:0;transition:opacity 320ms ease,transform 320ms ease;
  background:color-mix(in oklch,var(--bx-ground) 62%,transparent);
  border:1px solid color-mix(in oklch,var(--bx-ink) 10%,transparent);
  -webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%);
  box-shadow:0 2px 6px var(--bx-shadow),0 18px 40px -20px var(--bx-shadow-deep);}
.bx-tools[data-show="1"]{opacity:1;pointer-events:auto;}
.bx-tools[data-show="0"]{pointer-events:none;transform:translateY(-50%) translateX(10px);}
.bx-tool{width:30px;height:30px;border:none;border-radius:50%;cursor:pointer;padding:0;
  display:flex;align-items:center;justify-content:center;
  background:color-mix(in oklch,var(--bx-ink) 8%,transparent);color:var(--bx-ink-soft);
  transition:transform 160ms ease,background 160ms ease,color 160ms ease;}
.bx-tool:hover{background:color-mix(in oklch,var(--bx-ink) 16%,transparent);
  color:var(--bx-ink);transform:scale(1.08);}
.bx-tool[data-on="1"]{background-image:linear-gradient(140deg,var(--bx-accent),var(--bx-accent-alt));
  color:var(--bx-accent-ink);box-shadow:0 0 16px var(--bx-glow);}
.bx-swatches{display:flex;flex-direction:column;gap:4px;margin-top:3px;padding-top:6px;
  border-top:1px solid color-mix(in oklch,var(--bx-ink) 12%,transparent);}
.bx-swatch{width:16px;height:16px;border-radius:50%;border:1px solid
  color-mix(in oklch,var(--bx-ink) 22%,transparent);cursor:pointer;padding:0;
  transition:transform 140ms ease,box-shadow 140ms ease;}
.bx-swatch:hover{transform:scale(1.18);}
.bx-swatch[data-on="1"]{transform:scale(1.28);box-shadow:0 0 0 2px var(--bx-ground),0 0 0 3.5px var(--bx-ink);}

.bx-timer{position:absolute;right:14px;top:14px;z-index:24;padding:6px 12px;border-radius:999px;
  font:500 14px/1 ui-monospace,'SF Mono',monospace;font-variant-numeric:tabular-nums;
  color:var(--bx-ink-soft);pointer-events:none;
  background:color-mix(in oklch,var(--bx-ground) 62%,transparent);
  border:1px solid color-mix(in oklch,var(--bx-ink) 10%,transparent);
  -webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%);}

.bx-help{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:40;
  width:min(46rem,88vw);max-height:82vh;overflow:auto;padding:26px 30px;border-radius:16px;
  color:var(--bx-ink);font:400 14px/1.5 system-ui,-apple-system,sans-serif;
  background:color-mix(in oklch,var(--bx-ground) 88%,transparent);
  border:1px solid color-mix(in oklch,var(--bx-ink) 12%,transparent);
  -webkit-backdrop-filter:blur(28px) saturate(150%);backdrop-filter:blur(28px) saturate(150%);
  box-shadow:0 30px 90px var(--bx-shadow-deep);
  animation:bx-help-in 260ms cubic-bezier(.2,1.3,.35,1) both;}
/* Its own keyframe rather than bx-pop: an animation that sets the transform
   property would drop the centring translate this panel is positioned by. */
@keyframes bx-help-in{from{opacity:0;transform:translate(-50%,-50%) scale(0.94)}
  to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.bx-help h2{margin:0 0 16px;font:600 15px/1 system-ui,sans-serif;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--bx-ink-faint);}
.bx-help dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));
  gap:2px 26px;}
.bx-help dl>div{display:flex;align-items:baseline;gap:12px;padding:5px 0;
  border-bottom:1px solid color-mix(in oklch,var(--bx-ink) 7%,transparent);}
.bx-help dt{flex:0 0 6.4rem;font:600 12px/1.5 ui-monospace,'SF Mono',monospace;
  color:var(--bx-accent);letter-spacing:0.02em;}
.bx-help dd{margin:0;color:var(--bx-ink-soft);}
.bx-help p{margin:16px 0 0;color:var(--bx-ink-faint);font-size:12px;}

@media (prefers-reduced-motion:reduce){
  .bx-ping{animation-duration:1ms}
  .bx-card[data-hit="1"]>.bx-anim,.bx-card[data-hit="1"]>*:first-child{animation:none}
}

@media (prefers-reduced-motion:reduce){
  .bx-anim,.bx-w,.bx-ink path,.bx-edge{animation:none!important;opacity:1!important;
    transform:none!important;filter:none!important;clip-path:none!important;stroke-dashoffset:0!important;}
  .bx-fade{transition:none;}
  .bx-card[data-focus="0"]{filter:none;opacity:0.3;}
}
`.trim();
}

/** Variables the board root carries, so every card reads the same palette. */
export function surfaceVars(surface: Surface): Record<string, string> {
  const p = paletteOf(surface);
  return {
    '--bx-ground': p.ground,
    '--bx-ground-edge': p.groundEdge,
    '--bx-ambient': p.ambient,
    '--bx-vignette': p.vignette,
    '--bx-ink': p.ink,
    '--bx-ink-soft': p.inkSoft,
    '--bx-ink-faint': p.inkFaint,
    '--bx-rule': p.rule,
    '--bx-accent': p.accent,
    '--bx-accent-alt': p.accentAlt,
    '--bx-accent-ink': p.accentInk,
    '--bx-glow': p.glow,
    '--bx-mat': p.mat,
    '--bx-mat-ink': p.matInk,
    '--bx-shadow': p.shadow,
    '--bx-shadow-deep': p.shadowDeep,
    '--bx-scrim': p.scrim,
  };
}

/** The endless grid, as a background the viewport paints under the world. */
export function gridStyle(
  board: Board,
  cameraX: number,
  cameraY: number,
  zoom: number,
  vw: number,
  vh: number,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const p = paletteOf(board.surface);
  // The grid coarsens as you pull back, so it never becomes a grey wash.
  let unit = 40;
  while (unit * zoom < 12) unit *= 5;
  const size = unit * zoom;
  const ox = ((vw / 2 - cameraX * zoom) % size + size) % size;
  const oy = ((vh / 2 - cameraY * zoom) % size + size) % size;
  if (board.grid === 'none') {
    return { backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0' };
  }
  if (board.grid === 'lines') {
    return {
      backgroundImage: `linear-gradient(to right, ${p.gridDot} 1px, transparent 1px), linear-gradient(to bottom, ${p.gridDot} 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px, ${size}px ${size}px`,
      backgroundPosition: `${ox}px ${oy}px, ${ox}px ${oy}px`,
    };
  }
  const r = Math.max(1, Math.min(2.2, size / 26));
  return {
    backgroundImage: `radial-gradient(circle at center, ${p.gridDot} ${r}px, transparent ${r}px)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${ox}px ${oy}px`,
  };
}

/* ============================================================================
   Cards
   ========================================================================== */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function styleAttr(pairs: Record<string, string | number | undefined>): string {
  const body = Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return body ? ` style="${escapeHtml(body)}"` : '';
}

/**
 * Words, each one addressable, with the spaces between them left as they were.
 *
 * A cascade needs to animate a word at a time, and a word cannot be animated
 * unless something wraps it. Splitting on whitespace rather than replacing it
 * keeps the wrap identical to the unwrapped text — the spaces are still spaces.
 */
function words(text: string): string {
  const parts = text.split(/(\s+)/);
  let index = 0;
  return parts
    .map((part) => {
      if (!part) return '';
      if (/^\s+$/.test(part)) return escapeHtml(part);
      return `<span class="bx-w" style="--bx-wi:${index++}">${escapeHtml(part)}</span>`;
    })
    .join('');
}

/** The citation a card carries when it came from the paper. */
export function citation(card: Card): string | null {
  return card.source ? `p. ${card.source.page}` : null;
}

/**
 * A card's markup. `assets` lets the publisher swap object URLs for inlined
 * data — the editor passes nothing and gets its own live URLs.
 */
export function cardHtml(
  card: Card,
  surface: Surface,
  assets?: (src: string | null) => string | null,
): string {
  const p = paletteOf(surface);
  const t = toneColors(card.tone, surface);
  const src = (s: string | null) => (assets ? assets(s) : s);

  switch (card.kind) {
    case 'text': {
      const role = TEXT_ROLES[card.role] ?? TEXT_ROLES.body;
      const marked = card.tone !== 'plain';
      const inner = card.text ? words(card.text) : '&nbsp;';
      const body = marked
        ? `<span class="bx-mark"${styleAttr({
            'background-image': `linear-gradient(103deg, ${t.fill} 0%, ${t.fillAlt} 100%)`,
            color: t.ink,
          })}>${inner}</span>`
        : inner;
      return `<div class="bx-text"${styleAttr({
        'font-family': role.family,
        'font-weight': role.weight,
        'font-size': `${Math.round(role.size * card.scale)}px`,
        'line-height': role.leading,
        'letter-spacing': role.tracking,
        'text-transform': role.transform,
        'font-style': role.italic ? 'italic' : 'normal',
        'text-align': card.align,
        color: marked ? undefined : 'var(--bx-ink)',
        'align-items':
          card.align === 'center' ? 'center' : card.align === 'end' ? 'flex-end' : 'flex-start',
      })}><div class="bx-body">${body}</div></div>`;
    }

    case 'sticky':
      return `<div class="bx-sticky"${styleAttr({
        '--bx-sheen': p.dark ? '0.09' : '0.30',
        'background-image':
          t.fill === 'transparent'
            ? 'none'
            : `linear-gradient(158deg, ${t.fillAlt} 0%, ${t.fill} 58%, ${t.fillAlt} 100%)`,
        background: t.fill === 'transparent' ? 'var(--bx-mat)' : undefined,
        color: t.fill === 'transparent' ? 'var(--bx-mat-ink)' : t.ink,
        'font-size': `${Math.round(30 * card.scale)}px`,
      })}>${escapeHtml(card.text) || '&nbsp;'}</div>`;

    case 'shape': {
      const stroke = t.fill === 'transparent' ? 'var(--bx-ink)' : t.fill;
      return `<div class="bx-shape" data-shape="${card.shape}"${styleAttr({
        border: card.filled ? 'none' : `3px solid ${stroke}`,
        'background-image': card.filled
          ? `linear-gradient(150deg, ${t.fillAlt === 'transparent' ? 'var(--bx-ink)' : t.fillAlt} 0%, ${
              t.fill === 'transparent' ? 'var(--bx-ink)' : t.fill
            } 100%)`
          : undefined,
        color: card.filled ? t.ink : 'var(--bx-ink)',
        'border-radius': card.shape === 'rect' ? '10px' : undefined,
        'box-shadow': card.filled
          ? `0 2px 6px -2px var(--bx-shadow), 0 26px 52px -24px var(--bx-shadow-deep)`
          : undefined,
        'font-size': `${Math.round(28 * card.scale)}px`,
      })}>${escapeHtml(card.label)}</div>`;
    }

    case 'image': {
      const url = src(card.src);
      const inner = url
        ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(card.alt)}"${styleAttr({
            'object-fit': card.fit,
          })} />`
        : `<p class="bx-missing">Image unavailable</p>`;
      const cap = card.caption
        ? `<figcaption>${escapeHtml(card.caption)}</figcaption>`
        : '';
      return `<div class="bx-image"><figure>${inner}</figure>${cap}</div>`;
    }

    case 'table': {
      const url = src(card.src);
      let body: string;
      if (card.grid && card.grid.cells.length) {
        const head = card.grid.cells.slice(0, Math.max(0, card.grid.headerRows));
        const rows = card.grid.cells.slice(Math.max(0, card.grid.headerRows));
        const cell = (tag: string, cells: string[]) =>
          `<tr>${cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`;
        body = `<table>${head.length ? `<thead>${head.map((r) => cell('th', r)).join('')}</thead>` : ''}<tbody>${rows
          .map((r) => cell('td', r))
          .join('')}</tbody></table>`;
      } else if (url) {
        body = `<img src="${escapeHtml(url)}" alt="${escapeHtml(card.caption ?? 'Table')}" style="width:100%;object-fit:contain" />`;
      } else {
        body = `<p class="bx-missing">Table unavailable</p>`;
      }
      const cap = card.caption ? `<p class="bx-cap">${escapeHtml(card.caption)}</p>` : '';
      return `<div class="bx-table"${styleAttr({ 'font-size': `${Math.round(22 * card.scale)}px` })}>${cap}<div style="flex:1;min-height:0;overflow:hidden">${body}</div></div>`;
    }

    case 'stat': {
      const plain = t.fill === 'transparent';
      const quals = card.qualifiers.length
        ? `<em>${escapeHtml(card.qualifiers.join('  '))}</em>`
        : '';
      const cap = card.caption ? `<span>${escapeHtml(card.caption)}</span>` : '';
      /* A figure written straight on the board takes the accent as a gradient;
         one on a coloured card takes that card's own ink, because a gradient
         over a fill is two decorations arguing. */
      const number = plain
        ? {
            'background-image': `linear-gradient(148deg, ${p.accent} 0%, ${p.accentAlt} 100%)`,
            '-webkit-background-clip': 'text',
            'background-clip': 'text',
            color: 'transparent',
          }
        : { color: t.ink, 'text-shadow': p.dark ? `0 2px 18px ${p.shadow}` : undefined };
      return `<div class="bx-stat" data-plain="${plain ? 1 : 0}"${styleAttr({
        'background-image': plain
          ? undefined
          : `linear-gradient(148deg, ${t.fillAlt} 0%, ${t.fill} 100%)`,
        color: plain ? 'var(--bx-ink)' : t.ink,
      })}><b class="bx-num"${styleAttr({
        'font-size': `${Math.round(96 * card.scale)}px`,
        ...number,
      })}>${escapeHtml(card.value)}</b>${cap}${quals}</div>`;
    }

    case 'ink': {
      const w = Math.max(1, card.rect.w);
      const h = Math.max(1, card.rect.h);
      const paths = card.strokes
        .map((points) => {
          if (points.length < 4) return '';
          let d = '';
          for (let i = 0; i < points.length; i += 2) {
            d += `${i === 0 ? 'M' : 'L'}${(points[i] - card.rect.x).toFixed(1)} ${(
              points[i + 1] - card.rect.y
            ).toFixed(1)}`;
          }
          // pathLength normalises every stroke to 1, which is what lets one
          // dash-offset animation draw a stroke of any real length.
          return `<path d="${d}" pathLength="1" />`;
        })
        .join('');
      const stroke = t.fill === 'transparent' ? 'var(--bx-ink)' : t.fill;
      return `<svg class="bx-ink" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"${styleAttr({
        stroke,
        fill: 'none',
        'stroke-width': card.weight,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })}>${paths}</svg>`;
    }
  }
}

/**
 * A card wrapped in the thing that animates it.
 *
 * The rotation stays on the card and the entrance goes on this inner element,
 * so a turned card can still arrive without the two transforms fighting over
 * the same property.
 */
export function cardBody(
  card: Card,
  surface: Surface,
  assets?: (src: string | null) => string | null,
): string {
  return `<div class="bx-anim" data-reveal="${revealFor(card)}">${cardHtml(card, surface, assets)}</div>`;
}

/* ============================================================================
   Connections
   ========================================================================== */

/** Where a line from `from` towards `to` leaves the first card's edge. */
function edgePoint(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const dx = to.x + to.w / 2 - cx;
  const dy = to.y + to.h / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // The smaller of the two scalings that reach a side is the side it leaves by.
  const sx = dx === 0 ? Infinity : from.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : from.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * The arrows between cards, as one SVG layer. Drawn from card edge to card
 * edge rather than centre to centre, so a line never disappears under the
 * thing it points at.
 */
export function edgesSvg(board: Board): string {
  if (!board.edges.length) return '';
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const paths: string[] = [];
  let label = '';

  for (const edge of board.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const a = edgePoint(from.rect, to.rect);
    const b = edgePoint(to.rect, from.rect);
    paths.push(
      `<line class="bx-edge" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(
        1,
      )}" y2="${b.y.toFixed(1)}"${edge.dashed ? ' stroke-dasharray="14 12"' : ''}${
        edge.arrow ? ' marker-end="url(#bx-arrow)"' : ''
      } />`,
    );
    if (edge.label) {
      label += `<text class="bx-edge-label" x="${((a.x + b.x) / 2).toFixed(1)}" y="${(
        (a.y + b.y) / 2 -
        10
      ).toFixed(1)}" text-anchor="middle">${escapeHtml(edge.label)}</text>`;
    }
  }

  if (!paths.length) return '';
  return `<svg class="bx-edges" width="1" height="1" style="z-index:1"><defs><marker id="bx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor" /></marker></defs><g style="color:var(--bx-ink-faint)">${paths.join(
    '',
  )}${label}</g></svg>`;
}

/** Where a card sits and how it is turned, as an inline style string. */
export function cardTransform(card: Card): string {
  return `left:${card.rect.x}px;top:${card.rect.y}px;width:${card.rect.w}px;height:${card.rect.h}px;${
    card.rotation ? `transform:rotate(${card.rotation}deg);` : ''
  }z-index:${Math.round(card.z)}`;
}

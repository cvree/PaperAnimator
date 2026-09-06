import type { BoardEffects, Camera, Card, EffectPreset, Surface, WorldRect } from './types';

/**
 * The atmosphere: depth, light, texture — everything that is true of the room
 * rather than of any one card.
 *
 * Two rules hold this file together. The first is that every effect is a dial
 * that is genuinely off at zero: a board that asks for nothing renders the same
 * flat, fast surface it did before any of this existed, with no extra elements,
 * no filters and no work per frame. The second is that depth is *arithmetic*,
 * not decoration — the same three functions place a card, pick a card and drag
 * a card, so a thing you can see at depth is a thing you can grab at depth.
 *
 * Nothing here touches React or the DOM. It returns numbers and strings, so the
 * board you edit, the talk you present and the file you publish all agree.
 */

/* ============================================================================
   The dials
   ========================================================================== */

export const NO_EFFECTS: BoardEffects = {
  parallax: 0,
  focus: 0,
  spotlight: 0,
  bloom: 0,
  grain: 0,
  aurora: 0,
  vignette: 0,
  reveal: true,
};

/**
 * Five rooms.
 *
 * These are not five sets of numbers; they are five decisions about what kind
 * of surface this is. "desk" is a desk with the blinds open. "studio" is a room
 * where somebody is being shown something. "cinema" is the lights down. "neon"
 * is the sign outside. Anybody who moves a dial lands on "custom", which is a
 * name for "yours" rather than a sixth room.
 *
 * None of them is called Paper, because the shelf of things from the paper is
 * already called that and they sit two controls apart in the same toolbar.
 */
export const PRESETS: Record<Exclude<EffectPreset, 'custom'>, BoardEffects> = {
  plain: { ...NO_EFFECTS },
  desk: { parallax: 0.28, focus: 0, spotlight: 0, bloom: 0, grain: 0.5, aurora: 0, vignette: 0.24, reveal: true },
  studio: { parallax: 0.5, focus: 0.34, spotlight: 0.42, bloom: 0.12, grain: 0.24, aurora: 0.16, vignette: 0.34, reveal: true },
  cinema: { parallax: 0.8, focus: 0.68, spotlight: 0.34, bloom: 0.18, grain: 0.34, aurora: 0.1, vignette: 0.6, reveal: true },
  neon: { parallax: 0.62, focus: 0.3, spotlight: 0.5, bloom: 0.9, grain: 0.16, aurora: 0.62, vignette: 0.46, reveal: true },
};

export const PRESET_LIST: { id: EffectPreset; label: string; hint: string }[] = [
  { id: 'plain', label: 'Plain', hint: 'A board and nothing else.' },
  { id: 'desk', label: 'Desk', hint: 'Grain, a little depth, corners that fall away.' },
  { id: 'studio', label: 'Studio', hint: 'A light that follows you, and a lens that picks a plane.' },
  { id: 'cinema', label: 'Cinema', hint: 'Lights down. Deep focus falls off fast.' },
  { id: 'neon', label: 'Neon', hint: 'Ink that glows, and a colour field behind it.' },
];

/** The dials a named look stands for. `custom` keeps whatever it already had. */
export function presetEffects(preset: EffectPreset, current: BoardEffects): BoardEffects {
  if (preset === 'custom') return { ...current };
  return { ...PRESETS[preset] };
}

/** Whether a set of dials still matches the look it claims to be. */
export function matchesPreset(effects: BoardEffects, preset: EffectPreset): boolean {
  if (preset === 'custom') return true;
  const p = PRESETS[preset];
  return (Object.keys(p) as (keyof BoardEffects)[]).every((k) => p[k] === effects[k]);
}

/**
 * Dials that arrived from somewhere older, or from a link written before an
 * effect existed. Missing is off, and out of range is clamped, so a board can
 * never carry a value that would make the room unusable.
 */
export function normaliseEffects(input: Partial<BoardEffects> | undefined | null): BoardEffects {
  const dial = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  return {
    parallax: dial(input?.parallax),
    focus: dial(input?.focus),
    spotlight: dial(input?.spotlight),
    bloom: dial(input?.bloom),
    grain: dial(input?.grain),
    aurora: dial(input?.aurora),
    vignette: dial(input?.vignette),
    reveal: input?.reveal !== false,
  };
}

/** True when the board asks for nothing, so every overlay can be left out. */
export function effectsAreOff(fx: BoardEffects): boolean {
  return (
    fx.parallax === 0 &&
    fx.focus === 0 &&
    fx.spotlight === 0 &&
    fx.bloom === 0 &&
    fx.grain === 0 &&
    fx.aurora === 0 &&
    fx.vignette === 0
  );
}

/* ============================================================================
   Depth
   ========================================================================== */

/**
 * How hard depth pulls, at full strength. A card one screen from the middle,
 * at depth 1, slides by this fraction of that distance — enough to read as
 * separation, not enough to make anybody wonder where their card went.
 */
const PARALLAX_GAIN = 0.16;

/** A card's displacement coefficient. Zero for the board's own plane. */
export function depthFactor(depth: number, fx: BoardEffects): number {
  if (!fx.parallax || !depth) return 0;
  return Math.max(-1, Math.min(1, depth)) * fx.parallax * PARALLAX_GAIN;
}

/**
 * How far a card is drawn from where it lives, in world units.
 *
 * This is the whole of parallax: a card away from the middle of the view is
 * pushed further out when it is near the eye and pulled in when it is far from
 * it, in proportion to how far off the axis it already sits. It is linear,
 * which is what makes it invertible — see {@link pickShift} and
 * {@link dragDivisor}, which are the same fact read backwards.
 */
export function depthShift(rect: WorldRect, m: number, cam: Camera): { dx: number; dy: number } {
  if (!m) return { dx: 0, dy: 0 };
  return {
    dx: (rect.x + rect.w / 2 - cam.x) * m,
    dy: (rect.y + rect.h / 2 - cam.y) * m,
  };
}

/** Where a card is actually drawn, depth included. */
export function drawnRect(card: Card, cam: Camera, fx: BoardEffects): WorldRect {
  const m = depthFactor(card.depth, fx);
  if (!m) return card.rect;
  const s = depthShift(card.rect, m, cam);
  return { x: card.rect.x + s.dx, y: card.rect.y + s.dy, w: card.rect.w, h: card.rect.h };
}

/** The shift a hit test has to undo before it asks whether a point is inside. */
export function pickShift(card: Card, cam: Camera, fx: BoardEffects): { dx: number; dy: number } {
  return depthShift(card.rect, depthFactor(card.depth, fx), cam);
}

/**
 * Drag a card at depth and it would run ahead of or behind the cursor, because
 * moving it also moves the shift. Divide the world delta by this and it tracks
 * the pointer exactly — which is the only behaviour anybody will accept from a
 * thing they are holding.
 */
export function dragDivisor(card: Card, fx: BoardEffects): number {
  return 1 + depthFactor(card.depth, fx);
}

/**
 * How soft a card is, in screen pixels.
 *
 * Depth alone blurs a little; being outside the thing under discussion blurs a
 * lot. Together they are a rack focus: the point stays sharp and the rest of
 * the board admits it is the rest of the board.
 */
export function focusBlur(depth: number, offStage: boolean, fx: BoardEffects): number {
  if (!fx.focus) return 0;
  const raw = Math.abs(Math.max(-1, Math.min(1, depth))) * 5 + (offStage ? 7 : 0);
  return Math.min(13, raw * fx.focus);
}

/* ============================================================================
   The room, as CSS
   ========================================================================== */

/** Variables the board root carries so every effect reads one set of numbers. */
export function effectVars(fx: BoardEffects, surface: Surface): Record<string, string> {
  const dark = surface === 'black';
  return {
    '--bx-fx-grain': String(fx.grain * (dark ? 0.5 : 0.34)),
    '--bx-fx-vignette': String(fx.vignette),
    '--bx-fx-aurora': String(fx.aurora * (dark ? 0.75 : 0.34)),
    '--bx-fx-spot': String(fx.spotlight * (dark ? 0.72 : 0.44)),
    '--bx-fx-bloom': `${(fx.bloom * 26).toFixed(1)}px`,
    '--bx-fx-bloom-a': String(Math.min(0.85, fx.bloom * 0.75)),
    '--bx-aurora-blend': dark ? 'screen' : 'multiply',
    '--bx-grain-blend': dark ? 'soft-light' : 'multiply',
    '--bx-tape': dark ? 'rgba(226,232,236,0.22)' : 'rgba(214,196,150,0.55)',
  };
}

/**
 * The overlays, in two packs: one behind the world and one in front of it.
 *
 * They are markup rather than pseudo-elements because there are four of them
 * and they blend differently, and they are omitted entirely when their dial is
 * zero — an empty div with `mix-blend-mode` still costs a compositing layer.
 */
export function atmosphereHtml(fx: BoardEffects, where: 'back' | 'front'): string {
  const parts: string[] = [];
  if (where === 'back') {
    if (fx.aurora > 0) parts.push('<div class="bx-aurora"></div>');
  } else {
    if (fx.spotlight > 0) parts.push('<div class="bx-spot"></div>');
    if (fx.vignette > 0) parts.push('<div class="bx-vignette"></div>');
    if (fx.grain > 0) parts.push('<div class="bx-grain"></div>');
  }
  return parts.join('');
}

/**
 * Grain, as a tile the browser draws for us.
 *
 * A noise image would be a download and a cache entry for something the
 * renderer can generate; feTurbulence in a data URI is a few hundred bytes and
 * lands identically in an editor, a presentation and a file on a USB stick.
 */
const GRAIN_TILE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

/**
 * The stylesheet for depth, edges and atmosphere. Appended to the board's own
 * stylesheet, so the published page gets it for free.
 */
export function effectsCss(): string {
  return `
/* ---- the room ---------------------------------------------------------- */
.bx-atmos{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
.bx-atmos-back{z-index:0}
.bx-atmos-front{z-index:60}

.bx-aurora{position:absolute;inset:-25%;opacity:var(--bx-fx-aurora,0);
  mix-blend-mode:var(--bx-aurora-blend,screen);filter:blur(60px);
  background:
    radial-gradient(38% 46% at 22% 30%, var(--bx-accent) 0%, transparent 68%),
    radial-gradient(34% 40% at 78% 26%, color-mix(in oklch, var(--bx-accent) 55%, #b061ff) 0%, transparent 66%),
    radial-gradient(46% 44% at 58% 82%, color-mix(in oklch, var(--bx-accent) 40%, #16d1a5) 0%, transparent 70%);
  animation:bx-drift 54s cubic-bezier(.45,.05,.55,.95) infinite alternate;}
@keyframes bx-drift{
  0%{transform:translate3d(-3%,-2%,0) scale(1.04) rotate(-2deg)}
  50%{transform:translate3d(4%,3%,0) scale(1.14) rotate(2deg)}
  100%{transform:translate3d(-2%,4%,0) scale(1.06) rotate(-1deg)}}

.bx-grain{position:absolute;inset:0;opacity:var(--bx-fx-grain,0);
  mix-blend-mode:var(--bx-grain-blend,soft-light);
  background-image:${GRAIN_TILE};background-size:220px 220px;}

.bx-vignette{position:absolute;inset:0;
  background:radial-gradient(120% 100% at 50% 50%, transparent 42%, rgba(0,0,0,0.9) 100%);
  opacity:calc(var(--bx-fx-vignette,0) * 0.72);}

/* An unsized "circle" reaches the farthest corner, so the stops below are read
   as fractions of that: clear out to a quarter, gone by three quarters. Giving
   it a percentage size instead would be invalid and drop the whole light. */
.bx-spot{position:absolute;inset:0;opacity:var(--bx-fx-spot,0);
  background:radial-gradient(circle at var(--bx-spot-x,50%) var(--bx-spot-y,45%),
    transparent 0%, transparent 26%, rgba(0,0,0,0.94) 76%);}

/* ---- depth ------------------------------------------------------------- */
.bx-card{transition:filter 260ms cubic-bezier(.2,.7,.2,1);}
.bx-deep{filter:blur(var(--bx-blur,0px));}

/* ---- bloom ------------------------------------------------------------- */
.bx-root[data-bloom="1"] .bx-text,
.bx-root[data-bloom="1"] .bx-stat b{
  text-shadow:0 0 var(--bx-fx-bloom,0px) color-mix(in oklch, currentColor 55%, transparent);}
.bx-root[data-bloom="1"] .bx-ink,
.bx-root[data-bloom="1"] .bx-shape{
  filter:drop-shadow(0 0 calc(var(--bx-fx-bloom,0px) * 0.6) color-mix(in oklch, var(--bx-accent) 70%, transparent));}

/* ---- edges ------------------------------------------------------------- */
/* Every rule below weighs the same — one class and one attribute — so the one
   that names an edge beats the one that only sets the box up, on source order.
   A :not() on the base rule would quietly outrank all of them. */
.bx-card[data-outline]::before{content:'';position:absolute;
  inset:calc(-9px * var(--bx-out,1));pointer-events:none;border-radius:calc(5px * var(--bx-out,1));}
.bx-card[data-outline="none"]::before{content:none;}

.bx-card[data-outline="hairline"]::before{
  border:calc(2.5px * var(--bx-out,1)) solid var(--bx-edge,var(--bx-ink-faint));opacity:.75;}

.bx-card[data-outline="sketch"]::before{
  border:calc(4px * var(--bx-out,1)) solid var(--bx-edge,var(--bx-ink));
  border-radius:calc(14px * var(--bx-out,1));filter:url(#bx-rough);opacity:.85;}

.bx-card[data-outline="marker"]::before{
  inset:calc(-20px * var(--bx-out,1));
  border:calc(12px * var(--bx-out,1)) solid var(--bx-edge,var(--bx-accent));
  border-radius:52% 48% 47% 53%/56% 44% 56% 44%;
  transform:rotate(-1.2deg);filter:url(#bx-scrawl);opacity:.62;}

.bx-card[data-outline="glow"]::before{
  border-radius:calc(9px * var(--bx-out,1));
  box-shadow:0 0 0 calc(2.5px * var(--bx-out,1)) var(--bx-edge,var(--bx-accent)),
    0 0 calc(30px * var(--bx-out,1)) calc(6px * var(--bx-out,1)) color-mix(in oklch, var(--bx-edge,var(--bx-accent)) 60%, transparent);
  opacity:.9;}

.bx-card[data-outline="cut"]::before{
  inset:calc(-19px * var(--bx-out,1));background:var(--bx-mat);border-radius:2px;z-index:-1;
  box-shadow:0 calc(2px * var(--bx-out,1)) calc(4px * var(--bx-out,1)) var(--bx-shadow),
    0 calc(20px * var(--bx-out,1)) calc(46px * var(--bx-out,1)) var(--bx-shadow);
  transform:rotate(-0.45deg);}

/* Tape is two strips, so it takes both pseudo-elements and no border at all. */
.bx-card[data-outline="tape"]::before,
.bx-card[data-outline="tape"]::after{content:'';position:absolute;inset:auto;pointer-events:none;
  width:calc(108px * var(--bx-out,1));height:calc(34px * var(--bx-out,1));
  background:var(--bx-tape);border-radius:1px;
  box-shadow:0 calc(1px * var(--bx-out,1)) calc(3px * var(--bx-out,1)) var(--bx-shadow);}
.bx-card[data-outline="tape"]::before{left:calc(-28px * var(--bx-out,1));top:calc(-15px * var(--bx-out,1));
  transform:rotate(-33deg);}
.bx-card[data-outline="tape"]::after{right:calc(-28px * var(--bx-out,1));top:calc(-15px * var(--bx-out,1));
  transform:rotate(33deg);}

/* ---- arrival ------------------------------------------------------------ */
.bx-root[data-reveal="1"] .bx-fade{
  transition:opacity 480ms cubic-bezier(.2,.75,.25,1),transform 620ms cubic-bezier(.16,1.05,.3,1),
    filter 420ms cubic-bezier(.2,.7,.2,1);}

/* A drawing draws itself the moment its card is shown: the selector starts
   matching, which is what starts the animation. Nothing has to be told twice. */
@keyframes bx-draw{from{stroke-dashoffset:var(--bx-len,0)}to{stroke-dashoffset:0}}
.bx-root[data-reveal="1"][data-mode="present"] .bx-card[data-shown="1"] .bx-ink path{
  animation:bx-draw 780ms cubic-bezier(.35,.05,.2,1) both;}

@media (prefers-reduced-motion:reduce){
  .bx-aurora{animation:none}
  .bx-root[data-reveal="1"][data-mode="present"] .bx-card[data-shown="1"] .bx-ink path{animation:none}
}
`.trim();
}

/**
 * The filters the edges borrow. Two of them, because a hand and a marker do not
 * shake at the same wavelength: a drawn box wobbles tightly and shallowly, and
 * a circle scrawled round something swings wide and loose.
 *
 * It has to exist in the same document as the thing it filters, so the editor,
 * the presenter and the published page each carry one copy.
 */
export function effectDefsSvg(): string {
  return `<svg class="bx-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;pointer-events:none"><defs><filter id="bx-rough" x="-14%" y="-14%" width="128%" height="128%" filterUnits="objectBoundingBox"><feTurbulence type="fractalNoise" baseFrequency="0.014 0.018" numOctaves="3" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter><filter id="bx-scrawl" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox"><feTurbulence type="fractalNoise" baseFrequency="0.007 0.009" numOctaves="2" seed="19" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" /></filter></defs></svg>`;
}

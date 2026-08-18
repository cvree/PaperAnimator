import type { Layer, NarrationCue, Project, Scene, SceneId, LayerId } from '@/core/types';
import {
  ease,
  expandReveal,
  holdDef,
  motionDef,
  settledReveal,
  stillMotion,
  type ResolvedMask,
  type ResolvedReveal,
} from './motion';

/**
 * resolveFrame is the contract that makes preview equal export.
 *
 * It is pure: no DOM, no clock, no randomness, no I/O. The editor calls it on
 * every animation frame with the wall clock; the exporter calls it in a loop at
 * a fixed step. Same function, same input, same pixels.
 *
 * Nothing inside the scene canvas may animate via CSS transitions or a motion
 * library — every animated value on screen comes from here.
 */

export interface ResolveOptions {
  reducedMotion: boolean;
}

export interface ResolvedHighlight {
  id: string;
  treatment: 'sweep' | 'underline' | 'box' | 'spotlight' | 'strike';
  /** Word indices covered so far. Fractional, so the marker moves at reading speed. */
  from: number;
  to: number;
  colorToken: string;
}

export interface ResolvedLayer {
  id: LayerId;
  layer: Layer;
  /** Eased 0–1 progress of the entrance, exposed for content that counts up. */
  progress: number;
  opacity: number;
  /** Translation as a fraction of canvas height — resolution independent. */
  tx: number;
  ty: number;
  scale: number;
  /** Degrees, on top of the layer's own rotation. */
  rotate: number;
  /** The shape currently uncovering the layer, in fractions of its own box. */
  mask: ResolvedMask | null;
  /** Blur radius as a fraction of canvas height, so it survives any scale. */
  blur: number;
  /** Extra letter-spacing in em of the layer's own type. */
  trackingEm: number;
  /** Per-word or per-letter state, for entrances that stagger their own text. */
  reveal: ResolvedReveal | null;
  /** Sustained motion of the picture inside a figure's frame. */
  imageMotion: { tx: number; ty: number; scale: number } | null;
  highlights: ResolvedHighlight[];
  needsReview: boolean;
}

export interface ResolvedCaption {
  text: string;
  words: { text: string; spoken: boolean; active: boolean }[];
}

export interface FrameState {
  tMs: number;
  sceneIndex: number;
  sceneId: SceneId | null;
  sceneTMs: number;
  sceneDurationMs: number;
  layers: ResolvedLayer[];
  /** Outgoing scene during a transition, plus 0–1 progress. */
  transition: { fromSceneId: SceneId; progress: number; kind: Scene['transitionIn'] } | null;
  caption: ResolvedCaption | null;
  activeCueId: string | null;
  totalMs: number;
}

const TRANSITION_MS = 420;

/* ============================================================================
   Timeline
   ========================================================================== */

export interface SceneWindow {
  scene: Scene;
  startMs: number;
  endMs: number;
  index: number;
}

export function sceneWindows(project: Project): SceneWindow[] {
  const out: SceneWindow[] = [];
  let t = 0;
  let index = 0;
  for (const scene of project.scenes) {
    if (scene.hidden) continue;
    out.push({ scene, startMs: t, endMs: t + scene.durationMs, index });
    t += scene.durationMs;
    index++;
  }
  return out;
}

export function projectDuration(project: Project): number {
  return project.scenes.reduce((sum, s) => (s.hidden ? sum : sum + s.durationMs), 0);
}

/**
 * The moment a scene has finished arriving — the still that represents it.
 * Previews, the scene rail and any paused jump all use this, so a scene looks
 * the same everywhere it is shown as a single image.
 */
export function settledOffset(scene: Scene | undefined): number {
  if (!scene) return 0;
  const lastEnd = scene.layers.reduce(
    (max, l) => Math.max(max, l.enter.delayMs + l.enter.durationMs),
    0,
  );
  return Math.max(0, Math.min(scene.durationMs - 1, lastEnd + 40));
}

export function windowAt(windows: SceneWindow[], tMs: number): SceneWindow | null {
  if (windows.length === 0) return null;
  const clamped = Math.max(0, Math.min(tMs, windows[windows.length - 1].endMs - 1));
  for (const w of windows) {
    if (clamped >= w.startMs && clamped < w.endMs) return w;
  }
  return windows[windows.length - 1];
}

/* ============================================================================
   Frame resolution
   ========================================================================== */

export function resolveFrame(
  project: Project,
  tMs: number,
  options: ResolveOptions = { reducedMotion: false },
): FrameState {
  const windows = sceneWindows(project);
  const totalMs = windows.length ? windows[windows.length - 1].endMs : 0;

  if (windows.length === 0) {
    return {
      tMs,
      sceneIndex: -1,
      sceneId: null,
      sceneTMs: 0,
      sceneDurationMs: 0,
      layers: [],
      transition: null,
      caption: null,
      activeCueId: null,
      totalMs: 0,
    };
  }

  const win = windowAt(windows, tMs)!;
  const sceneTMs = Math.max(0, Math.min(tMs, win.endMs - 1) - win.startMs);
  const scene = win.scene;

  const layers = scene.layers
    .filter((l) => !l.hidden)
    .sort((a, b) => a.z - b.z)
    .map((layer) => resolveLayer(layer, scene, sceneTMs, options));

  // Transitions overlap the boundary so the outgoing scene can be cross-rendered.
  let transition: FrameState['transition'] = null;
  if (win.index > 0 && sceneTMs < TRANSITION_MS && scene.transitionIn !== 'cut') {
    const prev = windows[win.index - 1];
    transition = {
      fromSceneId: prev.scene.id,
      progress: options.reducedMotion ? 1 : sceneTMs / TRANSITION_MS,
      kind: scene.transitionIn,
    };
  }

  const activeCue = findActiveCue(scene, sceneTMs);
  const caption = activeCue ? resolveCaption(activeCue, sceneTMs) : null;

  return {
    tMs,
    sceneIndex: win.index,
    sceneId: scene.id,
    sceneTMs,
    sceneDurationMs: scene.durationMs,
    layers,
    transition,
    caption,
    activeCueId: activeCue?.id ?? null,
    totalMs,
  };
}

function resolveLayer(
  layer: Layer,
  scene: Scene,
  sceneTMs: number,
  options: ResolveOptions,
): ResolvedLayer {
  const { enter } = layer;
  const def = motionDef(enter.preset);
  const start = enter.delayMs;
  const raw = enter.durationMs <= 0 ? 1 : clamp01((sceneTMs - start) / enter.durationMs);
  const p = options.reducedMotion ? (sceneTMs >= start ? 1 : 0) : ease(def.ease, raw);
  const intensity = clampRange(enter.intensity ?? 1, 0.25, 2);

  // Reduced motion is not "the same thing, smaller". It is the informational
  // equivalent: the content appears, on time, without travelling.
  const motion = options.reducedMotion ? stillMotion() : def.resolve(p, intensity, raw);
  if (options.reducedMotion && enter.reducedMotion === 'fade') {
    motion.opacity = clamp01((sceneTMs - start) / 150);
  }

  let tx = motion.tx;
  let ty = motion.ty;
  let scale = motion.scale;
  let rotate = motion.rotate;
  let imageMotion: ResolvedLayer['imageMotion'] = null;

  // Sustained motion runs for as long as the layer is on screen, so a figure
  // keeps breathing after its entrance instead of freezing into a slide.
  const hold = holdDef(enter.hold ?? 'none');
  if (!options.reducedMotion && hold.id !== 'none') {
    const span = Math.max(1, scene.durationMs - start);
    const cycle = clamp01((sceneTMs - start) / span);
    const h = hold.resolve(cycle, intensity);
    const insideTheFrame = hold.prefersImage && (layer.type === 'figure' || layer.type === 'table');
    if (insideTheFrame) {
      imageMotion = { tx: h.tx, ty: h.ty, scale: h.scale };
    } else {
      tx += h.tx;
      ty += h.ty;
      scale *= h.scale;
      rotate += h.rotate;
    }
  }

  const reveal = resolveReveal(layer, motion.reveal, raw, options);

  return {
    id: layer.id,
    layer,
    progress: p,
    opacity: layer.opacity * motion.opacity,
    tx,
    ty,
    scale,
    rotate,
    mask: motion.mask,
    blur: motion.blur,
    trackingEm: motion.trackingEm,
    reveal,
    imageMotion,
    highlights: resolveHighlights(layer, scene, sceneTMs, options),
    needsReview: needsReview(layer),
  };
}

/**
 * How many words or letters a layer has to stagger.
 *
 * The count has to agree with what the renderers iterate, or a word would
 * arrive with another word's timing. Both of them build the same string — the
 * layer's atoms joined by single spaces — so both count the same units.
 */
export function revealText(layer: Layer): string | null {
  if (layer.type !== 'text') return null;
  return layer.atoms
    .map((a) => a.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function resolveReveal(
  layer: Layer,
  plan: ReturnType<typeof stillMotion>['reveal'],
  raw: number,
  options: ResolveOptions,
): ResolvedReveal | null {
  // Staggering applies to set text only. A picture has no words to stagger, so
  // a text preset simply falls back to its whole-block behaviour there.
  const text = revealText(layer);
  if (!text) return null;

  const words = text.split(' ');
  if (!plan) return null;

  const count = plan.unit === 'char' ? text.length : words.length;
  if (count === 0) return null;
  if (options.reducedMotion) return settledReveal(plan.unit, count);
  return expandReveal(plan, count, raw);
}

/* ============================================================================
   Highlight that follows the voice
   ========================================================================== */

function resolveHighlights(
  layer: Layer,
  scene: Scene,
  sceneTMs: number,
  options: ResolveOptions,
): ResolvedHighlight[] {
  if (layer.emphasis.length === 0) return [];
  const out: ResolvedHighlight[] = [];

  for (const spec of layer.emphasis) {
    if (spec.timing.mode === 'absolute') {
      const { startMs, durationMs } = spec.timing;
      const p = options.reducedMotion
        ? sceneTMs >= startMs
          ? 1
          : 0
        : clamp01((sceneTMs - startMs) / Math.max(1, durationMs));
      if (p <= 0) continue;
      out.push({
        id: spec.id,
        treatment: spec.treatment,
        from: spec.wordRange[0],
        to: spec.wordRange[0] + (spec.wordRange[1] - spec.wordRange[0]) * p,
        colorToken: spec.colorToken,
      });
      continue;
    }

    // Word mode: the marker advances exactly as the narrator speaks.
    const cue = cueForLayer(layer, scene);
    if (!cue) continue;
    const local = sceneTMs - cue.startMs;
    if (local < 0) continue;

    const spoken = spokenWords(cue, local);
    if (spoken <= 0) continue;

    const covered = Math.min(spec.wordRange[1], spec.wordRange[0] + spoken);
    if (covered <= spec.wordRange[0]) continue;

    out.push({
      id: spec.id,
      treatment: spec.treatment,
      from: spec.wordRange[0],
      to: options.reducedMotion ? Math.ceil(covered) : covered,
      colorToken: spec.colorToken,
    });
  }

  return out;
}

/** Fractional count of words spoken by local time, so the sweep is continuous. */
function spokenWords(cue: NarrationCue, localMs: number): number {
  const words = cue.words;
  if (words.length === 0) return 0;
  if (localMs >= cue.durationMs) return words.length;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (localMs < w.startMs) return i;
    if (localMs < w.endMs) {
      const span = Math.max(1, w.endMs - w.startMs);
      return i + clamp01((localMs - w.startMs) / span);
    }
  }
  return words.length;
}

/**
 * Match a text layer to the cue that speaks it. Composed scenes usually pair one
 * body layer with one cue; where several exist we take the closest textual match.
 */
const cueMatchCache = new WeakMap<Layer, NarrationCue | null>();

function cueForLayer(layer: Layer, scene: Scene): NarrationCue | null {
  if (cueMatchCache.has(layer)) return cueMatchCache.get(layer) ?? null;

  let result: NarrationCue | null = null;
  if (layer.type === 'text') {
    const layerText = normalize(layer.atoms.map((a) => a.text).join(' '));
    let best = 0;
    for (const cue of scene.narration) {
      const cueText = normalize(cue.text);
      const score =
        cueText === layerText
          ? 1
          : cueText.startsWith(layerText.slice(0, 40)) || layerText.startsWith(cueText.slice(0, 40))
            ? 0.8
            : overlapRatio(layerText, cueText);
      if (score > best) {
        best = score;
        result = cue;
      }
    }
    if (best < 0.45) result = scene.narration[0] ?? null;
  } else {
    result = scene.narration[0] ?? null;
  }

  cueMatchCache.set(layer, result);
  return result;
}

function overlapRatio(a: string, b: string): number {
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

function normalize(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ============================================================================
   Captions
   ========================================================================== */

function findActiveCue(scene: Scene, sceneTMs: number): NarrationCue | null {
  for (const cue of scene.narration) {
    if (sceneTMs >= cue.startMs && sceneTMs < cue.startMs + cue.durationMs) return cue;
  }
  return null;
}

/**
 * A caption is a reading window, not a transcript.
 *
 * A cue can be a whole marked paragraph; showing all of it at once would cover
 * the scene it is describing. What is shown is the words around the one being
 * said — enough to read ahead, enough to have just read.
 */
const CAPTION_BEHIND = 14;
const CAPTION_AHEAD = 10;

function resolveCaption(cue: NarrationCue, sceneTMs: number): ResolvedCaption {
  const local = sceneTMs - cue.startMs;
  const spoken = spokenWords(cue, local);
  const activeIndex = Math.floor(spoken);

  const from = Math.max(0, activeIndex - CAPTION_BEHIND);
  const to = Math.min(cue.words.length, activeIndex + CAPTION_AHEAD + 1);
  const window = cue.words.slice(from, to);

  return {
    text: window.map((w) => w.text).join(' '),
    words: window.map((w, i) => ({
      text: w.text,
      spoken: from + i < activeIndex,
      active: from + i === activeIndex,
    })),
  };
}

/* ============================================================================
   Utilities
   ========================================================================== */

function needsReview(layer: Layer): boolean {
  if (layer.type === 'text') {
    return layer.atoms.some((a) => a.provenance.kind === 'unsupported' && !a.provenance.reviewed);
  }
  if ('provenance' in layer) {
    return layer.provenance.kind === 'unsupported' && !layer.provenance.reviewed;
  }
  return false;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampRange(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function findSceneStart(project: Project, sceneId: SceneId): number {
  const windows = sceneWindows(project);
  return windows.find((w) => w.scene.id === sceneId)?.startMs ?? 0;
}

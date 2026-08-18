import { newId } from '@/core/id';
import {
  ASPECT_DIMS,
  type Aspect,
  type Frame,
  type Layer,
  type MotionPreset,
  type MotionSpec,
  type NarrationCue,
  type Paper,
  type ProjectSettings,
  type Provenance,
  type Scene,
  type SceneKind,
  type Sentence,
  type SourceRef,
  type Statistic,
  type TextLayer,
  type TextRole,
} from '@/core/types';
import { STYLES } from '@/render/styles';
import { motionDef } from '@/render/motion';
import { clip, tidy } from '@/reader/pageText';
import { passageRefs, primaryRef, type Passage } from '@/reader/selection';

/**
 * Scenes, built from what a person marked on the page.
 *
 * The highlight *is* the provenance. Every layer these builders emit carries the
 * quads of the span it came from, so there is no later step where a source gets
 * attached — and therefore no later step that can be skipped or got wrong.
 *
 * Layout is measured, not guessed: text picks the largest role that still fits
 * the frame at the project's real pixel dimensions, and blocks are stacked from
 * their measured heights. That is what stops a long sentence overflowing its
 * scene and a short one floating in the middle of an empty canvas.
 */

const M = 0.088;
const COL = 1 - M * 2;
const WORDS_PER_SECOND = 2.65;
const LEAD_IN_MS = 380;
const LEAD_OUT_MS = 620;
const MIN_SCENE_MS = 2200;

/** Furniture: a kicker, a page number, a figure label. Asserts nothing. */
const LABEL: Provenance = { kind: 'connective' };

/* ============================================================================
   Measuring type
   ========================================================================== */

const ROLE_ORDER: TextRole[] = ['display', 'headline', 'body', 'caption'];
/**
 * Mean advance width of a glyph as a fraction of its font size, rounded up.
 * Estimating wide keeps the fit conservative: a scene that reserves too much
 * room looks a little airy, one that reserves too little cuts a sentence.
 */
const ADVANCE = 0.52;

export interface Fit {
  role: TextRole;
  /** Height the text needs, as a fraction of the canvas. */
  h: number;
}

/**
 * The largest role whose set text still fits the given box.
 *
 * Metrics come from Broadsheet; the four styles are within a few percent of one
 * another, and the fit is computed with a safety margin wide enough to cover
 * the difference — a scene must never overflow because the style changed.
 */
export function fitText(
  text: string,
  boxW: number,
  boxH: number,
  aspect: Aspect,
  from: TextRole = 'display',
): Fit {
  const dims = ASPECT_DIMS[aspect];
  const chars = Math.max(1, text.length);
  const start = Math.max(0, ROLE_ORDER.indexOf(from));

  for (let i = start; i < ROLE_ORDER.length; i++) {
    const role = ROLE_ORDER[i];
    const spec = STYLES.broadsheet.type[role];
    const px = spec.size * dims.h;
    const perLine = Math.max(6, Math.floor((boxW * dims.w) / (px * ADVANCE)));
    const lines = Math.max(1, Math.ceil(chars / perLine));
    const h = (lines * px * spec.leading * 1.1) / dims.h;
    if (h <= boxH || i === ROLE_ORDER.length - 1) {
      return { role, h: Math.min(boxH, h) };
    }
  }
  return { role: 'caption', h: boxH };
}

/* ============================================================================
   Layer factories
   ========================================================================== */

interface TextOptions {
  role: TextRole;
  frame: Frame;
  delayMs: number;
  align?: TextLayer['align'];
  sweep?: boolean;
  preset?: Layer['enter']['preset'];
}

export function textLayer(
  text: string,
  provenance: Provenance,
  options: TextOptions,
): TextLayer {
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    id: newId('layer'),
    type: 'text',
    atoms: [{ id: newId('atom'), text, provenance }],
    role: options.role,
    align: options.align ?? 'start',
    frame: options.frame,
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: enterFor(options.preset ?? 'cascade', options.delayMs),
    emphasis: options.sweep
      ? [
          {
            id: newId('atom'),
            treatment: 'sweep',
            wordRange: [0, words],
            timing: { mode: 'word', cueId: '' as never, wordIndex: 0, trailWords: 3 },
            colorToken: 'hl-yellow',
          },
        ]
      : [],
    altText: null,
    decorative: false,
  };
}

function kicker(text: string, y: number): TextLayer {
  return textLayer(text.toUpperCase(), LABEL, {
    role: 'label',
    frame: { x: M, y, w: COL, h: 0.045 },
    delayMs: 0,
    preset: 'weigh-in',
  });
}

/**
 * An entrance at the length its preset was designed for. Picking a preset and
 * then giving it somebody else's duration is how a cascade ends up looking like
 * a stutter, so the catalogue's own timing is the default everywhere.
 */
function enterFor(preset: MotionPreset, delayMs: number, hold?: MotionSpec['hold']): MotionSpec {
  const def = motionDef(preset);
  return {
    preset,
    delayMs,
    durationMs: def.durationMs,
    reducedMotion: def.reducedMotion,
    ...(hold ? { hold } : null),
  };
}

function rule(y: number, delayMs: number): Layer {
  return {
    id: newId('layer'),
    type: 'rule',
    orientation: 'horizontal',
    weight: 1,
    frame: { x: M, y, w: COL, h: 0.004 },
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: { preset: 'draw-on', delayMs, durationMs: 520, reducedMotion: 'none' },
    emphasis: [],
    altText: null,
    decorative: true,
  };
}

function cue(
  text: string,
  provenance: Provenance,
  role: NarrationCue['role'],
  settings: ProjectSettings,
): NarrationCue {
  const words = text.split(/\s+/).filter(Boolean);
  const durationMs = Math.max(
    900,
    (words.length / (WORDS_PER_SECOND * Math.max(0.5, settings.speakingRate))) * 1000,
  );
  const per = durationMs / Math.max(1, words.length);
  return {
    id: newId('cue'),
    text,
    provenance,
    role,
    startMs: 0,
    durationMs,
    words: words.map((w, i) => ({ text: w, startMs: i * per, endMs: (i + 1) * per })),
  };
}

export function assembleScene(
  kind: SceneKind,
  title: string,
  layers: Layer[],
  cues: NarrationCue[],
  refs: SourceRef[],
): Scene {
  let t = LEAD_IN_MS;
  const timed = cues.map((c) => {
    const positioned = { ...c, startMs: t };
    t += c.durationMs + 180;
    return positioned;
  });
  return {
    id: newId('scene'),
    title,
    kind,
    durationMs: Math.max(MIN_SCENE_MS, t + LEAD_OUT_MS),
    durationPinned: false,
    layers: layers.map((l, i) => ({ ...l, z: i + 1 })),
    narration: timed,
    transitionIn: 'dissolve',
    sourceRefs: refs,
    locked: false,
    hidden: false,
  };
}

/* ============================================================================
   Provenance from a passage
   ========================================================================== */

export function extracted(ref: SourceRef, confidence = 0.96): Provenance {
  return { kind: 'extracted', ref, confidence };
}

function sentenceRef(sentence: Sentence): SourceRef {
  return sentence.ref;
}

/* ============================================================================
   The builders
   ========================================================================== */

export interface BuildContext {
  paper: Paper;
  settings: ProjectSettings;
}

/** A statement: the passage, set as large as it will go, spoken as it appears. */
export function statementScene(passage: Passage, ctx: BuildContext): Scene {
  const { settings } = ctx;
  const text = passage.text;
  const prov = extracted(primaryRef(passage));
  const label = passage.section?.title ?? `Page ${primaryRef(passage).page}`;

  const fit = fitText(text, COL, 0.5, settings.aspect);
  const top = 0.5 - fit.h / 2 + 0.02;

  const layers: Layer[] = [
    kicker(clip(label, 34), Math.max(0.1, top - 0.11)),
    rule(Math.max(0.145, top - 0.055), 120),
    textLayer(text, prov, {
      role: fit.role,
      frame: { x: M, y: top, w: COL, h: fit.h },
      delayMs: 200,
      sweep: true,
    }),
  ];

  return assembleScene(
    'finding',
    titleFor(passage),
    layers,
    [cue(text, prov, 'factual', settings)],
    passageRefs(passage),
  );
}

/** A pull quote, attributed to its page. */
export function quoteScene(passage: Passage, ctx: BuildContext): Scene {
  const { settings } = ctx;
  const prov = extracted(primaryRef(passage), 0.98);
  const fit = fitText(passage.text, COL - 0.04, 0.48, settings.aspect, 'headline');
  const top = 0.5 - fit.h / 2;

  const quote: Layer = {
    id: newId('layer'),
    type: 'quote',
    text: passage.text,
    attribution: attributionFor(passage, ctx.paper),
    provenance: prov,
    frame: { x: M, y: top, w: COL, h: fit.h + 0.08 },
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: enterFor('ink-bleed', 90),
    emphasis: [],
    altText: null,
    decorative: false,
  };

  return assembleScene(
    'quote',
    `“${clip(passage.text, 26)}`,
    [quote],
    [cue(passage.text, prov, 'factual', settings)],
    passageRefs(passage),
  );
}

/** The number, at the size it deserves, with the sentence that qualifies it. */
export function statisticScene(passage: Passage, ctx: BuildContext): Scene | null {
  const stat = pickStat(passage.statistics);
  if (!stat) return null;
  const { settings } = ctx;

  const sentence = passage.sentences.find((s) => s.id === stat.sentenceId);
  const caption = tidy(sentence?.text ?? passage.text);
  const captionProv = extracted(sentence ? sentenceRef(sentence) : primaryRef(passage));
  const fit = fitText(caption, COL, 0.2, settings.aspect, 'body');

  const layers: Layer[] = [
    {
      id: newId('layer'),
      type: 'stat',
      display: stat.raw,
      caption: null,
      qualifiers: stat.qualifiers.map((q) => q.raw),
      showQualifiers: stat.qualifiers.length > 0,
      countUp: stat.value !== null && Math.abs(stat.value) > 0 && Math.abs(stat.value) < 100000,
      provenance: extracted(stat.ref, 0.97),
      frame: { x: M, y: 0.19, w: COL, h: 0.4 },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: enterFor('weigh-in', 80),
      emphasis: [],
      altText: `${stat.raw}${stat.qualifiers.length ? `, ${stat.qualifiers.map((q) => q.raw).join(', ')}` : ''}`,
      decorative: false,
    },
    rule(0.63, 260),
    textLayer(caption, captionProv, {
      role: fit.role === 'display' ? 'body' : fit.role,
      frame: { x: M, y: 0.67, w: COL, h: Math.max(fit.h, 0.12) },
      delayMs: 420,
      sweep: true,
    }),
  ];

  return assembleScene(
    'statistic',
    stat.raw.length < 16 ? stat.raw : 'Finding',
    layers,
    [cue(caption, captionProv, 'factual', settings)],
    passageRefs(passage),
  );
}

/**
 * A build: one line per sentence, each entering as it is spoken, each carrying
 * its own span of the paper. A paragraph becomes a slide in one gesture.
 */
export function bulletScene(passage: Passage, ctx: BuildContext): Scene {
  const { settings } = ctx;
  const parts = splitParts(passage);
  const label = passage.section?.title ?? 'From the paper';

  const layers: Layer[] = [kicker(clip(label, 34), 0.13), rule(0.185, 120)];
  const cues: NarrationCue[] = [];

  const top = 0.245;
  const available = 0.72 - top;
  const gap = 0.028;
  const budget = (available - gap * (parts.length - 1)) / parts.length;

  let y = top;
  parts.forEach((part, i) => {
    const fit = fitText(part.text, COL - 0.05, budget, settings.aspect, 'headline');
    const prov = extracted(part.ref);
    layers.push(
      textLayer(part.text, prov, {
        role: fit.role,
        frame: { x: M + 0.05, y, w: COL - 0.05, h: fit.h },
        delayMs: 200 + i * 140,
        sweep: true,
      }),
    );
    // A tick in the margin, drawn as the line lands.
    layers.push({
      id: newId('layer'),
      type: 'rule',
      orientation: 'vertical',
      weight: 2,
      frame: { x: M, y, w: 0.004, h: fit.h },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: { preset: 'draw-on', delayMs: 180 + i * 140, durationMs: 420, reducedMotion: 'none' },
      emphasis: [],
      altText: null,
      decorative: true,
    });
    cues.push(cue(part.text, prov, 'factual', settings));
    y += fit.h + gap;
  });

  return assembleScene(
    'finding',
    clip(passage.section?.title ?? passage.text, 30),
    layers,
    cues,
    passageRefs(passage),
  );
}

/** One scene per sentence: a paragraph becomes a sequence. */
export function beatScenes(passage: Passage, ctx: BuildContext): Scene[] {
  const parts = splitParts(passage);
  if (parts.length < 2) return [statementScene(passage, ctx)];

  return parts.map((part) => {
    const single: Passage = {
      ...passage,
      id: `${passage.id}-${part.index}`,
      text: part.text,
      words: part.text.split(/\s+/).filter(Boolean).length,
      sentences: part.sentence ? [part.sentence] : [],
      statistics: passage.statistics.filter((s) =>
        part.sentence ? s.sentenceId === part.sentence.id : part.text.includes(s.raw),
      ),
      spans: [{ page: part.ref.page, quads: part.ref.quads, text: part.text }],
    };
    return statisticScene(single, ctx) ?? statementScene(single, ctx);
  });
}

/** A figure or a cropped region of the page, with its caption. */
export function figureScene(
  passage: Passage,
  ctx: BuildContext,
  crop: string | null,
): Scene | null {
  const { settings } = ctx;
  const figure = passage.figure;
  const table = passage.table;
  const src = crop ?? figure?.image ?? table?.image ?? null;
  if (!src && !figure && !table) return null;

  const ref = figure?.ref ?? table?.ref ?? primaryRef(passage);
  const prov = extracted(ref, figure || table ? 0.94 : 0.9);
  // A marquee sweeps up every sentence it touches; a caption is one line, so
  // an unlabelled crop takes the first sentence under it and no more.
  const caption = clip(
    tidy(figure?.caption ?? table?.caption ?? passage.sentences[0]?.text ?? passage.text),
    190,
  );
  const label = figure?.label ?? table?.label ?? `Page ${ref.page}`;
  const title = figure?.label ?? table?.label ?? 'Figure';

  const hasCaption = caption.length > 0;
  const fit = hasCaption
    ? fitText(caption, COL, 0.16, settings.aspect, 'caption')
    : { role: 'caption' as TextRole, h: 0 };

  const layers: Layer[] = [
    kicker(clip(label, 34), 0.1),
    table && !figure
      ? {
          id: newId('layer'),
          type: 'table',
          tableId: (table.id ?? newId('table')) as never,
          src,
          grid: table.grid,
          caption: null,
          provenance: prov,
          frame: { x: M, y: 0.19, w: COL, h: hasCaption ? 0.56 : 0.7 },
          z: 1,
          opacity: 1,
          rotation: 0,
          locked: false,
          hidden: false,
          enter: enterFor('unfold', 120),
          emphasis: [],
          altText: caption || label,
          decorative: false,
        }
      : {
          id: newId('layer'),
          type: 'figure',
          figureId: (figure?.id ?? newId('figure')) as never,
          src,
          caption: null,
          provenance: prov,
          fit: 'contain',
          frame: { x: M, y: 0.19, w: COL, h: hasCaption ? 0.56 : 0.7 },
          z: 1,
          opacity: 1,
          rotation: 0,
          locked: false,
          hidden: false,
          // A figure arrives through an opening iris and then keeps moving: a
          // still picture held dead still for six seconds is where a talk dies.
          enter: enterFor('iris', 120, 'ken-burns'),
          emphasis: [],
          altText: figure?.altText || caption || label,
          decorative: false,
        },
  ];

  if (hasCaption) {
    layers.push(
      textLayer(caption, prov, {
        role: fit.role,
        frame: { x: M, y: 0.78, w: COL, h: Math.max(0.08, fit.h) },
        delayMs: 460,
      }),
    );
  }

  const spoken = caption || `${label}.`;
  return assembleScene(
    table && !figure ? 'table' : 'figure',
    title,
    layers,
    [cue(spoken, hasCaption ? prov : LABEL, 'explanation', settings)],
    passageRefs(passage),
  );
}

/** An opening card: the marked passage as the title, the paper's own byline under it. */
export function titleScene(passage: Passage, ctx: BuildContext): Scene {
  const { paper, settings } = ctx;
  const title = passage.text;
  const prov = extracted(primaryRef(passage), 0.99);
  const authors = paper.meta.authors
    .slice(0, 4)
    .map((a) => a.name)
    .join(' · ');
  const venue = [paper.meta.venue, paper.meta.year].filter(Boolean).join(' · ');

  const fit = fitText(title, COL, 0.44, settings.aspect);
  const top = Math.max(0.16, 0.46 - fit.h / 2);

  const layers: Layer[] = [
    textLayer(title, prov, {
      role: fit.role,
      frame: { x: M, y: top, w: COL, h: fit.h },
      delayMs: 120,
      preset: 'weigh-in',
    }),
    rule(top + fit.h + 0.05, 420),
  ];

  if (authors) {
    layers.push(
      textLayer(authors, { kind: 'extracted', ref: primaryRef(passage), confidence: 0.9 }, {
        role: 'caption',
        frame: { x: M, y: top + fit.h + 0.09, w: COL, h: 0.07 },
        delayMs: 520,
      }),
    );
  }
  if (venue) {
    layers.push(kicker(venue, top + fit.h + (authors ? 0.17 : 0.09)));
  }

  return assembleScene(
    'title',
    clip(title, 30),
    layers,
    [cue(title, prov, 'factual', settings)],
    passageRefs(passage),
  );
}

/** Two marked passages, side by side, with their own sources. */
export function compareScene(passages: Passage[], ctx: BuildContext): Scene | null {
  const [a, b] = passages;
  if (!a || !b) return null;
  const { settings } = ctx;
  const half = (COL - 0.05) / 2;

  const layers: Layer[] = [rule(0.2, 200)];
  const cues: NarrationCue[] = [];

  [a, b].forEach((p, i) => {
    const x = M + i * (half + 0.05);
    const prov = extracted(primaryRef(p));
    const heading = p.section?.title ?? `Page ${primaryRef(p).page}`;
    const fit = fitText(p.text, half, 0.5, settings.aspect, 'headline');
    layers.push(
      textLayer(heading.toUpperCase(), LABEL, {
        role: 'label',
        frame: { x, y: 0.14, w: half, h: 0.045 },
        delayMs: i * 90,
        preset: 'settle',
      }),
      textLayer(p.text, prov, {
        role: fit.role,
        frame: { x, y: 0.27, w: half, h: fit.h },
        delayMs: 240 + i * 200,
        sweep: true,
      }),
    );
    cues.push(cue(p.text, prov, 'factual', settings));
  });

  // The divider between the two columns.
  layers.push({
    id: newId('layer'),
    type: 'rule',
    orientation: 'vertical',
    weight: 1,
    frame: { x: M + half + 0.024, y: 0.26, w: 0.003, h: 0.46 },
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: { preset: 'draw-on', delayMs: 320, durationMs: 620, reducedMotion: 'none' },
    emphasis: [],
    altText: null,
    decorative: true,
  });

  return assembleScene(
    'context',
    'Side by side',
    layers,
    cues,
    [...passageRefs(a), ...passageRefs(b)],
  );
}

/* ============================================================================
   Patches to an existing scene
   ========================================================================== */

/** Append the passage to a scene as another line, spoken after what is there. */
export function appendToScene(scene: Scene, passage: Passage, settings: ProjectSettings): void {
  const prov = extracted(primaryRef(passage));
  const existing = scene.layers.filter((l) => l.type === 'text' && !l.decorative).length;
  const y = Math.min(0.8, 0.24 + existing * 0.13);
  const fit = fitText(passage.text, COL, 0.9 - y, settings.aspect, 'body');

  scene.layers.push({
    ...textLayer(passage.text, prov, {
      role: fit.role,
      frame: { x: M, y, w: COL, h: fit.h },
      delayMs: 220 + existing * 120,
      sweep: true,
    }),
    z: scene.layers.length + 1,
  });
  scene.sourceRefs.push(...passageRefs(passage));

  const spoken = cue(passage.text, prov, 'factual', settings);
  const last = scene.narration.at(-1);
  spoken.startMs = last ? last.startMs + last.durationMs + 180 : LEAD_IN_MS;
  scene.narration.push(spoken);
  if (!scene.durationPinned) {
    scene.durationMs = Math.max(scene.durationMs, spoken.startMs + spoken.durationMs + LEAD_OUT_MS);
  }
}

/** Speak the passage over a scene without putting it on screen. */
export function narrateOverScene(scene: Scene, passage: Passage, settings: ProjectSettings): void {
  const prov = extracted(primaryRef(passage));
  const spoken = cue(passage.text, prov, 'explanation', settings);
  const last = scene.narration.at(-1);
  spoken.startMs = last ? last.startMs + last.durationMs + 180 : LEAD_IN_MS;
  scene.narration.push(spoken);
  scene.sourceRefs.push(...passageRefs(passage));
  if (!scene.durationPinned) {
    scene.durationMs = Math.max(scene.durationMs, spoken.startMs + spoken.durationMs + LEAD_OUT_MS);
  }
}

/**
 * Mark the passage's words inside a layer that already shows them.
 *
 * Returns false when the scene does not contain the passage, so the caller can
 * fall back to making a scene rather than silently doing nothing.
 */
export function emphasiseInScene(scene: Scene, passage: Passage): boolean {
  const needle = normalizeForMatch(passage.text);
  if (needle.length < 3) return false;

  for (const layer of scene.layers) {
    if (layer.type !== 'text') continue;
    const full = layer.atoms.map((a) => a.text).join(' ');
    const range = wordRange(full, passage.text);
    if (!range) continue;
    layer.emphasis = [
      ...layer.emphasis.filter((e) => e.treatment !== 'spotlight'),
      {
        id: newId('atom'),
        treatment: 'spotlight',
        wordRange: range,
        timing: { mode: 'absolute', startMs: 240, durationMs: 520 },
        colorToken: 'hl-yellow',
      },
    ];
    return true;
  }
  return false;
}

/** The sentence containing the passage, with the passage itself spotlit. */
export function spotlightScene(passage: Passage, ctx: BuildContext): Scene {
  const host = passage.sentences[0];
  const full = host ? tidy(host.text) : passage.text;
  const prov = extracted(host ? sentenceRef(host) : primaryRef(passage));
  const { settings } = ctx;

  const fit = fitText(full, COL, 0.46, settings.aspect, 'headline');
  const top = 0.5 - fit.h / 2;
  const range = wordRange(full, passage.text) ?? [0, full.split(/\s+/).length];

  const body = textLayer(full, prov, {
    role: fit.role,
    frame: { x: M, y: top, w: COL, h: fit.h },
    delayMs: 180,
  });
  body.emphasis = [
    {
      id: newId('atom'),
      treatment: 'spotlight',
      wordRange: range,
      timing: { mode: 'absolute', startMs: 620, durationMs: 620 },
      colorToken: 'hl-yellow',
    },
  ];

  const layers: Layer[] = [
    kicker(clip(passage.section?.title ?? `Page ${primaryRef(passage).page}`, 34), Math.max(0.1, top - 0.11)),
    body,
  ];

  return assembleScene(
    'finding',
    clip(passage.text, 28),
    layers,
    [cue(full, prov, 'factual', settings)],
    passageRefs(passage),
  );
}

/* ============================================================================
   Helpers
   ========================================================================== */

interface Part {
  index: number;
  text: string;
  ref: SourceRef;
  sentence: Sentence | null;
}

/**
 * The passage as lines.
 *
 * Whole sentences when the passage covers them — each keeps its own quads, so a
 * five-line build has five separate citations. A single long sentence splits at
 * its own punctuation instead, and the parts share the sentence's span, which
 * is the honest thing to say about where a clause came from.
 */
function splitParts(passage: Passage): Part[] {
  if (passage.sentences.length > 1) {
    return passage.sentences.map((s, i) => ({
      index: i,
      text: tidy(s.text),
      ref: sentenceRef(s),
      sentence: s,
    }));
  }

  const sentence = passage.sentences[0] ?? null;
  const ref = sentence ? sentenceRef(sentence) : primaryRef(passage);
  const text = passage.text;

  if (text.length > 150) {
    const clauses = text
      .split(/(?<=[,;:])\s+(?=(?:and|but|while|whereas|although|which|however)\b)|(?<=;)\s+/i)
      .map((t) => tidy(t))
      .filter((t) => t.split(/\s+/).length > 3);
    if (clauses.length > 1) {
      return clauses.slice(0, 5).map((t, i) => ({ index: i, text: t, ref, sentence }));
    }
  }
  return [{ index: 0, text, ref, sentence }];
}

function pickStat(stats: Statistic[]): Statistic | null {
  if (!stats.length) return null;
  const rank: Record<string, number> = {
    percentage: 6,
    ratio: 5,
    correlation: 5,
    'mean-sd': 4,
    count: 3,
    'confidence-interval': 2,
    other: 2,
    'sample-size': 1,
    'p-value': 0,
  };
  return [...stats].sort((a, b) => (rank[b.kind] ?? 0) - (rank[a.kind] ?? 0))[0];
}

function titleFor(passage: Passage): string {
  const stat = pickStat(passage.statistics);
  if (stat && stat.raw.length < 14) return stat.raw;
  return clip(passage.text, 32);
}

function attributionFor(passage: Passage, paper: Paper): string {
  const first = paper.meta.authors[0]?.name;
  const surname = first?.split(/\s+/).at(-1);
  const page = primaryRef(passage).page;
  return surname ? `${surname} et al., page ${page}` : `Page ${page}`;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Word indices of `needle` within `haystack`, or null when it is not there. */
export function wordRange(haystack: string, needle: string): [number, number] | null {
  const hWords = haystack.split(/\s+/).filter(Boolean);
  const nWords = normalizeForMatch(needle).split(' ').filter(Boolean);
  if (!nWords.length || nWords.length > hWords.length) return null;

  const norm = hWords.map((w) => normalizeForMatch(w));
  for (let i = 0; i <= norm.length - nWords.length; i++) {
    let ok = true;
    for (let j = 0; j < nWords.length; j++) {
      if (norm[i + j] !== nWords[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return [i, i + nWords.length];
  }
  return null;
}

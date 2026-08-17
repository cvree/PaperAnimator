import { newId } from '@/core/id';
import type {
  Layer,
  NarrationCue,
  ProjectSettings,
  Provenance,
  Scene,
  Sentence,
  Statistic,
  TextLayer,
} from '@/core/types';

/**
 * Building a scene from a selection.
 *
 * The selection *is* the provenance — there is no separate step where a source
 * gets attached, and therefore no step that can be skipped or got wrong.
 */

const M = 0.088;

/**
 * A kicker, a figure number, a section name. These are the presentation's own
 * furniture: they assert nothing about the paper, and calling them "yours"
 * would both be untrue and drag the integrity score down for wording nobody
 * wrote and nobody needs to check.
 */
const LABEL: Provenance = { kind: 'connective' };
const WORDS_PER_SECOND = 2.65;

export function makeSceneFromSentence(
  sentence: Sentence,
  stats: Statistic[],
  settings: ProjectSettings,
): Scene {
  const provenance: Provenance = { kind: 'extracted', ref: sentence.ref, confidence: 0.95 };
  const stat = pickStat(stats);
  const layers: Layer[] = [];

  if (stat) {
    layers.push({
      id: newId('layer'),
      type: 'stat',
      display: stat.raw,
      // The sentence appears once, as the layer below, so the marker has
      // something to travel across while it is being read out.
      caption: null,
      qualifiers: stat.qualifiers.map((q) => q.raw),
      showQualifiers: stat.qualifiers.length > 0,
      countUp: stat.value !== null && stat.value > 0 && stat.value < 100000,
      provenance: { kind: 'extracted', ref: stat.ref, confidence: 0.96 },
      frame: { x: M, y: 0.2, w: 1 - M * 2, h: 0.4 },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: { preset: 'rise', delayMs: 80, durationMs: 700, reducedMotion: 'fade' },
      emphasis: [],
      altText: `${stat.raw}${stat.qualifiers.length ? `, ${stat.qualifiers.map((q) => q.raw).join(', ')}` : ''}`,
      decorative: false,
    });
    layers.push(
      textLayer(sentence.text, provenance, 'body', { x: M, y: 0.66, w: 1 - M * 2, h: 0.22 }, 420),
    );
  } else {
    layers.push(
      textLayer(
        'FROM THE PAPER',
        LABEL,
        'label',
        { x: M, y: 0.18, w: 0.5, h: 0.05 },
        0,
        false,
      ),
    );
    layers.push(
      textLayer(
        sentence.text,
        provenance,
        sentence.text.length > 190 ? 'body' : 'headline',
        { x: M, y: 0.28, w: 1 - M * 2, h: 0.46 },
        160,
      ),
    );
  }

  const cue = makeCue(sentence.text, provenance, 'factual', settings);
  return assemble(stat ? 'statistic' : 'finding', titleFor(sentence, stat), layers, [cue], [sentence.ref]);
}

export function makeQuoteScene(sentence: Sentence, settings: ProjectSettings): Scene {
  const provenance: Provenance = { kind: 'extracted', ref: sentence.ref, confidence: 0.98 };
  const layers: Layer[] = [
    {
      id: newId('layer'),
      type: 'quote',
      text: sentence.text,
      attribution: `Page ${sentence.ref.page}`,
      provenance,
      frame: { x: M, y: 0.24, w: 1 - M * 2, h: 0.5 },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: { preset: 'rise', delayMs: 90, durationMs: 720, reducedMotion: 'fade' },
      emphasis: [],
      altText: null,
      decorative: false,
    },
  ];
  const cue = makeCue(sentence.text, provenance, 'factual', settings);
  return assemble('quote', 'Quote', layers, [cue], [sentence.ref]);
}

export function addSentenceToScene(scene: Scene, sentence: Sentence): void {
  const provenance: Provenance = { kind: 'extracted', ref: sentence.ref, confidence: 0.95 };
  const used = scene.layers.length;
  scene.layers.push(
    textLayer(
      sentence.text,
      provenance,
      'caption',
      { x: M, y: Math.min(0.82, 0.2 + used * 0.11), w: 1 - M * 2, h: 0.1 },
      200 + used * 90,
    ),
  );
  scene.sourceRefs.push(sentence.ref);

  const words = sentence.text.split(/\s+/).filter(Boolean);
  const durationMs = Math.max(900, (words.length / WORDS_PER_SECOND) * 1000);
  const last = scene.narration.at(-1);
  const startMs = last ? last.startMs + last.durationMs + 180 : 420;
  scene.narration.push({
    id: newId('cue'),
    text: sentence.text,
    provenance,
    role: 'factual',
    startMs,
    durationMs,
    words: evenTimings(words, durationMs),
  });
  scene.durationMs = Math.max(scene.durationMs, startMs + durationMs + 620);
}

/* ============================================================================
   Helpers
   ========================================================================== */

function assemble(
  kind: Scene['kind'],
  title: string,
  layers: Layer[],
  cues: NarrationCue[],
  refs: Scene['sourceRefs'],
): Scene {
  let t = 420;
  const timed = cues.map((c) => {
    const positioned = { ...c, startMs: t };
    t += c.durationMs + 180;
    return positioned;
  });
  return {
    id: newId('scene'),
    title,
    kind,
    durationMs: Math.max(2200, t + 620),
    durationPinned: false,
    layers: layers.map((l, i) => ({ ...l, z: i + 1 })),
    narration: timed,
    transitionIn: 'dissolve',
    sourceRefs: refs,
    locked: false,
    hidden: false,
  };
}

function textLayer(
  text: string,
  provenance: Provenance,
  role: TextLayer['role'],
  frame: TextLayer['frame'],
  delayMs: number,
  withSweep = true,
): TextLayer {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return {
    id: newId('layer'),
    type: 'text',
    atoms: [{ id: newId('atom'), text, provenance }],
    role,
    align: 'start',
    frame,
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: { preset: 'rise', delayMs, durationMs: 620, reducedMotion: 'fade' },
    emphasis: withSweep
      ? [
          {
            id: newId('atom'),
            treatment: 'sweep',
            wordRange: [0, wordCount],
            timing: { mode: 'word', cueId: '' as never, wordIndex: 0, trailWords: 3 },
            colorToken: 'hl-yellow',
          },
        ]
      : [],
    altText: null,
    decorative: false,
  };
}

function makeCue(
  text: string,
  provenance: Provenance,
  role: NarrationCue['role'],
  settings: ProjectSettings,
): NarrationCue {
  const words = text.split(/\s+/).filter(Boolean);
  const durationMs = Math.max(
    900,
    (words.length / (WORDS_PER_SECOND * settings.speakingRate)) * 1000,
  );
  return {
    id: newId('cue'),
    text,
    provenance,
    role,
    startMs: 0,
    durationMs,
    words: evenTimings(words, durationMs),
  };
}

function evenTimings(words: string[], durationMs: number) {
  const per = durationMs / Math.max(1, words.length);
  return words.map((w, i) => ({ text: w, startMs: i * per, endMs: (i + 1) * per }));
}

function pickStat(stats: Statistic[]): Statistic | null {
  if (stats.length === 0) return null;
  const rank: Record<string, number> = {
    percentage: 5,
    ratio: 4,
    correlation: 4,
    'mean-sd': 3,
    count: 2,
    'confidence-interval': 1,
    other: 1,
    'sample-size': 0,
    'p-value': 0,
  };
  return [...stats].sort((a, b) => (rank[b.kind] ?? 0) - (rank[a.kind] ?? 0))[0];
}

function titleFor(sentence: Sentence, stat: Statistic | null): string {
  if (stat) return stat.raw.length < 14 ? stat.raw : 'Finding';
  const words = sentence.text.split(/\s+/).slice(0, 4).join(' ');
  return words.length > 2 ? words.replace(/[,.;:]$/, '') + '…' : 'From the paper';
}


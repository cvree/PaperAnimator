import { newId } from '@/core/id';
import type {
  Aspect,
  Audience,
  Figure,
  Frame,
  Grounded,
  Layer,
  MotionSpec,
  NarrationCue,
  Paper,
  PaperTable,
  ProjectSettings,
  Provenance,
  Scene,
  SceneKind,
  SourceRef,
  Statistic,
  TextAtom,
  TextLayer,
} from '@/core/types';
import { formatStat } from '@/extract/stats';

/**
 * The composer builds scenes by *selecting* from the paper, never by writing
 * about it. Every on-screen atom and every narration cue is either a span of the
 * source (extracted) or a linking phrase that carries no claim (connective).
 *
 * That is what lets the product promise that nothing on screen is invented: it
 * is structurally incapable of inventing.
 */

const WORDS_PER_SECOND = 2.65;
const LEAD_IN_MS = 420;
const LEAD_OUT_MS = 620;
const MIN_SCENE_MS = 2200;

export interface ComposeOptions {
  settings: ProjectSettings;
  /** Soft cap; scenes are dropped by priority, never truncated mid-thought. */
  targetDurationMs: number | null;
}

interface Draft {
  scene: Scene;
  priority: number;
}

export function composeScenes(paper: Paper, options: ComposeOptions): Scene[] {
  const drafts: Draft[] = [];
  const { settings } = options;

  drafts.push({ scene: titleScene(paper, settings), priority: 100 });

  const q = paper.comprehension.question;
  if (q) drafts.push({ scene: statementScene('question', 'The question', q, settings), priority: 90 });

  const m = paper.comprehension.method;
  if (m) drafts.push({ scene: statementScene('method', 'How they studied it', m, settings), priority: 70 });

  // Findings, strongest first. A finding carrying a statistic becomes a stat scene.
  const usedStats = new Set<string>();
  paper.comprehension.findings.forEach((finding, i) => {
    const stat = findStatFor(finding, paper.statistics, usedStats);
    if (stat) {
      usedStats.add(stat.id);
      drafts.push({ scene: statisticScene(finding, stat, settings), priority: 88 - i * 2 });
    } else {
      drafts.push({
        scene: statementScene('finding', `Finding ${i + 1}`, finding, settings),
        priority: 86 - i * 2,
      });
    }
  });

  // Figures worth showing: confident, captioned, and actually cropped.
  const figures = [...paper.figures]
    .filter((f) => f.image && f.confidence > 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
  figures.forEach((fig, i) => {
    drafts.push({ scene: figureScene(fig, paper, settings), priority: 76 - i * 3 });
  });

  const tables = paper.tables.filter((t) => t.image).slice(0, 2);
  tables.forEach((tab, i) => {
    drafts.push({ scene: tableScene(tab, settings), priority: 60 - i * 3 });
  });

  paper.comprehension.limitations.slice(0, 2).forEach((lim, i) => {
    drafts.push({
      scene: statementScene('limitation', i === 0 ? 'What it cannot tell us' : 'Another caveat', lim, settings),
      priority: 74 - i,
    });
  });

  const conclusion = paper.comprehension.conclusions[0];
  if (conclusion) {
    drafts.push({
      scene: statementScene('conclusion', 'What it means', conclusion, settings),
      priority: 85,
    });
  }

  if (paper.references.length > 0 && settings.citationMode !== 'none') {
    drafts.push({ scene: citationsScene(paper, settings), priority: 40 });
  }

  // Order by narrative position, then trim by priority against the budget.
  const ORDER: SceneKind[] = [
    'title',
    'question',
    'method',
    'statistic',
    'finding',
    'figure',
    'table',
    'limitation',
    'conclusion',
    'citations',
  ];
  const ordered = [...drafts].sort((a, b) => {
    const d = ORDER.indexOf(a.scene.kind) - ORDER.indexOf(b.scene.kind);
    return d !== 0 ? d : b.priority - a.priority;
  });

  const budget = options.targetDurationMs;
  if (!budget) return renumber(ordered.map((d) => d.scene));

  let total = ordered.reduce((sum, d) => sum + d.scene.durationMs, 0);
  const droppable = [...ordered].sort((a, b) => a.priority - b.priority);
  const dropped = new Set<string>();
  for (const d of droppable) {
    if (total <= budget * 1.12) break;
    if (d.scene.kind === 'title' || d.scene.kind === 'conclusion') continue;
    dropped.add(d.scene.id);
    total -= d.scene.durationMs;
  }

  return renumber(ordered.filter((d) => !dropped.has(d.scene.id)).map((d) => d.scene));
}

function renumber(scenes: Scene[]): Scene[] {
  let findingIndex = 0;
  return scenes.map((s) => {
    if (s.kind === 'finding' || s.kind === 'statistic') {
      findingIndex++;
      if (/^Finding \d+$/.test(s.title)) return { ...s, title: `Finding ${findingIndex}` };
    }
    return s;
  });
}

/* ============================================================================
   Scene builders
   ========================================================================== */

const M = 0.088; // page margin, normalized

/**
 * A kicker, a figure number, a section name. These are the presentation's own
 * furniture: they assert nothing about the paper, and calling them "yours"
 * would both be untrue and drag the integrity score down for wording nobody
 * wrote and nobody needs to check.
 */
const LABEL: Provenance = { kind: 'connective' };

function titleScene(paper: Paper, settings: ProjectSettings): Scene {
  const title = paper.meta.title ?? 'Untitled paper';
  const titleRef: SourceRef = {
    page: 1,
    quads: [],
    text: title,
  };
  const layers: Layer[] = [];

  layers.push(
    text({
      atoms: [atom(title, prov(titleRef))],
      role: 'display',
      frame: { x: M, y: 0.24, w: 1 - M * 2, h: 0.34 },
      enter: motion('rise', 0, 720),
      align: 'start',
    }),
  );

  layers.push({
    id: newId('layer'),
    type: 'rule',
    orientation: 'horizontal',
    weight: 1,
    frame: { x: M, y: 0.63, w: 1 - M * 2, h: 0.002 },
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: motion('draw-on', 480, 640),
    emphasis: [],
    altText: null,
    decorative: true,
  });

  const byline = paper.meta.authors.length
    ? paper.meta.authors.map((a) => a.name).join(' · ')
    : null;
  if (byline) {
    layers.push(
      text({
        atoms: [atom(byline, prov({ page: 1, quads: [], text: byline }))],
        role: 'label',
        frame: { x: M, y: 0.67, w: 1 - M * 2, h: 0.06 },
        enter: motion('rise', 620, 520),
        align: 'start',
      }),
    );
  }

  const meta = [paper.meta.year, paper.meta.doi ? `doi:${paper.meta.doi}` : null]
    .filter(Boolean)
    .join('  ·  ');
  if (meta) {
    layers.push(
      text({
        atoms: [atom(meta, { kind: 'authored' })],
        role: 'caption',
        frame: { x: M, y: 0.74, w: 1 - M * 2, h: 0.05 },
        enter: motion('rise', 760, 480),
        align: 'start',
      }),
    );
  }

  const cues: NarrationCue[] = [
    cue(title, prov(titleRef), 'factual', settings),
  ];
  if (byline) cues.push(cue(`A paper by ${byline}.`, { kind: 'connective' }, 'transition', settings));

  return scene('title', 'Title', layers, cues, [titleRef], settings);
}

function statementScene(
  kind: SceneKind,
  title: string,
  grounded: Grounded<string>,
  settings: ProjectSettings,
): Scene {
  const p = prov(grounded.refs[0], grounded.confidence);
  const body = grounded.value;
  const layers: Layer[] = [
    text({
      atoms: [atom(title.toUpperCase(), LABEL)],
      role: 'label',
      frame: { x: M, y: 0.18, w: 0.5, h: 0.05 },
      enter: motion('rise', 0, 420),
      align: 'start',
    }),
    text({
      atoms: [atom(body, p)],
      role: body.length > 190 ? 'body' : 'headline',
      frame: { x: M, y: 0.28, w: 1 - M * 2, h: 0.46 },
      enter: motion('rise', 160, 640),
      align: 'start',
      emphasisFromWords: true,
    }),
  ];

  return scene(kind, title, layers, [cue(body, p, kind === 'question' ? 'question' : 'factual', settings)], grounded.refs, settings);
}

function statisticScene(
  grounded: Grounded<string>,
  stat: Statistic,
  settings: ProjectSettings,
): Scene {
  const p = prov(stat.ref, 0.95);
  const display = stat.raw;
  const qualifiers = stat.qualifiers.map((q) => q.raw);
  const context = grounded.value;

  const layers: Layer[] = [
    {
      id: newId('layer'),
      type: 'stat',
      display,
      // The sentence is its own layer below, where the marker can follow the
      // narration across it. Repeating it here printed the same claim twice.
      caption: null,
      qualifiers,
      showQualifiers: qualifiers.length > 0,
      countUp: stat.value !== null && stat.value > 0 && stat.value < 100000,
      provenance: p,
      frame: { x: M, y: 0.2, w: 1 - M * 2, h: 0.4 },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: motion('rise', 80, 700),
      emphasis: [],
      altText: `${display}${qualifiers.length ? `, ${qualifiers.join(', ')}` : ''}`,
      decorative: false,
    },
    text({
      atoms: [atom(context, prov(grounded.refs[0], grounded.confidence))],
      role: 'body',
      frame: { x: M, y: 0.66, w: 1 - M * 2, h: 0.22 },
      enter: motion('rise', 420, 560),
      align: 'start',
      emphasisFromWords: true,
    }),
  ];

  const narration = qualifiers.length
    ? `${context} ${formatStat(stat, true) === stat.raw ? '' : `The paper reports ${formatStat(stat, true)}.`}`.trim()
    : context;

  return scene(
    'statistic',
    'Finding',
    layers,
    [cue(narration, p, 'factual', settings)],
    [stat.ref, ...grounded.refs],
    settings,
  );
}

function figureScene(fig: Figure, paper: Paper, settings: ProjectSettings): Scene {
  const p = prov(fig.ref, fig.confidence);
  const mention = findMention(fig, paper);
  const layers: Layer[] = [
    {
      id: newId('layer'),
      type: 'figure',
      figureId: fig.id,
      src: fig.image,
      caption: fig.caption,
      provenance: p,
      fit: 'contain',
      frame: { x: M, y: 0.16, w: 1 - M * 2, h: 0.56 },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: motion('crop-in', 60, 780),
      emphasis: [],
      altText: fig.altText,
      decorative: false,
    },
    text({
      atoms: [atom(fig.label.toUpperCase(), LABEL)],
      role: 'label',
      frame: { x: M, y: 0.755, w: 0.3, h: 0.04 },
      enter: motion('rise', 520, 380),
      align: 'start',
    }),
  ];

  if (fig.caption) {
    layers.push(
      text({
        atoms: [atom(shorten(stripLabel(fig.caption), 220), p)],
        role: 'caption',
        frame: { x: M, y: 0.8, w: 1 - M * 2, h: 0.12 },
        enter: motion('rise', 600, 460),
        align: 'start',
      }),
    );
  }

  const narrationText = mention?.text ?? stripLabel(fig.caption ?? '') ?? fig.label;
  const narrationProv = mention ? prov(mention.ref, 0.9) : p;

  return scene(
    'figure',
    fig.label,
    layers,
    [cue(narrationText || `${fig.label}.`, narrationText ? narrationProv : { kind: 'connective' }, 'factual', settings)],
    [fig.ref, ...(mention ? [mention.ref] : [])],
    settings,
  );
}

function tableScene(tab: PaperTable, settings: ProjectSettings): Scene {
  const p = prov(tab.ref, tab.confidence);
  const layers: Layer[] = [
    {
      id: newId('layer'),
      type: 'table',
      tableId: tab.id,
      src: tab.image,
      grid: tab.grid,
      caption: tab.caption,
      provenance: p,
      frame: { x: M, y: 0.18, w: 1 - M * 2, h: 0.56 },
      z: 1,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      enter: motion('unfold', 60, 720),
      emphasis: [],
      altText: `${tab.label}${tab.caption ? `: ${stripLabel(tab.caption)}` : ''}`,
      decorative: false,
    },
    text({
      atoms: [atom(tab.label.toUpperCase(), LABEL)],
      role: 'label',
      frame: { x: M, y: 0.78, w: 0.3, h: 0.04 },
      enter: motion('rise', 480, 380),
      align: 'start',
    }),
  ];
  if (tab.caption) {
    layers.push(
      text({
        atoms: [atom(shorten(stripLabel(tab.caption), 200), p)],
        role: 'caption',
        frame: { x: M, y: 0.825, w: 1 - M * 2, h: 0.1 },
        enter: motion('rise', 560, 440),
        align: 'start',
      }),
    );
  }
  return scene(
    'table',
    tab.label,
    layers,
    [cue(stripLabel(tab.caption ?? '') || `${tab.label}.`, tab.caption ? p : { kind: 'connective' }, 'factual', settings)],
    [tab.ref],
    settings,
  );
}

function citationsScene(paper: Paper, settings: ProjectSettings): Scene {
  void settings;
  const cited = paper.references.slice(0, 7);
  const lines = cited.map((r) => shorten(r.raw, 110));
  const layers: Layer[] = [
    text({
      atoms: [atom('SOURCES', LABEL)],
      role: 'label',
      frame: { x: M, y: 0.16, w: 0.4, h: 0.05 },
      enter: motion('rise', 0, 400),
      align: 'start',
    }),
    text({
      atoms: [
        atom(
          paper.meta.title ?? 'This paper',
          prov({ page: 1, quads: [], text: paper.meta.title ?? '' }),
        ),
      ],
      role: 'headline',
      frame: { x: M, y: 0.24, w: 1 - M * 2, h: 0.16 },
      enter: motion('rise', 120, 520),
      align: 'start',
    }),
    text({
      atoms: lines.map((l, i) =>
        atom(l, prov(cited[i].ref, 0.9)),
      ),
      role: 'caption',
      frame: { x: M, y: 0.46, w: 1 - M * 2, h: 0.42 },
      enter: motion('rise', 260, 620),
      align: 'start',
    }),
  ];
  return scene(
    'citations',
    'Sources',
    layers,
    [cue('Every claim in this presentation traces back to the paper.', { kind: 'connective' }, 'transition', settings)],
    cited.map((c) => c.ref),
    settings,
  );
}

/* ============================================================================
   Helpers
   ========================================================================== */

function scene(
  kind: SceneKind,
  title: string,
  layers: Layer[],
  cues: NarrationCue[],
  refs: SourceRef[],
  _settings: ProjectSettings,
): Scene {
  let t = LEAD_IN_MS;
  const timed = cues.map((c) => {
    const positioned = { ...c, startMs: t };
    t += c.durationMs + 180;
    return positioned;
  });
  const duration = Math.max(MIN_SCENE_MS, t + LEAD_OUT_MS);

  return {
    id: newId('scene'),
    title,
    kind,
    durationMs: duration,
    durationPinned: false,
    layers: layers.map((l, i) => ({ ...l, z: i + 1 })),
    narration: timed,
    transitionIn: kind === 'title' ? 'cut' : 'dissolve',
    sourceRefs: refs.filter(Boolean),
    locked: false,
    hidden: false,
  };
}

interface TextArgs {
  atoms: TextAtom[];
  role: TextLayer['role'];
  frame: Frame;
  enter: MotionSpec;
  align: TextLayer['align'];
  emphasisFromWords?: boolean;
}

function text(args: TextArgs): TextLayer {
  const full = args.atoms.map((a) => a.text).join(' ');
  const wordCount = full.split(/\s+/).filter(Boolean).length;
  return {
    id: newId('layer'),
    type: 'text',
    atoms: args.atoms,
    role: args.role,
    align: args.align,
    frame: args.frame,
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: args.enter,
    // A highlight that tracks the narration, word by word, across the whole line.
    emphasis: args.emphasisFromWords
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

function atom(text: string, provenance: Provenance): TextAtom {
  return { id: newId('atom'), text, provenance };
}

function prov(ref: SourceRef | undefined, confidence = 0.92): Provenance {
  if (!ref) return { kind: 'unsupported', reason: 'no-source', reviewed: false, detail: 'No source span was attached.' };
  return { kind: 'extracted', ref, confidence };
}

function motion(preset: MotionSpec['preset'], delayMs: number, durationMs: number): MotionSpec {
  return { preset, delayMs, durationMs, reducedMotion: 'fade' };
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
    (words.length / (WORDS_PER_SECOND * settings.speakingRate)) * 1000,
  );
  const per = durationMs / Math.max(1, words.length);
  return {
    id: newId('cue'),
    text,
    provenance,
    role,
    startMs: 0,
    durationMs,
    // Provisional even spacing; replaced by real boundary timings when spoken.
    words: words.map((w, i) => ({ text: w, startMs: i * per, endMs: (i + 1) * per })),
  };
}

function findStatFor(
  grounded: Grounded<string>,
  stats: Statistic[],
  used: Set<string>,
): Statistic | null {
  const candidates = stats.filter(
    (s) => s.sentenceId === grounded.sentenceId && !used.has(s.id),
  );
  if (candidates.length === 0) return null;
  const rank: Record<string, number> = {
    percentage: 5,
    ratio: 4,
    'mean-sd': 3,
    count: 2,
    'confidence-interval': 1,
    correlation: 3,
    'sample-size': 0,
    'p-value': 0,
    other: 1,
  };
  return candidates.sort((a, b) => (rank[b.kind] ?? 0) - (rank[a.kind] ?? 0))[0];
}

function findMention(fig: Figure, paper: Paper): { text: string; ref: SourceRef } | null {
  const num = /(\d+)/.exec(fig.label)?.[1];
  if (!num) return null;
  const re = new RegExp(`\\b(fig(?:ure)?\\.?\\s*${num})\\b`, 'i');
  for (const section of paper.sections) {
    for (const para of section.paragraphs) {
      for (const sentence of para.sentences) {
        if (re.test(sentence.text) && sentence.text.length > 40 && sentence.text.length < 320) {
          return { text: sentence.text, ref: sentence.ref };
        }
      }
    }
  }
  return null;
}

function stripLabel(caption: string): string {
  return caption
    .replace(/^\s*(fig(?:ure)?s?\.?|table|tab\.?|scheme|chart)\s*\.?\s*[\dIVXLC]+[a-z]?\s*[.:—–-]?\s*/i, '')
    .trim();
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd() + '…';
}

export function estimateDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, s) => sum + s.durationMs, 0);
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  expert: 'Specialists in the field',
  informed: 'Scientifically literate, outside the field',
  general: 'No background assumed',
};

export const ASPECT_LABEL: Record<Aspect, string> = {
  '16:9': 'Widescreen',
  '1:1': 'Square',
  '9:16': 'Vertical',
};

/**
 * Paper Animator — core types.
 *
 * Rule: every piece of on-screen content carries exactly one Provenance.
 * There is no way to construct a factual atom without saying where it came from.
 */

export type Id<T extends string> = string & { readonly __brand: T };

export type ProjectId = Id<'project'>;
export type SceneId = Id<'scene'>;
export type LayerId = Id<'layer'>;
export type AtomId = Id<'atom'>;
export type CueId = Id<'cue'>;
export type FigureId = Id<'figure'>;
export type TableId = Id<'table'>;
export type RefId = Id<'reference'>;

/* ============================================================================
   Source geometry
   ========================================================================== */

/** Rect in normalized page space (0–1 of page width/height, origin top-left). */
export interface Quad {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceRef {
  /** 1-indexed, matches Page.number */
  page: number;
  /** One quad per line fragment. Empty when we could not resolve geometry. */
  quads: Quad[];
  /** The exact source text. */
  text: string;
  anchor?: string;
}

/* ============================================================================
   Provenance — the trust system
   ========================================================================== */

export type UnsupportedReason =
  | 'no-source'
  | 'value-mismatch'
  | 'hedge-strengthened'
  | 'citation-unmatched'
  | 'source-deleted';

export type Provenance =
  | { kind: 'extracted'; ref: SourceRef; confidence: number }
  | { kind: 'paraphrase'; ref: SourceRef; confidence: number }
  | { kind: 'explanation'; ref: SourceRef; confidence: number }
  | { kind: 'connective' }
  | { kind: 'authored' }
  | { kind: 'unsupported'; reason: UnsupportedReason; reviewed: boolean; detail: string };

export type ProvenanceKind = Provenance['kind'];

export const PROVENANCE_META: Record<
  ProvenanceKind,
  { label: string; glyph: string; description: string; token: string }
> = {
  extracted: {
    label: 'Verbatim',
    glyph: '▣',
    description: 'Taken word for word from the paper',
    token: 'extracted',
  },
  paraphrase: {
    label: 'Paraphrase',
    glyph: '◨',
    description: 'Restated from the paper without changing its meaning',
    token: 'paraphrase',
  },
  explanation: {
    label: 'Explanation',
    glyph: '◇',
    description: 'Plain-language gloss of a specific passage',
    token: 'explanation',
  },
  connective: {
    label: 'Transition',
    glyph: '⋯',
    description: 'Linking words that carry no claim',
    token: 'connective',
  },
  authored: {
    label: 'Yours',
    glyph: '✎',
    description: 'You wrote this',
    token: 'authored',
  },
  unsupported: {
    label: 'Needs review',
    glyph: '△',
    description: 'Not yet traced to the paper',
    token: 'unsupported',
  },
};

export function provenanceRef(p: Provenance): SourceRef | null {
  return p.kind === 'extracted' || p.kind === 'paraphrase' || p.kind === 'explanation'
    ? p.ref
    : null;
}

export function isGrounded(p: Provenance): boolean {
  return p.kind === 'extracted' || p.kind === 'paraphrase' || p.kind === 'explanation';
}

/** Where a layer came from in the paper, whatever kind of layer it is. */
export function layerRef(layer: Layer): SourceRef | null {
  if (layer.type === 'text') {
    for (const atom of layer.atoms) {
      const ref = provenanceRef(atom.provenance);
      if (ref) return ref;
    }
    return null;
  }
  if ('provenance' in layer) return provenanceRef(layer.provenance);
  return null;
}

/** Content that makes a factual assertion and therefore requires grounding. */
export function isFactual(p: Provenance): boolean {
  return p.kind !== 'connective';
}

/* ============================================================================
   The extracted paper
   ========================================================================== */

export type HedgeLevel =
  | 'assertion'
  | 'association'
  | 'suggestion'
  | 'speculation'
  | 'negative'
  | 'null-result';

export const HEDGE_RANK: Record<HedgeLevel, number> = {
  'null-result': 0,
  negative: 1,
  speculation: 2,
  suggestion: 3,
  association: 4,
  assertion: 5,
};

export type SectionKind =
  | 'abstract'
  | 'introduction'
  | 'background'
  | 'related-work'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'limitations'
  | 'conclusion'
  | 'references'
  | 'appendix'
  | 'acknowledgements'
  | 'other';

export interface Author {
  name: string;
  affiliation?: string;
}

export interface PaperMeta {
  title: string | null;
  authors: Author[];
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  year: number | null;
  language: string;
  pageCount: number;
  isScanned: boolean;
}

export interface TextItem {
  text: string;
  quad: Quad;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

export interface Page {
  number: number;
  width: number;
  height: number;
  /** Rendered raster as an object URL (session-scoped). */
  raster: string | null;
  items: TextItem[];
  ocr: boolean;
}

export interface Sentence {
  id: AtomId;
  text: string;
  ref: SourceRef;
  hedge: HedgeLevel;
  statIds: AtomId[];
  citationIds: RefId[];
  /** Heuristic 0–1 of how central this sentence is to the paper's argument. */
  salience: number;
}

export interface Paragraph {
  id: string;
  sentences: Sentence[];
  ref: SourceRef;
}

export interface Section {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  kind: SectionKind;
  paragraphs: Paragraph[];
  pageRange: [number, number];
  confidence: number;
}

export interface Figure {
  id: FigureId;
  label: string;
  caption: string | null;
  page: number;
  quad: Quad;
  /** Cropped raster as an object URL. */
  image: string | null;
  altText: string;
  altTextEdited: boolean;
  confidence: number;
  ref: SourceRef;
}

export interface TableGrid {
  headerRows: number;
  cells: string[][];
}

export interface PaperTable {
  id: TableId;
  label: string;
  caption: string | null;
  page: number;
  quad: Quad;
  image: string | null;
  grid: TableGrid | null;
  notes: string[];
  confidence: number;
  ref: SourceRef;
}

export type StatKind =
  | 'percentage'
  | 'p-value'
  | 'confidence-interval'
  | 'sample-size'
  | 'ratio'
  | 'mean-sd'
  | 'correlation'
  | 'count'
  | 'other';

export interface StatQualifier {
  kind: 'ci' | 'p' | 'n' | 'sd' | 'se';
  raw: string;
}

export interface Statistic {
  id: AtomId;
  raw: string;
  value: number | null;
  unit: string | null;
  kind: StatKind;
  qualifiers: StatQualifier[];
  ref: SourceRef;
  sentenceId: AtomId;
}

export interface Reference {
  id: RefId;
  marker: string;
  raw: string;
  authors: string | null;
  title: string | null;
  year: number | null;
  ref: SourceRef;
}

export type StageName =
  | 'intake'
  | 'pages'
  | 'structure'
  | 'figures'
  | 'tables'
  | 'references'
  | 'statistics'
  | 'comprehension';

export interface StageReport {
  stage: StageName;
  status: 'ok' | 'degraded' | 'skipped' | 'failed';
  durationMs: number;
  counts: Record<string, number>;
}

export interface Degradation {
  stage: StageName;
  reason: string;
  impact: string;
  remedy?: string;
}

export interface ExtractionReport {
  stages: StageReport[];
  degradations: Degradation[];
  overallConfidence: number;
  durationMs: number;
}

export interface Grounded<T> {
  value: T;
  refs: SourceRef[];
  hedge: HedgeLevel;
  confidence: number;
  sentenceId: AtomId;
}

export interface Comprehension {
  question: Grounded<string> | null;
  method: Grounded<string> | null;
  findings: Grounded<string>[];
  limitations: Grounded<string>[];
  conclusions: Grounded<string>[];
}

export interface Paper {
  meta: PaperMeta;
  pages: Page[];
  sections: Section[];
  figures: Figure[];
  tables: PaperTable[];
  statistics: Statistic[];
  references: Reference[];
  comprehension: Comprehension;
  extraction: ExtractionReport;
}

/* ============================================================================
   Project
   ========================================================================== */

export type StyleId = 'broadsheet' | 'notebook' | 'signal' | 'chalk';

export type Aspect = '16:9' | '1:1' | '9:16';

export const ASPECT_DIMS: Record<Aspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
};

export type Audience = 'expert' | 'informed' | 'general';

export interface ProjectSettings {
  aspect: Aspect;
  fps: 24 | 30 | 60;
  audience: Audience;
  targetDurationMs: number | null;
  citationMode: 'inline' | 'corner' | 'end-card' | 'none';
  voiceURI: string | null;
  speakingRate: number;
  captionsEnabled: boolean;
}

export type SceneKind =
  | 'title'
  | 'question'
  | 'context'
  | 'method'
  | 'finding'
  | 'figure'
  | 'table'
  | 'quote'
  | 'statistic'
  | 'limitation'
  | 'conclusion'
  | 'citations';

/** Normalized frame, 0–1 of the canvas. Resolution independent by construction. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How a layer arrives. Every preset is defined once, in `@/render/motion`, as a
 * pure function of progress — the editor, the previews and the exporter all read
 * that one definition, so an entrance cannot look different where it counts.
 */
export type MotionPreset =
  /* the originals */
  | 'rise'
  | 'settle'
  | 'draw-on'
  | 'crop-in'
  | 'unfold'
  | 'trace'
  | 'slide'
  | 'none'
  /* word- and letter-level entrances (text layers) */
  | 'cascade'
  | 'typeset'
  | 'scatter'
  | 'weigh-in'
  | 'tumble'
  /* whole-block entrances */
  | 'focus-pull'
  | 'ink-bleed'
  | 'sweep'
  | 'push'
  /* masked entrances, at their best on figures */
  | 'iris'
  | 'wipe'
  | 'develop'
  | 'shutter';

/** Sustained motion for as long as the layer is on screen. */
export type HoldPreset = 'none' | 'ken-burns' | 'drift' | 'breathe' | 'float' | 'sway';

export interface MotionSpec {
  preset: MotionPreset;
  delayMs: number;
  durationMs: number;
  /** Required. There is no way to author motion without deciding its still form. */
  reducedMotion: 'fade' | 'none';
  /** What keeps happening after the entrance has landed. Defaults to none. */
  hold?: HoldPreset;
  /**
   * How far the entrance travels, 0.25–2. One preset, quieter or louder, so a
   * choice of character does not force a choice of volume.
   */
  intensity?: number;
}

export type HighlightTreatment = 'sweep' | 'underline' | 'box' | 'spotlight' | 'strike';

export interface HighlightSpec {
  id: string;
  treatment: HighlightTreatment;
  /** Word range within the layer's own text. */
  wordRange: [number, number];
  timing:
    | { mode: 'absolute'; startMs: number; durationMs: number }
    | { mode: 'word'; cueId: CueId; wordIndex: number; trailWords: number };
  colorToken: 'hl-yellow' | 'hl-mint' | 'hl-sky' | 'hl-rose' | 'hl-lilac';
}

export interface TextAtom {
  id: AtomId;
  text: string;
  provenance: Provenance;
}

export interface LayerBase {
  id: LayerId;
  frame: Frame;
  z: number;
  opacity: number;
  rotation: number;
  locked: boolean;
  hidden: boolean;
  enter: MotionSpec;
  emphasis: HighlightSpec[];
  altText: string | null;
  decorative: boolean;
}

export type TextRole = 'display' | 'headline' | 'body' | 'caption' | 'label' | 'quote';

export interface TextLayer extends LayerBase {
  type: 'text';
  atoms: TextAtom[];
  role: TextRole;
  align: 'start' | 'center' | 'end';
}

export interface StatLayer extends LayerBase {
  type: 'stat';
  display: string;
  /** Null when the sentence behind the number is shown as its own layer. */
  caption: string | null;
  qualifiers: string[];
  showQualifiers: boolean;
  countUp: boolean;
  provenance: Provenance;
}

export interface FigureLayer extends LayerBase {
  type: 'figure';
  figureId: FigureId;
  src: string | null;
  caption: string | null;
  provenance: Provenance;
  fit: 'contain' | 'cover';
}

export interface TableLayer extends LayerBase {
  type: 'table';
  tableId: TableId;
  src: string | null;
  grid: TableGrid | null;
  caption: string | null;
  provenance: Provenance;
}

export interface QuoteLayer extends LayerBase {
  type: 'quote';
  text: string;
  attribution: string | null;
  provenance: Provenance;
}

export interface RuleLayer extends LayerBase {
  type: 'rule';
  orientation: 'horizontal' | 'vertical';
  weight: number;
}

export interface CitationLayer extends LayerBase {
  type: 'citation';
  text: string;
  provenance: Provenance;
}

export type Layer =
  | TextLayer
  | StatLayer
  | FigureLayer
  | TableLayer
  | QuoteLayer
  | RuleLayer
  | CitationLayer;

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export interface NarrationCue {
  id: CueId;
  text: string;
  provenance: Provenance;
  role: 'factual' | 'transition' | 'explanation' | 'question';
  startMs: number;
  durationMs: number;
  words: WordTiming[];
}

export interface Scene {
  id: SceneId;
  title: string;
  kind: SceneKind;
  durationMs: number;
  durationPinned: boolean;
  layers: Layer[];
  narration: NarrationCue[];
  transitionIn: 'dissolve' | 'crop' | 'turn' | 'recompose' | 'cut';
  sourceRefs: SourceRef[];
  locked: boolean;
  hidden: boolean;
}

export interface Project {
  id: ProjectId;
  version: 1;
  title: string;
  paper: Paper;
  settings: ProjectSettings;
  scenes: Scene[];
  style: StyleId;
  createdAt: string;
  updatedAt: string;
}

/* ============================================================================
   Integrity
   ========================================================================== */

export interface IntegrityIssue {
  id: string;
  severity: 'blocking' | 'warning' | 'info';
  reason: UnsupportedReason | 'low-confidence' | 'missing-alt-text' | 'no-narration';
  sceneId: SceneId;
  layerId?: LayerId;
  message: string;
  detail: string;
  fixes: IntegrityFix[];
}

export interface IntegrityFix {
  id: string;
  label: string;
  kind: 'accept' | 'navigate' | 'auto';
}

export interface IntegrityReport {
  score: number;
  coverage: number;
  counts: Record<ProvenanceKind, number>;
  issues: IntegrityIssue[];
  factualAtoms: number;
  groundedAtoms: number;
}

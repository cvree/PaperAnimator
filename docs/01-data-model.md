# 01 — Data Model

Types live in `packages/core/src/types/` and are the single source of truth. Every one has
a matching Zod schema in `packages/core/src/schema/` used for API validation, project-file
parsing, and LLM structured output. **If a type and its schema disagree, the schema wins**
— it is the one that runs at the boundary.

---

## 1. Identity

```ts
type Id<T extends string> = string & { readonly __brand: T };

type ProjectId  = Id<'project'>;
type SceneId    = Id<'scene'>;
type LayerId    = Id<'layer'>;
type AtomId     = Id<'atom'>;
type CueId      = Id<'cue'>;
type FigureId   = Id<'figure'>;
type TableId    = Id<'table'>;
type EquationId = Id<'equation'>;
type RefId      = Id<'reference'>;
type FootnoteId = Id<'footnote'>;
```

Branded strings: free at runtime, and they stop the entire class of bug where a `SceneId`
is passed where a `LayerId` belongs. IDs are ULIDs — sortable, so scene rails and
timelines have a stable natural order even before explicit ordering is applied.

---

## 2. The source document

The extraction output. Immutable once produced; re-extraction creates a new version.

```ts
interface Paper {
  id: ProjectId;
  meta: PaperMeta;
  pages: Page[];
  sections: Section[];          // tree, flattened with parentId
  figures: Figure[];
  tables: Table[];
  equations: Equation[];
  references: Reference[];
  footnotes: Footnote[];
  stats: Statistic[];           // every number we could parse, with its context
  extraction: ExtractionReport; // what worked, what degraded, what failed
}

interface PaperMeta {
  title: string | null;
  authors: Author[];
  affiliations: string[];
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  year: number | null;
  keywords: string[];
  language: string;             // BCP-47, detected
  pageCount: number;
  isScanned: boolean;
}

interface Page {
  number: number;               // 1-indexed, always
  width: number;                // PDF user-space units
  height: number;
  rotation: 0 | 90 | 180 | 270;
  textItems: TextItem[];        // from pdf.js, with transforms resolved
  thumbnailKey: string;         // object-store key, 200px wide WebP
  renderKey: string;            // 1600px WebP for the source pane
  ocr: boolean;                 // true if text came from OCR, not the PDF
}

interface TextItem {
  text: string;
  quad: Quad;                   // page coordinates
  fontSize: number;
  fontName: string;
  bold: boolean;
  italic: boolean;
}

/** Axis-aligned rect in PDF user space. Origin bottom-left, as PDF defines it.
 *  Convert to screen space only at the last moment, in the source-pane renderer. */
interface Quad { x: number; y: number; w: number; h: number; }
```

### Structural units

```ts
interface Section {
  id: string;
  parentId: string | null;
  level: 1 | 2 | 3 | 4;
  title: string;
  kind: SectionKind;
  paragraphs: Paragraph[];
  pageRange: [number, number];
  confidence: number;           // 0–1, how sure we are of the kind
}

type SectionKind =
  | 'abstract' | 'introduction' | 'background' | 'related-work'
  | 'methods'  | 'results'      | 'discussion' | 'limitations'
  | 'conclusion' | 'references' | 'appendix'   | 'acknowledgements'
  | 'other';

interface Paragraph {
  id: string;
  text: string;
  sentences: Sentence[];
  ref: SourceRef;
}

interface Sentence {
  id: AtomId;
  text: string;
  ref: SourceRef;
  containsStat: boolean;
  containsCitation: RefId[];
  hedging: HedgeLevel;          // see §2.1
}
```

### 2.1 Hedging — a first-class field

Scientific claims are graded. Flattening "was associated with" into "caused" is the most
common way a summary becomes wrong, so the grade is data, not prose:

```ts
type HedgeLevel =
  | 'assertion'    // "X reduces Y"
  | 'association'  // "X was associated with lower Y"
  | 'suggestion'   // "these results suggest X may reduce Y"
  | 'speculation'  // "X could plausibly reduce Y"
  | 'negative'     // "X did not reduce Y"
  | 'null-result'; // "no significant difference was observed"
```

The narration generator receives the source `HedgeLevel` and is prohibited from producing
output at a stronger level. A violation is caught by a post-check that compares the
generated sentence's detected hedge level against the source's; a strengthened claim is
demoted to `unsupported`.

### Figures, tables, equations, statistics

```ts
interface Figure {
  id: FigureId;
  label: string;                // "Figure 3"
  caption: string | null;
  page: number;
  quad: Quad;
  imageKey: string;             // cropped PNG at 2× device scale
  subpanels: { label: string; quad: Quad }[];  // "(a)", "(b)" if detected
  mentionedIn: AtomId[];        // sentences that reference it
  altText: string | null;       // generated, always user-editable
  confidence: number;
}

interface Table {
  id: TableId;
  label: string;
  caption: string | null;
  page: number;
  quad: Quad;
  imageKey: string;             // ALWAYS produced — the fallback if grid parsing failed
  grid: TableGrid | null;       // null when confidence < threshold
  units: Record<string, string>;// column key → unit, preserved separately
  notes: string[];              // table footnotes ("* p < .05")
  confidence: number;
}

interface TableGrid {
  headerRows: number;
  headerCols: number;
  cells: TableCell[][];
}
interface TableCell { text: string; rowSpan: number; colSpan: number; ref: SourceRef; }

interface Equation {
  id: EquationId;
  latex: string | null;         // null if we could only capture it as an image
  imageKey: string;
  page: number;
  quad: Quad;
  displayNumber: string | null; // "(4)"
}

interface Statistic {
  id: AtomId;
  raw: string;                  // exactly as printed: "12.4%" / "p < .001" / "n = 1,204"
  value: number | null;
  unit: string | null;
  kind: StatKind;
  qualifiers: StatQualifier[];  // CI, p, n, effect size — never dropped
  ref: SourceRef;
}

type StatKind =
  | 'count' | 'percentage' | 'mean' | 'median' | 'ratio' | 'odds-ratio'
  | 'hazard-ratio' | 'correlation' | 'p-value' | 'effect-size'
  | 'confidence-interval' | 'other';

interface StatQualifier { kind: 'ci' | 'p' | 'n' | 'sd' | 'se' | 'df'; raw: string; }
```

> **Design note.** `Table.imageKey` is non-optional on purpose. A cropped image of the
> real table is always correct; a reconstructed grid is sometimes wrong. When confidence
> is low we render the image and tell the user why, rather than showing a plausible-looking
> grid that has silently transposed a column.

---

## 3. Provenance

```ts
interface SourceRef {
  page: number;
  quads: Quad[];                // may span lines; one per line fragment
  text: string;                 // exact source text
  anchor?: FigureId | TableId | EquationId | RefId | FootnoteId;
}

type Provenance =
  | { kind: 'extracted';   ref: SourceRef; confidence: number }
  | { kind: 'paraphrase';  ref: SourceRef; confidence: number }
  | { kind: 'explanation'; ref: SourceRef; confidence: number }
  | { kind: 'connective' }
  | { kind: 'authored' }
  | { kind: 'unsupported'; reason: UnsupportedReason; reviewed: boolean };

type UnsupportedReason =
  | 'no-source'          // model produced a factual claim with no citation
  | 'value-mismatch'     // rendered number ≠ source number
  | 'hedge-strengthened' // claim asserted more strongly than the source
  | 'citation-unmatched' // attributed to a reference we couldn't resolve
  | 'source-deleted'     // the span it pointed at no longer exists
  | 'contradiction';     // conflicts with another extracted passage
```

### Invariants (enforced in `packages/core/src/invariants.ts`, asserted in tests)

| # | Invariant |
|---|---|
| P1 | Every `TextAtom`, `StatAtom`, and `NarrationCue` has exactly one `Provenance`. |
| P2 | `connective` provenance may only appear on cues classified as transitions, and on no on-screen factual text. |
| P3 | A `StatAtom` renders only if its display string is derivable from `ref.text` by an allowed transform (rounding is *not* allowed by default; unit conversion requires an explicit, recorded conversion). Otherwise → `unsupported/value-mismatch`. |
| P4 | `unsupported` content with `reviewed: false` renders with a review chip and is excluded from narration audio. |
| P5 | Deleting a source span sets dependents to `unsupported/source-deleted`; it never leaves stale text with a dangling ref. |
| P6 | `confidence < 0.5` forces a visible uncertainty affordance in the editor (not necessarily in the export). |

### Integrity score

```ts
interface IntegrityReport {
  score: number;                        // 0–100
  coverage: number;                     // grounded atoms / factual atoms
  counts: Record<Provenance['kind'], number>;
  unresolved: IntegrityIssue[];
  updatedAt: string;
}

interface IntegrityIssue {
  id: string;
  severity: 'blocking' | 'warning' | 'info';
  reason: UnsupportedReason | 'low-confidence' | 'missing-citation';
  sceneId: SceneId;
  layerId?: LayerId;
  ref?: SourceRef;
  message: string;                      // written for a human, not a log
}
```

Score is computed, never stored as truth — it is derived from the project on every
mutation and memoized. `blocking` issues are the ones that gate a clean export.

---

## 4. The project

```ts
interface Project {
  id: ProjectId;
  version: 3;                   // schema version, bumped on breaking change
  title: string;
  paper: Paper;
  settings: ProjectSettings;
  scenes: Scene[];              // order is presentation order
  audio: AudioTrack[];
  style: StyleId;
  overrides: StyleOverride[];   // user edits that survive a style switch
  createdAt: string;
  updatedAt: string;
}

interface ProjectSettings {
  aspect: '16:9' | '1:1' | '9:16';
  resolution: { w: number; h: number };
  fps: 24 | 30 | 60;
  audience: 'expert' | 'informed' | 'general';
  tone: 'neutral' | 'explanatory' | 'enthusiastic' | 'cautious';
  targetDurationMs: number | null;
  citationMode: 'inline' | 'corner' | 'end-card' | 'none';
  voice: VoiceSettings;
  captions: { enabled: boolean; style: CaptionStyle };
  reducedMotionVariant: 'auto' | 'always';
}
```

### Scenes and layers

```ts
interface Scene {
  id: SceneId;
  title: string;                // shown in the rail; user-editable
  kind: SceneKind;
  durationMs: number;           // authoritative; derived from narration by default
  layers: Layer[];
  narration: NarrationCue[];
  transitionIn: Transition;
  beats: Beat[];                // named times other things key off
  sourceRefs: SourceRef[];      // union of everything this scene draws on
  locked: boolean;
  hidden: boolean;
}

type SceneKind =
  | 'title' | 'question' | 'context' | 'method' | 'finding'
  | 'figure' | 'table' | 'quote'  | 'comparison' | 'process'
  | 'limitation' | 'conclusion' | 'citations';

interface Beat { id: string; label: string; atMs: number; }

type Layer =
  | TextLayer | StatLayer | FigureLayer | TableLayer
  | QuoteLayer | ChartLayer | ShapeLayer | CaptionLayer | CitationLayer;

interface LayerBase {
  id: LayerId;
  frame: Frame;                 // normalized 0–1 coordinates — resolution independent
  z: number;
  opacity: number;
  rotation: number;
  locked: boolean;
  hidden: boolean;
  enter: MotionSpec;
  exit: MotionSpec;
  emphasis: HighlightSpec[];    // the "highlighting for effect" system
  a11y: { altText: string | null; decorative: boolean };
}

interface Frame { x: number; y: number; w: number; h: number; }  // 0–1 of canvas

interface TextLayer extends LayerBase {
  type: 'text';
  atoms: TextAtom[];            // provenance is per-atom, not per-layer
  role: 'display' | 'headline' | 'body' | 'caption' | 'label';
}

interface TextAtom { id: AtomId; text: string; provenance: Provenance; }

interface StatLayer extends LayerBase {
  type: 'stat';
  atom: StatAtom;
  showQualifiers: boolean;      // defaults true; turning it off warns
  countUp: boolean;
}
interface StatAtom { id: AtomId; display: string; statId: AtomId; provenance: Provenance; }
```

`Frame` is normalized so a project can be re-rendered at any resolution or aspect without
re-layout. Aspect changes re-run the style's layout strategy and mark moved layers.

### Motion and highlight

```ts
interface MotionSpec {
  preset: MotionPreset;
  delayMs: number;
  durationMs: number;
  easing: Easing;               // cubic-bezier tuple or named
  stagger?: { perChild: number; from: 'start' | 'centre' | 'end' };
  reducedMotion: 'fade' | 'none';  // the mandatory static equivalent
}

type MotionPreset =
  | 'rise' | 'settle' | 'draw-on' | 'crop-in' | 'unfold'
  | 'ink-bleed' | 'trace' | 'slide' | 'none';

interface HighlightSpec {
  id: string;
  treatment: 'sweep' | 'underline' | 'box' | 'spotlight' | 'strike' | 'tether';
  target: { atomId: AtomId } | { quad: Frame } | { childRange: [number, number] };
  timing:
    | { mode: 'absolute'; startMs: number; durationMs: number }
    | { mode: 'word'; cueId: CueId; wordIndex: number; trailWords: number };
  colorToken: string;           // token name, never a literal — style switch must work
  tether?: { toLayerId: LayerId };
}
```

`timing.mode: 'word'` is the highlight-follows-voice mechanism: the sweep's progress is
computed from the cue's word timings at frame-resolve time, so it stays correct if the
narration is re-synthesized, the rate changes, or the voice changes.

### Narration and audio

```ts
interface NarrationCue {
  id: CueId;
  text: string;
  provenance: Provenance;
  role: 'factual' | 'transition' | 'explanation' | 'question';
  startMs: number;              // relative to scene start
  durationMs: number;
  words: WordTiming[];          // required; alignment fills it if TTS won't
  audioKey: string | null;      // null until synthesized
  pronunciations: Record<string, string>;
  speakerNote: string | null;   // exported to PPTX notes
}

interface WordTiming { text: string; startMs: number; endMs: number; }

interface AudioTrack {
  id: string;
  kind: 'narration' | 'music' | 'sfx';
  src: string;
  gainDb: number;
  muted: boolean;
  solo: boolean;
  ducking: { enabled: boolean; targetDb: number; attackMs: number; releaseMs: number };
  clips: AudioClip[];
}
interface AudioClip { id: string; startMs: number; durationMs: number; offsetMs: number; }
```

---

## 5. Commands (undo/redo, and the collaboration seam)

Every mutation is a serializable command with an inverse. Nothing writes to the store
directly.

```ts
interface Command<T = unknown> {
  id: string;
  type: string;                 // 'scene.reorder', 'layer.setFrame', …
  label: string;                // shown in the undo tooltip: "Move title"
  payload: T;
  inverse: () => Command;
  coalesceKey?: string;         // drags coalesce into one undo step
  at: number;
}
```

- 50-step stack, per project.
- `coalesceKey` merges a continuous drag into one entry, so undo feels like a person
  would expect rather than replaying 200 mousemove events.
- Because commands are serializable and invertible, adding CRDT/OT transport later is a
  transport problem, not a rewrite.

---

## 6. Persistence

### Postgres (Prisma)

```prisma
model Project {
  id         String   @id
  ownerId    String
  title      String
  version    Int
  settings   Json
  styleId    String
  scenes     Json     // scene graph — read/written whole; small (< 2 MB typical)
  paperId    String
  paper      Paper    @relation(fields: [paperId], references: [id])
  integrity  Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  snapshots  Snapshot[]
  renders    Render[]
  @@index([ownerId, updatedAt])
}

model Paper {
  id          String   @id
  ownerId     String
  meta        Json
  structure   Json     // sections, paragraphs, sentences
  figures     Json
  tables      Json
  stats       Json
  references  Json
  extraction  Json     // the ExtractionReport
  pdfKey      String
  pageCount   Int
  createdAt   DateTime @default(now())
  projects    Project[]
}

model Snapshot {  // version history, last 20
  id        String   @id
  projectId String
  scenes    Json
  label     String?
  createdAt DateTime @default(now())
  @@index([projectId, createdAt])
}

model Render {
  id         String   @id
  projectId  String
  format     String
  preset     String
  status     String   // queued | running | done | failed | cancelled
  progress   Float
  stage      String?
  outputKey  String?
  error      Json?
  bytes      Int?
  createdAt  DateTime @default(now())
  @@index([projectId, createdAt])
}
```

Scene graphs are stored as JSONB rather than normalized rows: they are read and written
as a unit, they are small, and normalizing them would make every editor save a
multi-table transaction for no benefit. Provenance is queryable *within* the JSONB via
GIN indexes when the integrity view needs cross-project analytics.

### Object storage

```
papers/{paperId}/source.pdf
papers/{paperId}/pages/{n}.webp          page render, 1600px
papers/{paperId}/thumbs/{n}.webp         page thumb, 200px
papers/{paperId}/figures/{figureId}.png
papers/{paperId}/tables/{tableId}.png
projects/{projectId}/audio/{cueId}.mp3
projects/{projectId}/renders/{renderId}.{ext}
```

All access via signed URLs, 15-minute expiry. Delete is a prefix sweep plus a DB
transaction, both in one job with a completion receipt shown to the user.

### Local (IndexedDB)

`autosave` (debounced 3s), `journal` (command log since last server save), `assets`
(blob cache keyed by object-store key + etag). Recovery on load: if the journal is
non-empty and newer than the server copy, offer **Restore** vs **Discard** with a preview
of what changed — never silently pick one.

---

## 7. The `.paperanim` file

A zip. Deterministic ordering so the same project produces the same bytes — makes it
diffable and cacheable.

```
manifest.json      { format: 'paperanim', version: 3, app: '1.x', createdAt, checksum }
project.json       Project, with asset paths rewritten to be relative
paper/source.pdf   optional — omitted when `includeSource: false`
paper/pages/*.webp
assets/figures/*.png
assets/tables/*.png
assets/audio/*.mp3
```

**Import contract:** a `.paperanim` file opens in any build whose schema version is ≥ its
own. Older files are migrated forward through a chain of pure migration functions in
`packages/core/src/migrations/`; each migration has a fixture test. A newer file in an
older build refuses to open with an explicit message and a link — it never opens
partially.

**Portability guarantee:** with `includeSource: true` the file is fully self-contained.
Every provenance link resolves offline against the bundled pages. This is what makes the
project file a genuine archival artifact rather than a pointer into our database.

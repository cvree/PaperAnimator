# 02 — Extraction Pipeline

Turning a PDF into a `Paper` (see [01](01-data-model.md)). This is the part of the product
where being *honest about failure* matters more than being clever.

**Governing principle:** degrade visibly. Every stage reports what it achieved, what it
guessed, and what it could not do. The UI shows this while it happens, and the
`ExtractionReport` carries it into the editor.

---

## 1. Stages

Eight stages, run as a pipeline with per-stage progress emitted over SSE. Stages 3–7 run
concurrently where they don't depend on each other.

| # | Stage | Output | Degrades to |
|---|---|---|---|
| 1 | **Intake** | Validated file, page count, encryption check | Reject with a specific reason |
| 2 | **Page raster + text** | `Page[]` with `TextItem[]` and coordinates | OCR (stage 2b) |
| 2b | **OCR** *(conditional)* | Same shape, `ocr: true`, lower confidence | Image-only mode: figures still work, text does not |
| 3 | **Layout & structure** | `Section[]`, `Paragraph[]`, `Sentence[]` | Flat section list, one per page |
| 4 | **Figures** | `Figure[]` with crops and captions | Whole-page crops, uncaptioned |
| 5 | **Tables** | `Table[]` with grid *or* image | Image-only table (always available) |
| 6 | **References & citations** | `Reference[]`, in-text links | Unlinked reference strings |
| 7 | **Statistics & claims** | `Statistic[]`, hedge levels | Statistics without qualifiers, flagged |
| 8 | **Comprehension** | question / method / findings / limitations | Empty slots, never invented |

### Stage 1 — Intake

```ts
const LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxPages: 400,
  clientExtractionPageLimit: 60,   // above this, extraction moves server-side
} as const;
```

Checks, in order, each with its own user-facing message:

1. MIME + magic bytes are actually PDF (a renamed `.docx` is the most common mistake).
2. Not password-protected. If it is: ask for the password once, in-page, never store it.
3. Page count and byte size within limits.
4. Not a portfolio/collection PDF (offer to pick a contained document).
5. Text layer present? → decides whether stage 2b runs.

### Stage 2 — Page raster + text

`pdfjs-dist` in a dedicated worker. For each page:

- `getTextContent({ includeMarkedContent: true })` → items with a 6-element transform.
  We resolve each transform to a `Quad` in PDF user space. **This is the provenance
  foundation** — without real coordinates, "click a claim to see its source" is fiction.
- `page.render()` to an `OffscreenCanvas` at two scales → 1600px WebP (source pane) and
  200px WebP (thumbnails, hero).
- Detect a scanned page: fewer than 20 text items on a page with > 40% ink coverage.

**Reading order.** Two-column layouts are the default in this domain and naive
left-to-right extraction interleaves the columns into nonsense. Algorithm:

1. Project all text-item x-centres onto a histogram.
2. Find the deepest valley in the middle third; if the valley is < 15% of peak density
   and there is ink on both sides, treat as two columns.
3. Sort items into column buckets, then within each bucket sort by `-y`, then `x`.
4. Merge into lines using a y-tolerance of 0.4 × median font size.
5. Merge lines into paragraphs on: indentation change, vertical gap > 1.6 × leading, or
   font change.

Full-width elements (figures, tables, section headings spanning both columns) are
detected by width > 80% of the text block and are hoisted out of column ordering.

### Stage 2b — OCR

Triggered when > 40% of pages are scanned.

| Path | When | Engine |
|---|---|---|
| Client | ≤ 20 pages | `tesseract.js`, WASM, in a worker — the PDF never leaves the device |
| Server | > 20 pages | `ocrmypdf` (tesseract) in the extraction service |

OCR output carries word-level boxes, so provenance still works — just with lower
confidence (`0.6` ceiling). The UI states plainly: *"This paper is scanned. Text was read
by OCR, so quotes may contain small errors — check any figure you rely on."*

If OCR confidence is below 0.4 overall, we do **not** proceed to narration generation.
Instead we offer **Image mode**: figures and page crops are usable as scene content, text
extraction is disabled, and the user is told why. A wrong quote is worse than no quote.

### Stage 3 — Layout & structure

Section detection is a scoring function, not a regex:

```ts
function headingScore(line: Line, doc: DocStats): number {
  return (
    2.0 * z(line.fontSize, doc.bodyFontSize)      // bigger than body text
    + 1.5 * (line.bold ? 1 : 0)
    + 1.2 * (line.isNumbered ? 1 : 0)             // "3.", "3.1", "IV."
    + 1.0 * (line.isShort ? 1 : 0)                // < 8 words
    + 0.8 * (line.spaceAbove > 1.5 * doc.leading ? 1 : 0)
    + 0.8 * (line.isTitleCase || line.isAllCaps ? 1 : 0)
    - 1.5 * (line.endsWithPeriod ? 1 : 0)         // sentences aren't headings
  );
}
```

Above threshold → heading. Level from font size rank and numbering depth.
`SectionKind` is classified from the heading text against a synonym table
(`"Materials and Methods"` → `methods`, `"Findings"` → `results`, …), with
`claude-haiku-4-5` as the tiebreaker for headings that match nothing — a cheap,
high-volume classification, exactly what the small model is for.

**Fallback:** if fewer than 3 headings are found in a paper of > 4 pages, we abandon
structure detection and produce one section per page, with `confidence: 0.2` and a
visible notice. A wrong outline is more damaging than an obviously flat one.

Sentence segmentation uses `Intl.Segmenter` with a domain abbreviation guard
(`et al.`, `Fig.`, `Eq.`, `vs.`, `i.e.`, `e.g.`, `ca.`, `approx.`, `p.`, `pp.`, and
detected author initials) to stop mid-citation splits.

### Stage 4 — Figures

1. Extract embedded images (`page.getOperatorList()` → `OPS.paintImageXObject`) with
   their placement matrices.
2. Detect vector figures: dense clusters of path operations bounded away from text.
3. Merge nearby image + vector regions into one figure bbox (charts are often both).
4. Find the caption: nearest text block beginning `Fig`/`Figure`/`FIG` within 1.5 ×
   figure height below (or above — some venues caption above; detect per-document by
   majority).
5. Crop at 2× device scale with 8pt padding.
6. Detect subpanels: `(a)`, `(b)` labels inside the bbox → subpanel quads, so a scene can
   zoom to one panel.
7. Generate alt text with `claude-opus-5` from the crop **plus the caption plus the
   sentences that mention it** — context makes the difference between "a bar chart" and
   "a bar chart comparing recovery rates across three treatment groups". Always
   user-editable, always exported.

### Stage 5 — Tables

The hardest stage; the design assumes it will sometimes fail.

1. Detect the table region (ruled lines, or aligned whitespace columns).
2. **Always** crop an image of it. This is the guaranteed-correct artifact.
3. Attempt grid reconstruction:
   - Ruled tables: cluster horizontal/vertical rule segments → cell grid.
   - Unruled: cluster text-item x-positions into columns, y-positions into rows.
   - Detect header rows (bold, rule beneath, or unit-bearing).
   - Detect spans (a cell whose bbox covers multiple column centres).
4. Score confidence: rectangularity, consistent column count, header plausibility,
   numeric-type consistency down each column.
5. **Below 0.75 → `grid: null`.** The editor renders the image, and the inspector says:
   *"This table's structure couldn't be read reliably, so the original image is used.
   You can still highlight regions of it."*

Units are extracted into `Table.units` separately from cell text so that a scene showing
one column cannot lose its unit. Table footnotes (`* p < .05`) are captured into `notes`
and travel with any cell that references them.

### Stage 6 — References & citations

1. Locate the references section (heading kind, or the trailing dense block of
   `Author, Year` patterns).
2. Split entries by numbering (`[1]`, `1.`) or hanging-indent geometry.
3. Parse each into `{ authors, title, venue, year, doi, url }` with a grammar-first pass,
   falling back to `claude-haiku-4-5` structured extraction for entries the grammar
   rejects.
4. Link in-text citations: `[12]`, `(Smith et al., 2020)`, superscripts. Each link becomes
   a `RefId` on the containing `Sentence`.
5. Unmatched in-text citations are recorded as `citation-unmatched` issues rather than
   dropped — they surface in the integrity view.

Crossref enrichment is **off by default** (it reveals which papers a user is reading to a
third party). Opt-in per project, stated plainly.

### Stage 7 — Statistics & claims

Regex-first, model-verified:

```
percent      /\b\d+(?:\.\d+)?\s?%/
p-value      /\bp\s?[<=>]\s?\.?\d+(?:\.\d+)?/i
ci           /\b\d+\s?%\s?CI[:\s]*\[?[-−]?\d+(?:\.\d+)?\s?[–—,-]\s?[-−]?\d+(?:\.\d+)?\]?/i
n            /\bn\s?=\s?[\d,]+/i
ratio        /\b(?:OR|RR|HR|β|d|r)\s?=\s?[-−]?\d+(?:\.\d+)?/
mean-sd      /\b\d+(?:\.\d+)?\s?±\s?\d+(?:\.\d+)?/
```

Every match is then sent, **with its full sentence**, through a structured-output call
that returns `{ kind, value, unit, qualifiers[] }` and attaches nearby qualifiers to the
right primary statistic. This binding step is what stops "12.4% (95% CI 8.1–16.7)" from
becoming a bare "12.4%" on screen.

`HedgeLevel` is classified per sentence in the same call.

### Stage 8 — Comprehension

One `claude-opus-5` call over the cached document with citations enabled, returning a
strict schema:

```ts
interface Comprehension {
  question:    Grounded<string> | null;
  method:      Grounded<string> | null;
  findings:    Grounded<string>[];
  limitations: Grounded<string>[];
  conclusions: Grounded<string>[];
  contradictions: { a: SourceRef; b: SourceRef; note: string }[];
}
type Grounded<T> = { value: T; refs: SourceRef[]; hedge: HedgeLevel; confidence: number };
```

**`null` and `[]` are correct answers.** The prompt states that a paper with no stated
limitations must return an empty array, and the schema permits it. The UI renders an empty
limitations slot as *"This paper doesn't state its limitations explicitly"* — which is
itself useful information about the paper.

Details of the call, caching, and cost: [07 — AI Services](07-ai-services.md).

---

## 2. The extraction report

```ts
interface ExtractionReport {
  startedAt: string;
  finishedAt: string;
  stages: StageReport[];
  degradations: Degradation[];
  overallConfidence: number;
}

interface StageReport {
  stage: StageName;
  status: 'ok' | 'degraded' | 'skipped' | 'failed';
  durationMs: number;
  counts: Record<string, number>;   // { figures: 7, captioned: 6 }
  notes: string[];
}

interface Degradation {
  stage: StageName;
  reason: string;                   // human-readable, shown verbatim
  impact: string;                   // what the user should expect
  remedy?: string;                  // what they can do about it
}
```

Degradations are shown during processing *as they happen* and remain available in the
editor under **Source → Extraction quality**. Example:

> **Tables** · degraded
> Table 2's structure couldn't be read reliably (columns weren't consistently aligned).
> The original image is used instead, so the data is still accurate — you just can't
> animate individual cells. You can crop to a region manually.

---

## 3. Where the work runs

| Condition | Location | Why |
|---|---|---|
| ≤ 60 pages, native text | **Browser workers** | Private, no upload wait, instant first artifact |
| > 60 pages, or > 20 scanned pages | **Server** | Memory and CPU headroom |
| Any figure/table crop | Wherever the pages are | Avoid shipping page rasters twice |
| Comprehension, alt text, statistics | **Server** | API keys never reach the client |

The browser path uploads the PDF only when the user saves the project, and says so on the
dropzone. This is a real privacy property, not a marketing line — for a researcher with
an unpublished manuscript it is the difference between using the product and not.

**Concurrency.** Page-level work is parallel across `min(navigator.hardwareConcurrency-1, 4)`
workers with a bounded queue. Progress is emitted per page, so the progress bar moves
smoothly rather than jumping in stages.

---

## 4. Test corpus

Extraction is only trustworthy with fixtures. `e2e/fixtures/papers/` holds ten PDFs, each
with a hand-checked expected `Paper` snapshot:

| Fixture | Exercises |
|---|---|
| `arxiv-two-column.pdf` | Standard case: two columns, numbered sections, LaTeX figures |
| `nature-single-column.pdf` | Captions above figures, dense reference list |
| `scanned-1990s.pdf` | OCR path end to end |
| `tables-heavy.pdf` | Ruled, unruled, spanned, and rotated tables |
| `equations-heavy.pdf` | Display equations with numbering |
| `no-limitations.pdf` | Comprehension must return `[]`, not invent |
| `non-english.pdf` | Language detection, non-ASCII segmentation |
| `400-pages.pdf` | Memory and server-path routing |
| `corrupt-truncated.pdf` | Graceful failure with a specific message |
| `encrypted.pdf` | Password prompt path |

CI asserts against the snapshots with tolerances (coordinates ±2pt, confidence ±0.05).
A fixture regression fails the build — extraction quality is not allowed to drift
silently.

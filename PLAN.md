# Paper Animator — Master Plan

> Upload a research paper. Get a source-faithful animated presentation you can edit, verify, and export.

This is the authoritative plan for the whole project. It is written to be executed:
every section either states a decision, or states the question that must be answered
before the decision can be made. Companion documents in `docs/` carry the detail.

| Doc | Covers |
|---|---|
| [`docs/01-data-model.md`](docs/01-data-model.md) | TypeScript types, DB schema, project file format, provenance model |
| [`docs/02-extraction-pipeline.md`](docs/02-extraction-pipeline.md) | PDF → structured paper, OCR fallback, figures, tables, confidence |
| [`docs/03-render-engine.md`](docs/03-render-engine.md) | The determinism contract that makes preview == export |
| [`docs/04-design-system.md`](docs/04-design-system.md) | Tokens, type, colour, texture, motion specs, component inventory |
| [`docs/05-editor-spec.md`](docs/05-editor-spec.md) | Panels, the three signature interactions, drag matrix, shortcuts |
| [`docs/06-export-spec.md`](docs/06-export-spec.md) | Every export format, its pipeline, and its validation |
| [`docs/07-ai-services.md`](docs/07-ai-services.md) | Model choice, prompt caching, structured extraction, cost model |
| [`docs/08-quality-gates.md`](docs/08-quality-gates.md) | Accessibility, performance budgets, state catalogue, test matrix |
| [`docs/09-roadmap.md`](docs/09-roadmap.md) | Milestones M0–M8 with acceptance criteria |

---

## 1. What this is

**Paper Animator** turns a research paper (PDF) into an animated, narrated presentation
whose every claim is traceable back to the page it came from.

**Primary action:** upload a paper → get a storyboard → edit → export.

**Who it's for**

| Audience | Job to be done |
|---|---|
| Researchers | Turn a paper into a conference talk / lab meeting deck without a weekend of slide work |
| Students | Understand a dense paper by seeing it decomposed, then explain it back |
| Educators | Build reusable teaching material from primary sources |
| Science communicators & journalists | Explain evidence accurately, with citations that survive scrutiny |
| Healthcare / policy teams | Brief non-specialists on findings without losing caveats |

**Explicit non-goals** (say no early, say it once)

- Not a general video editor. Timeline features exist to serve paper-derived scenes.
- Not a reference manager, PDF reader, or annotation tool.
- Not a "summarize this for me" chatbot. The output is a presentation artifact.
- Not real-time multiplayer at v1 (the data model is built so it can be added — see §7).
- Not a paper-writing or paper-reviewing tool.

---

## 2. Non-negotiables

These are the things that, if violated, make the product not worth shipping.

1. **No fabricated content is ever presented as fact.** Every factual statement on
   screen carries provenance or is visibly marked as unverified.
2. **Preview equals export.** A frame at time *t* in the editor is byte-comparable to
   the frame at time *t* in the MP4. Enforced by architecture, not by discipline (§6).
3. **Every control does something.** No dead buttons, no fake export options, no
   placeholder routes, no sample data dressed as a real project.
4. **Keyboard-complete.** Every drag has a keyboard equivalent. Every action has a
   focus path.
5. **Reduced motion is a first-class mode**, not a degraded one.
6. **Uploaded papers are private by default** and deletable in one action.
7. **The core workflow survives** the absence of WebGL, custom fonts, and animation.

---

## 3. Ease of use: the three signature interactions

The user's brief calls out *extreme ease of use*, *highlighting text for effect*, and
*draggables*. These are not three features — they are one interaction model, and it is
the product's core idea:

> **You make the presentation by touching the paper.**

### 3.1 Highlight → Scene ("the marker")

Select any text in the source paper pane. A floating action bar appears with the
options that make sense for that selection: **Make a scene**, **Add to current scene**,
**Quote it**, **Explain it**. One click builds a scene with the selection as its spine —
provenance attached automatically, because the selection *is* the source span.

The same highlight becomes a *visual* device on the canvas. `HighlightSpec` supports six
treatments, all timed against narration word offsets so the highlight lands on the word
being spoken:

| Treatment | Reads as | Best for |
|---|---|---|
| `sweep` | Marker pen drawn left→right | The key sentence |
| `underline` | Ink underline drawing on | A term being defined |
| `box` | Rule drawn around a region | A figure panel, a table cell |
| `spotlight` | Everything else dims | One number in a dense page |
| `strike` | Strikethrough | "The prior assumption was…" |
| `tether` | Curve from text to a callout | Connecting claim to figure |

*Highlight-follows-voice* is the signature micro-interaction: the sweep is keyframed to
the narration's word timings, so the marker moves at reading speed and stops on the
number the narrator says. See [`docs/04-design-system.md`](docs/04-design-system.md) §Motion.

### 3.2 Drag → Canvas ("the pull")

Drag a figure, table, equation, or paragraph out of the source pane and drop it onto the
canvas. It becomes a layer with its `SourceRef` already attached. Drop it on the timeline
instead and it becomes a new scene. This is the moment the product should feel alive:
you are physically pulling the paper apart into a storyboard.

Full drag surface, keyboard equivalents, and accessibility announcements:
[`docs/05-editor-spec.md`](docs/05-editor-spec.md) §Drag matrix.

### 3.3 Click → Proof ("the thread")

Click any element on the canvas: the source pane scrolls to its origin and flashes the
exact quad on the page. Click any highlighted span in the source: every scene using it
lights up in the scene rail. Provenance is bidirectional and always one click away —
this is what makes the trust system feel like a superpower rather than a compliance form.

### 3.4 Progressive disclosure: three levels

| Level | Shown | Default for |
|---|---|---|
| **Simple** | Source pane, canvas, scene rail, play, export | First project, all mobile |
| **Studio** | + properties panel, multitrack timeline, styles | Second project onward |
| **Pro** | + keyframes, per-layer motion curves, safe areas, command palette | Opt-in, remembered |

Level is a user preference, not a plan tier. `⌘.` cycles it. A first-run project starts
in Simple and offers to unlock Studio after the first successful export.

---

## 4. The journey

Six stages. Each has an explicit "what if it goes wrong" (full catalogue in
[`docs/08-quality-gates.md`](docs/08-quality-gates.md)).

### 4.1 Arrival & upload

First viewport says what the product does in one sentence and shows the transformation
happening. The dropzone is the largest interactive element on the page. It states:
accepted formats (PDF, up to 100 MB / 400 pages), what happens to the file, and how to
delete it. A **sample paper** path exists and is clearly labelled as a sample — it is
never presented as the user's own work.

**Hero mechanism:** a real page separating into its parts (headings, a figure, a
statistic, a citation) and reassembling into three scene cards. Built from the actual
extraction of the sample paper, not a stock illustration. Under `prefers-reduced-motion`
it becomes a single composed still with the same parts labelled.

### 4.2 Transformation

Extraction is a job with **eight named stages** and truthful progress. The screen shows
real partial results as they land — the title appears when the title is parsed, figure
thumbnails appear as they are cropped, the outline builds itself. There is never an
empty spinner pretending to be work.

If a stage degrades (scanned PDF → OCR, no table structure found), the UI says so at that
moment, not at the end.

### 4.3 Story setup

The user is shown a proposed structure and can change it before the editor opens:

- Outline (drag to reorder, toggle sections in/out)
- Audience level: `expert` · `informed` · `general` (this materially changes narration)
- Target duration: 60s / 3min / 5min / 10min / custom → drives scene budget
- Tone: `neutral` · `explanatory` · `enthusiastic` · `cautious`
- Voice + speaking rate
- Visual style (four genuinely distinct systems — §5.3)
- Aspect ratio: 16:9 / 1:1 / 9:16
- Citation treatment: `inline` · `corner` · `end-card` · `none (with warning)`

Defaults are good enough that **Continue** is always a legitimate first action.

### 4.4 Editor

Left: outline + scene rail + search. Centre: canvas with safe areas. Right: contextual
inspector. Bottom: multitrack timeline. Top: status, undo/redo, integrity score, export.
Detail: [`docs/05-editor-spec.md`](docs/05-editor-spec.md).

### 4.5 Accuracy review — *Source Integrity*

A dedicated view, not a modal. Shows:

- **Coverage** — % of scenes whose factual content is fully grounded
- **Unresolved** — claims with no source span, ranked by how load-bearing they are
- **Altered statistics** — any number on screen that does not string-match a number in
  the source (this catches rounding, unit changes, and hallucination in one check)
- **Missing citations** — claims attributed to other work with no reference matched
- **Generated language** — scenes containing AI-authored connective text
- **Contradictions** — passages the extractor flagged as inconsistent

Every row deep-links to the scene *and* the page. An **integrity score** (0–100) sits in
the top bar at all times; clicking it opens this view. Export of a project below a
configurable threshold produces a warning, not a block — the user's judgment is final,
but it must be informed.

### 4.6 Export

Presets (Talk / Social / Slides / Audio / Archive), a pre-flight validation pass, honest
progress with per-stage detail, resumable failures, and a downloads list that persists.
Every format is real and verified by opening the produced file in a test.
[`docs/06-export-spec.md`](docs/06-export-spec.md).

---

## 5. Product capabilities

### 5.1 Ingest & extract

Native and scanned PDFs; OCR fallback; extraction of title, authors, affiliations,
abstract, section tree, paragraphs, figures + captions, tables, equations, statistics,
references, footnotes, and page coordinates for all of it.
[`docs/02-extraction-pipeline.md`](docs/02-extraction-pipeline.md).

### 5.2 Comprehend

Detect the paper's **question, method, findings, limitations, conclusions** — and detect
their *absence*. A paper with no stated limitations gets an empty limitations slot with
an explanation, never an invented one. Statistical qualifiers (CI, p, n, effect size,
"associated with" vs "causes") are extracted as structured fields so they can never be
silently dropped from narration.

### 5.3 Style

Four visual systems that restyle *layout, motion, and typography* — not just colour:

| System | Feel | Layout logic | Motion character |
|---|---|---|---|
| **Broadsheet** | Editorial, printed, authoritative | Baseline grid, big serif display, rules | Ink-like: draws on, settles |
| **Lab Notebook** | Tactile, annotated, working | Off-grid, margin notes, hand rules | Sketchy: traces, small jitter |
| **Signal** | Quiet futurism, dark, precise | Modular grid, mono accents, thin rules | Optical: fades, precise slides |
| **Chalk** | Teaching, warm, spoken | Centre-weighted, large text, few elements | Human: paced, slight overshoot |

A style is a token set + a layout strategy + a motion profile. Switching restyles the
whole project deterministically; user overrides survive the switch and are marked.

### 5.4 Narrate

TTS with word-level timings (or forced alignment when the provider gives none), a
pronunciation dictionary (auto-seeded from the paper's own terms and author names),
per-scene rate and pause control, music with automatic ducking, waveform scrubbing,
mute/solo. Captions are *derived* from word timings, never hand-synced.

### 5.5 Edit

Drag, trim, split, duplicate, reorder, group, lock, hide, undo/redo (50 steps, command
pattern), zoom, snapping, magnetic timeline, keyboard shortcuts, real-time preview.

### 5.6 Export

`MP4` `WebM` `GIF` `MP3` `WAV` `PPTX` `PNG` `JPG` `PDF` `SRT` `VTT` `TXT transcript`
`.paperanim` (project). [`docs/06-export-spec.md`](docs/06-export-spec.md).

### 5.7 Persist

Autosave every 3s (debounced) to IndexedDB + every 30s to server; crash recovery from
the local journal; version history for the last 20 saves; explicit delete that actually
deletes (including derived assets and render artifacts).

---

## 6. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ apps/web — React 19 + TS + Vite                                      │
│   routes/  upload · processing · setup · editor · integrity · export │
│   editor/  panels, canvas, timeline, inspector                       │
│   render/  ★ renderFrame() — shared with the worker                  │
│   state/   Zustand + Immer stores, command stack                     │
└───────────┬────────────────────────────────────┬─────────────────────┘
            │ HTTP + SSE                         │ postMessage
┌───────────▼──────────────┐        ┌────────────▼─────────────────────┐
│ apps/api — Fastify       │        │ workers/ (browser)               │
│   upload → object store  │        │   pdf.worker   text + coords     │
│   jobs   → queue         │        │   ocr.worker   tesseract fallback│
│   sse    → job progress  │        │   audio.worker waveform peaks    │
│   projects CRUD          │        └──────────────────────────────────┘
└───────────┬──────────────┘
            │
┌───────────▼──────────────────────────────────────────────────────────┐
│ services/                                                            │
│   extract/  pdf parse · OCR · figures · tables · references          │
│   ai/       ★ claude client: structured extraction, narration        │
│   tts/      synth + word timings + alignment fallback                │
│   render/   headless chromium + ffmpeg, deterministic seek           │
│   package/  pptx · pdf · srt/vtt · .paperanim zip                    │
└──────────────────────────────────────────────────────────────────────┘
            │
   Postgres (projects, scenes, provenance)  ·  S3-compatible (pdfs, assets, renders)
   Redis (job queue, progress)
```

★ = the two load-bearing pieces. `renderFrame()` is imported by both the editor and the
export worker — that import is what guarantees fidelity. The AI client is the only place
that talks to a model, so provenance rules are enforced in exactly one file.

### 6.1 Stack decisions

| Layer | Choice | Why this and not the obvious alternative |
|---|---|---|
| App | React 19 + TypeScript + Vite | Team-standard, fast HMR, no SSR needed (app is behind auth and heavily client-stateful) |
| Styling | Tailwind v4 over CSS custom properties | Tokens must be readable at runtime by the render worker; CSS vars give us that. Tailwind is the authoring ergonomics on top. |
| Primitives | Radix UI | Accessible menus/dialogs/tooltips without owning focus-trap bugs |
| Editor state | Zustand + Immer | Small, sync, no context re-render storms; command stack sits cleanly on top. Redux Toolkit is more ceremony than this needs. |
| Server state | TanStack Query | Job polling, SSE integration, cache invalidation |
| Drag | `@dnd-kit` | Keyboard sensor and live-region announcements are built in — the accessibility requirement picks this for us over `react-dnd` |
| UI motion | Motion (`framer-motion`) | **Chrome only.** Never inside the scene canvas — see §6.2 |
| PDF | `pdfjs-dist` in a worker | Gives text *with* transform matrices → real page coordinates, which is the whole provenance story |
| OCR | `tesseract.js` (client, small docs) / `ocrmypdf` (server, large) | Client path keeps small scanned papers private and fast |
| LLM | Claude (`claude-opus-5`, `claude-haiku-4-5`) | Native PDF input + **citations with page locations** — provenance we would otherwise fake. See [`docs/07-ai-services.md`](docs/07-ai-services.md) |
| Video render | Playwright + headless Chromium + ffmpeg | Frame-exact seek; the same DOM/canvas the user saw |
| In-browser render (fallback) | WebCodecs + `mp4-muxer` | Fast path for short 16:9 exports, no server round-trip |
| Slides | `pptxgenjs` | Real editable PPTX, not images-in-a-deck (though it also ships an image fallback) |
| PDF out | `pdf-lib` | Deterministic, no headless dependency for the paper path |
| DB | Postgres + Prisma | Provenance is relational; JSONB for scene graphs |
| Queue | BullMQ + Redis | Progress events map naturally onto SSE |

### 6.2 The one architectural rule

> **Scene playback is a pure function of time. UI animation is not scene animation.**

`framer-motion`, CSS transitions, and `requestAnimationFrame`-driven tweens are allowed
in the app chrome and forbidden inside the scene canvas. Everything the canvas renders
comes from `resolveFrame(project, tMs)` — a pure, side-effect-free function. The editor
calls it on every animation frame with the wall clock; the exporter calls it in a loop at
a fixed `1000/fps` step. Same function, same input, same pixels.

This single rule is what turns "preview matches export" from a QA problem into a type
signature. [`docs/03-render-engine.md`](docs/03-render-engine.md).

### 6.3 Repository layout

```
paper-animator/
├── apps/
│   ├── web/                 React app
│   └── api/                 Fastify server
├── packages/
│   ├── core/                Types, zod schemas, .paperanim codec  ← no deps
│   ├── render/              resolveFrame + layer renderers        ← imported by both
│   ├── extract/             PDF/OCR/figure/table/reference parsing
│   ├── ai/                  Claude client, prompts, output schemas
│   ├── tts/                 Synthesis + alignment
│   ├── export/              Encoders and packagers
│   └── ui/                  Design system components + tokens
├── workers/                 Browser worker entrypoints
├── docs/                    This plan
└── e2e/                     Playwright suites
```

`packages/core` and `packages/render` must have **zero runtime dependencies on React or
Node built-ins**. They run in the browser, in a worker, and in headless Chromium.

---

## 7. Data & provenance

Full types: [`docs/01-data-model.md`](docs/01-data-model.md). The shape that matters
most:

```ts
type Provenance =
  | { kind: 'extracted';   ref: SourceRef; confidence: number }  // verbatim from PDF
  | { kind: 'paraphrase';  ref: SourceRef; confidence: number }  // faithful restatement
  | { kind: 'explanation'; ref: SourceRef; confidence: number }  // plain-language gloss
  | { kind: 'connective' }                                       // AI transition text
  | { kind: 'authored' }                                         // the user typed it
  | { kind: 'unsupported'; reason: string; reviewed: boolean };  // needs review

interface SourceRef {
  page: number;              // 1-indexed
  quads: Quad[];             // PDF user-space rects — draws the highlight
  text: string;              // the exact source text
  anchor?: FigureId | TableId | EquationId | ReferenceId | FootnoteId;
}
```

Rules the type system and the API enforce together:

1. Every `TextAtom`, `StatAtom`, and `NarrationCue` carries exactly one `Provenance`.
2. `unsupported` content **cannot** be rendered as factual narration until
   `reviewed: true`. The renderer draws it with a review chip; the exporter refuses to
   include it silently.
3. A `StatAtom` whose rendered value does not string-match its `SourceRef.text` is
   automatically demoted to `unsupported` with `reason: 'value-mismatch'`.
4. Deleting a source span cascades: dependent atoms become `unsupported`, they do not
   silently keep stale text.

**Where provenance comes from.** Claude's document citations return `page_location`
(`start_page_number` / `end_page_number`) and `cited_text` for every cited claim. That is
the primary source of `SourceRef`. We resolve `cited_text` → `quads` by matching against
the pdf.js text layer for that page. When the match fails we keep the page-level ref and
mark confidence low, rather than inventing a rectangle.

**Collaboration-ready, not collaborative.** All mutations go through a command stack with
serializable, invertible commands. Adding multiplayer later means transporting those
commands, not rewriting state.

---

## 8. AI services

Detail and code in [`docs/07-ai-services.md`](docs/07-ai-services.md). Summary of
decisions:

- **Models:** `claude-opus-5` for structure comprehension and narration (the accuracy-
  critical work); `claude-haiku-4-5` for cheap, high-volume classification (section
  typing, figure-caption matching). Never downgrade the accuracy path for cost.
- **Structured outputs everywhere.** No prose-parsing. `output_config.format` with a
  JSON schema (via `zodOutputFormat`) for every extraction call. Prefills are not used —
  they return 400 on current models, and structured outputs are strictly better anyway.
- **Citations on.** Every document block sets `citations: { enabled: true }`. This is the
  provenance backbone, not a nice-to-have.
- **Prompt caching is architectural.** The extracted paper is a large, stable prefix
  reused across dozens of calls (per-scene narration, per-claim verification). It is
  cached with a 1-hour TTL; volatile content (scene index, user edits) goes *after* the
  breakpoint. Getting this ordering wrong makes the product 5–10× more expensive.
- **Batch API for the first pass.** Initial narration for all scenes is a batch job at
  50% cost — the user is already waiting on a progress screen, so latency is free.
  Interactive edits use the streaming path.
- **Refusals are handled.** `stop_reason === 'refusal'` is checked before reading
  content on every call, with a `fallbacks: "default"` opt-in.
- **The model never asserts unsupported facts.** Prompts require every factual sentence
  to cite; uncited sentences are received as `connective` and are limited to transitions.

---

## 9. Accessibility, privacy, performance

Full checklists: [`docs/08-quality-gates.md`](docs/08-quality-gates.md).

**Accessibility (target: WCAG 2.2 AA, with AAA on body text contrast)**
Semantic landmarks; one `h1` per route; complete keyboard operation including every drag;
visible focus (2px, 3:1 against both adjacent surfaces); status never carried by colour
alone (icon + text always); live regions for drag and job progress; adjustable base text
size that reflows rather than scales-and-clips; editable alt text on every generated
visual, exported into PPTX and PDF; accurate captions; transcript always available;
pausable motion; `prefers-reduced-motion` honoured with *static equivalents*, not
removals; media controls that are real buttons.

**Privacy**
Uploads are private by default. Storage location, retention, and deletion are stated on
the dropzone — not buried. Signed, short-lived URLs for all assets. Delete removes the
PDF, derived assets, renders, and DB rows within one transaction and one bucket sweep.
**No uploaded content is used for training, ever, without explicit opt-in consent that is
off by default and revocable.**

**Performance budgets** (enforced in CI on a throttled profile)

| Metric | Budget |
|---|---|
| LCP on `/` | < 1.8 s |
| First interactive dropzone | < 1.0 s |
| Editor JS (initial route) | < 350 KB gzip |
| Time to first extracted artifact | < 4 s for a 12-page native PDF |
| Canvas frame time at 30 layers | < 16 ms p95 |
| Timeline scrub | 60 fps with 200 clips |
| Memory after 30 min editing | < 1.2 GB, no monotonic growth |

Techniques: content before decoration; extraction and render in workers; SSE streaming
progress; lazy-loaded expensive panels; `content-visibility` on off-screen scenes;
virtualized scene rail and timeline; font subsetting with `size-adjust` fallbacks to
prevent CLS; explicit teardown of object URLs, audio nodes, and worker ports.

---

## 10. Risks & open questions

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Table structure extraction is genuinely hard; ruled and multi-header tables defeat heuristics | Wrong data on screen — the worst failure we can have | Confidence scoring; below threshold we render the table as a *cropped image* with a caption rather than a reconstructed grid, and say why |
| R2 | Word-level TTS timings unavailable from a chosen provider | Highlight-follows-voice breaks, captions drift | Forced alignment fallback (Whisper) in the TTS service; provider interface requires timings, adapter supplies them |
| R3 | Headless render drift vs. browser preview (fonts, subpixel AA) | Breaks non-negotiable #2 | Same Chromium version pinned; fonts embedded not fetched; golden-frame test in CI comparing preview and export at 5 timestamps per style |
| R4 | LLM cost per project if prompt caching is mis-ordered | Unit economics fail quietly | Cache-hit assertion in CI: a fixture project must show `cache_read_input_tokens > 0` on the second call, or the build fails |
| R5 | Very large PDFs (400 pages, 200 MB) blow browser memory | Crash mid-upload | Page-range streaming, server-side extraction above a page threshold, hard limits stated up front |
| R6 | Users export a low-integrity project and it circulates | Reputational, and against our mission | Integrity score is always visible; sub-threshold exports get a warning step; exported PDFs/PPTX carry a source appendix by default |
| R7 | Scope: the editor is a real creative tool and can absorb infinite work | Never ships | Progressive disclosure means Simple mode is the shippable product; Studio/Pro land in M6–M7 |

**Open questions to resolve before M2**

1. TTS provider — needs word timings, a usable voice set, and acceptable licensing for
   commercial output. Shortlist and evaluate against a fixed script.
2. Server render capacity model — per-user concurrency limit and queue behaviour under
   load. Affects whether the WebCodecs fast path is required at v1 or optional.
3. Whether reference resolution should hit an external metadata API (Crossref) — improves
   citation quality, adds a network dependency and a privacy consideration (it leaks
   which papers are being processed). Default: **off**, opt-in per project.

---

## 11. Definition of done

The product ships when all of the following are simultaneously true:

- [ ] A first-time user uploads a paper and reaches a downloaded MP4 without help,
      in under 6 minutes, on a mid-range laptop.
- [ ] Every export format is produced, opened, and asserted in an automated test.
- [ ] Five frames per visual style match between preview and export within a 2%
      perceptual diff.
- [ ] Zero axe-core violations on every route; a full task completed with keyboard only;
      a full task completed with a screen reader.
- [ ] The reduced-motion path completes the same task with no information lost.
- [ ] All seven performance budgets pass in CI.
- [ ] Every state in the state catalogue has a designed, tested screen.
- [ ] A deliberately corrupted PDF, a 400-page PDF, a pure-scan PDF, and a
      non-English PDF each produce a coherent outcome, not a crash.
- [ ] The integrity view correctly flags a hand-seeded fabricated statistic, a dropped
      confidence interval, and an unmatched citation in a fixture project.
- [ ] No console errors or unhandled rejections across the full happy path.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Atom** | The smallest provenance-bearing unit of content (a sentence, a statistic, a figure reference) |
| **Scene** | One narrated beat: a layout, a set of layers, narration, and a duration |
| **Layer** | A drawable element inside a scene (text, figure, table, quote, chart, shape) |
| **Cue** | One narration utterance with word-level timings |
| **SourceRef** | Page + rectangles + text identifying where something came from |
| **Provenance** | The classification of how a piece of content relates to the source |
| **Integrity score** | 0–100 project-level measure of grounded content |
| **resolveFrame** | The pure function mapping (project, time) → renderable frame state |
| **`.paperanim`** | The editable project file: a zip of `project.json` plus assets |

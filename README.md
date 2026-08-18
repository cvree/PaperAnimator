# Paper Animator

Open a research paper. Get a source-faithful animated presentation you can edit, verify,
and export.

Everything runs in the browser. The PDF is read on your own machine — nothing is
uploaded, nothing is stored, and nothing is used for training.

---

## The idea

**Read the paper. Mark it up. That is the presentation.**

The editor opens on the real pages, rendered as printed, with text you can drag across the
way you would in any PDF reader — and on an empty storyboard. Nothing is composed on your
behalf, because a talk assembled by a machine is a talk you then have to argue with. (If
you would rather begin from a draft, the empty storyboard offers to make one from the
whole paper; it stays a thing you asked for.)

Highlight a passage and a bar arrives on it. Then either click a tool or pick one up and
drop it on the words:

| Drop this | Get this |
|---|---|
| **Statement** | The passage, set as large as it fits, read aloud as it appears |
| **Big number** | The statistic at full size, with the sentence that qualifies it |
| **Pull quote** | A quotation, attributed to its page |
| **Build a list** | One line per sentence, each arriving as it is spoken, each separately cited |
| **Beat by beat** | One scene per sentence — a paragraph becomes a sequence in one gesture |
| **Figure** | A crop of the page at full resolution, with its caption |
| **Spotlight** | Those exact words marked inside the sentence around them |
| **Side by side** | This passage against one you kept earlier, in two columns |

While you carry a tool, the scene it would make floats under the cursor — drawn by the
same renderer as the canvas and the export, so the preview cannot promise what the drop
would not deliver.

**The highlight is the citation.** A passage carries the quads of what you marked, down to
the character, so there is no later step where a source gets attached and therefore no
later step that can be skipped or got wrong. Passages already used by a scene are washed
in mint on the page, with a numbered chip in the margin that jumps to that scene; clicking
a claim on the canvas draws a thread back to the exact words it came from.

A project-wide **Source Integrity** score tells you how much of your presentation is
grounded, and which parts need review — before you present it to anyone.

Nothing here needs the pointer. Click a line to take its sentence, `⌥↑` to widen the mark
to its paragraph, then press a letter: `S` statement, `N` number, `Q` quote, `B` build,
`X` beats, `F` figure, `H` spotlight, `A` add to this scene, `V` voice-over. `M` opens the
animation gallery for whatever you are looking at.

---

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build
npm run preview      # serve the build on :4173
```

There is no server, no account, and no API key. `Try a sample paper` on the landing page
generates a real two-column PDF in the browser and runs it through the same pipeline your
own paper would take.

---

## How it stays accurate

**The composer selects; it never writes.** Every on-screen atom and every narration cue is
either a span of the source or a linking phrase that carries no claim. Comprehension is a
ranking problem over the paper's own sentences, so the result is grounded by construction
rather than grounded by review. A paper that never states its limitations gets an empty
limitations list, and the interface says so — that absence is information about the paper.

**Provenance is the selection.** There is no separate step where a source gets attached,
and therefore no step that can be skipped or got wrong. Each atom carries exactly one of
`extracted · paraphrase · explanation · connective · authored · unsupported`.

**Playback is a pure function of time.** `resolveFrame(project, tMs)` is the only source
of animated values, and it is imported by the live canvas, the static previews and the
exporter alike. Nothing inside the scene surface animates via CSS or a motion library.
That single rule turns "preview matches export" from a QA problem into a type signature.

**Every animation is one definition.** `src/render/motion.ts` holds the whole catalogue —
twenty-one entrances and six sustained motions — each a pure function of progress. The
storyboard's animated tiles run that function, the stage runs it, and the exporter runs
it, so an animation cannot look one way while you are choosing it and another way once it
is chosen. `tools/parity-shot.mjs` draws both renderings of the same frame side by side to
prove it, and asserts the reduced-motion contract: with movement off, nothing travels.

---

## Animating it

Marking a passage makes a scene; the ✦ **Animate** button on any storyboard card — or
<kbd>M</kbd>, or the button beside the transport — opens the gallery. Every tile in it is
your own scene, animating for real, so choosing is watching rather than guessing.

Entrances are grouped by what they act on. Words and letters get **Cascade**, **Typeset**,
**Scatter**, **Tumble**, **Open out**, **Ink bleed** and **Sweep**; pictures get **Iris**,
**Wipe**, **Shutter**, **Develop**, **Crop in** and **Push**; the quiet workhorses —
**Rise**, **Settle**, **Slide**, **Focus pull**, **Cut** — suit anything. The gallery leads
with the ones built for whatever the scene is actually about, judged by what occupies the
most of the frame.

Three further controls sit under them. **While it stays on screen** adds sustained motion
after the entrance has landed — a slow zoom that travels inside a figure's frame, a drift,
a breath. **Choreography** hands out the delays so elements arrive in sequence rather than
all at once. **Volume** takes the same move louder or quieter without changing its
character. Every choice applies immediately and is a single undo away.

---

## Exports

Every format below is produced in the browser and opens in real software.

| File | What it is |
|---|---|
| `.webm` | The talk as you watched it. Encoded through WebCodecs with the timestamp each frame represents, so the duration is the real one. |
| `.zip` | One PNG per scene at the chosen resolution. |
| `.pptx` | An editable deck. Speaker notes carry the narration and its page citations. |
| `.pdf` | Rendered pages plus an invisible text layer, so it is searchable and readable aloud, with a source appendix. |
| `.srt` / `.vtt` | Caption tracks. |
| `.txt` | Transcript: every line, timed, with the page it came from. |
| `.paperanim` | Reopen and keep editing. Assets travel with it. |

Narration is read by the browser's own speech engine, which cannot be captured into a
video file. The video is silent and carries captions; the captions, transcript and speaker
notes contain every spoken line.

---

## Verifying it

`tools/` holds the harnesses used to inspect the product as it was built. Each drives a
real browser against `npm run preview`.

| Script | What it checks |
|---|---|
| `tools/flow.mjs` | Landing → processing → editor, arriving on the paper with an empty storyboard |
| `tools/motion.mjs` | Making a scene, opening the animation gallery three ways, picking an entrance, watching the stage obey |
| `tools/parity-shot.mjs` | Every entrance drawn twice — screen against export — plus the reduced-motion assertion (needs `npm run dev`) |
| `tools/editor.mjs` | Marking a sentence, making a scene, the source thread, each disclosure level, integrity, export |
| `tools/reader.mjs` | The text layer, highlighting, the marker bar, dragging a tool onto a sentence, cropping a figure, comparing two passages |
| `tools/reader-small.mjs` | The reader at tablet and phone widths |
| `tools/demos.mjs` | The three landing-page interactions |
| `tools/exports.mjs` | Runs every export for real and reports the bytes and file types |
| `tools/playback.mjs` | Plays the exported video and samples frames from it |
| `tools/a11y.mjs` | Mobile layout, reduced motion, and a keyboard-only path |
| `tools/theme.mjs` | The dark Press appearance across all three phases |
| `tools/landing.mjs` | The landing page, scrolled |

```sh
npm run build && npm run preview &
node tools/flow.mjs
```

---

## The plan

The design work this was built from:

| Document | What's in it |
|---|---|
| [`PLAN.md`](PLAN.md) | Product definition, non-negotiables, architecture, risks, definition of done |
| [`docs/01-data-model.md`](docs/01-data-model.md) | Types, provenance model, project file format |
| [`docs/02-extraction-pipeline.md`](docs/02-extraction-pipeline.md) | PDF → structured paper, figures, tables, confidence |
| [`docs/03-render-engine.md`](docs/03-render-engine.md) | The determinism contract that makes preview equal export |
| [`docs/04-design-system.md`](docs/04-design-system.md) | Tokens, typography, the four visual styles, motion system |
| [`docs/05-editor-spec.md`](docs/05-editor-spec.md) | The reader, the instruments, the drag matrix, shortcuts |
| [`docs/06-export-spec.md`](docs/06-export-spec.md) | Every format, its pipeline, and its verification |
| [`docs/07-ai-services.md`](docs/07-ai-services.md) | The model-backed design the plan assumed |
| [`docs/08-quality-gates.md`](docs/08-quality-gates.md) | Accessibility, performance budgets, state catalogue, tests |
| [`docs/09-roadmap.md`](docs/09-roadmap.md) | Milestones M0–M8 with acceptance criteria |

Where the build departs from the plan, the build is the record. Two departures matter:

**Comprehension is selection, not generation.** The plan routed it through a hosted model;
this implementation ranks the paper's own sentences in the browser. That is a stronger
accuracy guarantee — a component that only ever chooses existing sentences cannot invent
one — and it removes the account, the key and the network round trip.

**There is one source view, not two.** The plan offered an outline mode beside a pages
mode. The outline is gone: a re-typeset paper is not the paper, and having two notions of
"where you are" made the product feel like a tool rather than like reading. What replaced
it is a reader with real page rasters, a real selectable text layer, and a dock of
instruments you drop onto what you marked.

---

## Stack

React 19 · TypeScript · Vite · Tailwind v4 over CSS custom properties · Zustand + Immer ·
dnd-kit · Radix · GSAP for interface motion · pdf.js · pdf-lib · pptxgenjs · JSZip ·
WebCodecs + webm-muxer · Playwright for the visual harnesses.

---

## What this is not

Not a general video editor. Not a reference manager. Not a summarization chatbot. Not a
paper-writing tool. The output is a presentation artifact whose every claim is traceable
to its source — that constraint is the product.

# Paper Animator

Open a research paper. Get a source-faithful animated presentation you can edit, verify,
and export.

Everything runs in the browser. The PDF is read on your own machine — nothing is
uploaded, nothing is stored, and nothing is used for training.

---

## The idea

You make the presentation by touching the paper.

- **Highlight** a sentence → it becomes a scene, with its source attached automatically.
- **Drag** a figure onto the canvas → it becomes a layer, provenance included.
- **Click** any claim → the source pane scrolls to the exact page, flashes the sentence,
  and draws a thread between the two.

Every factual statement on screen traces back to a page. A project-wide **Source
Integrity** score tells you how much of your presentation is grounded, and which parts
need review — before you present it to anyone.

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
| `tools/flow.mjs` | Landing → processing → setup → editor, with console errors surfaced |
| `tools/editor.mjs` | Selecting a sentence, making a scene, the source thread, each disclosure level, integrity, export |
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
| [`docs/05-editor-spec.md`](docs/05-editor-spec.md) | Panels, the three signature interactions, drag matrix, shortcuts |
| [`docs/06-export-spec.md`](docs/06-export-spec.md) | Every format, its pipeline, and its verification |
| [`docs/07-ai-services.md`](docs/07-ai-services.md) | The model-backed design the plan assumed |
| [`docs/08-quality-gates.md`](docs/08-quality-gates.md) | Accessibility, performance budgets, state catalogue, tests |
| [`docs/09-roadmap.md`](docs/09-roadmap.md) | Milestones M0–M8 with acceptance criteria |

Where the build departs from the plan, the build is the record. The largest departure:
the plan routed comprehension through a hosted model, and this implementation does the
comprehension by selection in the browser instead. That is a stronger accuracy guarantee —
a component that only ever chooses existing sentences cannot invent one — and it removes
the account, the key and the network round trip.

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

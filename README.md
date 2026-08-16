# Paper Animator

Upload a research paper. Get a source-faithful animated presentation you can edit,
verify, and export.

> **Status: planning.** No application code yet. This repository currently contains the
> full project plan. Start with [`PLAN.md`](PLAN.md).

---

## The idea

You make the presentation by touching the paper.

- **Highlight** a sentence → it becomes a scene, with its source attached automatically.
- **Drag** a figure onto the canvas → it becomes a layer, provenance included.
- **Click** any claim → the source pane scrolls to the exact page and flashes the sentence
  it came from.

Every factual statement on screen traces back to a page. A project-wide **Source
Integrity** score tells you how much of your presentation is grounded, and which parts
need review — before you present it to anyone.

Export to MP4, WebM, GIF, MP3, WAV, PPTX, PDF, PNG/JPG, SRT, VTT, transcript, and an
editable project file.

---

## The plan

| Document | What's in it |
|---|---|
| [`PLAN.md`](PLAN.md) | **Start here.** Product definition, non-negotiables, architecture, risks, definition of done |
| [`docs/01-data-model.md`](docs/01-data-model.md) | Types, provenance model, DB schema, project file format |
| [`docs/02-extraction-pipeline.md`](docs/02-extraction-pipeline.md) | PDF → structured paper, OCR, figures, tables, confidence |
| [`docs/03-render-engine.md`](docs/03-render-engine.md) | The determinism contract that makes preview equal export |
| [`docs/04-design-system.md`](docs/04-design-system.md) | Tokens, typography, the four visual styles, motion system |
| [`docs/05-editor-spec.md`](docs/05-editor-spec.md) | Panels, the three signature interactions, drag matrix, shortcuts |
| [`docs/06-export-spec.md`](docs/06-export-spec.md) | Every format, its pipeline, and its verification |
| [`docs/07-ai-services.md`](docs/07-ai-services.md) | Model choice, prompt caching, structured extraction, cost model |
| [`docs/08-quality-gates.md`](docs/08-quality-gates.md) | Accessibility, performance budgets, state catalogue, tests |
| [`docs/09-roadmap.md`](docs/09-roadmap.md) | Milestones M0–M8 with acceptance criteria |

---

## Three decisions worth knowing up front

**1. Provenance comes from the model's citations, not from string matching.**
Claude's document citations return the cited text *and* its page location, which we
resolve to rectangles against the PDF text layer. When the rectangle match is uncertain we
keep the page reference and say so — we never draw a highlight around a guess.
→ [`docs/07-ai-services.md`](docs/07-ai-services.md) §2

**2. Scene playback is a pure function of time.**
`resolveFrame(project, tMs)` is imported by the editor *and* the export worker. CSS
animation is banned inside the canvas. That single rule turns "preview matches export"
from a QA problem into a type signature, and a CI test compares real frames to prove it.
→ [`docs/03-render-engine.md`](docs/03-render-engine.md)

**3. Prompt caching is architecture, not optimization.**
The extracted paper is a large stable prefix reused across dozens of calls. Ordered
correctly it costs ~$1.11 per project; ordered carelessly it costs five times that,
silently. A CI assertion fails the build if a cache read ever drops to zero.
→ [`docs/07-ai-services.md`](docs/07-ai-services.md) §4

---

## Intended stack

React 19 · TypeScript · Vite · Tailwind v4 over CSS custom properties · Radix ·
Zustand + Immer · TanStack Query · dnd-kit · pdf.js · tesseract.js ·
Claude (`claude-opus-5`, `claude-haiku-4-5`) · Fastify · Prisma + Postgres · BullMQ +
Redis · Playwright + ffmpeg · pptxgenjs · pdf-lib

Rationale for each choice, including the alternatives rejected and why:
[`PLAN.md`](PLAN.md) §6.1.

---

## What this will not be

Not a general video editor. Not a reference manager. Not a summarization chatbot. Not a
paper-writing tool. The output is a presentation artifact whose every claim is traceable
to its source — that constraint is the product.

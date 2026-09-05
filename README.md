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

Click a sentence to take the whole of it — click again to widen to the paragraph, or drag
across the words and the mark rounds out to whole ones. It rounds out by a word, never by
a line: a drag that stopped a word short of a full stop takes the word and offers it back,
and a drag that stopped anywhere else stops there. Mark a few by hand and the reader
notices, and stops rounding at all. A bar arrives on whatever you marked. Then either
click a tool or pick one up and drop it on the words:

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
twenty-one entrances, six sustained motions and five scene transitions — each a pure
function of progress. The storyboard's animated tiles run that function, the stage runs
it, and the exporter runs it, so an animation cannot look one way while you are choosing
it and another way once it is chosen. `tools/parity-shot.mjs` draws both renderings of the
same frame side by side to prove it — entrances and joins alike — and asserts the
reduced-motion contract: with movement off, nothing travels.

**The motion has house rules, and they are in the code.** Easing curves are real
cubic-béziers solved at runtime, so a curve written as a CSS token and the same curve on
the canvas are one function rather than two approximations of it. Entrance blur is clamped
to about three pixels at 1080p. Staggers are laid out in milliseconds and capped, so a
forty-word paragraph and a four-word headline both arrive at a pace a person can read.
Durations come off one short scale, so the deck has a rhythm instead of twenty unrelated
timings.

---

## Animating it

Marking a passage makes a scene; the ✦ **Animate** button on any storyboard card — or
<kbd>M</kbd>, or the button beside the transport — opens the gallery. Every tile in it is
your own scene, animating for real, so choosing is watching rather than guessing.

It opens on **Look**, which is the only choice most people should have to make. A look
sets the whole scene at once — the entrance suited to each kind of element, what keeps
moving after it lands, how far apart things arrive, and how the scene is joined to the one
before it — because those four decisions are not separable, and making them one at a time
is how a deck ends up with a headline that tumbles next to a figure that irises.
**Editorial** is calm and printed, **Documentary** slower and filmic, **Keynote** crisp and
word-by-word, **Minimal** nearly nothing. Each can be applied to this scene or to every
scene in the talk. Everything a look sets stays editable afterwards.

Under it the same decisions are available one at a time, shelved rather than dumped in a
grid. **Essentials** leads — the five that are right almost always and wrong almost never
— then the shelf this content can actually perform: **Word and letter** for text
(**Cascade**, **Typeset**, **Sweep**, **Open out**, **Ink bleed**), **Pictures and tables**
for figures (**Crop in**, **Unfold**, **Shutter**, **Develop**, **Draw on**, **Trace**),
and **Accents** last, for the louder moves worth one moment in a talk rather than ten.

Three further controls sit under those. **While it stays on screen** adds sustained motion
after the entrance has landed — a slow zoom that travels inside a figure's frame, a drift,
a breath. **Coming from the scene before** is the join itself: a dissolve, a push in, a
page turn, a recompose, or a straight cut, each tile running the two scenes that actually
meet. **Choreography** hands out the delays; **Volume** takes the same move louder or
quieter without changing its character. Every choice applies immediately and is a single
undo away.

---

## The board

The storyboard next door is a sequence: one scene, then the next. The **board** is a place.
Open it with the *Board* tab or <kbd>⌘B</kbd> and you get a surface with no edges — scroll
to pan, <kbd>⌘</kbd>-scroll to zoom, <kbd>⌘0</kbd> to see everything you have made. There is
no page underneath, only a coordinate system and a camera, so it never runs out of room in
any direction.

**One switch turns the lights off.** Whiteboard or blackboard is a single control in the
toolbar because it is a single decision, and every card reads its colours from the surface —
so a black board is a black board, not white cards stranded on one. The grid coarsens as you
pull back and can be dots, lines or nothing at all.

**Everything on it comes from somewhere.** The left shelf is the paper: its figures, its
tables, its numbers, its sentences. Click one and it lands on the board with the page it came
from still attached, so a card can always answer the only question worth asking about it —
*says who?* Click the page reference and the reader jumps to the passage. You can also write
your own: <kbd>T</kbd> for text, <kbd>N</kbd> for a note, <kbd>R</kbd> for a shape,
<kbd>P</kbd> to draw by hand. Cards land beside what is already there rather than on top of
it. Everything is undoable, because the board lives in the project.

**A slide is a region, not a copy.** Draw one with <kbd>F</kbd>, or select a few cards and
frame them from the panel on the right. Move the cards and the slide changes, because the
slide *is* the part of the board it surrounds. The order of the stops is the order of the
talk, and the panel is where you reorder it.

**Then it is interactive.** Any card can wait for a click instead of arriving with its stop,
and a click on a card can send the camera to another stop, zoom in on the card itself, or
open a link — one control each. Presenting flies the camera between stops, pulling back far
enough on a long journey that the audience keeps its bearings. <kbd>→</kbd> and <kbd>←</kbd>
move, <kbd>O</kbd> shows the whole board at once, <kbd>L</kbd> is a pointer, <kbd>B</kbd>
blacks the screen, <kbd>N</kbd> is your notes, <kbd>F</kbd> is full screen. A stop can also
be told to move on by itself, for a talk left running at a poster session.

**Finishing it gives you a link.** *Get the link* writes the whole thing — cards, figures,
camera, behaviour and a few hundred bytes of its own runtime — into one HTML file with the
images inside it. Open it from a USB stick, mail it, or drop it on any static host: it is the
same presentation, offline, with nothing phoning home. A board light enough also gets a
second form, an address that carries the talk inside its own fragment, which opens here and
uploads nothing to anyone. Slide numbers live in the address, so a link can point at one
stop.

---

## Exports

Every format below is produced in the browser and opens in real software.

| File | What it is |
|---|---|
| `.mp4` | The talk as you watched it. H.264 encoded through WebCodecs with the timestamp each frame represents, so the duration is the real one. A browser that cannot write H.264 gets `.webm` instead, and the export says so. |
| `.zip` | One PNG per scene at the chosen resolution. |
| `.pptx` | An editable deck. Speaker notes carry the narration and its page citations. |
| `.pdf` | Rendered pages plus an invisible text layer, so it is searchable and readable aloud, with a source appendix. |
| `.srt` / `.vtt` | Caption tracks. |
| `.txt` | Transcript: every line, timed, with the page it came from. |
| `.paperanim` | Reopen and keep editing. Assets travel with it. |
| `.html` | The board as a presentation that runs on its own, images inside it, no server. Written from *Get the link* — see [The board](#the-board). |

Narration is read by the browser's own speech engine, which cannot be captured into a
video file. The video is silent and carries captions; the captions, transcript and speaker
notes contain every spoken line.

**The voice is off while you edit.** A synthetic voice reciting over you every time the
playhead moves is worse than silence, and it is the wrong thing to judge the writing by —
so nothing is spoken unless you ask for it, with the speaker button beside the transport or
the switch in the inspector's Voice tab. The choice is remembered per browser. Captions,
the reading marker and everything exported work either way; with the voice on, the engine
reports where each word begins and those timings are saved, so the marker then tracks it
exactly.

---

## Verifying it

`tools/` holds the harnesses used to inspect the product as it was built. Each drives a
real browser against `npm run preview`.

| Script | What it checks |
|---|---|
| `tools/flow.mjs` | Landing → processing → editor, arriving on the paper with an empty storyboard |
| `tools/motion.mjs` | Making a scene, opening the animation gallery three ways, picking an entrance, watching the stage obey |
| `tools/parity-shot.mjs` | Every entrance and every scene join drawn twice — screen against export — plus the reduced-motion assertion (needs `npm run dev`) |
| `tools/joins-and-voice.mjs` | That nothing is spoken until the voice is asked for, and that a scene join really puts two scenes on the surface at once |
| `tools/editor.mjs` | Marking a sentence, making a scene, the source thread, each disclosure level, integrity, export |
| `tools/reader.mjs` | The text layer, highlighting, the marker bar, dragging a tool onto a sentence, cropping a figure, comparing two passages |
| `tools/marking.mjs` | What a drag marks: what is rounded out, what is left alone, and the reader stepping back once it is being done by hand |
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
WebCodecs + mp4-muxer / webm-muxer · Playwright for the visual harnesses.

---

## What this is not

Not a general video editor. Not a reference manager. Not a summarization chatbot. Not a
paper-writing tool. The output is a presentation artifact whose every claim is traceable
to its source — that constraint is the product.

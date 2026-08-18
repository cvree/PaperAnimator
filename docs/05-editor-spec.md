# 05 — Editor Specification

The editor must feel like a professional instrument to someone who has used one, and
obvious to someone who has not. Both, at once, from the first project.

The mechanism for "both at once" is **progressive disclosure with three levels**
(Simple / Studio / Pro, `⌘.` to cycle) plus the principle that *the paper is the primary
interface*. A user who never opens the timeline can still make a good presentation by
highlighting and dragging.

---

## 1. Layout

The paper is not a reference panel beside the work. The paper *is* the work: it takes the
larger half of the window, and everything to its right is what the paper has produced so
far.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Paper Animator   Sleep Duration and Recovery    ↶ ↷   Broadsheet  ⚡︎92  Export │  56px
├──────────────────────────────────────────────┬─────────────────────────────────┤
│ Contents ▾   ⌕ search the paper      − 92% + │                                 │
│                                              │            STAGE                │
│   ┌──────────────────────────────────────┐   │   ┌─────────────────────────┐   │
│ 7 │                                      │   │   │     16:9 · captions     │   │
│ ▔ │   the real page, rendered, with      │   │   └─────────────────────────┘   │
│   │   selectable text over it            │   │   ▶  00:09.2 / 01:36  scene 2/11│
│   │                                      │   ├─────────────────────────────────┤
│   │   ┌──────────────────────────────┐   │   │  STORYBOARD  │  INSPECTOR       │
│   │   │ ⠿ Spotlight H  ≡ ❝ ⋮≡ T ⊞ │2│ │   │   │  ┌───────────────────────────┐ │
│   │   └──────────────────────────────┘   │   │   │  │ 01  Title         8.2s  │ │
│   │                                      │   │   │  ├───────────────────────────┤ │
│   └──────────────────────────────────────┘   │   │  │ 02  31.4%         6.4s  │ │
│                                              │   │  └───────────────────────────┘ │
│  ┌────────────────────────────────────────┐  │   │                             │
│  │ ≡ Statement  ⑫ Big number  ❝ Pull quote│  │   │                             │
│  │ ⊞ Add to scene  ✎ Spotlight  ♪ Voice   │  │   │                             │
│  └────────────────────────────────────────┘  │   │                             │
├──────────────────────────────────────────────┴─────────────────────────────────┤
│ TIMELINE  (Pro only)   scenes ▓▓▓▓│▓▓▓▓▓▓│▓▓▓▓▓▓▓▓  narration ─wave──wave──     │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Width | Present at |
|---|---|---|
| Reader | fills the rest | every level |
| Tool dock | floats over the reader's lower edge | every level |
| Stage | 46% of the right column's height | every level |
| Storyboard / Inspector | `clamp(23rem, 30vw, 33rem)` | Storyboard always; Inspector from Studio |
| Timeline | `clamp(8rem, 15vh, 11rem)` | Pro |

`⌘.` cycles Simple → Studio → Pro. Simple alone produces a complete, exportable project:
nothing in Studio or Pro is required to finish a talk, only to fine-tune one.

---

## 2. The reader — where the product's idea lives

Every page is drawn as it was printed — the real raster — with a transparent layer of
absolutely positioned text runs on top of it. The browser's own selection therefore works:
drag across the page and the words highlight, exactly as in a PDF reader. There is no
re-typeset "outline" mode any more, because a re-typeset paper is not the paper.

Three details make it feel like reading rather than like using a tool:

- **Runs are emitted in reading order**, from the assembled lines, not in the order the
  PDF stored them. Dragging down a two-column page selects the left column and then the
  right one, rather than zig-zagging across the gutter.
- **Each run is scaled horizontally onto its printed counterpart.** The factor is measured
  once, because font size is expressed in container-query units, so both the natural width
  and the target width scale with the page and their ratio does not. Highlights land on
  the ink.
- **Only pages near the viewport exist in the DOM.** A 400-page paper costs three pages of
  text runs, not four hundred.

### What a mark is

A **passage** is whatever was marked, resolved against the paper: its quads per page, its
tidied text, the sentences it covers, any statistics inside it, the section it belongs to,
and the figure or table it overlaps. The passage *is* the provenance — there is no later
step where a source gets attached, and therefore no later step that can be skipped.

| Gesture | Marks |
|---|---|
| Drag across text | Exactly those words, to the character |
| Click a line | The whole sentence it belongs to, or the printed line when it is a title, a heading or a caption |
| `⌥↑` / `⌥↓` | Widens to sentence → paragraph → section, or narrows back |
| `⌥`-drag, or the Figure tool | A rectangular region, cropped from the page at full resolution |

### The instruments

The dock carries every tool at once, grouped by what it does to the project. A tool can be
**clicked** to apply it to the current mark, **dragged onto the page** to apply it to
whatever is under the pointer, or reached by its **letter key**.

| Group | Tool | Key | Makes |
|---|---|---|---|
| Make a scene | Statement | `S` | The passage, set as large as it fits, read aloud as it appears |
| | Big number | `N` | The statistic at full size, with the sentence that qualifies it |
| | Pull quote | `Q` | A quotation attributed to its page |
| | Build a list | `B` | One line per sentence, each arriving as it is spoken, each with its own citation |
| | Beat by beat | `X` | One scene per sentence — a paragraph becomes a sequence in one gesture |
| | Figure | `F` | A crop of the page, with its caption |
| | Title card | `T` | An opening card with the paper's own byline |
| Add to this scene | Add to scene | `A` | Appends the passage as another line, spoken after what is there |
| | Spotlight | `H` | Marks those exact words inside the sentence around them |
| | Voice-over | `V` | Spoken over the current scene without appearing on it |
| Combine | Side by side | `C` | This passage against the one you kept (`⇧K`), in two columns |

The leading button on the marker bar is whatever the passage most wants to be: a number
becomes a number, a figure becomes a figure, a phrase inside a sentence becomes a
spotlight. One click for the obvious thing; a drag for the deliberate one.

### The preview cannot lie

Each instrument's `plan()` is pure: it returns the scenes it *would* insert without
touching the project. The same call drives the drag ghost, the keyboard shortcut and the
drop — so the scene shown floating under the cursor is literally the scene that lands.

### Marks in the reader

- Passages a scene already uses carry a mint wash and a green underline, with a numbered
  chip in the margin. Clicking the chip jumps to that scene.
- A mark that is already in a scene shows that scene's number on its marker bar.
- Hovering a scene card in the storyboard lights its passages on the page.
- Selecting a claim on the stage draws a thread from it to the exact quads it came from.

---

## 3. Canvas

- Exact aspect ratio with a letterboxed surround. Zoom `10%–400%`, `⌘0` fit, `⌘1` 100%.
- Safe areas: title-safe (90%) and action-safe (95%) as hairlines, Pro level only, toggle
  `⇧S`.
- Selection: click to select, `⇧`-click to multi-select, marquee drag on empty space,
  `⌥`-drag to duplicate, arrow keys nudge 1px, `⇧`+arrows nudge 10px.
- Transform handles: 8 resize handles, rotate handle above the top-centre. `⇧` constrains
  aspect, `⌥` resizes from centre.
- **Snapping**: to safe areas, canvas centre lines, other layers' edges and centres, the
  baseline grid (style-dependent), and the optical margin. Guides appear only while
  dragging and vanish on release. Hold `⌘` to disable snapping momentarily.
- The playhead is always live: editing while playing updates in place.

---

## 4. Scene rail

A vertical list of `SceneCard`s. Each shows: thumbnail (rendered from `resolveFrame` at
the scene's hold beat), index, title, duration, an integrity dot, and lock/hide toggles.

- Drag to reorder (dnd-kit, keyboard sensor enabled: `Space` to lift, `↑↓` to move,
  `Space` to drop, `Esc` to cancel — announced through a live region).
- `⌘D` duplicate, `⌫` delete (with an undo toast, not a confirmation dialog),
  `⌘G` group into a chapter.
- Right-click: Insert scene before/after, Split at playhead, Regenerate narration,
  Change kind, Copy provenance.
- An amber dot on a card means unresolved integrity issues; clicking it filters the
  integrity view to that scene.

---

## 5. Timeline

Five tracks:

| Track | Contents | Interactions |
|---|---|---|
| **Scenes** | Scene blocks, transitions at boundaries | Drag to reorder, edge-drag to retime, split at playhead |
| **Narration** | Cue clips with waveforms and word ticks | Drag, trim, re-synthesize, edit text inline |
| **Music** | Music clips with a ducking envelope | Drag, trim, fade handles, gain |
| **Captions** | Derived caption blocks (read-only positions) | Edit text; timing follows narration |
| **Beats** *(Pro)* | Named markers | Drag, rename, snap targets for motion |

- Magnetic snapping (8px) to scene boundaries, beats, cue starts, and the playhead, with
  a 3px dead zone for precision. Snap targets pre-highlight before drop.
- Zoom: `⌘+/-`, `⌥`-scroll, or pinch. Zoom range 1s → 10min visible.
- Ripple mode (`R`) — trimming shifts everything downstream. Off by default because
  surprising ripples are the most common source of "what just happened".
- Virtualized: only clips in the visible window plus one screen of padding are in the DOM.

---

## 6. Inspector

Contextual, tabbed. Tabs shown depend on selection type and disclosure level.

| Tab | Contents |
|---|---|
| **Content** | The text/stat/figure itself, editable, with a `ProvenanceChip` per atom |
| **Source** | The originating span rendered inline, page number, a **Go to source** button, and **Change source** |
| **Layout** | Position, size, rotation, alignment, distribute, layer order |
| **Motion** | Enter/exit preset, delay, duration, easing, stagger, and the **required** reduced-motion equivalent |
| **Voice** | Cue text, voice, rate, pauses, pronunciation overrides, re-synthesize |
| **Captions** | Style, position, line length, per-scene override |
| **Accessibility** | Alt text (with a **generated → edited** indicator), decorative flag, contrast check for this layer's text against its actual background |

The Accessibility tab runs a **live contrast check** on the selected text layer against
the pixels behind it and shows a pass/fail with the measured ratio. This is where
accessibility stops being a checklist and becomes a design tool.

---

## 7. Drag matrix

Every drag has a keyboard path. The tool drags are pointer-event based rather than
HTML5 drag-and-drop, so they work under touch and can show a live preview; the storyboard
reorder uses dnd-kit with its keyboard sensor and a live region.

| # | From | To | Result | Keyboard equivalent |
|---|---|---|---|---|
| 1 | Tool chip | A sentence on the page | That tool applied to that sentence | Mark it, press the tool's letter |
| 2 | Tool chip | The current highlight | That tool applied to the highlight | Same |
| 3 | Figure tool | A figure or a paragraph | Crops that region and builds a figure scene | `F`, then drag a box |
| 4 | The highlight (by its grip) | A tool chip | That tool applied | The tool's letter |
| 5 | The highlight | A scene card | The passage appended to that scene | Select the scene, press `A` |
| 6 | The highlight | Between two scene cards | A new scene inserted at that position | `S`, then reorder |
| 7 | Scene card | Storyboard | Reorder | `Space` lift, `↑↓`, `Space` drop |
| 8 | Scene block | Timeline | Reorder / retime | Select, `⌥←→` move, `⇧←→` trim |
| 9 | Layer | Canvas | Move | Arrows / `⇧`+arrows |
| 10 | Layer handle | — | Resize / rotate | Inspector numeric fields |

Nothing re-renders per frame during a drag: the ghost is moved by writing a transform to
one element, and React is told only when the *target* changes — when the pointer crosses
into a different sentence, a few times a second at most.

**Announcements** follow one grammar so they are learnable:
`"{item} lifted"` → `"{item} moved to position {n} of {total}"` → `"{item} dropped at
position {n}"` or `"movement cancelled"`.

---

## 8. Keyboard shortcuts

**Global**

| Key | Action |
|---|---|
| `⌘K` | Command palette |
| `⌘S` | Save now |
| `⌘Z` / `⇧⌘Z` | Undo / Redo |
| `⌘E` | Export |
| `⌘/` | Shortcut reference |
| `⌘.` | Cycle disclosure level |
| `⌘1`–`⌘4` | Toggle source / scenes / inspector / timeline |
| `⌘\` | Toggle source view mode |
| `⌘I` | Source Integrity view |
| `?` | Contextual help for the focused region |

**Playback** — `Space` play/pause · `←→` ±1 frame · `⇧←→` ±1 second ·
`↑↓` previous/next scene · `Home`/`End` start/end · `J K L` shuttle · `I`/`O` in/out ·
`M` mute

**Editing** — `V` select · `T` text · `H` highlight · `R` ripple ·
`⌘D` duplicate · `⌘G` group · `⌘⇧K` split at playhead · `⌫` delete ·
`⌘L` lock · `⌘⇧H` hide · `⌘[` `⌘]` z-order · `⌥⌘←→` align

**Reader** — click a line to take its sentence · `⌥↑`/`⌥↓` widen/narrow the mark ·
`⇧K` keep the passage for a comparison · `Esc` clear the mark ·
`S N Q B X F T` make a scene · `A H V` add to the current scene · `C` side by side ·
`⌘`-scroll to zoom

Fully remappable; the map is stored per user and exported with preferences.

---

## 9. Onboarding

**Guided first project** — four coach marks, dismissible, never modal, each anchored to a
real element and each requiring an actual action to advance:

1. *"Highlight something in the paper."* → the marker bar arrives on the mark
2. *"Drop a tool on your highlight."* → a scene appears in the storyboard, cited
3. *"Click something on the scene."* → a thread is drawn back to the words on the page
4. *"Press Space to watch it."* → playback

Total time: under 60 seconds. After that, the user has performed all three signature
interactions and can be left alone.

**Everywhere else:** empty states carry the next action, not just an illustration. The
storyboard with no scenes says *"Highlight a sentence in the paper to make your first
scene"*.

---

## 10. Source Integrity view

Full-route (`/project/:id/integrity`), not a modal — reviewing accuracy is real work and
deserves real space.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Source Integrity                                          ⚡︎ 92 / 100  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  92% grounded         │
│                                                                          │
│  ▣ 61 extracted   ◨ 24 paraphrase   ◇ 9 explanation                     │
│  ⋯ 12 connective  ✎ 3 authored      ⚠ 4 need review                     │
├─────────────────────────────────────────────────────────────────────────┤
│  Needs review (4)                                    [ Review all → ]   │
│                                                                          │
│  ⚠  Scene 3 · "reduced recovery time by roughly a third"                │
│     The paper says "reduced recovery time by 31.4% (95% CI 24.8–37.9)".  │
│     "Roughly a third" is a fair rounding, but the confidence interval    │
│     is not shown on screen.                                              │
│     [ Use the exact figure ]  [ Add the interval ]  [ Keep · reviewed ]  │
│                                       page 7 ▸                           │
└─────────────────────────────────────────────────────────────────────────┘
```

Each issue offers **concrete fixes**, not just a flag. "Keep · reviewed" is always
available — the user's judgment is final — but it is recorded, so the export knows the
claim was consciously accepted rather than missed.

Filters: by severity, by scene, by reason. Bulk actions where safe. Every row deep-links
to both the scene and the page.

---

## 11. Mobile & tablet

**Mobile** — four bottom tabs:

| Tab | Does |
|---|---|
| **Paper** | The real pages, opened zoomed far enough to read a column; tap a line to mark its sentence, then use the dock |
| **Scenes** | Reorder, retitle, edit text, adjust duration |
| **Preview** | Full-bleed playback with captions |
| **Review** | The integrity list, optimized for triage |

Editing happens in bottom sheets sized to content. Export is available and runs
server-side with a notification when complete.

Honestly absent on mobile, and labelled as such: keyframing, multitrack mixing, precise
layer positioning. A "Continue on desktop" link is offered where relevant.

**Tablet** keeps the two-pane layout — reader plus a narrower stage-and-storyboard column —
with the dock in its icon-only form.

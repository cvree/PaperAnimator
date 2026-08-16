# 05 — Editor Specification

The editor must feel like a professional instrument to someone who has used one, and
obvious to someone who has not. Both, at once, from the first project.

The mechanism for "both at once" is **progressive disclosure with three levels**
(Simple / Studio / Pro, `⌘.` to cycle) plus the principle that *the paper is the primary
interface*. A user who never opens the timeline can still make a good presentation by
highlighting and dragging.

---

## 1. Layout

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Paper Animator   Photosynthesis in Low Light      ✓ Saved   ↶ ↷   ⚡︎92   ▶ Export │  56px
├──────────────┬──────────────────────────────────────────┬──────────────────────┤
│              │                                          │                      │
│  SOURCE      │              CANVAS                      │   INSPECTOR          │
│              │                                          │                      │
│  ⌕ search    │   ┌──────────────────────────────────┐   │  ▣ Content           │
│              │   │                                  │   │  ⌖ Source            │
│  ▸ Abstract  │   │        16:9 · safe areas         │   │  ⬒ Layout            │
│  ▾ Methods   │   │                                  │   │  ↗ Motion            │
│    ¶ ¶ ¶     │   │                                  │   │  ♪ Voice             │
│  ▸ Results   │   └──────────────────────────────────┘   │  ⊞ Captions          │
│  ▸ Figures   │                                          │  ♿ Accessibility     │
│              │    ◀◀  ▶  ▶▶   00:04.2 / 03:12   ⤢ 100% │                      │
├──────────────┼──────────────────────────────────────────┴──────────────────────┤
│  SCENES      │  TIMELINE                                                       │
│  ▦ 1 Title   │  scenes    ▓▓▓▓│▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓                            │
│  ▦ 2 Question│  narration ─wave────wave───────wave──                            │
│  ▦ 3 Method ⚠│  music     ────────────────────────────                          │
│  ▦ 4 Finding │  captions  ▭▭▭ ▭▭▭▭ ▭▭  ▭▭▭▭▭ ▭▭▭                               │
│  + Add scene │  beats     ╷      ╷        ╷                                     │
└──────────────┴─────────────────────────────────────────────────────────────────┘
```

| Region | Default | Resizable | Collapsible |
|---|---|---|---|
| Top bar | 56px | no | no |
| Source pane | 320px | 240–520 | `⌘1` |
| Scene rail | 320px (below source) | shares source width | `⌘2` |
| Canvas | fill | — | — |
| Inspector | 320px | 260–480 | `⌘3` |
| Timeline | 200px | 120–480 | `⌘4` |

Panel sizes persist per user. Double-clicking a divider resets to default.

**Level gating:** Simple shows source + canvas + scene rail + transport. Studio adds the
inspector and timeline. Pro adds keyframe rows, motion curve editing, safe-area controls,
and the beats track.

---

## 2. Source pane — where the product's idea lives

A virtualized, scrollable rendering of the actual paper (page rasters with a selectable
text layer positioned from the extracted quads). Not a re-typeset approximation — the
real pages, because trust comes from recognizing your own paper.

**Two view modes:**

| Mode | Shows | Default for |
|---|---|---|
| **Outline** | Section tree with paragraph previews, figures, tables, statistics | First-time users |
| **Pages** | Actual page rasters with a live text layer | Verification, precise selection |

Toggle with `⌘\`. Both modes support selection and drag.

### Selection → action

Selecting text raises `SelectionBar` with contextual actions:

| Selection | Actions offered |
|---|---|
| A sentence | **Make a scene** · Add to current · Quote · Explain |
| A statistic | **Make a stat scene** · Add stat · Explain |
| A figure | **Make a figure scene** · Add to current · Zoom to panel |
| A table | **Make a table scene** · Add column · Add row |
| Multiple paragraphs | **Make a section** (produces several scenes) |
| An equation | **Make an equation scene** · Explain in words |

Every one of these attaches provenance automatically, because the selection *is* the
source span. This is the reason the product can promise accuracy without asking the user
to do bookkeeping.

**Keyboard equivalent:** `Tab` moves through atoms in reading order; `Space` selects;
`Shift+↓` extends; `Enter` opens the same action bar as a menu. No pointer required.

### Highlights in the source

- Spans already used by a scene are underlined in that scene's rail colour.
- Hovering a span shows *"Used in Scene 4"*; clicking jumps there.
- The current scene's spans are drawn in `--accent-subtle`.
- Unresolved integrity issues show an amber margin marker at the line.

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

Every drag has a keyboard path and a live-region announcement. dnd-kit's keyboard sensor
is enabled on every sortable and droppable.

| # | From | To | Result | Keyboard equivalent |
|---|---|---|---|---|
| 1 | Source atom | Canvas | New layer, provenance attached | Select atom → `Enter` → *Add to current scene* |
| 2 | Source atom | Scene rail | New scene built around it | Select atom → `Enter` → *Make a scene* |
| 3 | Source figure | Canvas | Figure layer with caption + alt text | Same menu |
| 4 | Source table | Canvas | Table layer (grid or image) | Same menu |
| 5 | Scene card | Scene rail | Reorder | `Space` lift, `↑↓`, `Space` drop |
| 6 | Scene block | Timeline | Reorder / retime | Select, `⌥←→` to move, `⇧←→` to trim |
| 7 | Clip edge | — | Trim | `⇧←→` on selected clip |
| 8 | Layer | Canvas | Move | Arrows / `⇧`+arrows |
| 9 | Layer handle | — | Resize / rotate | Inspector numeric fields |
| 10 | Layer | Layer list | Reorder z | `⌘[` / `⌘]` |
| 11 | Music clip | Music track | Position | `⌥←→` |
| 12 | Keyframe *(Pro)* | Motion row | Retime | `←→` when keyframe focused |
| 13 | Panel divider | — | Resize | `⌃⌥←→` when divider focused |
| 14 | External file | Canvas | Import image/audio | Toolbar → Import |

**Announcements** follow one grammar so they are learnable:
`"{item} lifted"` → `"{item} moved to position {n} of {total}"` → `"{item} dropped at
position {n}"` or `"movement cancelled"`.

**Touch:** long-press 200ms to lift (with haptics), auto-scroll near edges, a larger
30px snap radius, and a persistent menu alternative for every drag.

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

**Source** — `Tab` next atom · `⇧Tab` previous · `Space` select · `Enter` action menu ·
`⌘⏎` make a scene from selection

Fully remappable; the map is stored per user and exported with preferences.

---

## 9. Onboarding

**Guided first project** — four coach marks, dismissible, never modal, each anchored to a
real element and each requiring an actual action to advance:

1. *"Select any sentence here."* → the SelectionBar appears
2. *"Turn it into a scene."* → a scene appears in the rail with provenance attached
3. *"Click the chip to see where it came from."* → the source pane flashes the quad
4. *"Press Space to watch it."* → playback

Total time: under 60 seconds. After that, the user has performed all three signature
interactions and can be left alone.

**Everywhere else:** empty states carry the next action, not just an illustration. The
scene rail with no scenes says *"Highlight a sentence in the paper to make your first
scene"* with a button that scrolls the source pane to the abstract.

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
| **Paper** | Read, select, make scenes from selections |
| **Scenes** | Reorder, retitle, edit text, adjust duration |
| **Preview** | Full-bleed playback with captions |
| **Review** | The integrity list, optimized for triage |

Editing happens in bottom sheets sized to content. Export is available and runs
server-side with a notification when complete.

Honestly absent on mobile, and labelled as such: keyframing, multitrack mixing, precise
layer positioning. A "Continue on desktop" link is offered where relevant.

**Tablet** adds a two-pane layout (source + canvas), pen support for highlighting, and a
compact timeline for reordering and trimming.

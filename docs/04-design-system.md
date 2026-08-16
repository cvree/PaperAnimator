# 04 — Design System & Motion

**Concept:** *a research paper unfolding into a living cinematic story.*

Visual language: cinematic editorial design, tactile paper, precise scientific annotation,
quiet futurism. The product should feel like a well-made instrument — premium because
every relationship is intentional, not because it borrows luxury signifiers.

**Explicitly banned:** purple-to-blue gradients, glowing blobs, glassmorphism as a default
surface, uniform 16px-radius card grids, decorative 3D, floating device mockups, generic
SaaS bento layouts, and any motion that doesn't explain something.

---

## 1. Tokens

All tokens are CSS custom properties on `:root`, readable at runtime by the render worker.
Tailwind maps to them; nothing hardcodes a colour.

### Colour — app chrome

Two ambients: **Paper** (light) and **Press** (dark). Both are neutral-warm, not blue-grey
— paper is warm, and the whole product is about paper.

```css
:root {
  /* surfaces — warm neutrals, low chroma */
  --surface-page:    oklch(98.5% 0.004 85);   /* the app background */
  --surface-raised:  oklch(100%  0     0);    /* panels, cards */
  --surface-sunken:  oklch(96%   0.006 85);   /* wells, timeline bed */
  --surface-inverse: oklch(21%   0.012 85);

  /* ink */
  --ink-primary:   oklch(21% 0.012 85);       /* 15.8:1 on --surface-page */
  --ink-secondary: oklch(44% 0.010 85);       /*  7.4:1 */
  --ink-tertiary:  oklch(58% 0.008 85);       /*  4.6:1 — never body text */
  --ink-inverse:   oklch(97% 0.004 85);

  /* structure */
  --rule-hairline: oklch(88% 0.006 85);
  --rule-strong:   oklch(74% 0.008 85);

  /* accent — a single ink blue. One accent. */
  --accent:        oklch(48% 0.148 252);
  --accent-hover:  oklch(42% 0.152 252);
  --accent-subtle: oklch(95% 0.030 252);
}

:root[data-theme="press"] {
  --surface-page:    oklch(17% 0.010 85);
  --surface-raised:  oklch(21% 0.011 85);
  --surface-sunken:  oklch(14% 0.010 85);
  --ink-primary:     oklch(96% 0.004 85);
  --ink-secondary:   oklch(76% 0.008 85);
  --ink-tertiary:    oklch(60% 0.008 85);
  --rule-hairline:   oklch(30% 0.010 85);
  --rule-strong:     oklch(42% 0.010 85);
  --accent:          oklch(72% 0.140 252);
  --accent-subtle:   oklch(28% 0.060 252);
}
```

### Colour — evidence

These carry meaning and are **never decorative**. Each pairs with an icon and a label;
colour alone never encodes status.

| Token | Colour | Means | Icon |
|---|---|---|---|
| `--ev-extracted` | `oklch(46% 0.11 155)` green | Verbatim from the paper | ▣ solid square |
| `--ev-paraphrase` | `oklch(50% 0.10 200)` teal | Faithful restatement | ◨ half square |
| `--ev-explanation` | `oklch(52% 0.11 250)` blue | Plain-language gloss | ◇ diamond |
| `--ev-connective` | `oklch(60% 0.02 85)` grey | AI transition text | ⋯ dots |
| `--ev-authored` | `oklch(48% 0.09 300)` violet | The user wrote it | ✎ pen |
| `--ev-unsupported` | `oklch(58% 0.16 55)` amber | Needs review | ⚠ triangle |

Amber, not red: unsupported content is *unreviewed*, not *wrong*. Red is reserved for
destructive actions and hard errors. This distinction is what keeps the trust system
feeling empowering rather than punitive.

### Highlight colours

Marker colours are separate from evidence colours — they are a *presentation* device.
Five, each with a light and dark variant, each ≥ 3:1 against both page ambients when used
as a rule and ≥ 4.5:1 for any text drawn on top:

`--hl-yellow` `--hl-mint` `--hl-sky` `--hl-rose` `--hl-lilac`

### Type

Three families, each doing one job:

| Role | Family | Why |
|---|---|---|
| Display / headline | **Newsreader** (variable serif) | Editorial authority; optical sizes; the "printed" voice |
| UI / body | **Inter** (variable) | Neutral, dense, excellent at small sizes |
| Data / code / labels | **JetBrains Mono** | Tabular figures for statistics; unambiguous glyphs |

Statistics **always** render with `font-variant-numeric: tabular-nums`. A count-up
animation with proportional figures jitters, and jitter reads as imprecision.

```css
:root {
  --step--2: clamp(0.72rem, 0.70rem + 0.10vw, 0.79rem);
  --step--1: clamp(0.83rem, 0.79rem + 0.18vw, 0.94rem);
  --step-0:  clamp(1.00rem, 0.95rem + 0.24vw, 1.13rem);
  --step-1:  clamp(1.20rem, 1.12rem + 0.38vw, 1.42rem);
  --step-2:  clamp(1.44rem, 1.32rem + 0.60vw, 1.80rem);
  --step-3:  clamp(1.73rem, 1.55rem + 0.90vw, 2.28rem);
  --step-4:  clamp(2.07rem, 1.81rem + 1.32vw, 2.89rem);
  --step-5:  clamp(2.49rem, 2.10rem + 1.94vw, 3.66rem);

  --leading-tight: 1.15;   /* display */
  --leading-snug:  1.35;   /* headlines */
  --leading-body:  1.6;    /* body — reading comfort over density */
  --measure:       66ch;   /* hard cap on any prose column */
}
```

Base text size is user-adjustable (14 / 16 / 18 / 20px). The layout **reflows** — no
transform-scaling, no clipping. Tested at 200% browser zoom on every route.

### Space, radius, elevation

```css
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

--radius-sm: 3px;   /* chips, inputs */
--radius-md: 6px;   /* panels, buttons */
--radius-lg: 10px;  /* dialogs */
/* No pill buttons. No 16px+ radii. Editorial, not friendly-blob. */

/* Depth is rules + a single soft shadow, never a stack of glows */
--shadow-raised: 0 1px 2px oklch(21% 0.012 85 / 0.06),
                 0 4px 12px oklch(21% 0.012 85 / 0.05);
--shadow-float:  0 2px 4px oklch(21% 0.012 85 / 0.07),
                 0 12px 32px oklch(21% 0.012 85 / 0.10);
```

### Paper texture

A single 512×512 tiling fibre noise at **2–3% opacity**, applied to `--surface-page` only,
disabled under `prefers-reduced-transparency` and on low-power devices. It should be
felt, not seen: if you can point at it, it is too strong.

---

## 2. The four visual styles

A style is a **token set + a layout strategy + a motion profile**. Switching restyles the
whole project; user overrides survive and are marked with a dot in the inspector.

| | **Broadsheet** | **Lab Notebook** | **Signal** | **Chalk** |
|---|---|---|---|---|
| Feel | Editorial, printed | Tactile, annotated | Quiet futurism | Teaching, spoken |
| Ground | Warm off-white | Cream, faint grid | Near-black | Deep slate |
| Display type | Newsreader 600, tight | Inter 500 + margin notes | Inter 300, wide tracking | Newsreader 500, large |
| Accent | Ink blue | Pencil graphite + red pen | Cyan hairline | Warm chalk white |
| Layout | Strict baseline grid, rules | Off-grid, margin column | Modular 12-col, generous | Centre-weighted, few elements |
| Figures | Full-bleed with rule caption | Taped-in with slight rotation | Framed, hairline border | Large, minimal chrome |
| Motion | Ink: draws on, settles | Sketch: traces, micro-jitter | Optical: fades, precise slides | Human: paced, slight overshoot |
| Best for | Formal talks, journals | Lab meetings, teaching | Technical, ML/CS | Lectures, explainers |

Each style file (`packages/ui/src/styles/{style}.ts`) exports:

```ts
interface VisualStyle {
  id: StyleId;
  tokens: Record<string, string>;
  layout: LayoutStrategy;            // (scene, aspect, metrics) => Frame[]
  motion: MotionProfile;             // preset → concrete timing + easing
  decorations: DecorationSpec[];     // rules, margin notes, frames
}
```

---

## 3. Motion system

### Timing scale

| Token | ms | Used for |
|---|---|---|
| `--dur-instant` | 90 | State flips, checkbox, toggle |
| `--dur-quick` | 160 | Hover, focus ring, tooltip |
| `--dur-base` | 240 | Panel open, chip appear |
| `--dur-slow` | 380 | Scene transition, drawer |
| `--dur-deliberate` | 640 | The transformation moment (once per session) |

### Easing

```css
--ease-out:    cubic-bezier(0.16, 1, 0.30, 1);      /* things arriving */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);      /* things moving */
--ease-ink:    cubic-bezier(0.33, 0, 0.15, 1);      /* draw-on, marker sweeps */
--ease-settle: cubic-bezier(0.34, 1.26, 0.64, 1);   /* slight overshoot, Chalk only */
```

No bounce, no elastic, no spring on anything informational. Overshoot appears once, in
one style, on one preset.

### The five motion moments

**1. Hero — the unfold.** On the landing page: a real page separates into headings, a
figure, a statistic, and a citation, which drift apart, then reassemble into three scene
cards that slot into a timeline. Built from the sample paper's actual extraction. Plays
once, 3.2s, then holds the composed state. Never loops. Reduced motion: the composed end
state with connector rules drawn statically.

**2. Ambient — page fibres.** Extremely slow (60s cycle) drift of two noise layers at 2%
opacity behind the upload surface. Suggests material without competing with reading.
Disabled under reduced motion and on `deviceMemory < 4`.

**3. Transformation — the storyboard moment.** The first successful import. The processing
view's accumulated artifacts (title, sections, figures, statistics) fly into their scene
positions and the timeline draws itself left to right. 640ms, `--ease-out`, staggered 40ms
per element. This is the single most important animation in the product and it happens
**once per project** — its impact comes from scarcity.

**4. Transitions — the paper language.** Scene transitions are page operations, not video
wipes:

| Transition | What happens | Use |
|---|---|---|
| `crop` | Frame tightens onto a region of the previous scene | Zooming into a figure panel |
| `turn` | Content slides with a subtle page-edge shadow | Section change |
| `recompose` | Shared elements move to new positions | Same data, new framing |
| `dissolve` | Cross-fade | Neutral default, and the reduced-motion fallback for all |
| `cut` | Instant | Fast-paced sequences |

**5. Micro-interactions** — the ones worth building properly:

- **Citation thread**: hovering a citation draws a 200ms curve from the claim to the
  source pane's highlighted quad. The curve is a real path between two live positions,
  not an approximation.
- **Magnetic timeline**: clips snap within 8px to scene boundaries, beats, and cue starts.
  The snap target *highlights before* the drop, and there is a 3px dead zone so precision
  is still possible.
- **Waveform scrub**: playhead follows the pointer with 0 latency; the waveform under the
  cursor brightens; a tooltip shows the word at that timestamp.
- **Source highlight flash**: clicking a claim scrolls the source pane and pulses the quad
  twice (2 × 300ms). Two pulses, not a persistent glow — the eye finds it, then it stops
  demanding attention.
- **Export completion**: the file card slides up with its real thumbnail, size, and
  duration. No confetti.
- **Drag feedback**: the dragged item lifts 2px with `--shadow-float`; the drop target
  shows a 2px inset rule in `--accent`; invalid targets show nothing at all (absence is a
  clearer signal than a red X).

### Motion rules

- Motion must explain **state, causality, hierarchy, or progress**. If it explains none of
  these, delete it.
- Native scrolling is never hijacked. No scroll-jacking, no scroll-driven narrative that
  traps the user, no `overflow: hidden` on `body` outside of modals.
- Nothing important is hidden behind hover — hover reveals *shortcuts*, never *content*.
- Every animation is interruptible. Clicking during a transition completes it instantly
  and applies the click.
- `prefers-reduced-motion: reduce` swaps to the static equivalent declared on each
  `MotionSpec` (see [03](03-render-engine.md) §8), and the product remains fully
  informative.

---

## 4. Component inventory

`packages/ui`. Radix primitives underneath everything interactive.

**Foundation** — `Button` (primary/secondary/ghost/danger), `IconButton`, `Input`,
`Textarea`, `Select`, `Combobox`, `Slider`, `Switch`, `Checkbox`, `RadioGroup`,
`SegmentedControl`, `Tabs`, `Tooltip`, `Popover`, `Dialog`, `Drawer`, `ContextMenu`,
`DropdownMenu`, `Toast`, `Progress`, `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`.

**Domain** — the components that make this product what it is:

| Component | Job |
|---|---|
| `Dropzone` | Upload; drag-over, invalid-type, too-large, and progress states |
| `PageCanvas` | Renders a page raster with an interactive quad overlay |
| `SourcePane` | Scrollable paper with selection, highlights, and virtualized pages |
| `SelectionBar` | The floating "Make a scene / Quote / Explain" bar |
| `ProvenanceChip` | Colour + icon + label + confidence; the atom of the trust system |
| `SourceLink` | Bidirectional claim ↔ source affordance |
| `IntegrityMeter` | The always-visible 0–100 score |
| `SceneCard` | Scene rail item: thumbnail, title, duration, integrity dot, drag handle |
| `Timeline` | Multitrack, virtualized, magnetic |
| `Waveform` | Peaks from the audio worker, scrub, cue boundaries |
| `LayerInspector` | Contextual properties for the selected layer type |
| `StylePicker` | Four styles with live previews rendered from the real project |
| `ExportSheet` | Presets, options, validation, progress, results |
| `CommandPalette` | `⌘K` — every action, searchable |

Every component ships with: all states (default / hover / focus / active / disabled /
loading / error / empty), a keyboard interaction spec, an ARIA contract, and both
ambients. A component without these is not done.

---

## 5. Responsive

| Range | Layout |
|---|---|
| `< 640` | **Mobile**: single column, bottom tab bar (Source · Scenes · Preview · Review), sheet-based editing, large touch targets |
| `640–1023` | **Tablet**: two panes side by side, bottom sheet inspector, pen/touch drag with 44px targets |
| `1024–1439` | **Desktop compact**: full editor, timeline collapsed by default |
| `≥ 1440` | **Desktop**: the full four-region editor |

**Mobile is purposeful, not compressed.** It supports: upload, review scenes, read and
verify provenance, light text edits, reorder scenes, play, comment, and export. It does
**not** attempt keyframing, multitrack audio mixing, or precise layer positioning — those
are honestly marked as desktop features rather than shipped as unusable miniatures.

Touch targets ≥ 44×44px. Drag on touch uses long-press-to-lift (200ms) with haptic
feedback where available, plus an always-present menu alternative.

---

## 6. Accessibility of the design system itself

- Focus ring: 2px solid `--accent` + 2px offset, verified ≥ 3:1 against **both** the
  element and the surrounding surface.
- Contrast: body text ≥ 7:1 (AAA), UI text and icons ≥ 4.5:1, non-text boundaries ≥ 3:1.
  Enforced by a token-level contrast test in CI that checks every documented pairing.
- No information conveyed by colour alone — every evidence state has icon + text.
- `--ink-tertiary` is forbidden for body text by lint rule; it exists for rules and
  disabled affordances only.
- All animations respect `prefers-reduced-motion`; all transparency respects
  `prefers-reduced-transparency`; all borders respect `prefers-contrast: more` by
  promoting hairlines to `--rule-strong`.

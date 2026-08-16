# 03 — Render Engine

The engine exists to make one promise true: **the frame you see at time *t* in the editor
is the frame in the exported video at time *t*.** Everything here follows from that.

---

## 1. The contract

```ts
// packages/render/src/resolveFrame.ts
// Pure. Deterministic. No DOM, no clock, no randomness, no I/O.
export function resolveFrame(project: Project, tMs: number): FrameState;

export interface FrameState {
  tMs: number;
  sceneId: SceneId;
  sceneTMs: number;              // time within the scene
  layers: ResolvedLayer[];       // z-sorted, invisible layers already removed
  transition: ResolvedTransition | null;
  captions: ResolvedCaption[];
  audio: AudioFrameState;        // for scrubbing/waveform only, not playback
  safeAreas: SafeAreaSpec;
}

export interface ResolvedLayer {
  id: LayerId;
  type: Layer['type'];
  frame: Frame;                  // post-motion, post-layout, normalized 0–1
  opacity: number;
  transform: { rotate: number; scale: number; skewX: number };
  clip: Frame | null;
  content: ResolvedContent;      // discriminated by type
  highlights: ResolvedHighlight[];
  reviewChip: boolean;           // unsupported && !reviewed
}
```

Consumers:

| Consumer | Time source | Loop |
|---|---|---|
| Editor preview | `performance.now()` offset from play start | `requestAnimationFrame` |
| Timeline scrub | Pointer position → ms | On pointer move |
| Server export | Frame counter | `for (let f = 0; f < total; f++) resolveFrame(p, f * 1000 / fps)` |
| WebCodecs export | Frame counter | Same |
| Still export (PNG/PDF/PPTX) | Scene `beats.hold` or midpoint | Once per scene |

Because all five call the same function, fidelity is structural. There is no "export
renderer" to drift from a "preview renderer" — there is one renderer with several clocks.

---

## 2. The rules that keep it pure

1. **No CSS transitions or animations inside the canvas subtree.** Enforced by an ESLint
   rule (`no-restricted-syntax` on `transition`/`animation` properties within
   `packages/render` and `apps/web/src/editor/canvas`) and by a runtime dev-mode assertion
   that walks the canvas subtree's computed styles once per second.
2. **No `framer-motion` inside the canvas.** Import-boundary lint rule. It is welcome
   everywhere else.
3. **No `Math.random()` or `Date.now()` in `packages/render`.** Any needed jitter (the
   Lab Notebook style's hand-drawn wobble) comes from a seeded PRNG whose seed is the
   layer id, so it is stable across renders and across machines.
4. **No layout measurement.** Text layout is computed with an explicit measurement pass
   *before* resolve (§4), never read from the DOM during resolve.
5. **Fonts are embedded, not fetched.** The render worker loads the same WOFF2 subsets
   from the bundle. A missing font would change metrics and break fidelity.

---

## 3. Time model

```
project timeline
├── scene[0]  0 ────────────── 4200ms
├── scene[1]  4200 ─────────── 9100ms      (transitions overlap the boundary)
└── scene[2]  9100 ─────────── 13400ms

within a scene
├── cue[0]      0 ──── 1800      words: [0,220][220,410]…
├── cue[1]   1800 ──── 4100
├── beat "reveal"      @ 1200
└── layer enter/exit keyed off cue starts, beats, or absolute ms
```

- **Scene duration is derived by default**: `sum(cue durations) + leadIn + leadOut`,
  clamped to a minimum of 1.8s. The user can pin a duration; pinning is recorded so a
  re-synthesis of narration doesn't silently overwrite an intentional choice.
- **Transitions overlap**: a 400ms transition means the outgoing scene renders until
  `end + 200` and the incoming from `start - 200`. `resolveFrame` returns both layer sets
  with a `transition.progress` so the compositor can cross-render.
- **Word timings drive highlights**, so changing the voice or rate re-times every
  highlight correctly with no manual work.

### Retiming

When narration is re-synthesized, `retimeScene()` runs:

1. New cue durations replace old ones.
2. Absolute-timed motion is scaled proportionally *only if* the layer opted in
   (`timing.elastic: true`, the default); pinned timings hold.
3. Word-mode highlights need no action — they resolve from the new word timings.
4. Beats are re-anchored to their nearest cue word if they were created from one.

---

## 4. Layout and text

Text is the hard part of determinism: the same string can wrap differently given a
different font load state or a different browser.

**Solution: pre-measured, cached text layout.**

```ts
interface TextLayout {
  lines: { text: string; width: number; runs: Run[] }[];
  height: number;
  fontKey: string;               // family + weight + size + tracking
  measuredAt: number;
}
```

- Measurement uses an `OffscreenCanvas` 2D context with the embedded font, not DOM
  reflow. Deterministic across editor, worker, and headless Chromium.
- Layout is memoized on `hash(text + fontKey + maxWidth)`, stored on the layer, and
  invalidated only when one of those changes.
- The export worker asserts, per scene, that every text layer has a `TextLayout` whose
  `fontKey` matches the loaded font. A mismatch fails the render loudly instead of
  producing a subtly reflowed video.

Style layout strategies (`packages/render/src/layout/`) take a scene + a style and produce
`Frame`s for auto-placed layers. They are pure functions of
`(sceneKind, layerTypes, aspect, textMetrics)` — same inputs, same boxes.

---

## 5. Compositing

The canvas is a **DOM layer tree**, not a `<canvas>` bitmap:

| Element | Rendered as |
|---|---|
| Text | Real DOM text with `transform` and `opacity` from `ResolvedLayer` |
| Figure / table image | `<img>` with `object-fit` and clip |
| Highlights | Inline SVG overlays positioned from resolved quads |
| Shapes, rules, tethers | Inline SVG |
| Charts | SVG generated from `TableGrid` data |

Why DOM over canvas:

- **Text stays selectable and accessible in the editor** — screen readers can read the
  slide, which a bitmap canvas can never offer.
- Font rendering matches the browser exactly, and the export runs in a browser.
- Debugging is possible with devtools.

The cost is that we must be disciplined about not letting CSS animate anything (§2).
Every frame, we write `transform`/`opacity`/`clip-path` values computed by `resolveFrame`.
These are compositor-only properties, so 30–50 layers stay comfortably inside 16ms.

**Rendering path per frame:**

```
resolveFrame(project, t)
  → diff against previous FrameState (shallow, by layer id)
  → write only changed style properties (no React re-render for the canvas)
  → React owns structure (which layers exist); direct DOM writes own animation values
```

React re-renders when the layer *set* changes; per-frame value updates bypass React
entirely via refs. This is the standard escape hatch and it is what keeps scrubbing at
60fps with 200 clips.

---

## 6. Export path

```
┌─────────────────────────────────────────────────────────────┐
│ render service (Node)                                       │
│  1. materialize project → temp dir with all assets local    │
│  2. launch Chromium (pinned version, fixed device scale)    │
│  3. open /render?projectId=…&fps=30&w=1920&h=1080           │
│  4. page.evaluate(() => window.__render.seek(frameIndex))   │
│  5. screenshot → raw RGBA → stdin of ffmpeg                 │
│  6. ffmpeg muxes video + narration + music → mp4            │
└─────────────────────────────────────────────────────────────┘
```

Key details:

- `window.__render.seek(n)` calls `resolveFrame(project, n * 1000 / fps)`, applies it,
  waits for `document.fonts.ready` and all image decodes on the **first** frame only, then
  resolves. Subsequent frames are synchronous — assets are already decoded.
- Device scale factor is fixed at 1 and dimensions are set exactly, so no subpixel
  scaling enters the pipeline.
- Audio is rendered separately (§7) and muxed, never captured from the page. Page audio
  capture is the classic source of drift.
- Deterministic seek means we can render frames **out of order** and in parallel shards
  for long projects: shard *k* renders frames `[k·N, (k+1)·N)` in its own browser context,
  and ffmpeg concatenates. Only possible because `resolveFrame` is pure.

### In-browser fast path

For ≤ 90s at ≤ 1080p, `WebCodecs` + `mp4-muxer` encodes locally:

- Same `resolveFrame`, rendered into an `OffscreenCanvas` via `html2canvas`-free direct
  SVG/DOM serialization for the layer tree.
- ~5–10× faster than a server round-trip and keeps the paper on-device.
- Feature-detected; falls back to the server path silently but tells the user which path
  ran, because render time expectations differ.

---

## 7. Audio rendering

Audio never goes through the browser during export:

```
cues (with audioKey) ──┐
                       ├─► ffmpeg filter graph ─► narration bed
music track ───────────┘        ├─ adelay per cue (exact ms from the timeline)
                                ├─ sidechaincompress (ducking, from AudioTrack.ducking)
                                ├─ volume (gainDb per track)
                                └─ loudnorm I=-16 LRA=11 TP=-1.5   (podcast standard)
```

`-16 LUFS` integrated is the target for spoken content; the same graph produces the
standalone MP3/WAV exports, so a user's audio-only export is identical to the video's
audio track. That identity is asserted in a test by comparing checksums of the extracted
audio stream.

---

## 8. Reduced motion

Reduced motion is a **render mode**, not a CSS media query:

```ts
resolveFrame(project, tMs, { reducedMotion: true })
```

Every `MotionSpec` declares its `reducedMotion` fallback (`'fade'` or `'none'`), which is
a required field — you cannot author a motion without deciding what its still equivalent
is. In reduced mode:

- Transforms collapse to their end state.
- `fade` presets keep a 150ms opacity change (movement, not motion sickness).
- Highlight `sweep` becomes an instant full-width highlight at the word it would have
  reached — **information preserved, motion removed**.
- Scene durations are unchanged, so narration and captions stay in sync.

The editor has a **Preview reduced motion** toggle, and the export dialog offers a
reduced-motion variant as a *second output file*, not a replacement.

---

## 9. Fidelity testing

`e2e/fidelity.spec.ts`, run in CI on every PR touching `packages/render`:

1. Load three fixture projects (one per visual style, plus one 9:16).
2. For each, pick 5 timestamps: `0`, first transition mid-point, a highlight peak, a
   figure reveal, and the final frame.
3. Capture the editor canvas at each timestamp via `seek()` + screenshot.
4. Run the export path for the same frames.
5. Compare with `pixelmatch` at threshold 0.02 (2% perceptual difference).

Any regression fails the build with both images attached to the run. This test is the
enforcement mechanism for non-negotiable #2 in the master plan — without it, "preview
equals export" is a wish.

---

## 10. Performance

| Concern | Approach |
|---|---|
| Off-screen scenes | `content-visibility: auto` + `contain-intrinsic-size` |
| Large figure images | Decoded once, cached by key, `ImageBitmap` reused across frames |
| Many layers | Diffed writes; only changed properties touched per frame |
| Long timelines | Virtualized clip rendering; only the visible window is in the DOM |
| Memory | `ImageBitmap.close()` on scene eviction; object URLs revoked on layer delete; audio buffers released when a scene leaves the ±2 scene window |
| Export throughput | Frame sharding across contexts; ffmpeg fed raw RGBA over a pipe, never via temp PNGs |

Frame-time budget: **16ms p95 at 30 layers**. A dev-mode overlay (`⌥⌘P`) shows resolve
time, write time, and layer count, so regressions are visible while building rather than
in a profile session later.

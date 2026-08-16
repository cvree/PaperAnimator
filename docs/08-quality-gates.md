# 08 — Quality Gates

Accessibility, performance, states, and testing. These are the things that get skipped
when a deadline arrives, so they are written down as gates with owners and CI checks
rather than as intentions.

---

## 1. Accessibility

**Target: WCAG 2.2 Level AA**, with AAA contrast on body text. Not a compliance exercise —
a paper explainer that a blind researcher cannot use has failed at its own mission.

### Structure

- One `<h1>` per route; heading levels never skip.
- Landmarks on every route: `banner`, `navigation`, `main`, `complementary`, `contentinfo`.
- The editor's four regions are `<section>`s with `aria-label`s ("Source paper",
  "Scenes", "Canvas", "Timeline") so a screen-reader user can jump between them.
- Skip links: to main content, and (in the editor) to each region.

### Keyboard

Every action is reachable. **Every drag has a documented keyboard equivalent**
([05](05-editor-spec.md) §7) — this is the single hardest accessibility requirement in the
product and the reason dnd-kit was chosen over alternatives.

- Focus order follows visual order in every region.
- Focus is trapped in dialogs and returned to the trigger on close.
- Focus is never lost: deleting a scene moves focus to the next scene, or to the rail.
- `Esc` cancels the current interaction at every level (drag → selection → dialog).
- No keyboard traps anywhere, including the canvas and timeline.
- A visible focus ring on every focusable element: 2px `--accent`, 2px offset, verified
  ≥ 3:1 against both the element and the surface behind it.

### Screen readers

Tested on **VoiceOver + Safari**, **NVDA + Firefox**, and **JAWS + Chrome**.

- Live regions: `role="status"` for autosave, job progress, and drag announcements;
  `role="alert"` for errors only.
- Drag announcements follow one grammar (see [05](05-editor-spec.md) §7).
- Canvas layers are exposed as a list with type, content, and provenance:
  *"Text layer, 'Recovery time fell by 31.4%', extracted from page 7, 2 of 5."*
- Provenance chips announce their full meaning, not just their colour:
  *"Extracted verbatim, page 7, confidence high."*
- The timeline is exposed as a set of labelled ranges with position and duration.
- Decorative elements are `aria-hidden`.

### Perception

| Requirement | Value |
|---|---|
| Body text contrast | ≥ 7:1 (AAA) |
| UI text, icons | ≥ 4.5:1 |
| Non-text boundaries, focus | ≥ 3:1 |
| Target size | ≥ 24×24 CSS px (AA); ≥ 44×44 on touch |
| Text resize | 200% with reflow, no clipping, no horizontal scroll |
| Colour independence | Every status has icon + text |
| Motion | `prefers-reduced-motion` honoured with informational equivalents, not removals |
| Transparency | `prefers-reduced-transparency` disables paper texture and blur |
| Contrast preference | `prefers-contrast: more` promotes hairlines to `--rule-strong` |

### Media

- Captions on all exported video, accurate to word timings.
- Transcript always available, always exportable.
- Alt text on every non-decorative image, generated but always user-editable, and
  **carried into PPTX and tagged PDF exports**.
- Media controls are real buttons with labels, not icon-only div soup.
- Nothing autoplays with sound.
- Playback is pausable, and the playhead is keyboard-controllable.

### Enforcement

| Check | Where |
|---|---|
| `axe-core` on all routes, zero violations | CI, every PR |
| Token contrast pairings | CI, unit test over the token map |
| Keyboard-only full task | CI, Playwright, no pointer events |
| Focus-visible on every interactive element | CI, Playwright sweep |
| Screen-reader smoke test | Manual, every release |
| 200% zoom, no clipping | CI, Playwright at 2× with layout assertions |

---

## 2. Performance budgets

Measured on a throttled profile (4× CPU slowdown, Fast 3G) in CI. A budget breach fails
the build.

| Metric | Budget | Measured by |
|---|---|---|
| LCP on `/` | < 1.8 s | Lighthouse CI |
| First interactive dropzone | < 1.0 s | Custom mark |
| CLS, all routes | < 0.05 | Lighthouse CI |
| INP, editor | < 200 ms | Playwright + PerformanceObserver |
| Editor initial JS | < 350 KB gzip | `size-limit` |
| Landing initial JS | < 120 KB gzip | `size-limit` |
| Time to first extracted artifact | < 4 s (12-page native PDF) | E2E timing |
| Full extraction | < 25 s (12-page native PDF) | E2E timing |
| Canvas frame time, 30 layers | < 16 ms p95 | Bench harness |
| Timeline scrub, 200 clips | 60 fps sustained | Bench harness |
| Memory after 30 min editing | < 1.2 GB, no monotonic growth | Playwright + CDP heap sampling |

### Techniques

**Loading order** — useful content before decorative systems. The dropzone is interactive
before the hero animation's assets are fetched. The hero is lazy and deferred behind
`requestIdleCallback`; if it never loads, the page is fully usable.

**Workers** — PDF parsing, OCR, and waveform analysis never touch the main thread.
Transferable objects (`ArrayBuffer`, `ImageBitmap`) move data without copying.

**Streaming** — extraction and render progress arrive over SSE and render incrementally.
Partial results are shown as they land.

**Code splitting** — routes split at the router; the editor's Studio and Pro panels are
lazy chunks loaded on first level change; export encoders load on demand.

**Assets** — WOFF2 subsets per family with `size-adjust`/`ascent-override` fallbacks so
the fallback font occupies identical space (CLS → 0). AVIF with WebP fallback. Page
rasters at exactly the two sizes we use, never scaled down in the browser.

**Rendering** — `content-visibility: auto` on off-screen scenes; virtualized scene rail,
timeline, and source pages; per-frame writes bypass React
([03](03-render-engine.md) §5).

**Memory discipline** — explicit teardown is a review checklist item:

- `URL.revokeObjectURL` on every created object URL
- `ImageBitmap.close()` when a scene leaves the ±2 window
- `AudioBufferSourceNode.disconnect()` on cue change
- Worker `terminate()` on route leave
- `AbortController` on every fetch, aborted on unmount
- `ResizeObserver`/`IntersectionObserver` disconnected in cleanup

**Low-power path** — `navigator.deviceMemory < 4` or `hardwareConcurrency < 4` disables
paper texture and ambient motion, reduces preview resolution to 720p, and caps worker
concurrency at 2. The product gets simpler, never broken.

---

## 3. State catalogue

Every one of these has a designed screen and a test. This list is the checklist; an entry
without a screen is an incomplete feature.

### Upload

| State | Behaviour |
|---|---|
| Empty | Clear affordance, formats, size limit, privacy statement |
| Drag over | Surface lifts, border becomes `--accent`, "Drop to begin" |
| Invalid type | *"That's a .docx. Paper Animator reads PDFs — export it as a PDF and try again."* |
| Too large | Actual size vs limit, with a suggestion (split, or compress) |
| Encrypted | Inline password field, tried once, never stored |
| Corrupt | *"This PDF appears damaged (it ends unexpectedly at page 4)."* + "Try another file" |
| Upload in progress | Real percentage, cancellable, resumable |
| Offline | Queued locally, retried on reconnect, stated clearly |

### Processing

| State | Behaviour |
|---|---|
| Running | Named stages, live partial results, real progress |
| Degraded | The degradation is shown *at that moment*, with its impact |
| Scanned detected | Explains OCR, shows an estimate, offers to continue or cancel |
| Failed, recoverable | The stage that failed, retry button, partial results kept |
| Failed, terminal | Plain explanation, the file is kept, a support path |
| Cancelled | Partial artifacts discarded, file retained, no orphan storage |

### Editor

| State | Behaviour |
|---|---|
| First project | Guided four-step walkthrough |
| No scenes | *"Highlight a sentence in the paper to make your first scene"* + a button |
| Saving / saved / save failed | Explicit status in the top bar, never ambiguous |
| Offline | Local-only banner; edits queue in the journal; sync on reconnect |
| Conflict (two tabs) | Both versions shown with a diff; user picks; nothing auto-resolved |
| Recovered session | *"We recovered unsaved work from 14:32"* with Restore / Discard and a preview |
| Narration generating | Per-scene spinner, other scenes remain editable |
| Asset missing | Placeholder with the reason and a re-fetch action |
| Locked layer | Selection shows a lock; edit attempts explain rather than doing nothing |

### Export

| State | Behaviour |
|---|---|
| Validation blocked | Issues listed with Fix actions |
| Queued | Position, estimated start, cancellable |
| Rendering | Per-stage progress, frame counts, honest time estimate |
| Failed | The stage, the reason, retry, partial artifacts kept |
| Complete | File card with thumbnail, size, duration, download, share |
| Expired | *"This render expired after 7 days"* + re-render |

### System

Permission denied · Not found · Rate limited · Quota exceeded · Server error ·
Unsupported browser · Session expired. All seven have designed pages with a specific
message and at least one action.

---

## 4. Test strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Extraction heuristics, `resolveFrame`, provenance invariants, caption breaking, schema migrations |
| Property | fast-check | `resolveFrame` purity (same inputs → same output, always); command inverse round-trips (`apply(inverse(apply(c)))` is identity) |
| Contract | Vitest + MSW | API request/response shapes; AI client behaviour against recorded fixtures |
| Fixture | Vitest | Ten-paper extraction corpus with snapshot assertions ([02](02-extraction-pipeline.md) §4) |
| Integration | Vitest | Pipeline stages composed; job orchestration; failure and retry paths |
| Fidelity | Playwright + pixelmatch | Preview vs export, 5 timestamps × 3 styles ([03](03-render-engine.md) §9) |
| E2E | Playwright | Happy path, keyboard-only path, mobile path, every export format opened and asserted |
| A11y | axe-core + Playwright | Zero violations on all routes; focus sweep; 200% zoom |
| Perf | Lighthouse CI + custom benches | All eleven budgets |
| Visual | Playwright screenshots | Component library, both ambients, all four styles |
| Load | k6 | Concurrent extraction and render jobs; queue behaviour at capacity |

### The E2E happy path

One test, run on every PR, that does the whole thing:

1. Upload `arxiv-two-column.pdf`
2. Wait for extraction; assert the title, section count, and figure count
3. Accept the proposed structure
4. Assert scenes exist and all carry provenance
5. Select a sentence in the source pane → **Make a scene**
6. Assert the new scene's provenance resolves to the right page
7. Drag a figure onto the canvas; assert the layer and its alt text
8. Open Source Integrity; assert the score and the issue count
9. Export MP4 + SRT + PPTX
10. **Open each file**: ffprobe the MP4 (duration, codec, pixel format), parse the SRT
    (cue count, monotonic times), reopen the PPTX (slide count, notes present)
11. Assert no console errors and no unhandled rejections across the entire run

### Manual verification before each release

Automation cannot judge whether something feels right. Before every release, one person
does all of this on real hardware:

- Full task at 320px, 768px, 1440px, and 2560px
- Full task with keyboard only
- Full task with VoiceOver
- Full task with `prefers-reduced-motion: reduce` — is anything lost?
- A 400-page paper, a pure-scan paper, a non-English paper
- Slow network (Fast 3G) through the whole flow
- Interrupted upload, killed tab mid-edit, recovery
- Open every exported file in its native application — QuickTime, PowerPoint, Preview,
  VLC — not just in a parser

---

## 5. Release checklist

- [ ] All CI gates green (unit, fixture, fidelity, E2E, a11y, perf, visual)
- [ ] Every state in §3 has a screen and a test
- [ ] Every export format opened in its native application by a human
- [ ] Manual verification list (§4) completed and signed off
- [ ] No `TODO`, `FIXME`, `console.log`, or commented-out code on the release branch
- [ ] No unused dependencies (`depcheck` clean); bundle diff reviewed
- [ ] Migration path tested from the previous schema version with a real old project file
- [ ] Privacy statements identical across upload screen, privacy page, and terms
- [ ] Error tracking, performance monitoring, and per-stage AI cost tracking all reporting
- [ ] Rollback plan written and tested on staging

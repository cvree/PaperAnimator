# 09 — Roadmap

Nine milestones. Each is **demoable** and each has acceptance criteria that are checkable
by someone other than the author. Nothing is "done" because the code exists; it is done
when the criteria pass.

The ordering is chosen so that the riskiest assumptions are tested earliest: extraction
quality (M1) and preview/export fidelity (M4) are the two things that, if they fail, mean
the product cannot exist in this shape. Both are proven before any polish work starts.

---

## M0 — Foundations (week 1)

Monorepo, tooling, and the type system. No features.

**Build**
- pnpm workspace: `apps/web`, `apps/api`, `packages/{core,render,extract,ai,tts,export,ui}`
- TypeScript strict, ESLint (including the import-boundary and no-CSS-animation rules),
  Prettier, Vitest, Playwright
- CI: typecheck, lint, unit, build — on every PR
- `packages/core`: every type and Zod schema from [01](01-data-model.md), plus the
  invariant assertions
- Design tokens in `packages/ui`, both ambients, contrast test passing
- Docker compose: Postgres, Redis, MinIO
- Prisma schema and first migration

**Done when**
- [ ] `pnpm build && pnpm test && pnpm lint` green from a clean clone
- [ ] A `Project` fixture round-trips through Zod with no loss
- [ ] The token contrast test passes for every documented pairing
- [ ] The import-boundary lint rule fails a deliberate violation

---

## M1 — Extraction (weeks 2–4) · **highest risk**

Prove we can read papers well enough for the product to be honest.

**Build**
- `pdfjs-dist` worker: pages, text items, resolved transforms → `Quad`s
- Two-column reading order; line and paragraph merging
- Section detection with the scoring function; `SectionKind` classification
- Figure detection, cropping, caption matching, subpanel detection
- Table detection, always-image + conditional grid, confidence scoring
- Reference parsing and in-text citation linking
- Statistic extraction with qualifier binding
- OCR path (client tesseract.js, server ocrmypdf)
- `ExtractionReport` with per-stage degradations
- The ten-paper fixture corpus with hand-checked snapshots

**Done when**
- [ ] All ten fixtures extract without crashing
- [ ] Titles correct on 10/10; section trees correct on 8/10
- [ ] Figures: ≥ 90% detected, ≥ 85% correctly captioned across the corpus
- [ ] Tables: 100% produce a usable image; ≥ 60% produce a correct grid
- [ ] Statistics: ≥ 95% of regex-matched values keep their qualifiers
- [ ] The scanned fixture produces usable text via OCR
- [ ] The corrupt fixture fails with a specific, human message
- [ ] Every extracted atom has a `SourceRef` whose quads land within 2pt of the truth

**If this milestone misses its bar**, the product's promise changes before anything else
is built — that is the point of doing it first.

---

## M2 — Comprehension & provenance (weeks 5–6)

**Build**
- `packages/ai` client: caching layout, refusal wrapper, cost logging
- Comprehension call via strict tool use + citations
- `cited_text` → quads resolution with the 0.85 confidence floor
- Provenance classification and all six `UnsupportedReason` paths
- The code-based verification pass ([07](07-ai-services.md) §6)
- Integrity scoring

**Done when**
- [ ] Comprehension returns grounded results on all ten fixtures
- [ ] The `no-limitations` fixture returns `[]` — it does not invent limitations
- [ ] The caching CI assertion passes (`cache_read_input_tokens > 0` on call two)
- [ ] A hand-seeded fabricated statistic is caught as `value-mismatch`
- [ ] A hand-seeded strengthened claim is caught as `hedge-strengthened`
- [ ] A refusal is handled without an unhandled exception
- [ ] Measured cost for a 12-page paper is within 25% of the $1.11 estimate

---

## M3 — Scenes & the render engine (weeks 7–9) · **second-highest risk**

**Build**
- Scene generation from comprehension: kind selection, pacing, layer composition
- `resolveFrame` and the layer renderers
- The Broadsheet visual style, complete
- Motion presets and the `HighlightSpec` system including word-mode timing
- Canvas with playback, scrubbing, and the transport
- Property-based purity tests for `resolveFrame`

**Done when**
- [ ] A fixture paper produces 12–20 coherent scenes automatically
- [ ] Playback is smooth at 60fps with 30 layers
- [ ] `resolveFrame` passes the purity property test over 10,000 generated inputs
- [ ] Every scene's layers trace to a `SourceRef`
- [ ] A highlight sweep tracks narration word timings within 50ms
- [ ] Reduced-motion mode loses no information

---

## M4 — Export & fidelity (weeks 10–12) · **the proof**

**Build**
- Render service: Chromium + ffmpeg, deterministic seek, frame sharding
- MP4, WebM, GIF
- TTS integration with word timings (and the forced-alignment fallback)
- Audio graph: narration, music, ducking, loudness normalization
- MP3, WAV, SRT, VTT, transcript
- The fidelity test harness

**Done when**
- [ ] Fidelity test passes: 5 timestamps × 3 fixtures within 2% perceptual difference
- [ ] Exported MP4 opens in QuickTime, VLC, and Chrome
- [ ] Duration within ±100ms of the timeline
- [ ] Caption times within ±50ms of cue times
- [ ] MP4 audio and standalone MP3 are perceptually identical
- [ ] A 3-minute project renders in under 4 minutes on the reference machine
- [ ] Cancelling a render leaves no orphaned storage

**This is the milestone where the product becomes real.** Everything after it is
extension and refinement.

---

## M5 — The editor (weeks 13–16)

**Build**
- Full four-region layout with resizing and persistence
- Source pane: both view modes, virtualized, with selection
- The three signature interactions: highlight→scene, drag→canvas, click→proof
- Scene rail with reordering
- Timeline with all five tracks, magnetic snapping, virtualization
- Inspector, all seven tabs
- Command stack, undo/redo with coalescing
- Autosave, journal, crash recovery
- Command palette
- Simple / Studio / Pro disclosure levels

**Done when**
- [ ] Every drag has a working keyboard equivalent with announcements
- [ ] Undo/redo is correct across 50 mixed operations (property test)
- [ ] A killed tab recovers with no data loss
- [ ] Timeline scrubs at 60fps with 200 clips
- [ ] The four-step onboarding completes in under 60 seconds
- [ ] Simple mode alone can produce a complete, exportable project

---

## M6 — Integrity, styles & documents (weeks 17–19)

**Build**
- The Source Integrity route with fixes, filters, and deep links
- The remaining three visual styles (Lab Notebook, Signal, Chalk)
- Style switching with override preservation
- PPTX with speaker notes, alt text, and the source appendix
- PDF (slides and handout modes), tagged
- PNG/JPG stills and contact sheet
- `.paperanim` codec with migrations

**Done when**
- [ ] The integrity view catches all three seeded issue types in a fixture project
- [ ] All four styles render all scene kinds without layout breakage
- [ ] Style switching preserves user overrides and marks them
- [ ] PPTX opens in PowerPoint, Keynote, and Google Slides with correct text and notes
- [ ] PDF passes a tagged-structure check
- [ ] A `.paperanim` file round-trips with zero loss and byte-identical repeat exports

---

## M7 — Accessibility, responsive & polish (weeks 20–22)

**Build**
- Full a11y pass: landmarks, live regions, focus management, canvas exposure
- Mobile and tablet layouts
- All states from [08](08-quality-gates.md) §3
- Reduced-motion equivalents for every animation
- The hero and transformation moments
- Performance work to hit every budget

**Done when**
- [ ] Zero axe-core violations on every route
- [ ] A full task completed keyboard-only, and again with VoiceOver
- [ ] Reduced motion loses no information
- [ ] 200% zoom reflows with no clipping on every route
- [ ] All eleven performance budgets pass in CI
- [ ] Every state has a screen and a test
- [ ] A full task completed on a phone

---

## M8 — Hardening & launch (weeks 23–24)

**Build**
- Load testing and queue tuning
- Error tracking, performance monitoring, per-stage cost dashboards
- Rate limiting, quotas, abuse handling
- Privacy: deletion job with verification, retention enforcement, consent flows
- Documentation: README, user guide, keyboard reference, privacy page
- Rollback tooling

**Done when**
- [ ] Load test passes at target concurrency with acceptable queue times
- [ ] Deletion is verified end-to-end: DB, object store, and Files API
- [ ] The release checklist ([08](08-quality-gates.md) §5) is fully green
- [ ] The definition of done in [`PLAN.md`](../PLAN.md) §11 is fully satisfied

---

## Sequencing notes

**Why extraction first.** Everything downstream is built on `Paper`. If figure detection
is unreliable, the scene generator, the editor's drag source, and the export's image
handling all inherit the problem. Finding that out in week 3 costs a re-plan; finding out
in week 15 costs the project.

**Why fidelity before the editor.** If preview and export can't be made to match, the
architecture changes — and the editor is the largest surface built on that architecture.
M4 before M5 means the expensive thing is built on proven ground.

**Why the integrity view comes late.** It depends on every provenance path existing and
being exercised. Built earlier it would be a shell; built at M6 it is populated by real
issues from real projects, which is the only way to design its fixes well.

**What can be cut under pressure**, in order:

1. The Chalk and Signal styles (ship two, not four)
2. Pro disclosure level (keyframes, motion curves)
3. GIF export
4. Handout-mode PDF
5. Tablet-specific layout (mobile + desktop only)

**What cannot be cut, ever:** provenance, the integrity view, keyboard equivalents for
drags, reduced-motion equivalents, export verification, and the fidelity test. Cutting any
of these produces a different, worse product that happens to share a name with this one.

---

## Parallelization

With three engineers:

| | Track A | Track B | Track C |
|---|---|---|---|
| Weeks 1–4 | Foundations → Extraction | Design system → Component library | API, jobs, storage, auth |
| Weeks 5–9 | Comprehension, provenance | Render engine, styles | Render service, TTS |
| Weeks 10–16 | Scene generation, integrity | Editor UI | Export formats, verification |
| Weeks 17–24 | Accessibility, states | Responsive, polish | Hardening, monitoring |

The one hard serialization: **`packages/core` types must be stable by end of week 1**, or
all three tracks churn. Spend the time to get them right, and treat a change to them
afterwards as a cross-team event rather than a commit.

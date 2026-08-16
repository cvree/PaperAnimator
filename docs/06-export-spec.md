# 06 — Export Specification

Thirteen formats. Every one is real, produced by a tested pipeline, and **opened and
asserted in CI** — a format that isn't verified by opening the file doesn't ship.

---

## 1. Presets

Presets are the whole UI for most users; individual formats are behind **Advanced**.

| Preset | Produces | For |
|---|---|---|
| **Talk** | MP4 1080p30 + SRT + transcript | Conference talk, lecture |
| **Social** | MP4 1080×1920 + MP4 1080×1080 + burned-in captions | LinkedIn, X, Instagram |
| **Slides** | PPTX with speaker notes + PDF | A deck to present live or hand over |
| **Audio** | MP3 + transcript + chapter marks | Podcast, accessibility |
| **Stills** | PNG sequence + a contact sheet | Figures for a paper or poster |
| **Archive** | `.paperanim` + MP4 + PDF + SRT | Long-term keeping |
| **Everything** | All of the above | — |

---

## 2. Formats

### Video

| Format | Codec | Settings | Notes |
|---|---|---|---|
| **MP4** | H.264 High + AAC 192k | `yuv420p`, `+faststart`, CRF 18 (high) / 23 (balanced) / 28 (small) | Universal target. `yuv420p` is non-negotiable — without it Safari and QuickTime refuse the file |
| **WebM** | VP9 + Opus 160k | CRF 31, `-row-mt 1` | Smaller, open; offered alongside MP4, never instead of it |
| **GIF** | — | Two-pass palette, ≤ 15fps, ≤ 800px, ≤ 20s | Two-pass (`palettegen` → `paletteuse`) is mandatory; single-pass GIF looks broken |

Resolutions: 3840×2160, 1920×1080, 1280×720, 1080×1080, 1080×1920. FPS 24/30/60.

**GIF guardrail:** above 20s or 800px the dialog states the expected file size before
rendering and suggests MP4. Users don't want a 90 MB GIF; they want a small one.

### Audio

| Format | Settings |
|---|---|
| **MP3** | 192 kbps CBR, ID3v2.4 tags (title = project title, album = paper title, artist = first author) |
| **WAV** | 48 kHz 16-bit PCM |

Both are normalized to **-16 LUFS integrated, -1.5 dBTP** by the same ffmpeg graph that
produces the video's audio track. A test asserts the extracted audio stream of the MP4
and the standalone MP3 are perceptually identical.

Chapter marks (one per scene) are embedded in MP3 and offered as a sidecar `.txt`.

### Slides & documents

**PPTX** (`pptxgenjs`) — a genuinely editable deck, not images in a wrapper:

- One slide per scene at 16:9 (or the project aspect).
- Text is real text boxes with the right fonts, sizes, and colours.
- Figures and tables are embedded images at 2× with **alt text carried through**.
- Tables with a parsed `grid` become real PowerPoint tables; image-only tables become
  captioned images.
- Narration goes into **speaker notes**, verbatim.
- Citations become a footer or an end slide per `citationMode`.
- A final **Sources** slide lists every referenced page and, where present, the DOI.
- An **Appendix** section (toggleable, on by default) lists each claim with its page — the
  artifact that makes the deck defensible after you've left the room.

**PDF** (`pdf-lib`) — two modes:

| Mode | Output |
|---|---|
| **Slides** | One page per scene, rendered at 300 DPI-equivalent |
| **Handout** | 2-up or 3-up with narration text alongside each frame |

Both embed fonts, are tagged for accessibility (headings, alt text, reading order), and
carry the same source appendix.

### Images

| Format | Detail |
|---|---|
| **PNG** | Per-scene at the hold beat, 1×/2×/3×, transparent background optional |
| **JPG** | Same, quality 90, for size-sensitive contexts |
| **Contact sheet** | A single image with all scenes in a grid, numbered |

Filenames: `{index}-{slug}.png` — `03-recovery-time-reduced.png`. Sortable, meaningful,
no `Untitled-1`.

### Captions & text

| Format | Detail |
|---|---|
| **SRT** | Derived from word timings; ≤ 2 lines, ≤ 42 chars/line, ≥ 1s duration, min 80ms gap |
| **VTT** | Same, plus cue positioning and `NOTE` blocks for scene boundaries |
| **Transcript (.txt)** | Timestamped, scene-headed, with a source appendix |
| **Transcript (.md)** | Same with headings and page links, for the web |

Caption line breaking respects clause boundaries (breaking at commas and conjunctions
before breaking at width), because captions broken mid-phrase are measurably harder to
read.

### Project

**`.paperanim`** — the zip described in [01](01-data-model.md) §7. Options: include the
source PDF (default on), include rendered page images (default on), include audio
(default on). Deterministic ordering so the same project yields identical bytes.

---

## 3. Pipeline

```
Export requested
   │
   ├─ 1. VALIDATE ──────────────────────────────────────────────────┐
   │     integrity check · asset availability · duration sanity     │
   │     missing alt text · caption overflow · unsynthesized cues   │
   │     → blocking issues stop here with fixes offered             │
   │
   ├─ 2. MATERIALIZE
   │     synthesize any missing narration
   │     resolve every asset to a local file
   │     freeze the project into an immutable render manifest
   │
   ├─ 3. RENDER  (per format, parallel where independent)
   │     video  → Chromium frames → ffmpeg
   │     audio  → ffmpeg filter graph
   │     slides → pptxgenjs / pdf-lib
   │     text   → cue serialization
   │
   ├─ 4. VERIFY
   │     ffprobe: duration ±100ms, stream count, codec, pixel format
   │     pptx/pdf: reopen and assert slide/page count
   │     srt/vtt: parse back and assert cue count and monotonic times
   │     images: decode and assert dimensions
   │
   └─ 5. DELIVER
         signed URL, 7-day retention, persistent downloads list
```

**Step 4 is not optional.** A render that produces a file we cannot reopen is a failure,
and it is better to know that in the job than in the user's inbox.

### Progress

Real per-stage progress over SSE, with the stage named in plain language:

```
Preparing narration        ████████████████████  done   (0:04)
Rendering frames           ███████████░░░░░░░░░  58%    1,742 / 3,000   ~1:10 left
Encoding video             ░░░░░░░░░░░░░░░░░░░░  queued
Writing captions           ░░░░░░░░░░░░░░░░░░░░  queued
```

Frame counts are real, not interpolated. Time remaining comes from measured throughput
over the last 100 frames, and is shown as a range once confidence is low.

### Failure & recovery

| Failure | Behaviour |
|---|---|
| A frame fails to render | Retry ×3 with backoff; then fail with the frame number and a link to that timestamp in the editor |
| ffmpeg non-zero exit | Capture stderr, map known errors to plain messages, keep the log for support |
| Job times out (> 30 min) | Cancel, keep partial artifacts, offer to resume from the last completed shard |
| Browser tab closed | Job continues server-side; results appear in the downloads list |
| Network drop during download | Signed URL is valid for 7 days; resumable ranges enabled |
| Quota exceeded | Stated before the job starts, never mid-render |

Cancellation is immediate and cleans up temp files. A cancelled job leaves no orphaned
storage.

---

## 4. Validation rules

Run before every export. **Blocking** stops the export; **warning** requires an
acknowledgement; **info** is shown in a collapsed list.

| Rule | Severity | Message |
|---|---|---|
| Unreviewed unsupported content | **blocking** | "3 claims need review before export. They'd appear as facts without a source." |
| Missing narration audio | **blocking** | "Scene 4's narration hasn't been generated yet." |
| Missing asset | **blocking** | "Figure 2's image is unavailable." |
| Zero-duration scene | **blocking** | "Scene 7 has no duration." |
| Missing alt text | warning | "2 images have no alt text. They'll be unlabelled for screen readers and in the PPTX." |
| Text outside safe area | warning | "Text in Scene 5 may be cropped on some displays." |
| Caption overflow | warning | "4 captions exceed 2 lines and will be split." |
| Contrast below 4.5:1 | warning | "Text in Scene 3 is hard to read against its background (3.1:1)." |
| Integrity score < 70 | warning | "This project is 64% grounded. Review before sharing." |
| Duration > 15 min | info | "Long videos take longer to render and to watch." |
| GIF > 20s | info | "This GIF will be about 34 MB. MP4 would be 2 MB." |

Every warning offers a **Fix** action that navigates to the exact place and, where the fix
is mechanical (add the interval, use the exact figure, shorten a caption), performs it.

---

## 5. Fidelity guarantees

The following are asserted in CI, not assumed:

1. **Frame fidelity** — 5 timestamps × 3 styles compared between preview and export at a
   2% perceptual threshold ([03](03-render-engine.md) §9).
2. **Duration** — exported media duration within ±100ms of the project timeline.
3. **Caption sync** — parsed SRT cue times match `NarrationCue` times within ±50ms.
4. **Audio identity** — the MP4's audio stream and the standalone MP3 match perceptually.
5. **Slide count** — PPTX and PDF page counts equal the visible scene count.
6. **Citation survival** — every `SourceRef` in the project appears in the exported PPTX
   appendix and the transcript's source list.
7. **Alt text survival** — every non-decorative image's alt text is present in the PPTX
   and the tagged PDF.

---

## 6. Cost and limits

| Concern | Approach |
|---|---|
| Render minutes | Per-user concurrency cap (2 jobs); queued jobs show position and estimated start |
| Storage | Renders retained 7 days, then deleted with a notice at day 6 |
| Long projects | Frame sharding across parallel contexts; concatenated by ffmpeg |
| The fast path | Projects ≤ 90s at ≤ 1080p offer in-browser WebCodecs encoding — no queue, no upload, and the paper stays on-device |

The export sheet always states which path will run and roughly how long it will take,
before the user commits.

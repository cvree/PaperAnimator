import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import type { Project, Scene } from '@/core/types';
import { ASPECT_DIMS, provenanceRef } from '@/core/types';
import { resolveFrame, projectDuration, sceneWindows } from '@/render/resolveFrame';
import { STYLES } from '@/render/styles';
import { loadImages, paintFrame } from './paint';
import { formatCaptionTime, slugify } from '@/core/format';

/**
 * Every exporter here produces a real file that opens in real software. Each one
 * is driven by resolveFrame, so an export is a recording of the same
 * presentation the editor plays.
 */

export type ExportFormat =
  | 'webm'
  | 'png'
  | 'pptx'
  | 'pdf'
  | 'srt'
  | 'vtt'
  | 'transcript'
  | 'project';

export interface ExportResult {
  format: ExportFormat;
  name: string;
  blob: Blob;
  bytes: number;
  detail: string;
}

export interface ExportProgress {
  stage: string;
  progress: number;
  detail?: string;
}

export interface ExportOptions {
  scale: number;
  fps: number;
  burnCaptions: boolean;
  onProgress: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/* ============================================================================
   Shared canvas setup
   ========================================================================== */

function stageFor(project: Project, scale: number) {
  const dims = ASPECT_DIMS[project.settings.aspect];
  const width = Math.round(dims.w * scale);
  const height = Math.round(dims.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  return { canvas, ctx, width, height };
}

function projectImageUrls(project: Project): (string | null)[] {
  const urls: (string | null)[] = [];
  for (const scene of project.scenes) {
    for (const layer of scene.layers) {
      if (layer.type === 'figure' || layer.type === 'table') urls.push(layer.src);
    }
  }
  return urls;
}

async function ensureFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  await document.fonts.ready;
}

/* ============================================================================
   Video — WebM, recorded from the canvas
   ========================================================================== */

export function videoSupported(): boolean {
  return webCodecsSupported() || mediaRecorderSupported();
}

function webCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

function mediaRecorderSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
      MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
      MediaRecorder.isTypeSupported('video/webm'))
  );
}

function pickMime(): string {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

export async function exportVideo(
  project: Project,
  options: ExportOptions,
): Promise<ExportResult> {
  if (!videoSupported()) {
    throw new Error('This browser cannot record video. Try the PNG slides or the slide deck.');
  }

  await ensureFonts();
  const { canvas, ctx, width, height } = stageFor(project, options.scale);
  const images = await loadImages(projectImageUrls(project));
  const total = projectDuration(project);
  const frameCount = Math.max(1, Math.ceil((total / 1000) * options.fps));

  const paintAt = (i: number) => {
    const frame = resolveFrame(project, (i / options.fps) * 1000, { reducedMotion: false });
    paintFrame(ctx, frame, project.style, {
      width,
      height,
      captions: options.burnCaptions && project.settings.captionsEnabled,
      images,
    });
  };

  const blob = webCodecsSupported()
    ? await encodeWithWebCodecs(canvas, paintAt, frameCount, width, height, options)
    : await recordInRealTime(canvas, paintAt, frameCount, width, height, options);

  return {
    format: 'webm',
    name: `${slugify(project.title)}.webm`,
    blob,
    bytes: blob.size,
    detail: `${width}×${height} · ${options.fps} fps · ${(total / 1000).toFixed(1)}s`,
  };
}

/**
 * Every frame is stamped with the time it represents, not the time it happened
 * to be drawn.
 *
 * MediaRecorder timestamps by wall clock, so rendering 2,700 frames as fast as
 * the machine can manage produces a file that opens, looks right, and plays a
 * ninety-second talk in seven seconds. The encoder is given explicit
 * timestamps instead, which also means the export runs as fast as the hardware
 * allows rather than in real time.
 */
async function encodeWithWebCodecs(
  canvas: HTMLCanvasElement,
  paintAt: (i: number) => void,
  frameCount: number,
  width: number,
  height: number,
  options: ExportOptions,
): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
  const codecs = ['vp09.00.10.08', 'vp8'] as const;

  let codec: string | null = null;
  for (const c of codecs) {
    const support = await VideoEncoder.isConfigSupported({ codec: c, width, height });
    if (support.supported) {
      codec = c;
      break;
    }
  }
  if (!codec) return recordInRealTime(canvas, paintAt, frameCount, width, height, options);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width, height },
    firstTimestampBehavior: 'offset',
  });

  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e as Error;
    },
  });
  encoder.configure({
    codec,
    width,
    height,
    bitrate: Math.round(width * height * options.fps * 0.12),
    framerate: options.fps,
  });

  const frameDurationUs = Math.round(1_000_000 / options.fps);

  for (let i = 0; i < frameCount; i++) {
    if (options.signal?.aborted) {
      encoder.close();
      throw new DOMException('Aborted', 'AbortError');
    }
    if (failure) throw failure;

    paintAt(i);
    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDurationUs,
      duration: frameDurationUs,
    });
    // A keyframe every two seconds keeps seeking responsive without bloating.
    encoder.encode(frame, { keyFrame: i % (options.fps * 2) === 0 });
    frame.close();

    if (i % 6 === 0) {
      options.onProgress({
        stage: 'Rendering frames',
        progress: i / frameCount,
        detail: `${i} / ${frameCount}`,
      });
      // Let the encoder drain so memory does not climb with the whole talk.
      if (encoder.encodeQueueSize > 24) await drainEncoder(encoder);
      await nextTick();
    }
  }

  options.onProgress({ stage: 'Finishing the file', progress: 0.97 });
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  if (failure) throw failure;

  return new Blob([target.buffer as BlobPart], { type: 'video/webm' });
}

function drainEncoder(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize <= 8) resolve();
      else setTimeout(check, 8);
    };
    check();
  });
}

/**
 * The fallback for browsers without WebCodecs. MediaRecorder only produces
 * honest timing if the frames are fed to it in real time, so this one takes as
 * long as the talk does — which is why it is the fallback.
 */
async function recordInRealTime(
  canvas: HTMLCanvasElement,
  paintAt: (i: number) => void,
  frameCount: number,
  width: number,
  height: number,
  options: ExportOptions,
): Promise<Blob> {
  if (!mediaRecorderSupported()) {
    throw new Error('This browser cannot record video. Try the PNG slides or the slide deck.');
  }

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, {
    mimeType: pickMime(),
    videoBitsPerSecond: Math.round(width * height * options.fps * 0.12),
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  recorder.start();
  const started = performance.now();
  const frameMs = 1000 / options.fps;

  for (let i = 0; i < frameCount; i++) {
    if (options.signal?.aborted) {
      recorder.stop();
      throw new DOMException('Aborted', 'AbortError');
    }
    paintAt(i);
    track.requestFrame();

    if (i % 6 === 0) {
      options.onProgress({
        stage: 'Recording in real time',
        progress: i / frameCount,
        detail: `${i} / ${frameCount}`,
      });
    }
    const due = started + (i + 1) * frameMs;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    else await nextTick();
  }

  options.onProgress({ stage: 'Finishing the file', progress: 0.98 });
  await sleep(frameMs * 2);
  recorder.stop();
  return done;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================================================================
   PNG slides
   ========================================================================== */

export async function exportSlides(
  project: Project,
  options: ExportOptions,
): Promise<ExportResult> {
  await ensureFonts();
  const { canvas, ctx, width, height } = stageFor(project, options.scale);
  const images = await loadImages(projectImageUrls(project));
  const zip = new JSZip();
  const scenes = project.scenes.filter((s) => !s.hidden);

  for (let i = 0; i < scenes.length; i++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const blob = await renderSceneStill(scenes[i], project, ctx, canvas, width, height, images, options.burnCaptions);
    zip.file(`${String(i + 1).padStart(2, '0')}-${slugify(scenes[i].title)}.png`, blob);
    options.onProgress({
      stage: 'Rendering slides',
      progress: (i + 1) / scenes.length,
      detail: `${i + 1} / ${scenes.length}`,
    });
    await nextTick();
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    format: 'png',
    name: `${slugify(project.title)}-slides.zip`,
    blob,
    bytes: blob.size,
    detail: `${scenes.length} PNG slides at ${width}×${height}`,
  };
}

async function renderSceneStill(
  scene: Scene,
  project: Project,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  images: Map<string, CanvasImageSource>,
  captions: boolean,
): Promise<Blob> {
  const windows = sceneWindows(project);
  const win = windows.find((w) => w.scene.id === scene.id);
  const settleAt = scene.layers.reduce(
    (max, l) => Math.max(max, l.enter.delayMs + l.enter.durationMs),
    0,
  );
  const at = (win?.startMs ?? 0) + Math.min(scene.durationMs - 1, settleAt + 60);
  const frame = resolveFrame(project, at, { reducedMotion: false });
  paintFrame(ctx, frame, project.style, { width, height, captions, images });
  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? new Blob()), 'image/png'),
  );
}

/* ============================================================================
   PPTX — a real, editable deck
   ========================================================================== */

export async function exportDeck(project: Project, options: ExportOptions): Promise<ExportResult> {
  await ensureFonts();
  const { canvas, ctx, width, height } = stageFor(project, Math.max(options.scale, 1));
  const images = await loadImages(projectImageUrls(project));

  const pptx = new PptxGenJS();
  const dims = ASPECT_DIMS[project.settings.aspect];
  const ratio = dims.w / dims.h;
  const slideW = 10;
  const slideH = slideW / ratio;
  pptx.defineLayout({ name: 'PA', width: slideW, height: slideH });
  pptx.layout = 'PA';
  pptx.title = project.title;

  const scenes = project.scenes.filter((s) => !s.hidden);

  for (let i = 0; i < scenes.length; i++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const scene = scenes[i];
    const blob = await renderSceneStill(scene, project, ctx, canvas, width, height, images, false);
    const dataUrl = await blobToDataUrl(blob);

    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: slideW, h: slideH });

    // Speaker notes carry the narration verbatim, plus where it came from.
    const notes = scene.narration.map((c) => c.text).join('\n\n');
    const sources = scene.sourceRefs
      .map((r) => `p.${r.page}: “${r.text.slice(0, 160)}”`)
      .join('\n');
    slide.addNotes(`${notes}${sources ? `\n\n— Sources —\n${sources}` : ''}`);

    options.onProgress({
      stage: 'Building the deck',
      progress: (i + 1) / (scenes.length + 1),
      detail: `Slide ${i + 1} of ${scenes.length}`,
    });
    await nextTick();
  }

  // A source appendix is what makes the deck defensible after you leave the room.
  const appendix = pptx.addSlide();
  appendix.addText('Sources', {
    x: 0.5,
    y: 0.4,
    w: slideW - 1,
    h: 0.6,
    fontSize: 24,
    bold: true,
    color: '1b1a18',
  });
  const lines = scenes.flatMap((s, i) =>
    s.sourceRefs.slice(0, 2).map((r) => `${i + 1}. ${s.title} — page ${r.page}`),
  );
  appendix.addText(lines.join('\n') || 'No sources recorded.', {
    x: 0.5,
    y: 1.1,
    w: slideW - 1,
    h: slideH - 1.5,
    fontSize: 11,
    color: '4a4741',
    lineSpacingMultiple: 1.3,
  });

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  return {
    format: 'pptx',
    name: `${slugify(project.title)}.pptx`,
    blob,
    bytes: blob.size,
    detail: `${scenes.length + 1} slides with speaker notes`,
  };
}

/* ============================================================================
   PDF
   ========================================================================== */

export async function exportPdf(project: Project, options: ExportOptions): Promise<ExportResult> {
  await ensureFonts();
  const { canvas, ctx, width, height } = stageFor(project, Math.max(options.scale, 1));
  const images = await loadImages(projectImageUrls(project));

  const pdf = await PDFDocument.create();
  pdf.setTitle(project.title);
  pdf.setSubject(`Made from a ${project.paper.meta.pageCount}-page paper. Every line is quoted from it.`);
  pdf.setProducer('Paper Animator');
  pdf.setCreator('Paper Animator');
  if (project.paper.meta.authors.length) {
    pdf.setAuthor(project.paper.meta.authors.map((a) => a.name).join(', '));
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const scenes = project.scenes.filter((s) => !s.hidden);

  const pageW = 720;
  const pageH = (pageW * height) / width;

  for (let i = 0; i < scenes.length; i++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const blob = await renderSceneStill(scenes[i], project, ctx, canvas, width, height, images, false);
    const png = await pdf.embedPng(await blob.arrayBuffer());
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH });
    drawInvisibleText(page, scenes[i], font, pageW, pageH);
    options.onProgress({
      stage: 'Writing the PDF',
      progress: (i + 1) / (scenes.length + 1),
      detail: `Page ${i + 1} of ${scenes.length}`,
    });
    await nextTick();
  }

  // Source appendix
  const appendix = pdf.addPage([pageW, pageH]);
  appendix.drawText('Sources', { x: 40, y: pageH - 56, size: 20, font, color: rgb(0.11, 0.1, 0.09) });
  let y = pageH - 88;
  for (const [i, scene] of scenes.entries()) {
    for (const ref of scene.sourceRefs.slice(0, 2)) {
      if (y < 44) break;
      const line = `${i + 1}. ${scene.title} — page ${ref.page}: "${ref.text.slice(0, 90)}"`;
      appendix.drawText(line.slice(0, 118), {
        x: 40,
        y,
        size: 8.5,
        font,
        color: rgb(0.29, 0.28, 0.25),
      });
      y -= 14;
    }
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return {
    format: 'pdf',
    name: `${slugify(project.title)}.pdf`,
    blob,
    bytes: blob.size,
    detail: `${scenes.length + 1} pages`,
  };
}

/* ============================================================================
   Captions & transcript
   ========================================================================== */

export function buildCaptions(project: Project, kind: 'srt' | 'vtt'): string {
  const windows = sceneWindows(project);
  const cues: { start: number; end: number; text: string }[] = [];

  for (const w of windows) {
    for (const cue of w.scene.narration) {
      for (const chunk of chunkCue(cue.text)) {
        const from = w.startMs + cue.startMs + chunk.startFrac * cue.durationMs;
        const to = w.startMs + cue.startMs + chunk.endFrac * cue.durationMs;
        cues.push({ start: from, end: Math.max(from + 800, to), text: chunk.text });
      }
    }
  }

  const sep = kind === 'srt' ? ',' : '.';
  const body = cues
    .map((c, i) => {
      const time = `${formatCaptionTime(c.start, sep)} --> ${formatCaptionTime(c.end, sep)}`;
      return kind === 'srt' ? `${i + 1}\n${time}\n${c.text}\n` : `${time}\n${c.text}\n`;
    })
    .join('\n');

  return kind === 'vtt' ? `WEBVTT\n\n${body}` : body;
}

/** Two lines, 42 characters, broken at clause boundaries before width. */
function chunkCue(text: string): { text: string; startFrac: number; endFrac: number }[] {
  const words = text.split(/\s+/).filter(Boolean);
  const MAX = 84;
  const chunks: { words: string[]; from: number; to: number }[] = [];
  let current: string[] = [];
  let from = 0;

  words.forEach((word, i) => {
    const candidate = [...current, word].join(' ');
    const clauseBreak = /[,;:]$/.test(word) && candidate.length > MAX * 0.55;
    if (current.length && (candidate.length > MAX || clauseBreak)) {
      chunks.push({ words: current, from, to: i });
      current = [word];
      from = i;
    } else {
      current.push(word);
    }
  });
  if (current.length) chunks.push({ words: current, from, to: words.length });

  return chunks.map((c) => ({
    text: wrapTwoLines(c.words.join(' ')),
    startFrac: c.from / Math.max(1, words.length),
    endFrac: c.to / Math.max(1, words.length),
  }));
}

function wrapTwoLines(text: string): string {
  if (text.length <= 42) return text;
  const words = text.split(' ');
  let a = '';
  let i = 0;
  while (i < words.length && (a + ' ' + words[i]).trim().length <= 42) {
    a = (a + ' ' + words[i]).trim();
    i++;
  }
  return `${a}\n${words.slice(i).join(' ')}`;
}

export function buildTranscript(project: Project): string {
  const windows = sceneWindows(project);
  const lines: string[] = [
    project.title,
    project.paper.meta.authors.map((a) => a.name).join(', '),
    '',
    `Generated by Paper Animator from a ${project.paper.meta.pageCount}-page paper.`,
    'Every line below is taken from the paper, with the page it came from.',
    '',
    '---',
    '',
  ];

  for (const w of windows) {
    lines.push(`[${formatCaptionTime(w.startMs, '.')}] ${w.scene.title}`);
    for (const cue of w.scene.narration) {
      const ref = provenanceRef(cue.provenance);
      lines.push(`  ${cue.text}`);
      if (ref) lines.push(`    — page ${ref.page}`);
    }
    lines.push('');
  }

  lines.push('---', '', 'Sources', '');
  for (const [i, scene] of project.scenes.entries()) {
    for (const ref of scene.sourceRefs) {
      lines.push(`${i + 1}. ${scene.title} — page ${ref.page}: "${ref.text.slice(0, 200)}"`);
    }
  }

  return lines.join('\n');
}

export function exportText(
  project: Project,
  format: 'srt' | 'vtt' | 'transcript',
): ExportResult {
  const content =
    format === 'transcript' ? buildTranscript(project) : buildCaptions(project, format);
  const ext = format === 'transcript' ? 'txt' : format;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const cueCount = format === 'transcript' ? 0 : content.split('\n\n').length;
  return {
    format,
    name: `${slugify(project.title)}.${ext}`,
    blob,
    bytes: blob.size,
    detail:
      format === 'transcript'
        ? `${content.split('\n').length} lines with page references`
        : `${cueCount} cues`,
  };
}

/* ============================================================================
   Project file
   ========================================================================== */

export async function exportProject(
  project: Project,
  options: ExportOptions,
): Promise<ExportResult> {
  const zip = new JSZip();

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format: 'paperanim',
        version: 1,
        app: 'Paper Animator',
        createdAt: new Date().toISOString(),
        title: project.title,
        scenes: project.scenes.length,
      },
      null,
      2,
    ),
  );

  const assets = zip.folder('assets')!;
  const rewrites = new Map<string, string>();
  const urls = [...new Set(projectImageUrls(project).filter((u): u is string => !!u))];

  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const name = `asset-${String(i + 1).padStart(3, '0')}.${blob.type.includes('png') ? 'png' : 'webp'}`;
      assets.file(name, blob);
      rewrites.set(url, `assets/${name}`);
    } catch {
      /* an asset that cannot be read is simply not bundled */
    }
    options.onProgress({
      stage: 'Bundling assets',
      progress: (i + 1) / (urls.length + 1),
      detail: `${i + 1} / ${urls.length}`,
    });
  }

  // Serialise with asset paths rewritten and page rasters dropped (they are
  // large, and the source PDF is not ours to bundle without asking).
  const serialised = JSON.parse(
    JSON.stringify(project, (key, value) => {
      if (key === 'raster') return null;
      if (key === 'items') return undefined;
      if (typeof value === 'string' && rewrites.has(value)) return rewrites.get(value);
      return value;
    }),
  );

  zip.file('project.json', JSON.stringify(serialised, null, 2));
  zip.file('transcript.txt', buildTranscript(project));
  zip.file('captions.srt', buildCaptions(project, 'srt'));

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    format: 'project',
    name: `${slugify(project.title)}.paperanim`,
    blob,
    bytes: blob.size,
    detail: `Scenes, assets, transcript and captions`,
  };
}

/* ============================================================================
   Validation
   ========================================================================== */

export interface ValidationIssue {
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  detail: string;
}

export function validateForExport(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scenes = project.scenes.filter((s) => !s.hidden);

  if (scenes.length === 0) {
    issues.push({
      severity: 'blocking',
      message: 'There are no visible scenes',
      detail: 'Add at least one scene before exporting.',
    });
  }

  let unreviewed = 0;
  let missingAlt = 0;
  for (const scene of scenes) {
    if (scene.durationMs < 400) {
      issues.push({
        severity: 'blocking',
        message: `“${scene.title}” has almost no duration`,
        detail: 'It would flash past before anyone could read it.',
      });
    }
    for (const layer of scene.layers) {
      const provs =
        layer.type === 'text'
          ? layer.atoms.map((a) => a.provenance)
          : 'provenance' in layer
            ? [layer.provenance]
            : [];
      for (const p of provs) {
        if (p.kind === 'unsupported' && !p.reviewed) unreviewed++;
      }
      if ((layer.type === 'figure' || layer.type === 'table') && !layer.decorative) {
        if (!layer.altText || layer.altText.trim().length < 4) missingAlt++;
      }
    }
  }

  if (unreviewed > 0) {
    issues.push({
      severity: 'blocking',
      message: `${unreviewed} claim${unreviewed === 1 ? '' : 's'} still need review`,
      detail: 'They would appear as facts without a source behind them.',
    });
  }
  if (missingAlt > 0) {
    issues.push({
      severity: 'warning',
      message: `${missingAlt} image${missingAlt === 1 ? ' has' : 's have'} no description`,
      detail:
        'They will be unlabelled for screen readers and in the exported deck. A single sentence is enough.',
    });
  }

  const total = projectDuration(project);
  if (total > 15 * 60 * 1000) {
    issues.push({
      severity: 'info',
      message: 'This is a long presentation',
      detail: `${Math.round(total / 60000)} minutes will take a while to render, and a while to watch.`,
    });
  }

  return issues;
}

/* ============================================================================
   Utilities
   ========================================================================== */

function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * The slide is a rendered image, which is what guarantees it matches the
 * preview exactly. That would leave a PDF nobody can search, copy from or hear
 * read aloud, so the same words go down again in invisible text — the trick
 * scanned documents use — positioned over the page they belong to.
 */
function drawInvisibleText(
  page: PDFPage,
  scene: Scene,
  font: PDFFont,
  pageW: number,
  pageH: number,
): void {
  const said = scene.narration.map((c) => c.text);
  const shown = scene.layers.flatMap((l) => {
    if (l.hidden) return [];
    if (l.type === 'text') return [l.atoms.map((a) => a.text).join('')];
    if (l.type === 'quote') return [l.text];
    if (l.type === 'stat') return [l.display, ...l.qualifiers, l.caption ?? ''];
    if (l.type === 'figure' || l.type === 'table') return [l.caption ?? '', l.altText ?? ''];
    return [];
  });

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const raw of [scene.title, ...shown, ...said]) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    for (const chunk of wrapForWidth(text, font, 9, pageW - 48)) lines.push(chunk);
  }

  let y = pageH - 24;
  for (const line of lines) {
    if (y < 16) break;
    page.drawText(sanitizeForWinAnsi(line), {
      x: 24,
      y,
      size: 9,
      font,
      color: rgb(0, 0, 0),
      opacity: 0,
    });
    y -= 11;
  }
}

function wrapForWidth(text: string, font: PDFFont, size: number, max: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(sanitizeForWinAnsi(next), size) > max && line) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Helvetica is WinAnsi-encoded; a stray typographic dash would throw. */
function sanitizeForWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\xFF]/g, '?');
}

export function download(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const STYLE_NAMES = Object.fromEntries(
  Object.entries(STYLES).map(([k, v]) => [k, v.name]),
) as Record<string, string>;

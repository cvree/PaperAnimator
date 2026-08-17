import * as pdfjs from 'pdfjs-dist';
// Inlined as source rather than imported as a separate ?url chunk: a worker
// fetched over the network is a single extra request that an ad blocker,
// corporate filter, or flaky connection can drop — and when it does, pdf.js's
// own fallback tries to fetch that exact same URL and fails the same way,
// which used to surface to users as "this PDF is damaged" for every PDF,
// including the sample. Building the worker from a Blob already present in
// the bundle removes that request as a failure point entirely.
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
// The same shims polyfills.ts installs on the main thread, as raw source, so
// they can be installed inside the worker realm too — the worker is where
// pdf.js actually parses, and it inherits nothing the main thread patched.
import realmShims from '@/core/realmShims.js?raw';
import { collectDiagnostics, describeFile, type Diagnostics } from '@/core/diagnostics';
import type {
  Author,
  Degradation,
  Figure,
  Page,
  Paper,
  PaperMeta,
  PaperTable,
  Quad,
  Reference,
  Section,
  Sentence,
  StageReport,
  TextItem,
} from '@/core/types';
import { newId } from '@/core/id';
import { assemblePage, median, pageStats, type Line } from './text';
import { buildStructure } from './structure';
import { detectRegions } from './regions';
import { extractStatistics } from './stats';
import { comprehend } from './comprehend';
import { extractReferences } from './refs';

/**
 * The pdf.js worker, built from source already in the bundle.
 *
 * The shims are prepended, not merely imported on the main thread, because a
 * Web Worker is a separate realm: Map.prototype inside the worker is not the
 * Map.prototype polyfills.ts patched. pdf.js parses inside the worker, so
 * without this the reader runs unpatched on exactly the browsers the shims
 * exist for — and every PDF fails at once, which reads to a user as "damaged".
 */
pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([realmShims, '\n', workerSource], { type: 'text/javascript' }),
);

/** How the document was actually opened, recorded for diagnostics. */
let openRoute = 'not attempted';

export const LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxPages: 400,
  eagerRasterPages: 24,
  rasterWidth: 1240,
} as const;

export type ProgressStage =
  | { stage: 'intake'; label: string }
  | { stage: 'pages'; label: string; done: number; total: number }
  | { stage: 'structure'; label: string }
  | { stage: 'figures'; label: string; count: number }
  | { stage: 'tables'; label: string; count: number }
  | { stage: 'references'; label: string; count: number }
  | { stage: 'statistics'; label: string; count: number }
  | { stage: 'comprehension'; label: string };

export interface ExtractionEvents {
  onStage: (p: ProgressStage) => void;
  /** Fired as artifacts land, so the interface can show real partial results. */
  onArtifact: (a: Artifact) => void;
}

export type Artifact =
  | { type: 'meta'; meta: PaperMeta }
  | { type: 'page'; page: Page }
  | { type: 'section'; section: Section }
  | { type: 'figure'; figure: Figure }
  | { type: 'table'; table: PaperTable }
  | { type: 'statistic'; count: number };

export class PdfIntakeError extends Error {
  /** Filled in for failures that are about the environment, not the file. */
  diagnostics?: Diagnostics;

  constructor(
    message: string,
    readonly detail: string,
    readonly remedy?: string,
  ) {
    super(message);
    this.name = 'PdfIntakeError';
  }
}

/** Holds the open document so pages can be rasterized on demand. */
export class PaperSession {
  private cache = new Map<number, string>();
  private pending = new Map<number, Promise<string | null>>();

  constructor(
    private doc: pdfjs.PDFDocumentProxy,
    readonly paper: Paper,
    private loadingTask: { destroy: () => Promise<void> },
  ) {}

  async raster(pageNumber: number): Promise<string | null> {
    const hit = this.cache.get(pageNumber);
    if (hit) return hit;
    const inflight = this.pending.get(pageNumber);
    if (inflight) return inflight;

    const job = (async () => {
      try {
        const page = await this.doc.getPage(pageNumber);
        const url = await rasterize(page, LIMITS.rasterWidth);
        if (url) this.cache.set(pageNumber, url);
        return url;
      } catch {
        return null;
      } finally {
        this.pending.delete(pageNumber);
      }
    })();
    this.pending.set(pageNumber, job);
    return job;
  }

  prime(pageNumber: number, url: string) {
    this.cache.set(pageNumber, url);
  }

  async cropRegion(pageNumber: number, quad: Quad, targetWidth = 900): Promise<string | null> {
    try {
      const page = await this.doc.getPage(pageNumber);
      return await cropFromPage(page, quad, targetWidth);
    } catch {
      return null;
    }
  }

  destroy() {
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
    void this.loadingTask.destroy();
  }
}

export async function extractPaper(
  file: File | ArrayBuffer,
  events: ExtractionEvents,
  signal?: AbortSignal,
): Promise<PaperSession> {
  const t0 = performance.now();
  const stages: StageReport[] = [];
  const degradations: Degradation[] = [];
  const mark = async <T>(stage: StageReport['stage'], fn: () => Promise<T> | T): Promise<T> => {
    const s = performance.now();
    const out = await fn();
    stages.push({ stage, status: 'ok', durationMs: performance.now() - s, counts: {} });
    return out;
  };

  /* ---- intake -------------------------------------------------------- */
  events.onStage({ stage: 'intake', label: 'Checking the file' });
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();

  if (data.byteLength > LIMITS.maxBytes) {
    throw new PdfIntakeError(
      'That file is larger than 100 MB',
      `This PDF is ${(data.byteLength / 1024 / 1024).toFixed(0)} MB. Large scans are usually the cause.`,
      'Try exporting a smaller version, or splitting it into chapters.',
    );
  }
  if (!looksLikePdf(data)) {
    throw new PdfIntakeError(
      "That doesn't look like a PDF",
      'The file does not begin with a PDF header, so it may be a Word document or an image that was renamed.',
      'Export it as a PDF and try again.',
    );
  }

  // Captured while the buffer is certainly intact: pdf.js may transfer it.
  const fileSummary = describeFile(
    file instanceof ArrayBuffer ? '(in-memory buffer)' : file.name,
    data,
  );

  let doc: pdfjs.PDFDocumentProxy;
  let loadingTask: pdfjs.PDFDocumentLoadingTask;
  try {
    ({ doc, loadingTask } = await openDocument(data));
  } catch (err) {
    throw await explainOpenFailure(err, fileSummary);
  }

  if (doc.numPages > LIMITS.maxPages) {
    throw new PdfIntakeError(
      `That paper has ${doc.numPages} pages`,
      `We read up to ${LIMITS.maxPages} pages in one project.`,
      'Split it into sections and animate the part you need.',
    );
  }

  /* ---- pages --------------------------------------------------------- */
  const pages: Page[] = [];
  const pageLines: { page: number; lines: Line[]; stats: ReturnType<typeof pageStats>; aspect: number }[] = [];
  let scannedPages = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    events.onStage({
      stage: 'pages',
      label: `Reading page ${n} of ${doc.numPages}`,
      done: n - 1,
      total: doc.numPages,
    });

    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const items = await readTextItems(page, viewport);
    const isScanned = items.length < 12;
    if (isScanned) scannedPages++;

    const raster = n <= LIMITS.eagerRasterPages ? await rasterize(page, LIMITS.rasterWidth) : null;

    const record: Page = {
      number: n,
      width: viewport.width,
      height: viewport.height,
      raster,
      items,
      ocr: false,
    };
    pages.push(record);
    events.onArtifact({ type: 'page', page: record });

    const { lines: ordered } = assemblePage(items);
    pageLines.push({
      page: n,
      lines: ordered,
      stats: pageStats(ordered),
      aspect: viewport.width / viewport.height,
    });

    // Yield to the main thread so partial results actually paint.
    if (n % 2 === 0) await frame();
  }
  stages.push({
    stage: 'pages',
    status: scannedPages > 0 ? 'degraded' : 'ok',
    durationMs: performance.now() - t0,
    counts: { pages: doc.numPages, scanned: scannedPages },
  });

  const scannedRatio = scannedPages / doc.numPages;
  const imageMode = scannedRatio > 0.4;
  if (imageMode) {
    degradations.push({
      stage: 'pages',
      reason: `${scannedPages} of ${doc.numPages} pages have no readable text layer, so this paper is a scan.`,
      impact:
        'Text, statistics and citations cannot be traced. You can still build a presentation from page regions and your own words.',
      remedy: 'If you have a text-based PDF of the same paper, it will produce a much stronger result.',
    });
  }

  const docBodySize = median(pageLines.map((p) => p.stats.bodyFontSize)) || 0.012;

  /* ---- meta ---------------------------------------------------------- */
  const { meta, frontMatterBottom } = await mark('intake', () =>
    readMeta(doc, pageLines[0]?.lines ?? [], docBodySize, doc.numPages, imageMode),
  );
  events.onArtifact({ type: 'meta', meta });

  /* ---- figures & tables, found before prose --------------------------- */
  // Regions are located first so their interior text — axis labels, tick values,
  // table cells — can be kept out of the prose. A stray "0" from a chart axis
  // inside a quoted sentence is the kind of error that destroys trust.
  const regionInput = pageLines.map((p) => ({
    page: p.page,
    lines: p.lines,
    pageAspect: p.aspect,
    bodyFontSize: p.stats.bodyFontSize || docBodySize,
  }));
  const detected = detectRegions(regionInput);

  const regionsByPage = new Map<number, Quad[]>();
  for (const r of [...detected.figures, ...detected.tables]) {
    const list = regionsByPage.get(r.page) ?? [];
    list.push(r.quad);
    regionsByPage.set(r.page, list);
  }

  const proseLines = pageLines.map((p) => ({
    ...p,
    lines: p.lines.filter(
      (line) =>
        !insideAny(line.quad, regionsByPage.get(p.page) ?? []) &&
        !(p.page === 1 && line.quad.y + line.quad.h <= frontMatterBottom + 0.001),
    ),
  }));

  /* ---- structure ----------------------------------------------------- */
  events.onStage({ stage: 'structure', label: 'Finding the shape of the argument' });
  const { sections } = await mark('structure', () => buildStructure(proseLines, docBodySize));
  for (const s of sections) events.onArtifact({ type: 'section', section: s });
  if (sections.length < 3 && !imageMode) {
    degradations.push({
      stage: 'structure',
      reason: 'Only a few headings were recognised in this paper.',
      impact: 'The outline may be flatter than the real structure.',
      remedy: 'You can rename and reorder scenes freely in the editor.',
    });
  }
  await frame();

  /* ---- figures & tables ---------------------------------------------- */
  events.onStage({ stage: 'figures', label: 'Lifting figures off the page', count: detected.figures.length });
  const figures: Figure[] = [];
  for (const f of detected.figures) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const page = await doc.getPage(f.page);
    const image = await cropFromPage(page, f.quad, 1000);
    const figure: Figure = { ...f, image };
    figures.push(figure);
    events.onArtifact({ type: 'figure', figure });
    await frame();
  }
  stages.push({ stage: 'figures', status: 'ok', durationMs: 0, counts: { figures: figures.length } });

  events.onStage({ stage: 'tables', label: 'Reading tables', count: detected.tables.length });
  const tables: PaperTable[] = [];
  let unparsedTables = 0;
  for (const t of detected.tables) {
    const page = await doc.getPage(t.page);
    const image = await cropFromPage(page, t.quad, 1000);
    const table: PaperTable = { ...t, image };
    if (!table.grid || table.confidence < 0.75) {
      unparsedTables++;
      table.grid = table.confidence >= 0.75 ? table.grid : null;
    }
    tables.push(table);
    events.onArtifact({ type: 'table', table });
    await frame();
  }
  stages.push({ stage: 'tables', status: unparsedTables > 0 ? 'degraded' : 'ok', durationMs: 0, counts: { tables: tables.length } });
  if (unparsedTables > 0) {
    degradations.push({
      stage: 'tables',
      reason: `${unparsedTables} of ${tables.length} table${tables.length === 1 ? '' : 's'} could not be read as a grid reliably.`,
      impact: 'The printed table is used as an image instead, so the data stays correct — you just cannot animate single cells.',
      remedy: 'You can still highlight any region of the table.',
    });
  }

  /* ---- references ---------------------------------------------------- */
  events.onStage({ stage: 'references', label: 'Matching citations', count: 0 });
  const references: Reference[] = extractReferences(sections);
  stages.push({ stage: 'references', status: 'ok', durationMs: 0, counts: { references: references.length } });

  /* ---- statistics ---------------------------------------------------- */
  const allSentences: Sentence[] = [];
  for (const s of sections) for (const p of s.paragraphs) allSentences.push(...p.sentences);

  events.onStage({ stage: 'statistics', label: 'Binding numbers to their qualifiers', count: 0 });
  const statistics = extractStatistics(allSentences);
  events.onArtifact({ type: 'statistic', count: statistics.length });
  stages.push({ stage: 'statistics', status: 'ok', durationMs: 0, counts: { statistics: statistics.length } });
  await frame();

  /* ---- comprehension -------------------------------------------------- */
  events.onStage({ stage: 'comprehension', label: 'Reading for the argument' });
  const comprehension = comprehend(sections, statistics);
  stages.push({
    stage: 'comprehension',
    status: 'ok',
    durationMs: 0,
    counts: {
      findings: comprehension.findings.length,
      limitations: comprehension.limitations.length,
    },
  });

  if (comprehension.limitations.length === 0 && !imageMode) {
    degradations.push({
      stage: 'comprehension',
      reason: 'This paper does not state its limitations in a form we can quote.',
      impact: 'No limitations scene was created. We will not write one for you.',
      remedy: 'If the paper discusses caveats elsewhere, highlight that passage to make a scene.',
    });
  }

  const paper: Paper = {
    meta,
    pages,
    sections,
    figures,
    tables,
    statistics,
    references,
    comprehension,
    extraction: {
      stages,
      degradations,
      overallConfidence: computeConfidence(sections, figures, statistics, imageMode),
      durationMs: performance.now() - t0,
    },
  };

  const session = new PaperSession(doc, paper, loadingTask);
  for (const p of pages) if (p.raster) session.prime(p.number, p.raster);
  return session;
}

/* ============================================================================
   Opening the document
   ========================================================================== */

function errorName(err: unknown): string {
  return (err as Error)?.name ?? '';
}

/** A real "this file is broken" verdict from pdf.js, not a guess. */
function isDamagedPdf(err: unknown): boolean {
  return errorName(err) === 'InvalidPDFException';
}

function isPasswordProtected(err: unknown): boolean {
  return (
    errorName(err) === 'PasswordException' ||
    /password/i.test(String((err as Error)?.message ?? ''))
  );
}

/**
 * Runs pdf.js entirely on the main thread.
 *
 * pdf.js caches its own fallback loader in a property that stays rejected once
 * it has failed, so a plain retry after a worker failure would fail the same
 * way forever. Publishing the message handler on globalThis and replacing that
 * cached promise gives the retry a genuinely different route to run on.
 */
async function useMainThreadReader(): Promise<void> {
  const mod = (await import(/* @vite-ignore */ pdfjs.GlobalWorkerOptions.workerSrc)) as {
    WorkerMessageHandler: unknown;
  };
  (globalThis as Record<string, unknown>).pdfjsWorker = mod;
  const PDFWorker = (pdfjs as unknown as { PDFWorker?: object }).PDFWorker;
  if (PDFWorker) {
    Object.defineProperty(PDFWorker, '_setupFakeWorkerGlobal', {
      value: Promise.resolve(mod.WorkerMessageHandler),
      configurable: true,
      writable: false,
      enumerable: true,
    });
  }
}

/**
 * Opens the document, falling back from the worker to the main thread.
 *
 * Reading a PDF should not depend on a Web Worker being available. Workers can
 * be blocked by a page policy, unavailable in an embedded webview, or broken by
 * an extension — none of which say anything about the file. When that happens
 * we pay the cost of parsing on the main thread rather than telling somebody
 * their paper is damaged.
 */
async function openDocument(
  bytes: ArrayBuffer,
): Promise<{ doc: pdfjs.PDFDocumentProxy; loadingTask: pdfjs.PDFDocumentLoadingTask }> {
  // Each attempt gets its own copy — pdf.js may transfer the buffer it is given,
  // which would leave a retry with a detached, zero-length ArrayBuffer.
  const attempt = () => pdfjs.getDocument({ data: bytes.slice(0), useSystemFonts: true });

  const viaWorker = attempt();
  try {
    const doc = await viaWorker.promise;
    openRoute = 'web worker';
    return { doc, loadingTask: viaWorker };
  } catch (err) {
    // These verdicts are about the file itself, so a different execution route
    // cannot change them. Retrying would only make the failure slower.
    if (isDamagedPdf(err) || isPasswordProtected(err)) {
      openRoute = 'web worker';
      throw err;
    }
    console.warn('PDF worker route failed, retrying on the main thread', err);
    void viaWorker.destroy().catch(() => {});

    try {
      await useMainThreadReader();
      const viaMain = attempt();
      const doc = await viaMain.promise;
      openRoute = 'main thread (worker route failed)';
      return { doc, loadingTask: viaMain };
    } catch (retryErr) {
      openRoute = 'failed on both the worker and the main thread';
      // The retry almost always repeats the original breakage, so the first
      // error is the one worth reporting; the second is kept for the console.
      console.error('Main-thread retry also failed', retryErr);
      throw err;
    }
  }
}

/** Turns an open failure into something true, specific, and reportable. */
async function explainOpenFailure(err: unknown, fileSummary: string): Promise<PdfIntakeError> {
  console.error('PDF intake failed', err);

  if (isPasswordProtected(err)) {
    return new PdfIntakeError(
      'This PDF is password-protected',
      'We need the password to read it. It is used once and never stored.',
      'Remove the password, or open it in a reader and re-export.',
    );
  }

  const damaged = isDamagedPdf(err);
  const failure = damaged
    ? new PdfIntakeError(
        'This PDF appears to be damaged',
        'pdf.js could not parse the file structure. It may have been truncated during a download.',
        'Try downloading it again from the source, or re-export it from the original.',
      )
    : new PdfIntakeError(
        "Paper Animator couldn't start its PDF reader",
        "This is not a problem with your file — the reader itself failed to run, so any PDF would fail the same way right now. The details below say exactly what this browser could not do.",
        'Try disabling ad blockers or privacy extensions for this site, or open it in another browser. If it keeps failing, copy the details below into a bug report.',
      );

  // Attached to both: when a file really is damaged the report still says which
  // pdf.js error decided that, which is the difference between a claim and
  // something the user can check.
  failure.diagnostics = await collectDiagnostics({
    phase: 'opening the document',
    route: openRoute,
    file: fileSummary,
    error: err,
    pdfjsVersion: pdfjs.version ?? 'unknown',
  });
  return failure;
}

/* ============================================================================
   pdf.js plumbing
   ========================================================================== */

async function readTextItems(
  page: pdfjs.PDFPageProxy,
  viewport: pdfjs.PageViewport,
): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const out: TextItem[] = [];
  const W = viewport.width;
  const H = viewport.height;

  for (const raw of content.items) {
    const item = raw as { str: string; transform: number[]; width: number; height: number; fontName?: string };
    if (!item.str || !item.str.trim()) continue;

    // Move into viewport space so the origin is top-left and rotation is handled.
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(t[1], t[3]) || item.height || 10;
    const x = t[4];
    const baseline = t[5];
    const top = baseline - fontHeight * 0.82;
    // item.width is already in device space at scale 1 — scaling it by the font
    // size again makes every item look full-width and destroys column detection.
    const width = item.width > 0 ? item.width : item.str.length * fontHeight * 0.5;

    const font = (item.fontName ?? '').toLowerCase();
    out.push({
      text: item.str,
      quad: {
        x: x / W,
        y: top / H,
        w: width / W,
        h: (fontHeight * 1.14) / H,
      },
      fontSize: fontHeight / H,
      bold: /bold|black|heavy|semib|demib/.test(font),
      italic: /italic|oblique/.test(font),
    });
  }
  return out;
}

async function rasterize(page: pdfjs.PDFPageProxy, targetWidth: number): Promise<string | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, targetWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
  const blob = await canvasToBlob(canvas, 'image/webp', 0.86);
  canvas.width = 0;
  canvas.height = 0;
  return blob ? URL.createObjectURL(blob) : null;
}

async function cropFromPage(
  page: pdfjs.PDFPageProxy,
  quad: Quad,
  targetWidth: number,
): Promise<string | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, Math.max(1.2, targetWidth / Math.max(1, base.width * quad.w)));
  const viewport = page.getViewport({ scale });

  const sx = Math.max(0, Math.floor(quad.x * viewport.width));
  const sy = Math.max(0, Math.floor(quad.y * viewport.height));
  const sw = Math.min(viewport.width - sx, Math.ceil(quad.w * viewport.width));
  const sh = Math.min(viewport.height - sy, Math.ceil(quad.h * viewport.height));
  if (sw < 8 || sh < 8) return null;

  const full = document.createElement('canvas');
  full.width = Math.ceil(viewport.width);
  full.height = Math.ceil(viewport.height);
  const fctx = full.getContext('2d', { alpha: false });
  if (!fctx) return null;
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, full.width, full.height);
  await page.render({ canvas: full, canvasContext: fctx, viewport } as never).promise;

  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  const cctx = crop.getContext('2d', { alpha: false });
  if (!cctx) return null;
  cctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await canvasToBlob(crop, 'image/webp', 0.92);
  full.width = 0;
  full.height = 0;
  crop.width = 0;
  crop.height = 0;
  return blob ? URL.createObjectURL(blob) : null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/* ============================================================================
   Front matter
   ========================================================================== */

async function readMeta(
  doc: pdfjs.PDFDocumentProxy,
  firstPageLines: Line[],
  bodySize: number,
  pageCount: number,
  isScanned: boolean,
): Promise<{ meta: PaperMeta; frontMatterBottom: number }> {
  let title: string | null = null;
  let embeddedTitle: string | null = null;
  try {
    const info = (await doc.getMetadata())?.info as { Title?: string } | undefined;
    const t = info?.Title?.trim();
    if (t && t.length > 8 && !/^(untitled|microsoft word|\d+$)/i.test(t) && !/\.(docx?|tex|pdf)$/i.test(t)) {
      embeddedTitle = t;
    }
  } catch {
    /* metadata is optional */
  }

  const top = firstPageLines.filter((l) => l.quad.y < 0.42 && l.text.length > 3);
  const titleLines: Line[] = [];
  if (top.length > 0) {
    const maxSize = Math.max(...top.map((l) => l.fontSize));
    if (maxSize > bodySize * 1.18) {
      for (const l of top) {
        const sameSize = l.fontSize > maxSize * 0.92;
        if (!sameSize) {
          if (titleLines.length > 0) break;
          continue;
        }
        const prev = titleLines[titleLines.length - 1];
        // A title runs on only while the next line sits directly beneath it.
        if (prev && l.quad.y - (prev.quad.y + prev.quad.h) > prev.quad.h * 0.9) break;
        titleLines.push(l);
        if (titleLines.length >= 3) break;
      }
      const joined = titleLines
        .map((l) => l.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (joined.length > 8 && joined.length < 220) title = joined;
    }
  }
  title = title ?? embeddedTitle;

  // Authors: the lines between the title and the abstract, filtered for name shape.
  const authors: Author[] = [];
  // Taken from the lines the title was actually built from. Matching lines back
  // by substring would let a one-character axis label — "h" is inside
  // "Athletes" — push the byline search past the whole front matter.
  const titleY = titleLines.reduce((max, l) => Math.max(max, l.quad.y + l.quad.h), 0);
  let frontMatterBottom = titleY;
  for (const l of firstPageLines) {
    if (l.quad.y <= titleY || l.quad.y > 0.5) continue;
    if (/^abstract/i.test(l.text)) break;
    if (l.text.length > 220) continue;
    const looksLikeNames =
      /[A-Z][a-z]+[.,;]?\s+[A-Z]/.test(l.text) &&
      !/\b(university|institute|department|college|laborator|@|http|received|accepted|doi)\b/i.test(
        l.text,
      );
    if (looksLikeNames) {
      for (const name of l.text.split(/,| and |;|·|∗|\*|†|‡/)) {
        const clean = name.replace(/[\d\s,.*†‡§¶]+$/g, '').trim();
        if (clean.length > 3 && clean.length < 60 && /[A-Z][a-z]/.test(clean)) {
          authors.push({ name: clean });
        }
      }
      if (authors.length > 0) {
        frontMatterBottom = l.quad.y + l.quad.h;
        break;
      }
    }
  }

  // Affiliations, footnote markers and submission dates sit between the byline
  // and the abstract in smaller type. They are metadata, not argument, and
  // reading them as prose turns the outline's first two entries into the
  // paper's own title and byline repeated back at the reader.
  for (const l of firstPageLines) {
    if (l.quad.y <= frontMatterBottom || l.quad.y > 0.5) continue;
    if (/^abstract\b/i.test(l.text.trim())) break;
    if (l.fontSize >= bodySize * 0.98) break;
    frontMatterBottom = l.quad.y + l.quad.h;
  }

  // Abstract: from the "Abstract" marker to the next structural break.
  let abstract: string | null = null;
  const absIdx = firstPageLines.findIndex((l) => /^abstract\b/i.test(l.text.trim()));
  if (absIdx >= 0) {
    const parts: string[] = [];
    const firstLine = firstPageLines[absIdx].text.replace(/^abstract\b[\s—–:.-]*/i, '').trim();
    if (firstLine) parts.push(firstLine);
    for (let j = absIdx + 1; j < firstPageLines.length; j++) {
      const l = firstPageLines[j];
      if (/^(keywords?|index terms|1\.?\s+introduction|introduction|ccs concepts)\b/i.test(l.text.trim())) break;
      if (l.gapAbove > 2.4 && parts.length > 2) break;
      parts.push(l.text);
      if (parts.join(' ').length > 2400) break;
    }
    const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length > 80) abstract = joined;
  }

  const doiLine = firstPageLines.find((l) => /10\.\d{4,9}\/[^\s]+/.test(l.text));
  const doi = doiLine ? (/10\.\d{4,9}\/[^\s,;)]+/.exec(doiLine.text)?.[0] ?? null) : null;
  const yearLine = firstPageLines.find((l) => /\b(19|20)\d{2}\b/.test(l.text));
  const year = yearLine ? Number(/\b(19|20)\d{2}\b/.exec(yearLine.text)?.[0]) : null;

  return {
    meta: {
      title,
      authors: dedupeAuthors(authors).slice(0, 12),
      abstract,
      doi,
      venue: null,
      year: Number.isFinite(year) ? year : null,
      language: 'en',
      pageCount,
      isScanned,
    },
    frontMatterBottom,
  };
}

function dedupeAuthors(authors: Author[]): Author[] {
  const seen = new Set<string>();
  return authors.filter((a) => {
    const k = a.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function computeConfidence(
  sections: Section[],
  figures: Figure[],
  statistics: unknown[],
  imageMode: boolean,
): number {
  if (imageMode) return 0.3;
  let c = 0.4;
  if (sections.length >= 4) c += 0.2;
  if (sections.some((s) => s.kind === 'results')) c += 0.12;
  if (sections.some((s) => s.kind === 'methods')) c += 0.08;
  if (figures.length > 0) c += 0.08;
  if (statistics.length > 3) c += 0.08;
  const avgSectionConfidence =
    sections.reduce((a, s) => a + s.confidence, 0) / Math.max(1, sections.length);
  c += avgSectionConfidence * 0.12;
  return Math.min(0.97, c);
}

function looksLikePdf(data: ArrayBuffer): boolean {
  const head = new Uint8Array(data.slice(0, 1024));
  const text = new TextDecoder('latin1').decode(head);
  return text.includes('%PDF-');
}

function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function newProjectId() {
  return newId('project');
}


/** True when a line sits mostly inside one of the page's figure or table regions. */
function insideAny(quad: Quad, regions: Quad[]): boolean {
  for (const r of regions) {
    const overlapX = Math.min(quad.x + quad.w, r.x + r.w) - Math.max(quad.x, r.x);
    const overlapY = Math.min(quad.y + quad.h, r.y + r.h) - Math.max(quad.y, r.y);
    if (overlapX <= 0 || overlapY <= 0) continue;
    const covered = (overlapX * overlapY) / Math.max(1e-6, quad.w * quad.h);
    if (covered > 0.6) return true;
  }
  return false;
}

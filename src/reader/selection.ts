import type {
  Figure,
  Paper,
  PaperTable,
  Quad,
  Section,
  Sentence,
  SourceRef,
  Statistic,
} from '@/core/types';
import {
  contains,
  coverage,
  mergeLines,
  pageIndex,
  pageText,
  tidy,
  union,
} from './pageText';

/**
 * A passage: what the reader hands to an instrument.
 *
 * It is built from the browser's own selection over the page, so the geometry
 * is exactly what the person marked — not a sentence we decided they meant.
 * Because the quads come out of the live range, the provenance of anything
 * built from a passage *is* the highlight, down to the word.
 */

export interface PassageSpan {
  page: number;
  quads: Quad[];
  text: string;
}

export interface Passage {
  id: string;
  spans: PassageSpan[];
  /** The whole passage, tidied into one readable string. */
  text: string;
  words: number;
  /** Sentences the passage covers, in reading order. */
  sentences: Sentence[];
  statistics: Statistic[];
  figure: Figure | null;
  table: PaperTable | null;
  section: Section | null;
  /** Set when the passage is a dragged-out region rather than marked text. */
  region: { page: number; quad: Quad } | null;
  /** Where it sits on screen, for anchoring the marker bar. */
  clientRect: { x: number; y: number; w: number; h: number } | null;
}

export const TEXT_LAYER_SELECTOR = '[data-textlayer]';

let counter = 0;
function passageId(): string {
  return `psg-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ============================================================================
   From the live selection
   ========================================================================== */

export function readSelection(root: HTMLElement | null, paper: Paper): Passage | null {
  if (!root) return null;
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const spans: PassageSpan[] = [];
  for (const layer of root.querySelectorAll<HTMLElement>(TEXT_LAYER_SELECTOR)) {
    if (!range.intersectsNode(layer)) continue;
    const page = Number(layer.dataset.page);
    if (!Number.isFinite(page)) continue;

    const sub = clipRange(range, layer);
    if (!sub) continue;
    const text = tidy(rangeText(sub, layer));
    const quads = quadsOf(sub, layer);
    if (!text && !quads.length) continue;
    spans.push({ page, quads, text });
  }
  if (!spans.length) return null;

  const box = range.getBoundingClientRect();
  return assemble(spans, paper, null, {
    x: box.left,
    y: box.top,
    w: box.width,
    h: box.height,
  });
}

function clipRange(range: Range, layer: HTMLElement): Range | null {
  const whole = document.createRange();
  whole.selectNodeContents(layer);
  const sub = range.cloneRange();
  try {
    if (sub.compareBoundaryPoints(Range.START_TO_START, whole) < 0) {
      sub.setStart(whole.startContainer, whole.startOffset);
    }
    if (sub.compareBoundaryPoints(Range.END_TO_END, whole) > 0) {
      sub.setEnd(whole.endContainer, whole.endOffset);
    }
  } catch {
    return null;
  }
  return sub.collapsed ? null : sub;
}

/**
 * The words a range covers, assembled from the runs themselves.
 *
 * The layer sets `font-size: 0` so that the whitespace between absolutely
 * positioned runs takes no room, and a browser serialising the selection drops
 * that whitespace with it — which is how “how much load” came back as
 * “how muchload”. Each run carries the space or line break that belongs after
 * it, so the passage is rebuilt from those instead of from the rendered string.
 */
function rangeText(range: Range, layer: HTMLElement): string {
  let out = '';
  for (const el of layer.querySelectorAll<HTMLElement>('[data-run]')) {
    if (!range.intersectsNode(el)) continue;
    const piece = document.createRange();
    piece.selectNodeContents(el);
    try {
      if (piece.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
        piece.setStart(range.startContainer, range.startOffset);
      }
      if (piece.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
        piece.setEnd(range.endContainer, range.endOffset);
      }
    } catch {
      continue;
    }
    const text = piece.toString();
    if (!text) continue;
    const after = el.dataset.after;
    out += text + (after === 'n' ? '\n' : after === 's' ? ' ' : '');
  }
  return out;
}

function quadsOf(range: Range, layer: HTMLElement): Quad[] {
  const box = layer.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return [];
  const out: Quad[] = [];
  for (const rect of Array.from(range.getClientRects())) {
    // Collapsed whitespace between absolutely positioned runs reports slivers.
    if (rect.width < 1.5 || rect.height < 2) continue;
    out.push({
      x: (rect.left - box.left) / box.width,
      y: (rect.top - box.top) / box.height,
      w: rect.width / box.width,
      h: rect.height / box.height,
    });
  }
  return mergeLines(out);
}

/* ============================================================================
   From geometry (a click on a sentence, a dragged region, a scene's source)
   ========================================================================== */

export function passageFromQuads(
  paper: Paper,
  page: number,
  quads: Quad[],
  text: string,
  clientRect?: Passage['clientRect'],
): Passage {
  return assemble([{ page, quads: mergeLines(quads), text: tidy(text) }], paper, null, clientRect ?? null);
}

export function passageFromRegion(
  paper: Paper,
  page: number,
  quad: Quad,
  clientRect?: Passage['clientRect'],
): Passage {
  const index = pageIndex(paper, page);
  // Text under the marquee comes along, so a cropped chart still carries the
  // words printed inside it and the caption beneath it.
  const inside = index.sentences.filter((s) => coverage(s.bounds, quad) > 0.5);
  const text = tidy(inside.map((s) => s.sentence.text).join(' '));
  return assemble([{ page, quads: [quad], text }], paper, { page, quad }, clientRect ?? null);
}

/* ============================================================================
   Resolution
   ========================================================================== */

function assemble(
  spans: PassageSpan[],
  paper: Paper,
  region: Passage['region'],
  clientRect: Passage['clientRect'],
): Passage {
  const sentences: Sentence[] = [];
  const seen = new Set<string>();
  let section: Section | null = null;
  let figure: Figure | null = null;
  let table: PaperTable | null = null;

  for (const span of spans) {
    const index = pageIndex(paper, span.page);
    const area = span.quads.length ? union(span.quads) : null;

    // Purely geometric. A paper repeats itself — the abstract says what the
    // discussion says — so matching on text would attach a mark in one section
    // to a sentence in another, and every consumer of `sentences` would inherit
    // that mistake. Every sentence in the index has quads, so it is never needed.
    for (const entry of index.sentences) {
      if (seen.has(entry.sentence.id)) continue;
      const covered = entry.quads.reduce(
        (best, q) => Math.max(best, span.quads.reduce((m, s) => Math.max(m, coverage(q, s)), 0)),
        0,
      );
      if (covered > 0.34) {
        seen.add(entry.sentence.id);
        sentences.push(entry.sentence);
      }
    }

    if (!section && area) {
      const para = index.paragraphs.find((p) => coverage(area, p.bounds) > 0.2);
      section = para?.section ?? null;
    }
    if (area) {
      for (const r of index.regions) {
        const hit = coverage(area, r.bounds) > 0.55 || coverage(r.bounds, area) > 0.5;
        if (!hit) continue;
        if (r.kind === 'figure' && !figure) figure = paper.figures.find((f) => f.id === r.id) ?? null;
        if (r.kind === 'table' && !table) table = paper.tables.find((t) => t.id === r.id) ?? null;
      }
    }
  }

  const text = tidy(spans.map((s) => s.text).join(' '));
  const statistics = paper.statistics.filter((stat) => {
    if (sentences.some((s) => s.id === stat.sentenceId)) {
      return text.includes(stat.raw.trim()) || spans.some((s) => s.page === stat.ref.page);
    }
    return spans.some(
      (span) =>
        span.page === stat.ref.page &&
        stat.ref.quads.some((q) => span.quads.some((s) => coverage(q, s) > 0.5)),
    );
  });

  return {
    id: passageId(),
    spans,
    text,
    words: text ? text.split(/\s+/).filter(Boolean).length : 0,
    sentences,
    statistics,
    figure,
    table,
    section,
    region,
    clientRect,
  };
}

/* ============================================================================
   Passage → source refs
   ========================================================================== */

/** One ref per page the passage touches. The first is the primary. */
export function passageRefs(passage: Passage): SourceRef[] {
  return passage.spans
    .filter((s) => s.quads.length || s.text)
    .map((s) => ({ page: s.page, quads: s.quads, text: s.text || passage.text }));
}

export function primaryRef(passage: Passage): SourceRef {
  return passageRefs(passage)[0] ?? { page: 1, quads: [], text: passage.text };
}

/* ============================================================================
   Hit testing — what is under the pointer
   ========================================================================== */

export interface PageHit {
  page: number;
  x: number;
  y: number;
  sentence: Sentence | null;
  sentenceQuads: Quad[];
  /**
   * The printed line under the pointer, whether or not it parsed as a sentence.
   * A title, a heading and a figure caption are all marks a person will want to
   * make, and none of them is part of a paragraph.
   */
  line: { quad: Quad; text: string } | null;
  paragraphBounds: Quad | null;
  region: { kind: 'figure' | 'table'; id: string; label: string; bounds: Quad } | null;
}

export function hitPage(paper: Paper, page: number, x: number, y: number): PageHit {
  const index = pageIndex(paper, page);

  // The nearest *line* to the pointer, never a sentence's bounding box: a
  // multi-line sentence's box covers the lines of its neighbours, and matching
  // on it makes a click in the margin select something across the page.
  let sentence: Sentence | null = null;
  let quads: Quad[] = [];
  let best = Infinity;

  for (const entry of index.sentences) {
    for (const q of entry.quads) {
      if (x < q.x - 0.006 || x > q.x + q.w + 0.006) continue;
      const dy = y < q.y ? q.y - y : y > q.y + q.h ? y - (q.y + q.h) : 0;
      if (dy > q.h * 0.65) continue;
      if (dy < best) {
        best = dy;
        sentence = entry.sentence;
        quads = entry.quads;
      }
    }
    if (best === 0) break;
  }

  let line: { quad: Quad; text: string } | null = null;
  const source = paper.pages.find((p) => p.number === page);
  if (source) {
    let nearest = Infinity;
    for (const candidate of pageText(source).lines) {
      const q = candidate.quad;
      if (x < q.x - 0.006 || x > q.x + q.w + 0.006) continue;
      const dy = y < q.y ? q.y - y : y > q.y + q.h ? y - (q.y + q.h) : 0;
      if (dy > q.h * 0.65 || dy >= nearest) continue;
      nearest = dy;
      line = { quad: q, text: candidate.text };
    }
  }

  const para = index.paragraphs.find((p) => contains(p.bounds, x, y, 0.002));
  const region = index.regions.find((r) => contains(r.bounds, x, y)) ?? null;
  return {
    page,
    x,
    y,
    sentence,
    sentenceQuads: quads,
    line,
    paragraphBounds: para?.bounds ?? null,
    region,
  };
}

/**
 * Where a source reference sits on screen right now, in client coordinates.
 *
 * The thread that ties a claim to its sentence needs a point on the page, not
 * an element: the reader draws pages as images, so the sentence has no element
 * of its own — only quads.
 */
export function anchorRect(ref: SourceRef): DOMRect | null {
  if (typeof document === 'undefined') return null;
  const pageEl = document.querySelector<HTMLElement>(`[data-page="${ref.page}"]`);
  if (!pageEl) return null;
  const box = pageEl.getBoundingClientRect();
  if (!ref.quads.length || box.width < 1) return box;
  const u = union(ref.quads);
  return new DOMRect(
    box.left + u.x * box.width,
    box.top + u.y * box.height,
    Math.max(2, u.w * box.width),
    Math.max(2, u.h * box.height),
  );
}

/* ============================================================================
   Driving the browser's selection
   ========================================================================== */

/**
 * Select every run that sits inside the given quads.
 *
 * Used by click-a-sentence, by ⌥↑ expansion, and by the storyboard when it
 * shows where a scene came from — all three end up as a real browser selection,
 * so there is exactly one notion of "what is marked" in the whole product.
 */
export function selectQuads(root: HTMLElement | null, page: number, quads: Quad[]): boolean {
  if (!root || !quads.length || typeof window === 'undefined') return false;
  const layer = root.querySelector<HTMLElement>(`[data-textlayer][data-page="${page}"]`);
  if (!layer) return false;
  const box = layer.getBoundingClientRect();
  if (box.width < 1) return false;

  // A run is on the line if their vertical extents mostly agree, and part of the
  // mark if it also overlaps it horizontally. Both ends are then trimmed to
  // where the mark actually starts and stops — a printed line is often a single
  // run holding the end of one sentence and the start of the next, and taking
  // the whole run would highlight, cite and speak words nobody marked.
  const hits: { el: HTMLElement; run: Quad; target: Quad }[] = [];
  for (const el of layer.querySelectorAll<HTMLElement>('[data-run]')) {
    const run = runQuad(el);
    if (!run) continue;
    let target: Quad | null = null;
    let best = 0;
    for (const q of quads) {
      const down = Math.min(run.y + run.h, q.y + q.h) - Math.max(run.y, q.y);
      if (down < run.h * 0.5) continue;
      const across = Math.min(run.x + run.w, q.x + q.w) - Math.max(run.x, q.x);
      const share = run.w > 0 ? across / run.w : 0;
      if (share > best) {
        best = share;
        target = q;
      }
    }
    if (target && best > 0.25) hits.push({ el, run, target });
  }
  if (!hits.length) return false;

  const first = hits[0];
  const last = hits[hits.length - 1];
  const range = document.createRange();
  range.setStartBefore(first.el.firstChild ?? first.el);
  range.setEndAfter(last.el.lastChild ?? last.el);

  const wide = range.cloneRange();
  trimTo(range, first, box, 'start');
  trimTo(range, last, box, 'end');
  const use = range.collapsed ? wide : range;

  const sel = window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(use);
  return true;
}

/**
 * Move one end of the range to the character the mark actually begins or ends
 * on, asking the browser where that point falls in its own text.
 *
 * When the point cannot be resolved — the page is scrolled out of view, or
 * something is over it — the end is left on the run boundary, which is where it
 * already was.
 */
function trimTo(
  range: Range,
  hit: { el: HTMLElement; run: Quad; target: Quad },
  box: DOMRect,
  end: 'start' | 'end',
): void {
  const edge =
    end === 'start' ? hit.target.x : Math.min(hit.target.x + hit.target.w, hit.run.x + hit.run.w);
  const slack = hit.run.w * 0.04;
  if (end === 'start' ? edge <= hit.run.x + slack : edge >= hit.run.x + hit.run.w - slack) return;

  const x = box.left + edge * box.width + (end === 'start' ? 0.5 : -0.5);
  const y = box.top + (hit.run.y + hit.run.h / 2) * box.height;
  const found = caretAt(x, y);
  if (!found || !hit.el.contains(found.node)) return;
  const at = wholeWord(found, end);
  try {
    if (end === 'start') range.setStart(at.node, at.offset);
    else range.setEnd(at.node, at.offset);
  } catch {
    /* the point landed outside the range's own container; leave the end alone */
  }
}

/**
 * Nudge a trimmed end onto a word boundary.
 *
 * The run is laid out in the browser's own font and then scaled to sit on the
 * printed glyphs, so the character the point resolves to can be a character out
 * either way. A mark that begins at “oaches” is unmistakably wrong; one that
 * begins at “Coaches” is unmistakably right, and there is no third option — so
 * the end is moved to whichever boundary of the word it landed in.
 */
function wholeWord(
  at: { node: Node; offset: number },
  end: 'start' | 'end',
): { node: Node; offset: number } {
  if (at.node.nodeType !== Node.TEXT_NODE) return at;
  const data = (at.node as Text).data;
  let i = at.offset;
  if (end === 'start') {
    if (isWord(data[i])) while (i > 0 && isWord(data[i - 1])) i--;
    else while (i < data.length && !isWord(data[i])) i++;
  } else if (isWord(data[i - 1])) {
    while (i < data.length && isWord(data[i])) i++;
  } else {
    while (i > 0 && !isWord(data[i - 1])) i--;
  }
  return { node: at.node, offset: i };
}

/** WebKit only ever shipped the older spelling of this. */
type LegacyCaretDocument = {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  const legacy = document as unknown as LegacyCaretDocument;
  if (typeof legacy.caretRangeFromPoint === 'function') {
    const r = legacy.caretRangeFromPoint(x, y);
    if (r) return { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

export function clearSelection(): void {
  if (typeof window === 'undefined') return;
  window.getSelection()?.removeAllRanges();
}

/**
 * The live selection, kept so a mark the reader changed can be put back.
 *
 * A cloned range rather than the quads it covers: putting a mark back has to
 * restore it to the character, and quads only ever restore it to the word.
 */
export function captureSelection(root: HTMLElement | null): Range | null {
  if (!root || typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

/** Fails quietly when the page it belonged to has since dropped its text. */
export function restoreSelection(range: Range | null): boolean {
  if (!range || typeof window === 'undefined') return false;
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    sel.removeAllRanges();
    sel.addRange(range.cloneRange());
  } catch {
    return false;
  }
  return !sel.isCollapsed;
}

/**
 * Stretch the mark to the character under the pointer, keeping its anchor.
 *
 * What ⇧-click does in every text field there has ever been. The reader's own
 * ⇧-click takes the whole sentence it lands in, which is the right answer while
 * the reader is helping and the wrong one once someone is marking by hand: at
 * that point the pointer is being aimed, and an aimed pointer means the word it
 * is on.
 */
export function extendSelectionToPoint(
  root: HTMLElement | null,
  clientX: number,
  clientY: number,
): boolean {
  if (!root || typeof window === 'undefined') return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  if (!sel.anchorNode || !root.contains(sel.anchorNode)) return false;

  const at = caretAt(clientX, clientY);
  if (!at || !root.contains(at.node)) return false;
  if (!at.node.parentElement?.closest(TEXT_LAYER_SELECTOR)) return false;

  try {
    sel.extend(at.node, at.offset);
  } catch {
    return false;
  }
  return !sel.isCollapsed;
}

function runQuad(el: HTMLElement): Quad | null {
  const raw = el.dataset.quad;
  if (!raw) return null;
  const [x, y, w, h] = raw.split(',').map(Number);
  return Number.isFinite(x) ? { x, y, w, h } : null;
}

/* ============================================================================
   Expanding and contracting
   ========================================================================== */

/**
 * The next or previous sentence in reading order.
 *
 * This is what makes the reader usable without a pointer: ⌥→ walks the paper a
 * sentence at a time, ⌥↑ widens the mark to its paragraph, and a letter turns
 * it into a scene. No step of that path needs a mouse.
 */
export function stepSentence(
  paper: Paper,
  passage: Passage | null,
  direction: 1 | -1,
): { page: number; quads: Quad[] } | null {
  const all = paper.sections
    .flatMap((section) => section.paragraphs)
    .flatMap((para) => para.sentences)
    .filter((sentence) => sentence.ref.quads.length > 0);
  if (!all.length) return null;

  // Stepping forward from a multi-sentence mark continues after all of it.
  const edge = direction === 1 ? passage?.sentences.at(-1) : passage?.sentences[0];
  const at = edge ? all.findIndex((s) => s.id === edge.id) : -1;
  const next = at < 0 ? (direction === 1 ? 0 : all.length - 1) : at + direction;
  const target = all[Math.max(0, Math.min(all.length - 1, next))];
  return target ? { page: target.ref.page, quads: target.ref.quads } : null;
}

/**
 * The next thing containing the mark: a partial phrase grows to its sentence,
 * a sentence to its paragraph, a paragraph to its section.
 *
 * Decided by which sentences are covered rather than by comparing rectangles.
 * Geometry answers "is this box bigger", which stops being the right question
 * as soon as the mark spans a column break — identity always answers it.
 */
export function grow(paper: Paper, passage: Passage): { page: number; quads: Quad[] } | null {
  const span = passage.spans[0];
  if (!span) return null;
  const index = pageIndex(paper, span.page);
  const marked = new Set(passage.sentences.map((s) => s.id));
  const area = span.quads.length ? union(span.quads) : null;

  const host =
    (passage.sentences[0] &&
      index.sentences.find((e) => e.sentence.id === passage.sentences[0].id)) ||
    (area ? index.sentences.find((e) => coverage(area, e.bounds) > 0.4) : undefined);
  if (!host) return null;

  // A phrase inside a sentence grows to the sentence around it.
  const wholeSentence =
    marked.size > 1 || passage.text.length >= host.sentence.text.length - 4;
  if (!wholeSentence) return { page: span.page, quads: host.quads };

  const para = index.paragraphs.find((p) =>
    p.paragraph.sentences.some((s) => s.id === host.sentence.id),
  );
  if (!para) return null;

  const onPage = (sentences: Sentence[]) =>
    sentences.filter((s) => s.ref.page === span.page && s.ref.quads.length);

  const paraSentences = onPage(para.paragraph.sentences);
  if (paraSentences.some((s) => !marked.has(s.id))) {
    const quads = paraSentences.flatMap((s) => s.ref.quads);
    if (quads.length) return { page: span.page, quads };
  }

  const sectionSentences = onPage(para.section.paragraphs.flatMap((p) => p.sentences));
  if (sectionSentences.some((s) => !marked.has(s.id))) {
    const quads = sectionSentences.flatMap((s) => s.ref.quads);
    if (quads.length) return { page: span.page, quads };
  }
  return null;
}

/** The inverse of grow: a section narrows to a paragraph, a paragraph to a sentence. */
export function shrink(paper: Paper, passage: Passage): { page: number; quads: Quad[] } | null {
  const span = passage.spans[0];
  const first = passage.sentences[0];
  if (!span || !first || passage.sentences.length < 2) return null;

  const index = pageIndex(paper, span.page);
  const marked = new Set(passage.sentences.map((s) => s.id));
  const touched = index.paragraphs.filter((p) =>
    p.paragraph.sentences.some((s) => marked.has(s.id)),
  );

  // More than one paragraph under the mark? Come back to the one the mark
  // starts in — but only if that is actually a step down.
  if (touched.length > 1) {
    const home =
      touched.find((p) => p.paragraph.sentences.some((s) => s.id === first.id)) ?? touched[0];
    const inside = home.paragraph.sentences.filter(
      (s) => s.ref.page === span.page && s.ref.quads.length,
    );
    if (inside.length > 1 && inside.length < passage.sentences.length) {
      return { page: span.page, quads: inside.flatMap((s) => s.ref.quads) };
    }
  }
  return { page: first.ref.page, quads: first.ref.quads };
}

/* ============================================================================
   What a click means — the mark ladder
   ========================================================================== */

/**
 * Clicking is the fast path, so a click is never a caret: it takes something.
 *
 * One click takes the sentence under the pointer. Clicking again in the same
 * place widens the mark — sentence, paragraph, section — so the whole ladder is
 * reachable without learning a shortcut, and a double click always lands on the
 * whole sentence rather than the single word a browser would have given you.
 */

export type MarkKind =
  | 'sentence'
  | 'line'
  | 'block'
  | 'paragraph'
  | 'section'
  | 'figure'
  | 'table';

export interface MarkTarget {
  page: number;
  quads: Quad[];
  kind: MarkKind;
  /** The words the mark covers, for the pages whose text has no runs to select. */
  text: string;
  /** Set when the target is a figure or a table rather than words. */
  region: PageHit['region'];
}

/** `clicks` is 1 for a single click, 2 for a double click, and so on. */
export function targetForClick(
  paper: Paper,
  page: number,
  x: number,
  y: number,
  clicks: number,
): MarkTarget | null {
  const hit = hitPage(paper, page, x, y);
  const index = pageIndex(paper, page);
  const rungs: MarkTarget[] = [];

  if (hit.sentence && hit.sentenceQuads.length) {
    rungs.push({
      page,
      quads: hit.sentenceQuads,
      kind: 'sentence',
      text: hit.sentence.text,
      region: null,
    });

    const home = index.paragraphs.find((p) =>
      p.paragraph.sentences.some((s) => s.id === hit.sentence!.id),
    );
    if (home) {
      const para = onPage(home.paragraph.sentences, page);
      if (para.quads.length > hit.sentenceQuads.length) {
        rungs.push({ page, ...para, kind: 'paragraph', region: null });
      }
      const section = onPage(
        home.section.paragraphs.flatMap((p) => p.sentences),
        page,
      );
      if (section.quads.length > (para.quads.length || hit.sentenceQuads.length)) {
        rungs.push({ page, ...section, kind: 'section', region: null });
      }
    }
  } else if (hit.line && !hit.region) {
    // Inside a figure or a table, the printed lines are axis labels and cells —
    // never what someone clicking a chart meant to take. Everywhere else they
    // are titles, headings and captions, and are exactly what they meant.
    rungs.push({ page, quads: [hit.line.quad], kind: 'line', text: hit.line.text, region: null });
    const block = lineBlock(paper, page, hit.line.quad);
    if (block.length > 1) {
      rungs.push({
        page,
        quads: block.map((l) => l.quad),
        kind: 'block',
        text: tidy(block.map((l) => l.text).join('\n')),
        region: null,
      });
    }
  }

  // A figure or a table is the last rung, and the only one when the pointer is
  // over artwork rather than words — so a chart is marked by clicking it.
  if (hit.region) {
    rungs.push({
      page,
      quads: [hit.region.bounds],
      kind: hit.region.kind,
      text: hit.region.label,
      region: hit.region,
    });
  }

  if (!rungs.length) return null;
  // One click and two clicks both take the first rung: a double click has to
  // land on the whole sentence, not on the word a browser would have picked.
  return rungs[Math.max(0, Math.min(rungs.length - 1, clicks - 2))];
}

function onPage(sentences: Sentence[], page: number): { quads: Quad[]; text: string } {
  const here = sentences.filter((s) => s.ref.page === page && s.ref.quads.length);
  return {
    quads: here.flatMap((s) => s.ref.quads),
    text: tidy(here.map((s) => s.text).join(' ')),
  };
}

/**
 * The printed lines around a line: a two-line title, a wrapped caption.
 *
 * Titles and captions are not paragraphs, so they have no rung of their own to
 * grow into — this gives them one, by walking outwards while the next line sits
 * directly under the last at the same size and roughly the same width.
 */
function lineBlock(paper: Paper, page: number, seed: Quad): { quad: Quad; text: string }[] {
  const source = paper.pages.find((p) => p.number === page);
  if (!source) return [];
  const lines = pageText(source)
    .lines.map((l) => ({ quad: l.quad, text: l.text }))
    .sort((a, b) => a.quad.y - b.quad.y);
  const at = lines.findIndex(
    (l) => Math.abs(l.quad.y - seed.y) < 0.003 && Math.abs(l.quad.x - seed.x) < 0.02,
  );
  if (at < 0) return [];

  const kin = (above: Quad, below: Quad) => {
    const gap = below.y - (above.y + above.h);
    if (gap < -above.h * 0.5 || gap > above.h * 0.85) return false;
    if (Math.abs(above.h - below.h) > Math.max(above.h, below.h) * 0.34) return false;
    const overlap =
      Math.min(above.x + above.w, below.x + below.w) - Math.max(above.x, below.x);
    return overlap > Math.min(above.w, below.w) * 0.4;
  };

  const out = [lines[at]];
  for (let i = at + 1; i < lines.length && kin(out[out.length - 1].quad, lines[i].quad); i++) {
    out.push(lines[i]);
  }
  for (let i = at - 1; i >= 0 && kin(lines[i].quad, out[0].quad); i--) out.unshift(lines[i]);
  return out;
}

/**
 * Widen the mark to the sentence the pointer is on, keeping where it started.
 *
 * ⇧-click is how a mark is stretched with the pointer, in either direction —
 * the same gesture every text editor has, so nobody has to be told about it.
 */
export function extendMark(
  paper: Paper,
  passage: Passage,
  page: number,
  x: number,
  y: number,
): { page: number; quads: Quad[] } | null {
  const index = pageIndex(paper, page);
  if (!index.sentences.length) return null;

  const hit = hitPage(paper, page, x, y);
  const to = hit.sentence
    ? index.sentences.findIndex((e) => e.sentence.id === hit.sentence!.id)
    : -1;
  if (to < 0) return null;

  const marked = new Set(passage.sentences.map((s) => s.id));
  let first = -1;
  let last = -1;
  index.sentences.forEach((e, i) => {
    if (!marked.has(e.sentence.id)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return { page, quads: index.sentences[to].quads };

  const lo = Math.min(first, to);
  const hi = Math.max(last, to);
  const quads = index.sentences.slice(lo, hi + 1).flatMap((e) => e.quads);
  return quads.length ? { page, quads } : null;
}

/* ============================================================================
   Tidying what was dragged
   ========================================================================== */

/**
 * Round a dragged selection out to whole words.
 *
 * Nobody means to mark “the resul”. The browser gives you the character your
 * pointer stopped on; this gives you the word it was inside, which is what the
 * quote, the narration and the citation all end up carrying.
 *
 * `keepInsideWord` is set once the reader knows the mark is being made by hand,
 * and holds back the one case where rounding is wrong: a mark made entirely
 * inside a printed run — “hydro”, a units suffix, one half of a hyphenation —
 * is left at the characters it was dragged to. Nobody lands inside a word twice
 * by accident.
 */
export function snapSelectionToWords(
  root: HTMLElement | null,
  options: { keepInsideWord?: boolean } = {},
): void {
  if (!root || typeof window === 'undefined') return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  if (options.keepInsideWord && insideOneRun(range)) return;

  const start = wordEdge(range.startContainer, range.startOffset, -1);
  const end = wordEdge(range.endContainer, range.endOffset, 1);
  if (!start && !end) return;

  const next = range.cloneRange();
  try {
    if (start) next.setStart(start.node, start.offset);
    if (end) next.setEnd(end.node, end.offset);
  } catch {
    return;
  }
  if (next.collapsed) return;
  sel.removeAllRanges();
  sel.addRange(next);
}

/** Both ends in the same printed run, with no space between them. */
function insideOneRun(range: Range): boolean {
  const node = range.startContainer;
  if (node !== range.endContainer || node.nodeType !== Node.TEXT_NODE) return false;
  return !/\s/.test((node as Text).data.slice(range.startOffset, range.endOffset));
}

interface FlatText {
  text: string;
  nodes: { node: Text; start: number }[];
}

function flatten(layer: HTMLElement): FlatText {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

function isWord(ch: string | undefined): boolean {
  return !!ch && !/\s/.test(ch);
}

/** Only moves when the boundary is *inside* a word; otherwise it is left alone. */
function wordEdge(
  container: Node,
  offset: number,
  direction: -1 | 1,
): { node: Text; offset: number } | null {
  if (container.nodeType !== Node.TEXT_NODE) return null;
  const layer = container.parentElement?.closest<HTMLElement>(TEXT_LAYER_SELECTOR);
  if (!layer) return null;

  const flat = flatten(layer);
  const entry = flat.nodes.find((n) => n.node === container);
  if (!entry) return null;
  let at = entry.start + offset;

  if (direction < 0) {
    if (!isWord(flat.text[at]) || !isWord(flat.text[at - 1])) return null;
    while (at > 0 && isWord(flat.text[at - 1])) at--;
  } else {
    if (!isWord(flat.text[at - 1]) || !isWord(flat.text[at])) return null;
    while (at < flat.text.length && isWord(flat.text[at])) at++;
  }
  return locate(flat, at);
}

function locate(flat: FlatText, at: number): { node: Text; offset: number } | null {
  for (const entry of flat.nodes) {
    if (at >= entry.start && at <= entry.start + entry.node.data.length) {
      return { node: entry.node, offset: at - entry.start };
    }
  }
  return null;
}

/** How generous the round-up is: two words is a slip, three is a decision. */
const ROUND_UP_WORDS = 2;

/**
 * The last word or two a dragged mark stopped short of — and nothing more.
 *
 * A drag that ends a hair before the full stop was aiming at the full stop, and
 * carrying "the effect was" into a scene when the person marked "the effect was
 * significant" helps nobody. Everything past that is theirs: a drag that stops
 * halfway through a sentence stops halfway through a sentence, because someone
 * who dragged that far and let go there was saying where to stop. The reader
 * finishes a word; it does not finish a thought.
 *
 * Returns null unless every sentence the mark touches is within
 * `ROUND_UP_WORDS` of being whole — so the round-up can add a word, never a
 * line, and never a sentence nobody dragged into.
 */
export function completeSelection(
  paper: Paper,
  passage: Passage,
): { page: number; quads: Quad[] } | null {
  if (passage.region || passage.spans.length !== 1) return null;
  const span = passage.spans[0];
  if (!span.quads.length || !passage.text) return null;

  const index = pageIndex(paper, span.page);
  const touched = index.sentences.filter((entry) =>
    entry.quads.some((q) =>
      span.quads.some((s) => coverage(s, q) > 0.3 || coverage(q, s) > 0.3),
    ),
  );
  if (!touched.length) return null;

  // Counted in words rather than in area, because that is the unit the shortfall
  // is felt in: half of a four-word sentence is a slip and half of a forty-word
  // one is a decision, and no fraction tells those apart.
  let missing = 0;
  for (const entry of touched) {
    missing += (1 - markedFraction(entry.quads, span.quads)) * words(entry.sentence.text);
    if (missing > ROUND_UP_WORDS) return null;
  }
  // Already whole: there is nothing to round up to.
  if (missing < 0.35) return null;

  const quads = touched.flatMap((e) => e.quads);
  return quads.length ? { page: span.page, quads } : null;
}

/**
 * How much of a sentence a mark covers, measured along the line.
 *
 * Width, not area: a selection's client rects are as tall as the browser's own
 * line box and a sentence's quads are as tall as the printed glyphs, so the two
 * never agree vertically — and comparing areas would report a fully marked line
 * as four fifths marked. Horizontally they agree to the character.
 */
function markedFraction(target: Quad[], mark: Quad[]): number {
  let total = 0;
  let hit = 0;
  for (const q of target) {
    if (q.w <= 0) continue;
    total += q.w;
    let across = 0;
    for (const s of mark) {
      const down = Math.min(q.y + q.h, s.y + s.h) - Math.max(q.y, s.y);
      if (down < Math.min(q.h, s.h) * 0.45) continue;
      across += Math.max(0, Math.min(q.x + q.w, s.x + s.w) - Math.max(q.x, s.x));
    }
    hit += Math.min(q.w, across);
  }
  return total > 0 ? hit / total : 0;
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

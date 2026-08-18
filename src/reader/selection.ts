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
    const text = tidy(sub.toString());
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

  const runs = Array.from(layer.querySelectorAll<HTMLElement>('[data-run]'));
  const inside = runs.filter((el) => {
    const q = runQuad(el);
    return q ? quads.some((target) => coverage(q, target) > 0.45) : false;
  });
  if (!inside.length) return false;

  const first = inside[0];
  const last = inside[inside.length - 1];
  const range = document.createRange();
  range.setStartBefore(first.firstChild ?? first);
  range.setEndAfter(last.lastChild ?? last);

  const sel = window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function clearSelection(): void {
  if (typeof window === 'undefined') return;
  window.getSelection()?.removeAllRanges();
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

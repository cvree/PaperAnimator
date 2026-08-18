import type { Page, Paper, Paragraph, Quad, Section, Sentence } from '@/core/types';
import { assemblePage } from '@/extract/text';

/**
 * What the reader needs to put real, selectable text on top of a rendered page.
 *
 * The runs come out in *reading* order, not in the order the PDF happened to
 * store them, because the browser's own selection follows DOM order. Emitting
 * the assembled lines means dragging down a two-column page selects the left
 * column and then the right one — the order a person reads in — rather than
 * zig-zagging across the gutter the way most PDF viewers do.
 */

export interface GlyphRun {
  text: string;
  quad: Quad;
  /** Fraction of page height, so it can be expressed in container units. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** Whitespace that belongs after this run: ' ' between words, '\n' at a line end. */
  after: '' | ' ' | '\n';
  /** Index of the line this run belongs to. */
  line: number;
}

export interface TextLine {
  quad: Quad;
  /** The line as printed, so a heading or a caption can be marked like a sentence. */
  text: string;
  first: number;
  last: number;
}

export interface PageText {
  runs: GlyphRun[];
  lines: TextLine[];
}

const SPACE_RATIO = 0.26;
const textCache = new WeakMap<Page, PageText>();

export function pageText(page: Page): PageText {
  const hit = textCache.get(page);
  if (hit) return hit;

  const { lines } = assemblePage(page.items);
  const runs: GlyphRun[] = [];
  const out: TextLine[] = [];

  lines.forEach((line, lineIndex) => {
    const first = runs.length;
    line.items.forEach((item, i) => {
      const next = line.items[i + 1];
      let after: GlyphRun['after'] = '';
      if (next) {
        const gap = next.quad.x - (item.quad.x + item.quad.w);
        after = gap > item.quad.h * SPACE_RATIO ? ' ' : '';
      } else {
        after = '\n';
      }
      runs.push({
        text: item.text,
        quad: item.quad,
        fontSize: item.fontSize,
        bold: item.bold,
        italic: item.italic,
        after,
        line: lineIndex,
      });
    });
    if (runs.length > first) {
      out.push({ quad: line.quad, text: line.text, first, last: runs.length - 1 });
    }
  });

  const built = { runs, lines: out };
  textCache.set(page, built);
  return built;
}

/* ============================================================================
   Where things are on a page
   ========================================================================== */

export interface PageIndex {
  sentences: { sentence: Sentence; quads: Quad[]; bounds: Quad }[];
  paragraphs: { paragraph: Paragraph; section: Section; bounds: Quad }[];
  /** Figure and table regions, so a pointer can land on one. */
  regions: { kind: 'figure' | 'table'; id: string; label: string; bounds: Quad }[];
}

const indexCache = new WeakMap<Paper, Map<number, PageIndex>>();

export function pageIndex(paper: Paper, pageNumber: number): PageIndex {
  let byPage = indexCache.get(paper);
  if (!byPage) {
    byPage = new Map();
    indexCache.set(paper, byPage);
  }
  const hit = byPage.get(pageNumber);
  if (hit) return hit;

  const built: PageIndex = { sentences: [], paragraphs: [], regions: [] };

  for (const section of paper.sections) {
    for (const paragraph of section.paragraphs) {
      const paraQuads: Quad[] = [];
      for (const sentence of paragraph.sentences) {
        if (sentence.ref.page !== pageNumber) continue;
        const quads = sentence.ref.quads.filter((q) => q.w > 0 && q.h > 0);
        if (!quads.length) continue;
        built.sentences.push({ sentence, quads, bounds: union(quads) });
        paraQuads.push(...quads);
      }
      if (paraQuads.length) {
        built.paragraphs.push({ paragraph, section, bounds: union(paraQuads) });
      }
    }
  }

  for (const figure of paper.figures) {
    if (figure.page === pageNumber) {
      built.regions.push({ kind: 'figure', id: figure.id, label: figure.label, bounds: figure.quad });
    }
  }
  for (const table of paper.tables) {
    if (table.page === pageNumber) {
      built.regions.push({ kind: 'table', id: table.id, label: table.label, bounds: table.quad });
    }
  }

  byPage.set(pageNumber, built);
  return built;
}

/* ============================================================================
   Quad arithmetic
   ========================================================================== */

export function union(quads: Quad[]): Quad {
  const x = Math.min(...quads.map((q) => q.x));
  const y = Math.min(...quads.map((q) => q.y));
  const r = Math.max(...quads.map((q) => q.x + q.w));
  const b = Math.max(...quads.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}

export function contains(quad: Quad, x: number, y: number, pad = 0): boolean {
  return (
    x >= quad.x - pad && x <= quad.x + quad.w + pad && y >= quad.y - pad && y <= quad.y + quad.h + pad
  );
}

/** Fraction of `a` that lies inside `b`. */
export function coverage(a: Quad, b: Quad): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const area = a.w * a.h;
  return area > 0 ? (w * h) / area : 0;
}

/**
 * Merge rectangles that sit on the same line into one quad per line.
 *
 * A range's client rects arrive one per text run, so a selected sentence comes
 * back as a dozen slivers. Highlighting those directly looks like a barcode;
 * merging them per line is what makes a selection read as a marked passage.
 */
export function mergeLines(quads: Quad[]): Quad[] {
  if (quads.length < 2) return quads;
  const sorted = [...quads].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Quad[] = [];
  for (const q of sorted) {
    const last = out[out.length - 1];
    const sameLine =
      last && Math.abs(q.y + q.h / 2 - (last.y + last.h / 2)) < Math.max(q.h, last.h) * 0.6;
    const adjacent = last && q.x <= last.x + last.w + Math.max(q.h, last.h) * 1.6;
    if (sameLine && adjacent) {
      const right = Math.max(last.x + last.w, q.x + q.w);
      const top = Math.min(last.y, q.y);
      const bottom = Math.max(last.y + last.h, q.y + q.h);
      last.x = Math.min(last.x, q.x);
      last.y = top;
      last.w = right - last.x;
      last.h = bottom - top;
    } else {
      out.push({ ...q });
    }
  }
  return out;
}

/* ============================================================================
   Text tidying
   ========================================================================== */

/**
 * The string a person meant to select.
 *
 * PDF text arrives with the line breaks of the printed column, which is not how
 * the sentence should be spoken or shown. Hyphens at a line end are joined back
 * up; everything else collapses to single spaces.
 */
export function tidy(raw: string): string {
  return raw
    .replace(/-\n\s*/g, '')
    .replace(/­/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]])/g, '$1')
    .trim();
}

/** Trim a passage to whole words at a maximum length, adding an ellipsis. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

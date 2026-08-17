import type { Quad, TextItem } from '@/core/types';

/**
 * Line assembly and reading order.
 *
 * Columns are detected *before* lines are assembled. Grouping by vertical
 * position first would merge a left-column line with the right-column line
 * beside it, which silently corrupts every sentence downstream — the single
 * most damaging thing that can go wrong in this pipeline.
 */

export interface Line {
  text: string;
  quad: Quad;
  items: TextItem[];
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** 0 or 1 for a column, -1 for something spanning the full measure. */
  column: number;
  /** Vertical gap above this line, in multiples of the page's median leading. */
  gapAbove: number;
}

export interface PageStats {
  bodyFontSize: number;
  medianLeading: number;
}

const SPACE_RATIO = 0.26;
const SPAN_WIDTH = 0.58;

export interface AssembledPage {
  lines: Line[];
  columns: number;
}

export function assemblePage(items: TextItem[]): AssembledPage {
  const usable = items.filter((i) => i.text.trim().length > 0);
  if (usable.length === 0) return { lines: [], columns: 1 };

  const split = detectColumnSplit(usable);
  const lines: Line[] = [];

  // Rows first, then the gutter. Banding items by their x position before
  // assembling lines would tear a full-measure line in half; deciding by width
  // alone would misfile the short last line of a full-measure paragraph as
  // column text, which is how a sentence loses its ending.
  for (const row of groupRows(usable)) {
    for (const piece of splitAtGutter(row, split)) {
      const line = makeLine(piece);
      if (!line) continue;
      line.column = classifyColumn(line.quad, split);
      lines.push(line);
    }
  }

  computeGaps(lines);
  return { lines: orderLines(lines, split === null ? 1 : 2), columns: split === null ? 1 : 2 };
}

/** A line that reaches across the gutter belongs to neither column. */
function classifyColumn(quad: Quad, split: number | null): number {
  if (split === null) return -1;
  const EDGE = 0.02;
  if (quad.x < split - EDGE && quad.x + quad.w > split + EDGE) return -1;
  return quad.x + quad.w / 2 < split ? 0 : 1;
}

/**
 * A row spanning both columns is two lines only if something gutter-sized
 * separates them. A word gap is not a gutter, so full-measure text stays whole.
 */
function splitAtGutter(row: TextItem[], split: number | null): TextItem[][] {
  if (split === null || row.length < 2) return [row];

  const sorted = [...row].sort((a, b) => a.quad.x - b.quad.x);
  const pivot = sorted.findIndex((i) => i.quad.x + i.quad.w / 2 >= split);
  if (pivot <= 0) return [row];

  const lastLeft = sorted[pivot - 1];
  const firstRight = sorted[pivot];
  const gap = firstRight.quad.x - (lastLeft.quad.x + lastLeft.quad.w);
  const h = median(row.map((i) => i.quad.h)) || 0.012;
  if (gap < h) return [row];

  return [sorted.slice(0, pivot), sorted.slice(pivot)];
}

/** Items sharing a baseline, across the whole page. */
function groupRows(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => a.quad.y - b.quad.y || a.quad.x - b.quad.x);
  const tolerance = (median(sorted.map((i) => i.quad.h)) || 0.012) * 0.5;

  const rows: TextItem[][] = [];
  let current: TextItem[] = [sorted[0]];
  let rowY = sorted[0].quad.y;

  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (Math.abs(it.quad.y - rowY) <= tolerance) {
      current.push(it);
    } else {
      rows.push(current);
      current = [it];
      rowY = it.quad.y;
    }
  }
  rows.push(current);
  return rows;
}

function makeLine(row: TextItem[]): Line | null {
  const ordered = [...row].sort((a, b) => a.quad.x - b.quad.x);
  let text = '';
  for (let i = 0; i < ordered.length; i++) {
    const it = ordered[i];
    if (i > 0) {
      const prev = ordered[i - 1];
      const gap = it.quad.x - (prev.quad.x + prev.quad.w);
      if (gap > prev.quad.h * SPACE_RATIO && !text.endsWith(' ')) text += ' ';
    }
    text += it.text;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const x = Math.min(...ordered.map((i) => i.quad.x));
  const y = Math.min(...ordered.map((i) => i.quad.y));
  const right = Math.max(...ordered.map((i) => i.quad.x + i.quad.w));
  const bottom = Math.max(...ordered.map((i) => i.quad.y + i.quad.h));
  const boldChars = ordered.filter((i) => i.bold).reduce((s, i) => s + i.text.length, 0);
  const italicChars = ordered.filter((i) => i.italic).reduce((s, i) => s + i.text.length, 0);

  return {
    text,
    quad: { x, y, w: right - x, h: bottom - y },
    items: ordered,
    fontSize: median(ordered.map((i) => i.quad.h)),
    bold: boldChars > text.length * 0.6,
    italic: italicChars > text.length * 0.6,
    column: 0,
    gapAbove: 0,
  };
}

/**
 * Returns the x at which two columns divide, or null for a single column.
 * Weighted by text length so a couple of stray wide labels cannot invent a split.
 */
function detectColumnSplit(items: TextItem[]): number | null {
  const narrow = items.filter((i) => i.quad.w < SPAN_WIDTH);
  if (narrow.length < 12) return null;

  const BINS = 60;
  const hist = new Array(BINS).fill(0);
  for (const item of narrow) {
    const mid = item.quad.x + item.quad.w / 2;
    const bin = Math.min(BINS - 1, Math.max(0, Math.floor(mid * BINS)));
    hist[bin] += Math.max(1, item.text.length);
  }

  const peak = Math.max(...hist);
  if (peak === 0) return null;

  // The gutter is the middle of the widest quiet run, not the first empty bin.
  // A whole empty gutter ties at zero, and taking the first minimum would put
  // the split inside the left column, where it cuts real lines in half.
  const lo = Math.floor(BINS * 0.35);
  const hi = Math.ceil(BINS * 0.65);
  const quiet = peak * 0.16;

  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = lo; i < hi; i++) {
    if (hist[i] < quiet) {
      if (runStart < 0) runStart = i;
      if (i - runStart + 1 > bestLen) {
        bestLen = i - runStart + 1;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }
  // Two bins is about 3% of the page — narrower than any real gutter.
  if (bestLen < 2) return null;

  const left = hist.slice(0, bestStart).reduce((a, b) => a + b, 0);
  const right = hist.slice(bestStart + bestLen).reduce((a, b) => a + b, 0);
  if (Math.min(left, right) <= Math.max(left, right) * 0.3) return null;

  return (bestStart + bestLen / 2) / BINS;
}

/** Gaps are measured within a column, so a column break is not read as a paragraph. */
function computeGaps(lines: Line[]): void {
  const byColumn = new Map<number, Line[]>();
  for (const line of lines) {
    const list = byColumn.get(line.column) ?? [];
    list.push(line);
    byColumn.set(line.column, list);
  }

  const leadings: number[] = [];
  for (const list of byColumn.values()) {
    list.sort((a, b) => a.quad.y - b.quad.y);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].quad.y - (list[i - 1].quad.y + list[i - 1].quad.h);
      if (gap > 0 && gap < 0.06) leadings.push(gap);
    }
  }
  const medLead = median(leadings) || 0.004;

  for (const list of byColumn.values()) {
    for (let i = 0; i < list.length; i++) {
      if (i === 0) {
        list[i].gapAbove = 3;
        continue;
      }
      const gap = list[i].quad.y - (list[i - 1].quad.y + list[i - 1].quad.h);
      list[i].gapAbove = medLead > 0 ? gap / medLead : 0;
    }
  }
}

/** Full-width lines act as barriers; column content between them reads in order. */
function orderLines(lines: Line[], columns: number): Line[] {
  const byY = (a: Line, b: Line) => a.quad.y - b.quad.y || a.quad.x - b.quad.x;
  if (columns === 1) return [...lines].sort(byY);

  const spans = lines.filter((l) => l.column === -1).sort(byY);
  const left = lines.filter((l) => l.column === 0).sort(byY);
  const right = lines.filter((l) => l.column === 1).sort(byY);

  const out: Line[] = [];
  let li = 0;
  let ri = 0;
  for (const span of spans) {
    const cut = span.quad.y;
    while (li < left.length && left[li].quad.y < cut) out.push(left[li++]);
    while (ri < right.length && right[ri].quad.y < cut) out.push(right[ri++]);
    out.push(span);
  }
  while (li < left.length) out.push(left[li++]);
  while (ri < right.length) out.push(right[ri++]);
  return out;
}

export function pageStats(lines: Line[]): PageStats {
  const weighted: number[] = [];
  for (const l of lines) {
    const reps = Math.min(20, Math.ceil(l.text.length / 8));
    for (let i = 0; i < reps; i++) weighted.push(l.fontSize);
  }
  const gaps = lines.map((l) => l.gapAbove).filter((g) => g > 0 && g < 4);
  return {
    bodyFontSize: median(weighted) || 0.012,
    medianLeading: median(gaps) || 1,
  };
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function unionQuad(quads: Quad[]): Quad {
  const x = Math.min(...quads.map((q) => q.x));
  const y = Math.min(...quads.map((q) => q.y));
  const r = Math.max(...quads.map((q) => q.x + q.w));
  const b = Math.max(...quads.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}

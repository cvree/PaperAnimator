import { newId } from '@/core/id';
import type { Figure, PaperTable, Quad, TableGrid } from '@/core/types';
import type { Line } from './text';
import { median } from './text';

/**
 * Figures and tables, found the way a person finds them: by their caption.
 *
 * Caption-anchored detection works for vector charts, raster images, and ruled
 * tables alike, because it reasons about the page's whitespace rather than its
 * drawing operators. The crop is taken from the rendered page, so what we show
 * is always exactly what is printed.
 */

const FIGURE_CAPTION = /^\s*(fig(?:ure)?s?\.?|scheme|chart|plate)\s*\.?\s*(\d+[a-z]?)\b/i;
const TABLE_CAPTION = /^\s*(table|tab\.?)\s*\.?\s*([IVXLC]+|\d+[a-z]?)\b/i;

export interface RegionInput {
  page: number;
  lines: Line[];
  pageAspect: number;
  bodyFontSize: number;
}

export interface DetectedRegions {
  figures: Omit<Figure, 'image'>[];
  tables: Omit<PaperTable, 'image'>[];
}

export function detectRegions(pages: RegionInput[]): DetectedRegions {
  const figures: Omit<Figure, 'image'>[] = [];
  const tables: Omit<PaperTable, 'image'>[] = [];

  for (const p of pages) {
    const seen = new Set<string>();

    for (const sorted of columnScans(p.lines)) {
      for (let i = 0; i < sorted.length; i++) {
        const line = sorted[i];
        const figMatch = FIGURE_CAPTION.exec(line.text);
        const tabMatch = TABLE_CAPTION.exec(line.text);
        if (!figMatch && !tabMatch) continue;
        const key = (figMatch ? 'F' : 'T') + (figMatch ?? tabMatch)![2].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const { caption, endIndex } = gatherCaption(sorted, i);

        if (figMatch) {
          const region = findGraphicBand(sorted, i, endIndex, line.quad, p.bodyFontSize);
          if (!region) continue;
          figures.push({
            id: newId('figure'),
            label: `Figure ${figMatch[2]}`,
            caption,
            page: p.page,
            quad: region,
            altText: buildAltText(`Figure ${figMatch[2]}`, caption),
            altTextEdited: false,
            confidence: confidenceForBand(region, p.pageAspect),
            ref: { page: p.page, quads: [region], text: caption },
          });
        } else if (tabMatch) {
          const band = findTabularBand(sorted, i, endIndex);
          const quad =
            band?.quad ?? findGraphicBand(sorted, i, endIndex, line.quad, p.bodyFontSize);
          if (!quad) continue;
          const grid = band ? buildGrid(band.lines) : null;
          tables.push({
            id: newId('table'),
            label: `Table ${tabMatch[2]}`,
            caption,
            page: p.page,
            quad,
            grid,
            notes: band ? collectNotes(sorted, band) : [],
            confidence: grid ? gridConfidence(grid) : 0.35,
            ref: { page: p.page, quads: [quad], text: caption },
          });
        }

        i = endIndex;
      }
    }
  }

  return { figures, tables };
}

/**
 * Captions and their artwork are column-local, so scanning a page in raw
 * reading order lets a line from the neighbouring column interrupt a table
 * halfway down. Each column is scanned on its own, with full-measure lines
 * included because those genuinely do interrupt a column.
 */
function columnScans(lines: Line[]): Line[][] {
  const byY = (a: Line, b: Line) => a.quad.y - b.quad.y;
  const spans = lines.filter((l) => l.column === -1);
  const columns = [...new Set(lines.map((l) => l.column))].filter((c) => c >= 0).sort();
  if (columns.length <= 1) return [[...lines].sort(byY)];
  return columns.map((c) => [...lines.filter((l) => l.column === c), ...spans].sort(byY));
}

/** A caption runs on until the text stops looking like a caption. */
function gatherCaption(lines: Line[], start: number): { caption: string; endIndex: number } {
  const first = lines[start];
  let caption = first.text;
  let end = start;

  for (let j = start + 1; j < lines.length; j++) {
    const next = lines[j];
    const vGap = next.quad.y - (lines[j - 1].quad.y + lines[j - 1].quad.h);
    const sameSize = Math.abs(next.fontSize - first.fontSize) < first.fontSize * 0.18;
    const horizontallyAligned = Math.abs(next.quad.x - first.quad.x) < 0.06;
    const isNewCaption = FIGURE_CAPTION.test(next.text) || TABLE_CAPTION.test(next.text);

    if (isNewCaption || !sameSize || !horizontallyAligned || vGap > first.quad.h * 1.4) break;
    caption += ' ' + next.text;
    end = j;
    if (/[.!?]$/.test(next.text)) break;
  }

  return { caption: caption.replace(/\s+/g, ' ').trim(), endIndex: end };
}

/**
 * The graphic occupies the space between the caption and the nearest run of
 * prose, within the caption's own column.
 *
 * Axis labels, tick values and panel letters are text, so a strictly text-free
 * band finds nothing on a real chart. What actually bounds a figure is prose:
 * we walk outward past anything that reads as part of the artwork and stop at
 * the first line of body copy.
 */
function findGraphicBand(
  lines: Line[],
  capStart: number,
  capEnd: number,
  capQuad: Quad,
  bodyFontSize: number,
): Quad | null {
  const colLeft = capQuad.x - 0.03;
  const colRight = capQuad.x + capQuad.w + 0.03;
  // Most of the line has to live in this column. Mere overlap would let a
  // full-measure abstract line count as being in both columns at once, and a
  // spanning line directly above the caption would collapse the band to zero.
  const inColumn = (q: Quad) => {
    const overlap = Math.max(0, Math.min(q.x + q.w, colRight) - Math.max(q.x, colLeft));
    return overlap > q.w * 0.6;
  };

  const isProse = (line: Line) =>
    line.text.length >= 28 &&
    line.fontSize >= bodyFontSize * 0.82 &&
    /[a-z]{4}/.test(line.text) &&
    line.quad.w > capQuad.w * 0.5;

  const capTop = lines[capStart].quad.y;
  const capBottom = lines[capEnd].quad.y + lines[capEnd].quad.h;

  let above = 0;
  for (let j = capStart - 1; j >= 0; j--) {
    const line = lines[j];
    if (!inColumn(line.quad)) continue;
    if (isProse(line)) {
      above = line.quad.y + line.quad.h;
      break;
    }
  }
  const bandAbove = { y: above, h: capTop - above };

  let below = 1;
  for (let j = capEnd + 1; j < lines.length; j++) {
    const line = lines[j];
    if (!inColumn(line.quad)) continue;
    if (isProse(line)) {
      below = line.quad.y;
      break;
    }
  }
  const bandBelow = { y: capBottom, h: below - capBottom };

  const best = bandAbove.h >= bandBelow.h ? bandAbove : bandBelow;
  const MIN_BAND = 0.045;
  if (best.h < MIN_BAND) return null;

  const pad = 0.006;
  return {
    x: Math.max(0, capQuad.x - pad),
    y: Math.max(0, best.y + pad),
    w: Math.min(1 - capQuad.x + pad, capQuad.w + pad * 2),
    h: Math.min(1 - best.y, best.h - pad * 1.5),
  };
}

/** Table bodies are lines with several column-like gaps or heavy numeric content. */
function findTabularBand(
  lines: Line[],
  capStart: number,
  capEnd: number,
): { quad: Quad; lines: Line[] } | null {
  const collect = (from: number, step: number): Line[] => {
    const out: Line[] = [];
    for (let j = from; j >= 0 && j < lines.length; j += step) {
      const l = lines[j];
      if (FIGURE_CAPTION.test(l.text) || TABLE_CAPTION.test(l.text)) break;
      if (!looksTabular(l)) {
        if (out.length > 0) break;
        // allow one header-ish line before the body starts
        if (out.length === 0 && Math.abs(j - from) > 1) break;
        continue;
      }
      out.push(l);
    }
    return out;
  };

  const below = collect(capEnd + 1, 1);
  const above = collect(capStart - 1, -1).reverse();
  const body = below.length >= above.length ? below : above;
  if (body.length < 2) return null;

  const x = Math.min(...body.map((l) => l.quad.x));
  const y = Math.min(...body.map((l) => l.quad.y));
  const r = Math.max(...body.map((l) => l.quad.x + l.quad.w));
  const b = Math.max(...body.map((l) => l.quad.y + l.quad.h));
  const pad = 0.008;
  return {
    quad: {
      x: Math.max(0, x - pad),
      y: Math.max(0, y - pad),
      w: r - x + pad * 2,
      h: b - y + pad * 2,
    },
    lines: body,
  };
}

function looksTabular(line: Line): boolean {
  if (line.items.length < 2) return false;
  const gaps: number[] = [];
  for (let i = 1; i < line.items.length; i++) {
    const prev = line.items[i - 1];
    const gap = line.items[i].quad.x - (prev.quad.x + prev.quad.w);
    if (gap > 0) gaps.push(gap);
  }
  const bigGaps = gaps.filter((g) => g > line.quad.h * 1.1).length;
  const tokens = line.text.split(/\s+/);
  const numeric = tokens.filter((t) => /\d/.test(t)).length;
  return bigGaps >= 2 || (bigGaps >= 1 && numeric / Math.max(1, tokens.length) > 0.4);
}

/** Cluster item x-positions into columns, then place each line's items. */
function buildGrid(lines: Line[]): TableGrid | null {
  const starts: number[] = [];
  for (const l of lines) for (const it of l.items) starts.push(it.quad.x);
  if (starts.length < 4) return null;

  const sorted = [...starts].sort((a, b) => a - b);
  const tol = median(lines.map((l) => l.quad.h)) * 1.4 || 0.02;
  const centers: number[] = [];
  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - group[group.length - 1] <= tol) group.push(sorted[i]);
    else {
      centers.push(group.reduce((a, b) => a + b, 0) / group.length);
      group = [sorted[i]];
    }
  }
  centers.push(group.reduce((a, b) => a + b, 0) / group.length);

  if (centers.length < 2 || centers.length > 14) return null;

  const cells: string[][] = [];
  for (const l of lines) {
    const row = new Array(centers.length).fill('');
    for (const it of l.items) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = Math.abs(it.quad.x - centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      row[best] = (row[best] ? row[best] + ' ' : '') + it.text;
    }
    cells.push(row.map((c) => c.trim()));
  }

  const nonEmpty = cells.filter((r) => r.some((c) => c.length > 0));
  if (nonEmpty.length < 2) return null;

  const headerRows = detectHeaderRows(nonEmpty);
  return { headerRows, cells: nonEmpty };
}

function detectHeaderRows(cells: string[][]): number {
  const numericRatio = (row: string[]) => {
    const filled = row.filter((c) => c.length > 0);
    if (filled.length === 0) return 0;
    return filled.filter((c) => /^[-−+]?[\d.,%()\s±]+$/.test(c)).length / filled.length;
  };
  if (cells.length > 1 && numericRatio(cells[0]) < 0.3 && numericRatio(cells[1]) > 0.5) return 1;
  if (
    cells.length > 2 &&
    numericRatio(cells[0]) < 0.3 &&
    numericRatio(cells[1]) < 0.3 &&
    numericRatio(cells[2]) > 0.5
  )
    return 2;
  return 1;
}

function gridConfidence(grid: TableGrid): number {
  const widths = grid.cells.map((r) => r.filter((c) => c.length > 0).length);
  if (widths.length === 0) return 0.3;
  const mode = median(widths);
  const consistent = widths.filter((w) => Math.abs(w - mode) <= 1).length / widths.length;
  const filled =
    grid.cells.flat().filter((c) => c.length > 0).length /
    Math.max(1, grid.cells.length * grid.cells[0].length);
  return Math.max(0.2, Math.min(0.95, consistent * 0.65 + filled * 0.35));
}

function collectNotes(lines: Line[], band: { lines: Line[] }): string[] {
  const lastY = Math.max(...band.lines.map((l) => l.quad.y));
  return lines
    .filter((l) => l.quad.y > lastY && l.quad.y < lastY + 0.06)
    .map((l) => l.text)
    .filter((t) => /^[*†‡§¶]|^note[s]?[:.]|^\s*p\s?[<>=]/i.test(t))
    .slice(0, 4);
}

function confidenceForBand(band: Quad, pageAspect: number): number {
  const area = band.w * band.h;
  const ratio = (band.w * pageAspect) / Math.max(0.001, band.h);
  let c = 0.55;
  if (area > 0.06) c += 0.2;
  if (area > 0.14) c += 0.1;
  if (ratio > 0.35 && ratio < 4.5) c += 0.1;
  return Math.min(0.95, c);
}

function buildAltText(label: string, caption: string | null): string {
  if (!caption)
    return `${label} from the paper. No caption was found, so this description needs editing.`;
  const stripped = caption
    .replace(FIGURE_CAPTION, '')
    .replace(TABLE_CAPTION, '')
    .replace(/^[\s.:—–-]+/, '');
  return stripped ? `${label}: ${stripped}` : `${label} from the paper.`;
}

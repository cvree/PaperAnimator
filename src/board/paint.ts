import { effectsCss } from './effects';
import type { Board, Card, Surface, Tone } from './types';

/**
 * How a card looks — written once, in HTML and CSS, and read by two places:
 * the board you edit and the page you publish. A published talk that did not
 * match the board it came from would make the board a guess, so there is only
 * one renderer and the editor uses it too.
 *
 * Nothing in here touches React or the DOM. It returns strings.
 */

export interface Palette {
  ground: string;
  groundEdge: string;
  gridDot: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  rule: string;
  accent: string;
  /** A mat behind figures, which arrive from the paper on white and need it. */
  mat: string;
  matInk: string;
  shadow: string;
  scrim: string;
}

/**
 * Two rooms, one with the lights on. The dark board is not the light one
 * inverted — chalk is warmer and quieter than ink, and pure white on pure black
 * vibrates. These are the colours that let someone read for an hour.
 */
export const SURFACES: Record<Surface, Palette> = {
  white: {
    ground: '#fbfaf7',
    groundEdge: '#f1efe9',
    gridDot: 'rgba(27,26,24,0.13)',
    ink: '#171614',
    inkSoft: '#4a4741',
    inkFaint: '#8c887f',
    rule: '#d9d5cb',
    accent: '#1b4b8f',
    mat: '#ffffff',
    matInk: '#171614',
    shadow: 'rgba(27,26,24,0.16)',
    scrim: 'rgba(251,250,247,0.82)',
  },
  black: {
    ground: '#14171a',
    groundEdge: '#0e1013',
    gridDot: 'rgba(240,244,248,0.14)',
    ink: '#f2f4f6',
    inkSoft: '#b9c1c8',
    inkFaint: '#79828a',
    rule: '#2c3238',
    accent: '#5cc9dd',
    mat: '#f7f6f2',
    matInk: '#171614',
    shadow: 'rgba(0,0,0,0.5)',
    scrim: 'rgba(20,23,26,0.82)',
  },
};

interface ToneColors {
  /** Text and stroke colour. */
  ink: string;
  /** Card fill. `transparent` means the card is written straight on the board. */
  fill: string;
  edge: string;
}

const TONE_HUES: Record<Exclude<Tone, 'plain' | 'ink' | 'accent'>, [string, string]> = {
  /*            light surface,  dark surface  */
  yellow: ['#ffe9a8', '#5c4c1c'],
  mint: ['#c9ecd2', '#1f4b33'],
  sky: ['#cfe4f7', '#1d3c58'],
  rose: ['#f8d5d8', '#57262d'],
  lilac: ['#e2d9f6', '#3b3160'],
};

export function toneColors(tone: Tone, surface: Surface): ToneColors {
  const p = SURFACES[surface];
  if (tone === 'plain') return { ink: p.ink, fill: 'transparent', edge: p.rule };
  if (tone === 'ink') return { ink: surface === 'white' ? '#fbfaf7' : '#14171a', fill: p.ink, edge: p.ink };
  if (tone === 'accent')
    return { ink: surface === 'white' ? '#ffffff' : '#0b1417', fill: p.accent, edge: p.accent };
  const fill = TONE_HUES[tone][surface === 'white' ? 0 : 1];
  return { ink: surface === 'white' ? '#171614' : '#f2f4f6', fill, edge: fill };
}

/* ============================================================================
   Type
   ========================================================================== */

const SERIF = "'Newsreader Variable', Newsreader, Georgia, 'Times New Roman', serif";
const SANS = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

interface RoleType {
  family: string;
  weight: number;
  /** World px at scale 1. */
  size: number;
  leading: number;
  tracking: string;
  transform: string;
  italic: boolean;
}

export const TEXT_ROLES: Record<string, RoleType> = {
  title: { family: SERIF, weight: 500, size: 92, leading: 1.02, tracking: '-0.03em', transform: 'none', italic: false },
  heading: { family: SERIF, weight: 470, size: 54, leading: 1.14, tracking: '-0.018em', transform: 'none', italic: false },
  body: { family: SANS, weight: 400, size: 30, leading: 1.5, tracking: '0', transform: 'none', italic: false },
  quote: { family: SERIF, weight: 420, size: 46, leading: 1.28, tracking: '-0.012em', transform: 'none', italic: true },
  label: { family: SANS, weight: 570, size: 22, leading: 1.25, tracking: '0.14em', transform: 'uppercase', italic: false },
  mono: { family: MONO, weight: 420, size: 26, leading: 1.5, tracking: '0', transform: 'none', italic: false },
};

/* ============================================================================
   The stylesheet, shared by the editor and the published page
   ========================================================================== */

export function boardCss(): string {
  return `
.bx-root{position:absolute;inset:0;overflow:hidden;background:var(--bx-ground);color:var(--bx-ink);
  -webkit-font-smoothing:antialiased;touch-action:none;}
.bx-grid{position:absolute;inset:0;pointer-events:none;}
.bx-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform;z-index:1;}
.bx-card{position:absolute;transform-origin:50% 50%;box-sizing:border-box;}
.bx-card[data-hidden="1"]{opacity:0;pointer-events:none;}
.bx-fade{transition:opacity 420ms cubic-bezier(.2,.7,.2,1),transform 420ms cubic-bezier(.2,.7,.2,1);}
.bx-in{opacity:0;transform:translateY(22px);}

.bx-text{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;
  white-space:pre-wrap;overflow-wrap:break-word;}
.bx-mark{box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0.06em 0.18em;
  margin:0 -0.06em;border-radius:2px;}

.bx-sticky{width:100%;height:100%;padding:26px 28px;display:flex;align-items:flex-start;
  font-family:${SANS};font-size:30px;line-height:1.4;white-space:pre-wrap;overflow-wrap:break-word;
  box-shadow:0 2px 3px var(--bx-shadow),0 14px 34px var(--bx-shadow);}

.bx-shape{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:20px;font-family:${SANS};font-size:28px;line-height:1.3;}
.bx-shape[data-shape="ellipse"]{border-radius:50%;}
.bx-shape[data-shape="diamond"]{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);}

.bx-image{width:100%;height:100%;display:flex;flex-direction:column;gap:10px;}
.bx-image figure{margin:0;flex:1;min-height:0;background:var(--bx-mat);border:1px solid var(--bx-rule);
  border-radius:3px;overflow:hidden;display:flex;align-items:center;justify-content:center;}
.bx-image img{width:100%;height:100%;display:block;}
.bx-image figcaption{font-family:${SANS};font-size:20px;line-height:1.4;color:var(--bx-ink-soft);}
.bx-missing{font-family:${SANS};font-size:18px;color:var(--bx-ink-faint);padding:16px;text-align:center;}

.bx-table{width:100%;height:100%;display:flex;flex-direction:column;gap:10px;
  background:var(--bx-mat);color:var(--bx-mat-ink);border:1px solid var(--bx-rule);border-radius:3px;padding:16px;}
.bx-table table{border-collapse:collapse;width:100%;font-family:${SANS};font-size:22px;}
.bx-table th,.bx-table td{border-bottom:1px solid rgba(0,0,0,0.12);padding:8px 12px;text-align:left;
  vertical-align:top;}
.bx-table th{font-weight:600;}
.bx-table .bx-cap{font-size:19px;color:rgba(0,0,0,0.6);font-family:${SANS};}

.bx-stat{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;
  gap:10px;padding:26px 30px;border-radius:4px;}
.bx-stat b{font-family:${SANS};font-weight:600;font-size:96px;line-height:1;letter-spacing:-0.03em;
  font-variant-numeric:tabular-nums;display:block;}
.bx-stat span{font-family:${SANS};font-size:24px;line-height:1.4;opacity:0.82;}
.bx-stat em{font-family:${MONO};font-style:normal;font-size:20px;opacity:0.7;}

.bx-ink{width:100%;height:100%;display:block;overflow:visible;}
.bx-ink path{stroke-dasharray:var(--bx-len,none);}

.bx-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}
.bx-edge{stroke:var(--bx-ink-faint);fill:none;stroke-width:3;}
.bx-edge-label{font-family:${SANS};font-size:20px;fill:var(--bx-ink-soft);}

.bx-cite{font-family:${MONO};font-size:17px;color:var(--bx-ink-faint);letter-spacing:0.02em;}

/* The thing under the cursor says so before you press, so a board with fifty
   cards on it never makes you guess which one you are about to pick up. */
.bx-root[data-mode="edit"] .bx-card:hover{
  box-shadow:0 0 0 calc(1.5px * var(--bx-k,1)) color-mix(in oklch,var(--bx-accent) 38%,transparent);}
.bx-root[data-mode="edit"] .bx-card[data-held="1"]{cursor:grabbing;}

${effectsCss()}
`.trim();
}

/* ============================================================================
   A card's shell — the part the editor, the presenter and the file all build
   themselves, and therefore the part they have to agree about.
   ========================================================================== */

/**
 * The variables an edge is drawn from.
 *
 * An outline never introduces a colour: it borrows the card's own tone. But a
 * note is already *filled* with its tone, and a yellow line round a yellow
 * square is not a line — so a card that carries its colour gets that colour
 * drawn harder rather than repeated, which keeps the family and finds the
 * contrast. A card with no fill of its own is edged in the board's ink.
 */
export function cardShellVars(card: Card, surface: Surface): Record<string, string> {
  const t = toneColors(card.tone, surface);
  return {
    '--bx-edge':
      t.fill === 'transparent'
        ? 'var(--bx-ink)'
        : `color-mix(in oklch, ${t.fill} 58%, var(--bx-ink))`,
    // The edge is part of the card, so it grows when the card's type does.
    '--bx-out': String(Math.max(0.5, Math.min(3, card.scale || 1))),
  };
}

/** The shell's own style declarations, for the published page. */
export function cardShellStyle(card: Card, surface: Surface): string {
  return Object.entries(cardShellVars(card, surface))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** Variables the board root carries, so every card reads the same palette. */
export function surfaceVars(surface: Surface): Record<string, string> {
  const p = SURFACES[surface];
  return {
    '--bx-ground': p.ground,
    '--bx-ground-edge': p.groundEdge,
    '--bx-ink': p.ink,
    '--bx-ink-soft': p.inkSoft,
    '--bx-ink-faint': p.inkFaint,
    '--bx-rule': p.rule,
    '--bx-accent': p.accent,
    '--bx-mat': p.mat,
    '--bx-mat-ink': p.matInk,
    '--bx-shadow': p.shadow,
  };
}

/** The endless grid, as a background the viewport paints under the world. */
export function gridStyle(
  board: Board,
  cameraX: number,
  cameraY: number,
  zoom: number,
  vw: number,
  vh: number,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const p = SURFACES[board.surface];
  // The grid coarsens as you pull back, so it never becomes a grey wash.
  let unit = 40;
  while (unit * zoom < 12) unit *= 5;
  const size = unit * zoom;
  const ox = ((vw / 2 - cameraX * zoom) % size + size) % size;
  const oy = ((vh / 2 - cameraY * zoom) % size + size) % size;
  if (board.grid === 'none') {
    return { backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0' };
  }
  if (board.grid === 'lines') {
    return {
      backgroundImage: `linear-gradient(to right, ${p.gridDot} 1px, transparent 1px), linear-gradient(to bottom, ${p.gridDot} 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px, ${size}px ${size}px`,
      backgroundPosition: `${ox}px ${oy}px, ${ox}px ${oy}px`,
    };
  }
  const r = Math.max(1, Math.min(2.2, size / 26));
  return {
    backgroundImage: `radial-gradient(circle at center, ${p.gridDot} ${r}px, transparent ${r}px)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${ox}px ${oy}px`,
  };
}

/* ============================================================================
   Cards
   ========================================================================== */

/**
 * A drawn stroke, as a curve rather than as the raw sampling of a pointer.
 *
 * Every other point becomes a control point and the midpoints become the
 * on-curve ones, which is the cheapest smoothing there is and the only one a
 * hand can tell apart from none: the line a person drew comes back as the line
 * they meant, at whatever rate their browser happened to sample it.
 *
 * The length comes back too, because the only other way to get it is to put the
 * path in a document and ask, and this file has no document.
 */
export function smoothStroke(
  points: number[],
  ox = 0,
  oy = 0,
): { d: string; length: number } | null {
  const n = Math.floor(points.length / 2);
  if (n < 2) return null;
  const px = (i: number) => points[i * 2] - ox;
  const py = (i: number) => points[i * 2 + 1] - oy;

  let d = `M${px(0).toFixed(1)} ${py(0).toFixed(1)}`;
  let length = 0;
  for (let i = 1; i < n - 1; i++) {
    const mx = (px(i) + px(i + 1)) / 2;
    const my = (py(i) + py(i + 1)) / 2;
    d += `Q${px(i).toFixed(1)} ${py(i).toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  d += `L${px(n - 1).toFixed(1)} ${py(n - 1).toFixed(1)}`;
  for (let i = 1; i < n; i++) length += Math.hypot(px(i) - px(i - 1), py(i) - py(i - 1));
  return { d, length: Math.ceil(length) + 8 };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function styleAttr(pairs: Record<string, string | number | undefined>): string {
  const body = Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return body ? ` style="${escapeHtml(body)}"` : '';
}

/** The citation a card carries when it came from the paper. */
export function citation(card: Card): string | null {
  return card.source ? `p. ${card.source.page}` : null;
}

/**
 * A card's markup. `assets` lets the publisher swap object URLs for inlined
 * data — the editor passes nothing and gets its own live URLs.
 */
export function cardHtml(
  card: Card,
  surface: Surface,
  assets?: (src: string | null) => string | null,
): string {
  const t = toneColors(card.tone, surface);
  const src = (s: string | null) => (assets ? assets(s) : s);

  switch (card.kind) {
    case 'text': {
      const role = TEXT_ROLES[card.role] ?? TEXT_ROLES.body;
      const marked = card.tone !== 'plain';
      const inner = escapeHtml(card.text) || '&nbsp;';
      const body = marked
        ? `<span class="bx-mark"${styleAttr({ background: t.fill, color: t.ink })}>${inner}</span>`
        : inner;
      return `<div class="bx-text"${styleAttr({
        'font-family': role.family,
        'font-weight': role.weight,
        'font-size': `${Math.round(role.size * card.scale)}px`,
        'line-height': role.leading,
        'letter-spacing': role.tracking,
        'text-transform': role.transform,
        'font-style': role.italic ? 'italic' : 'normal',
        'text-align': card.align,
        color: marked ? undefined : 'var(--bx-ink)',
        'align-items':
          card.align === 'center' ? 'center' : card.align === 'end' ? 'flex-end' : 'flex-start',
      })}>${body}</div>`;
    }

    case 'sticky':
      return `<div class="bx-sticky"${styleAttr({
        background: t.fill === 'transparent' ? 'var(--bx-mat)' : t.fill,
        color: t.ink,
        'font-size': `${Math.round(30 * card.scale)}px`,
      })}>${escapeHtml(card.text) || '&nbsp;'}</div>`;

    case 'shape':
      return `<div class="bx-shape" data-shape="${card.shape}"${styleAttr({
        border: card.filled ? 'none' : `3px solid ${t.fill === 'transparent' ? 'var(--bx-ink)' : t.fill}`,
        background: card.filled ? (t.fill === 'transparent' ? 'var(--bx-ink)' : t.fill) : 'transparent',
        color: card.filled ? t.ink : 'var(--bx-ink)',
        'border-radius': card.shape === 'rect' ? '6px' : undefined,
        'font-size': `${Math.round(28 * card.scale)}px`,
      })}>${escapeHtml(card.label)}</div>`;

    case 'image': {
      const url = src(card.src);
      const inner = url
        ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(card.alt)}"${styleAttr({
            'object-fit': card.fit,
          })} />`
        : `<p class="bx-missing">Image unavailable</p>`;
      const cap = card.caption
        ? `<figcaption>${escapeHtml(card.caption)}</figcaption>`
        : '';
      return `<div class="bx-image"><figure>${inner}</figure>${cap}</div>`;
    }

    case 'table': {
      const url = src(card.src);
      let body: string;
      if (card.grid && card.grid.cells.length) {
        const head = card.grid.cells.slice(0, Math.max(0, card.grid.headerRows));
        const rows = card.grid.cells.slice(Math.max(0, card.grid.headerRows));
        const cell = (tag: string, cells: string[]) =>
          `<tr>${cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`;
        body = `<table>${head.length ? `<thead>${head.map((r) => cell('th', r)).join('')}</thead>` : ''}<tbody>${rows
          .map((r) => cell('td', r))
          .join('')}</tbody></table>`;
      } else if (url) {
        body = `<img src="${escapeHtml(url)}" alt="${escapeHtml(card.caption ?? 'Table')}" style="width:100%;object-fit:contain" />`;
      } else {
        body = `<p class="bx-missing">Table unavailable</p>`;
      }
      const cap = card.caption ? `<p class="bx-cap">${escapeHtml(card.caption)}</p>` : '';
      return `<div class="bx-table"${styleAttr({ 'font-size': `${Math.round(22 * card.scale)}px` })}>${cap}<div style="flex:1;min-height:0;overflow:hidden">${body}</div></div>`;
    }

    case 'stat': {
      const quals = card.qualifiers.length
        ? `<em>${escapeHtml(card.qualifiers.join('  '))}</em>`
        : '';
      const cap = card.caption ? `<span>${escapeHtml(card.caption)}</span>` : '';
      return `<div class="bx-stat"${styleAttr({
        background: t.fill === 'transparent' ? 'transparent' : t.fill,
        color: t.fill === 'transparent' ? 'var(--bx-ink)' : t.ink,
      })}><b${styleAttr({ 'font-size': `${Math.round(96 * card.scale)}px` })}>${escapeHtml(
        card.value,
      )}</b>${cap}${quals}</div>`;
    }

    case 'ink': {
      const w = Math.max(1, card.rect.w);
      const h = Math.max(1, card.rect.h);
      const paths = card.strokes
        .map((points) => {
          const stroke = smoothStroke(points, card.rect.x, card.rect.y);
          if (!stroke) return '';
          // The length rides along so a drawing can draw itself on without
          // anybody having to measure it in a browser first.
          return `<path d="${stroke.d}" style="--bx-len:${stroke.length.toFixed(0)}" />`;
        })
        .join('');
      const stroke = t.fill === 'transparent' ? 'var(--bx-ink)' : t.fill;
      return `<svg class="bx-ink" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"${styleAttr({
        stroke,
        fill: 'none',
        'stroke-width': card.weight,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })}>${paths}</svg>`;
    }
  }
}

/* ============================================================================
   Connections
   ========================================================================== */

/** Where a line from `from` towards `to` leaves the first card's edge. */
function edgePoint(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const dx = to.x + to.w / 2 - cx;
  const dy = to.y + to.h / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // The smaller of the two scalings that reach a side is the side it leaves by.
  const sx = dx === 0 ? Infinity : from.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : from.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * The arrows between cards, as one SVG layer. Drawn from card edge to card
 * edge rather than centre to centre, so a line never disappears under the
 * thing it points at.
 */
export function edgesSvg(board: Board): string {
  if (!board.edges.length) return '';
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const paths: string[] = [];
  let label = '';

  for (const edge of board.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const a = edgePoint(from.rect, to.rect);
    const b = edgePoint(to.rect, from.rect);
    paths.push(
      `<line class="bx-edge" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(
        1,
      )}" y2="${b.y.toFixed(1)}"${edge.dashed ? ' stroke-dasharray="14 12"' : ''}${
        edge.arrow ? ' marker-end="url(#bx-arrow)"' : ''
      } />`,
    );
    if (edge.label) {
      label += `<text class="bx-edge-label" x="${((a.x + b.x) / 2).toFixed(1)}" y="${(
        (a.y + b.y) / 2 -
        10
      ).toFixed(1)}" text-anchor="middle">${escapeHtml(edge.label)}</text>`;
    }
  }

  if (!paths.length) return '';
  return `<svg class="bx-edges" width="1" height="1" style="z-index:1"><defs><marker id="bx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor" /></marker></defs><g style="color:var(--bx-ink-faint)">${paths.join(
    '',
  )}${label}</g></svg>`;
}

/** Where a card sits and how it is turned, as an inline style string. */
export function cardTransform(card: Card): string {
  return `left:${card.rect.x}px;top:${card.rect.y}px;width:${card.rect.w}px;height:${card.rect.h}px;${
    card.rotation ? `transform:rotate(${card.rotation}deg);` : ''
  }z-index:${Math.round(card.z)}`;
}

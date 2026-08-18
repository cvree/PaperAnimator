import type { Layer } from '@/core/types';
import type { FrameState, ResolvedLayer } from '@/render/resolveFrame';
import type { ResolvedMask, RevealUnit } from '@/render/motion';
import { STYLES, type TypeSpec, type VisualStyle } from '@/render/styles';

/**
 * The canvas painter.
 *
 * It consumes the same FrameState the editor draws, so content, layout and
 * timing cannot diverge between what you watched and what you exported — the
 * frame function is shared, only the rasteriser differs.
 */

export interface PaintOptions {
  width: number;
  height: number;
  captions: boolean;
  /** Decoded images keyed by their source URL. */
  images: Map<string, CanvasImageSource>;
}

export function paintFrame(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  styleId: keyof typeof STYLES,
  options: PaintOptions,
): void {
  const style = STYLES[styleId];
  const { width: W, height: H } = options;

  ctx.save();
  ctx.fillStyle = style.tokens.ground;
  ctx.fillRect(0, 0, W, H);

  for (const rl of frame.layers) {
    paintLayer(ctx, rl, style, options);
  }

  if (options.captions && frame.caption) {
    paintCaption(ctx, frame.caption.text, style, options);
  }

  ctx.restore();
}

function paintLayer(
  ctx: CanvasRenderingContext2D,
  rl: ResolvedLayer,
  style: VisualStyle,
  o: PaintOptions,
): void {
  const { layer } = rl;
  if (rl.opacity <= 0.005) return;

  const x = layer.frame.x * o.width + rl.tx * o.height;
  const y = layer.frame.y * o.height + rl.ty * o.height;
  const w = layer.frame.w * o.width;
  const h = layer.frame.h * o.height;

  ctx.save();
  ctx.globalAlpha = rl.opacity;

  // The clip is applied before the transform, exactly as clip-path is in the
  // browser: the mask belongs to the layer's box, not to the moved image of it.
  if (rl.mask) {
    tracePath(ctx, rl.mask, x, y, w, h);
    ctx.clip();
  }

  const rotation = layer.rotation + rl.rotate;
  if (rl.scale !== 1 || rotation) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(rl.scale, rl.scale);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  const blurPx = rl.blur * o.height;
  if (blurPx > 0.05) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;

  switch (layer.type) {
    case 'text':
      paintText(ctx, rl, style, o, x, y, w);
      break;
    case 'stat':
      paintStat(ctx, rl, style, o, x, y, w);
      break;
    case 'figure':
    case 'table':
      paintImageBox(ctx, layer, rl.imageMotion, style, o, x, y, w, h);
      break;
    case 'quote':
      paintQuote(ctx, layer, style, o, x, y, w);
      break;
    case 'rule':
      ctx.fillStyle = style.tokens.rule;
      ctx.fillRect(x, y, w, Math.max(1, layer.weight));
      break;
    case 'citation':
      applyFont(ctx, style.type.label, o.height);
      ctx.fillStyle = style.tokens.inkFaint;
      ctx.fillText(transformText(layer.text, style.type.label), x, y + h);
      break;
  }

  ctx.restore();
}

/**
 * The same shape SceneSurface hands to clip-path, as a canvas path. The circle
 * radius is measured against the box's half-diagonal in both places, so a full
 * iris uncovers the last corner at the same instant on screen and on export.
 */
function tracePath(
  ctx: CanvasRenderingContext2D,
  mask: ResolvedMask,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  if (mask.kind === 'inset') {
    ctx.rect(
      x + mask.left * w,
      y + mask.top * h,
      w * (1 - mask.left - mask.right),
      h * (1 - mask.top - mask.bottom),
    );
    return;
  }
  if (mask.kind === 'circle') {
    const half = Math.hypot(w, h) / 2;
    ctx.arc(x + mask.cx * w, y + mask.cy * h, Math.max(0, mask.r * half), 0, Math.PI * 2);
    return;
  }
  mask.points.forEach(([px, py], i) => {
    const cx = x + px * w;
    const cy = y + py * h;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.closePath();
}

/* ============================================================================
   Text, with the marker
   ========================================================================== */

function paintText(
  ctx: CanvasRenderingContext2D,
  rl: ResolvedLayer,
  style: VisualStyle,
  o: PaintOptions,
  x: number,
  y: number,
  w: number,
): void {
  const layer = rl.layer as Extract<Layer, { type: 'text' }>;
  const spec = style.type[layer.role];
  const color =
    layer.role === 'label' || layer.role === 'caption' ? style.tokens.inkSoft : style.tokens.ink;

  const raw = layer.atoms.map((a) => a.text).join(' ');
  const text = transformText(raw, spec);
  applyFont(ctx, spec, o.height, rl.trackingEm);

  const fontPx = spec.size * o.height;
  const lineHeight = fontPx * spec.leading;
  const lines = wrapWords(ctx, text, w);
  const sweep = rl.highlights.find((h) => h.treatment === 'sweep');

  let wordIndex = 0;
  let charIndex = 0;
  let lineY = y + fontPx * 0.82;

  for (const line of lines) {
    let cursorX = x;
    if (layer.align === 'center') cursorX = x + (w - ctx.measureText(line.text).width) / 2;
    if (layer.align === 'end') cursorX = x + w - ctx.measureText(line.text).width;

    // The marker goes down first, so the text sits on top of it. It is one
    // continuous stroke per line: a rectangle per word leaves a pale gap at
    // every space, which reads as a printing fault rather than a highlighter.
    if (sweep) {
      const spaceW = ctx.measureText(' ').width;
      let runStart: number | null = null;
      let runEnd = 0;
      let cx = cursorX;

      for (let k = 0; k < line.words.length; k++) {
        const wordW = ctx.measureText(line.words[k]).width;
        const covered = sweep.to - (wordIndex + k);
        if (wordIndex + k >= sweep.from && covered > 0) {
          if (runStart === null) runStart = cx;
          runEnd = cx + wordW * Math.min(1, covered);
        }
        cx += wordW + spaceW;
      }

      if (runStart !== null) {
        const pad = fontPx * 0.1;
        ctx.fillStyle = style.tokens.marker;
        ctx.fillRect(runStart - pad, lineY - fontPx * 0.78, runEnd - runStart + pad * 2, fontPx * 1.06);
      }
    }

    ctx.fillStyle = color;

    if (rl.reveal) {
      // Staggered text is set one unit at a time so each can carry its own
      // offset. The advances come from the same measurement the whole line
      // would have used, so the words land exactly where the line put them.
      const spaceW = ctx.measureText(' ').width;
      let cx = cursorX;
      for (let k = 0; k < line.words.length; k++) {
        const word = line.words[k];
        const wordW = ctx.measureText(word).width;
        if (rl.reveal.unit === 'word') {
          paintUnit(ctx, word, cx, lineY, fontPx, rl.reveal.units[wordIndex + k]);
        } else {
          let chX = cx;
          for (let j = 0; j < word.length; j++) {
            const ch = word[j];
            paintUnit(ctx, ch, chX, lineY, fontPx, rl.reveal.units[charIndex + j]);
            chX += ctx.measureText(ch).width;
          }
          charIndex += word.length + 1;
        }
        cx += wordW + spaceW;
      }
    } else {
      ctx.fillText(line.text, cursorX, lineY);
    }

    wordIndex += line.words.length;
    lineY += lineHeight;
  }
}

/** One word or one letter, moved by its own share of the entrance. */
function paintUnit(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  fontPx: number,
  unit: RevealUnit | undefined,
): void {
  if (!unit) {
    ctx.fillText(text, x, baseline);
    return;
  }
  if (unit.opacity <= 0.004) return;

  const alpha = ctx.globalAlpha;
  const filter = ctx.filter;
  ctx.save();
  ctx.globalAlpha = alpha * Math.min(1, unit.opacity);

  const blurPx = unit.blur * fontPx;
  if (blurPx > 0.05) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;

  const w = ctx.measureText(text).width;
  const cx = x + w / 2;
  const cy = baseline - fontPx * 0.32;
  ctx.translate(unit.tx * fontPx, unit.ty * fontPx);
  ctx.translate(cx, cy);
  ctx.scale(unit.scale, unit.scale);
  if (unit.rotate) ctx.rotate((unit.rotate * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  ctx.fillText(text, x, baseline);
  ctx.restore();
  ctx.globalAlpha = alpha;
  ctx.filter = filter;
}

interface WrappedLine {
  text: string;
  words: string[];
}

function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): WrappedLine[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: WrappedLine[] = [];
  let current: string[] = [];

  for (const word of words) {
    const candidate = [...current, word].join(' ');
    if (current.length > 0 && ctx.measureText(candidate).width > maxWidth) {
      lines.push({ text: current.join(' '), words: current });
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) lines.push({ text: current.join(' '), words: current });
  return lines;
}

/* ============================================================================
   Statistic
   ========================================================================== */

function paintStat(
  ctx: CanvasRenderingContext2D,
  rl: ResolvedLayer,
  style: VisualStyle,
  o: PaintOptions,
  x: number,
  y: number,
  w: number,
): void {
  const layer = rl.layer as Extract<Layer, { type: 'stat' }>;
  const display = layer.countUp ? countUp(layer.display, rl.progress) : layer.display;

  const size = o.height * 0.175;
  ctx.font = `500 ${size}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${((-0.045 + rl.trackingEm) * size).toFixed(3)}px`;
  }
  ctx.fillStyle = style.tokens.ink;
  ctx.fillText(display, x, y + size * 0.86);

  let cursorY = y + size * 1.06;

  if (layer.showQualifiers && layer.qualifiers.length) {
    applyFont(ctx, style.type.caption, o.height);
    ctx.fillStyle = style.tokens.inkSoft;
    const text = layer.qualifiers.join('   ');
    cursorY += style.type.caption.size * o.height;
    ctx.fillText(text, x, cursorY);
  }

  if (layer.caption) {
    applyFont(ctx, style.type.body, o.height);
    ctx.fillStyle = style.tokens.inkSoft;
    const lineHeight = style.type.body.size * o.height * style.type.body.leading;
    cursorY += lineHeight * 0.9;
    for (const line of wrapWords(ctx, layer.caption, w * 0.76)) {
      cursorY += lineHeight;
      ctx.fillText(line.text, x, cursorY);
    }
  }
}

function countUp(display: string, progress: number): string {
  if (progress >= 1) return display;
  const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(display);
  if (!m) return display;
  const [, prefix, num, suffix] = m;
  const target = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(target)) return display;
  const decimals = num.includes('.') ? num.split('.')[1].length : 0;
  return `${prefix}${(target * progress).toFixed(decimals)}${suffix}`;
}

/* ============================================================================
   Images
   ========================================================================== */

function paintImageBox(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { type: 'figure' | 'table' }>,
  motion: ResolvedLayer['imageMotion'],
  style: VisualStyle,
  o: PaintOptions,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (style.figure.border) {
    ctx.fillStyle = style.tokens.figureFrame;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = style.tokens.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  const src = layer.src;
  if (!src) return;
  const img = o.images.get(src);
  if (!img) return;

  const pad = style.figure.pad * o.height;
  const boxW = w - pad * 2;
  const boxH = h - pad * 2;
  const iw = imageWidth(img);
  const ih = imageHeight(img);
  if (!iw || !ih) return;

  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;

  // Sustained motion moves the picture within its frame, so the frame is
  // clipped first — a slow zoom must not spill over the crop it was composed to.
  ctx.save();
  if (motion) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(motion.tx * w, motion.ty * h);
    ctx.translate(cx, cy);
    ctx.scale(motion.scale, motion.scale);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(img, x + pad + (boxW - dw) / 2, y + pad + (boxH - dh) / 2, dw, dh);
  ctx.restore();
}

function imageWidth(img: CanvasImageSource): number {
  return (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width ?? 0;
}
function imageHeight(img: CanvasImageSource): number {
  return (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height ?? 0;
}

function paintQuote(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { type: 'quote' }>,
  style: VisualStyle,
  o: PaintOptions,
  x: number,
  y: number,
  w: number,
): void {
  const spec = style.type.quote;
  applyFont(ctx, spec, o.height);
  ctx.fillStyle = style.tokens.ink;
  const lineHeight = spec.size * o.height * spec.leading;
  let lineY = y + spec.size * o.height * 0.82;
  for (const line of wrapWords(ctx, `“${layer.text}”`, w)) {
    ctx.fillText(line.text, x, lineY);
    lineY += lineHeight;
  }
  if (layer.attribution) {
    applyFont(ctx, style.type.label, o.height);
    ctx.fillStyle = style.tokens.inkFaint;
    ctx.fillText(transformText(layer.attribution, style.type.label), x, lineY + lineHeight * 0.4);
  }
}

/* ============================================================================
   Captions
   ========================================================================== */

function paintCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: VisualStyle,
  o: PaintOptions,
): void {
  const size = o.height * 0.035;
  ctx.font = `450 ${size}px "Inter Variable", Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';

  const maxWidth = o.width * 0.8;
  const lines = wrapWords(ctx, text, maxWidth).slice(-2);
  const lineHeight = size * 1.35;
  const boxH = lines.length * lineHeight + size * 0.7;
  const boxY = o.height - boxH - o.height * 0.05;

  const widest = Math.max(...lines.map((l) => ctx.measureText(l.text).width));
  const boxW = widest + size * 1.4;
  const boxX = (o.width - boxW) / 2;

  const dark = style.id === 'signal' || style.id === 'chalk';
  ctx.fillStyle = dark ? 'rgba(8,10,12,0.74)' : 'rgba(255,255,255,0.88)';
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = dark ? '#f2f4f6' : '#16181b';
  lines.forEach((line, i) => {
    const lw = ctx.measureText(line.text).width;
    ctx.fillText(line.text, (o.width - lw) / 2, boxY + size * 0.95 + i * lineHeight);
  });
}

/* ============================================================================
   Type helpers
   ========================================================================== */

function applyFont(
  ctx: CanvasRenderingContext2D,
  spec: TypeSpec,
  height: number,
  extraEm = 0,
): void {
  const style = spec.italic ? 'italic ' : '';
  const size = spec.size * height;
  ctx.font = `${style}${spec.weight} ${size}px ${spec.family}`;
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) {
    // Canvas takes a length, not an em value, so the entrance's extra tracking
    // is converted against this layer's own type size — the same em the browser
    // would have resolved it against.
    const baseEm = Number(/^(-?[\d.]+)em$/.exec(spec.tracking.trim())?.[1] ?? 0);
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${((baseEm + extraEm) * size).toFixed(3)}px`;
  }
}

function transformText(text: string, spec: TypeSpec): string {
  return spec.transform === 'uppercase' ? text.toUpperCase() : text;
}

/** Decode every image a project references, once, before painting. */
export async function loadImages(urls: (string | null)[]): Promise<Map<string, CanvasImageSource>> {
  const map = new Map<string, CanvasImageSource>();
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  await Promise.all(
    unique.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            map.set(url, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  );
  return map;
}

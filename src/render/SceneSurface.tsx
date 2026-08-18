import { memo, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Layer, StyleId } from '@/core/types';
import type { FrameState, ResolvedHighlight, ResolvedLayer } from './resolveFrame';
import type { ResolvedMask, RevealUnit } from './motion';
import { STYLES, type TypeSpec, type VisualStyle } from './styles';

/**
 * The scene surface draws a FrameState. It is the only place scene content is
 * rendered, so the editor, the static previews and the exporter cannot diverge.
 *
 * Nothing here animates on its own: every animated value arrives from
 * resolveFrame. There are no CSS transitions inside this subtree.
 */

interface Props {
  frame: FrameState;
  styleId: StyleId;
  width: number;
  height: number;
  /** Editor affordances — off for previews and exports. */
  interactive?: boolean;
  selectedLayerIds?: string[];
  onSelectLayer?: (id: string, additive: boolean) => void;
  showReviewChips?: boolean;
}

export const SceneSurface = memo(function SceneSurface({
  frame,
  styleId,
  width,
  height,
  interactive = false,
  selectedLayerIds = [],
  onSelectLayer,
  showReviewChips = true,
}: Props) {
  const style = STYLES[styleId];

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width,
        height,
        background: style.tokens.ground,
        color: style.tokens.ink,
      }}
    >
      <GrainOverlay opacity={style.tokens.grain} dark={isDark(style)} />

      {frame.layers.map((rl) => (
        <LayerView
          key={rl.id}
          rl={rl}
          style={style}
          width={width}
          height={height}
          interactive={interactive}
          selected={selectedLayerIds.includes(rl.id)}
          onSelect={onSelectLayer}
          showReviewChips={showReviewChips}
        />
      ))}
    </div>
  );
});

function GrainOverlay({ opacity, dark }: { opacity: number; dark: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        opacity,
        mixBlendMode: dark ? 'screen' : 'multiply',
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")",
        backgroundSize: '180px 180px',
      }}
    />
  );
}

function isDark(style: VisualStyle): boolean {
  return style.id === 'signal' || style.id === 'chalk';
}

/**
 * A resolved mask as a clip-path. The circle radius is given against the box's
 * half-diagonal, which CSS spells as a percentage of sqrt((w²+h²)/2) — hence
 * the √2/2. Both renderers therefore uncover the same pixels.
 */
export function cssMask(mask: ResolvedMask | null): string | undefined {
  if (!mask) return undefined;
  if (mask.kind === 'inset') {
    return `inset(${pc(mask.top)} ${pc(mask.right)} ${pc(mask.bottom)} ${pc(mask.left)})`;
  }
  if (mask.kind === 'circle') {
    return `circle(${(mask.r * 70.7107).toFixed(3)}% at ${pc(mask.cx)} ${pc(mask.cy)})`;
  }
  return `polygon(${mask.points.map(([x, y]) => `${pc(x)} ${pc(y)}`).join(', ')})`;
}

function pc(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}

/* ============================================================================
   Layer
   ========================================================================== */

function LayerView({
  rl,
  style,
  width,
  height,
  interactive,
  selected,
  onSelect,
  showReviewChips,
}: {
  rl: ResolvedLayer;
  style: VisualStyle;
  width: number;
  height: number;
  interactive: boolean;
  selected: boolean;
  onSelect?: (id: string, additive: boolean) => void;
  showReviewChips: boolean;
}) {
  const { layer } = rl;
  const blurPx = rl.blur * height;
  const box: CSSProperties = {
    position: 'absolute',
    left: layer.frame.x * width,
    top: layer.frame.y * height + rl.ty * height,
    width: layer.frame.w * width,
    height: layer.frame.h * height,
    opacity: rl.opacity,
    transform: `translate3d(${rl.tx * height}px,0,0) scale(${rl.scale}) rotate(${layer.rotation + rl.rotate}deg)`,
    transformOrigin: 'center',
    filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
    clipPath: cssMask(rl.mask),
    willChange: 'transform, opacity',
  };

  const content = renderContent(rl, style, width, height);

  return (
    <div
      style={box}
      /* Only the editable canvas claims the id. Every rail thumbnail renders the
         same layers, and a thread that measured a thumbnail would point at the
         wrong end of the room. */
      data-layer-id={interactive ? layer.id : undefined}
      onPointerDown={
        interactive && onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect(layer.id, e.shiftKey);
            }
          : undefined
      }
    >
      {content}

      {interactive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[3px] rounded-[2px]"
          style={{
            outline: selected ? `1.5px solid ${style.tokens.accent}` : 'none',
            outlineOffset: 0,
          }}
        />
      )}

      {showReviewChips && rl.needsReview && (
        <div
          className="pointer-events-none absolute -right-1 -top-2 flex items-center gap-1 rounded-[2px] px-1.5 py-0.5"
          style={{
            background: 'var(--ev-unsupported)',
            color: '#fff',
            fontSize: Math.max(8, height * 0.017),
            fontFamily: 'Inter Variable, Inter, sans-serif',
            fontWeight: 560,
            letterSpacing: '0.06em',
          }}
        >
          △ NEEDS REVIEW
        </div>
      )}
    </div>
  );
}

function renderContent(
  rl: ResolvedLayer,
  style: VisualStyle,
  width: number,
  height: number,
) {
  const { layer } = rl;
  switch (layer.type) {
    case 'text':
      return <TextContent rl={rl} style={style} height={height} />;
    case 'stat':
      return <StatContent rl={rl} style={style} height={height} />;
    case 'figure':
      return <FigureContent layer={layer} style={style} height={height} motion={rl.imageMotion} />;
    case 'table':
      return (
        <TableContent
          layer={layer}
          style={style}
          height={height}
          width={width}
          motion={rl.imageMotion}
        />
      );
    case 'quote':
      return <QuoteContent layer={layer} style={style} height={height} />;
    case 'rule':
      return (
        <div
          style={{
            width: '100%',
            height: Math.max(1, layer.weight),
            background: style.tokens.rule,
          }}
        />
      );
    case 'citation':
      return (
        <div
          style={{
            ...typeStyle(style.type.label, height, style.tokens.inkFaint),
            display: 'flex',
            alignItems: 'flex-end',
            height: '100%',
          }}
        >
          {layer.text}
        </div>
      );
    default:
      return null;
  }
}

/* ============================================================================
   Text: a marker that follows the voice, over words that arrive one at a time
   ========================================================================== */

function TextContent({
  rl,
  style,
  height,
}: {
  rl: ResolvedLayer;
  style: VisualStyle;
  height: number;
}) {
  const layer = rl.layer as Extract<Layer, { type: 'text' }>;
  const spec = style.type[layer.role];
  const color =
    layer.role === 'label' || layer.role === 'caption' ? style.tokens.inkSoft : style.tokens.ink;

  const words = useMemo(
    () =>
      layer.atoms
        .map((a) => a.text)
        .join(' ')
        .split(/\s+/)
        .filter(Boolean),
    [layer.atoms],
  );

  const sweep = rl.highlights.find((h) => h.treatment === 'sweep');
  const underline = rl.highlights.find((h) => h.treatment === 'underline');
  const fontPx = spec.size * height;

  // Character reveals index across the same joined string resolveFrame counted,
  // so the offset of a word is the length of everything before it plus a space.
  let charCursor = 0;
  const charStarts = words.map((w) => {
    const at = charCursor;
    charCursor += w.length + 1;
    return at;
  });

  return (
    <div
      style={{
        ...typeStyle(spec, height, color),
        letterSpacing: trackingWithExtra(spec.tracking, rl.trackingEm),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems:
          layer.align === 'center' ? 'center' : layer.align === 'end' ? 'flex-end' : 'flex-start',
        textAlign: layer.align === 'center' ? 'center' : layer.align === 'end' ? 'right' : 'left',
        height: '100%',
        // Text is measured before it is set, but a line can still wrap one word
        // differently at preview size than at export size. Letting the block
        // spill by that one line is far better than slicing a sentence in half.
        overflow: 'visible',
      }}
    >
      <p style={{ margin: 0, textWrap: 'pretty' as never }}>
        {words.map((word, i) => (
          <Word
            key={i}
            text={word}
            index={i}
            unit={rl.reveal?.unit === 'word' ? rl.reveal.units[i] : undefined}
            chars={
              rl.reveal?.unit === 'char'
                ? rl.reveal.units.slice(charStarts[i], charStarts[i] + word.length)
                : undefined
            }
            sweep={sweep}
            underline={underline}
            style={style}
            spec={spec}
            height={height}
            fontPx={fontPx}
          />
        ))}
      </p>
    </div>
  );
}

/** A per-unit transform, in em, as a style. Identical maths in the painter. */
function unitStyle(unit: RevealUnit | undefined, fontPx: number): CSSProperties {
  if (!unit) return {};
  const blurPx = unit.blur * fontPx;
  return {
    display: 'inline-block',
    opacity: unit.opacity,
    transform:
      `translate3d(${(unit.tx * fontPx).toFixed(2)}px,${(unit.ty * fontPx).toFixed(2)}px,0)` +
      ` scale(${unit.scale.toFixed(4)}) rotate(${unit.rotate.toFixed(2)}deg)`,
    filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
    willChange: 'transform, opacity',
  };
}

function Word({
  text,
  index,
  unit,
  chars,
  sweep,
  underline,
  style,
  spec,
  height,
  fontPx,
}: {
  text: string;
  index: number;
  unit?: RevealUnit;
  chars?: RevealUnit[];
  sweep?: ResolvedHighlight;
  underline?: ResolvedHighlight;
  style: VisualStyle;
  spec: TypeSpec;
  height: number;
  fontPx: number;
}) {
  let sweepPct = 0;
  if (sweep && index >= sweep.from) {
    const covered = sweep.to - index;
    sweepPct = covered >= 1 ? 100 : covered <= 0 ? 0 : covered * 100;
  }

  let underlinePct = 0;
  if (underline && index >= underline.from) {
    const covered = underline.to - index;
    underlinePct = covered >= 1 ? 100 : covered <= 0 ? 0 : covered * 100;
  }

  const pad = spec.size * height * 0.1;

  const body = chars
    ? text.split('').map((ch, j) => (
        <span key={j} style={unitStyle(chars[j], fontPx)}>
          {ch}
        </span>
      ))
    : text;

  // Letters set as separate inline-blocks are separate break opportunities, so
  // without this a word could split down the middle mid-entrance.
  const noBreak = chars ? { whiteSpace: 'nowrap' as const } : null;

  return (
    <>
      <span
        style={{
          position: 'relative',
          display: unit || chars ? 'inline-block' : 'inline',
          ...(unit ? unitStyle(unit, fontPx) : null),
          ...noBreak,
          backgroundImage:
            sweepPct > 0
              ? `linear-gradient(${style.tokens.marker}, ${style.tokens.marker})`
              : undefined,
          backgroundSize: sweepPct > 0 ? `${sweepPct}% 100%` : undefined,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'left center',
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
          paddingLeft: sweepPct > 0 ? pad : 0,
          paddingRight: sweepPct > 0 ? pad : 0,
          marginLeft: sweepPct > 0 ? -pad : 0,
          marginRight: sweepPct > 0 ? -pad : 0,
          borderBottom:
            underlinePct > 0
              ? `${Math.max(1, spec.size * height * 0.06)}px solid ${style.tokens.accent}`
              : undefined,
        }}
      >
        {body}
      </span>
      {/* The space carries the marker too, once the reading has passed it.
          Leaving it bare puts a pale nick between every word, which reads as a
          rendering fault rather than as one stroke of a highlighter. */}
      <span
        style={{
          backgroundImage:
            sweep && index >= sweep.from && sweep.to > index + 1
              ? `linear-gradient(${style.tokens.marker}, ${style.tokens.marker})`
              : undefined,
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }}
      >
        {' '}
      </span>
    </>
  );
}

/** Style tracking plus whatever the entrance is currently adding, both in em. */
function trackingWithExtra(base: string, extraEm: number): string {
  if (Math.abs(extraEm) < 0.0005) return base;
  const m = /^(-?[\d.]+)em$/.exec(base.trim());
  const baseEm = m ? Number(m[1]) : 0;
  return `${(baseEm + extraEm).toFixed(4)}em`;
}

/* ============================================================================
   Statistic
   ========================================================================== */

function StatContent({
  rl,
  style,
  height,
}: {
  rl: ResolvedLayer;
  style: VisualStyle;
  height: number;
}) {
  const layer = rl.layer as Extract<Layer, { type: 'stat' }>;
  const display = layer.countUp ? countUpText(layer.display, rl.progress) : layer.display;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div
        style={{
          fontFamily: 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace',
          fontSize: height * 0.175,
          lineHeight: 0.92,
          letterSpacing: trackingWithExtra('-0.045em', rl.trackingEm),
          fontWeight: 500,
          color: style.tokens.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </div>

      {layer.showQualifiers && layer.qualifiers.length > 0 && (
        <div
          style={{
            marginTop: height * 0.022,
            display: 'flex',
            gap: height * 0.024,
            flexWrap: 'wrap',
            ...typeStyle(style.type.caption, height, style.tokens.inkSoft),
          }}
        >
          {layer.qualifiers.map((q, i) => (
            <span key={i} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {q}
            </span>
          ))}
        </div>
      )}

      {layer.caption && (
        <div
          style={{
            marginTop: height * 0.03,
            maxWidth: '76%',
            ...typeStyle(style.type.body, height, style.tokens.inkSoft),
          }}
        >
          {layer.caption}
        </div>
      )}
    </div>
  );
}

/** Count up only the leading numeral, preserving units and symbols exactly. */
function countUpText(display: string, progress: number): string {
  if (progress >= 1) return display;
  const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(display);
  if (!m) return display;
  const [, prefix, num, suffix] = m;
  const target = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(target)) return display;
  const decimals = num.includes('.') ? num.split('.')[1].length : 0;
  const current = target * progress;
  return `${prefix}${current.toFixed(decimals)}${suffix}`;
}

/* ============================================================================
   Figure & table
   ========================================================================== */

/**
 * Sustained motion belongs to the picture, not to its frame: the crop stays
 * exactly where it was composed while the image creeps inside it. Offsets are
 * fractions of the frame, so a slow zoom travels the same distance at thumbnail
 * size and at 1080p.
 */
function imageTransform(motion: ResolvedLayer['imageMotion']): CSSProperties {
  if (!motion) return {};
  return {
    transform:
      `translate3d(${(motion.tx * 100).toFixed(3)}%,${(motion.ty * 100).toFixed(3)}%,0)` +
      ` scale(${motion.scale.toFixed(4)})`,
    transformOrigin: 'center',
    willChange: 'transform',
  };
}

function FigureContent({
  layer,
  style,
  height,
  motion,
}: {
  layer: Extract<Layer, { type: 'figure' }>;
  style: VisualStyle;
  height: number;
  motion: ResolvedLayer['imageMotion'];
}) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        background: style.figure.border ? style.tokens.figureFrame : 'transparent',
        border: style.figure.border ? `1px solid ${style.tokens.rule}` : 'none',
        borderRadius: style.figure.radius,
        padding: style.figure.pad * height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {layer.src ? (
        <img
          src={layer.src}
          alt={layer.altText ?? ''}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: layer.fit,
            mixBlendMode: isDark(style) ? 'normal' : 'multiply',
            ...imageTransform(motion),
          }}
          draggable={false}
        />
      ) : (
        <span style={typeStyle(style.type.caption, height, style.tokens.inkFaint)}>
          Image unavailable
        </span>
      )}
    </div>
  );
}

function TableContent({
  layer,
  style,
  height,
  width,
  motion,
}: {
  layer: Extract<Layer, { type: 'table' }>;
  style: VisualStyle;
  height: number;
  width: number;
  motion: ResolvedLayer['imageMotion'];
}) {
  if (layer.grid) {
    const cellSize = Math.min(height * 0.028, (width / Math.max(1, layer.grid.cells[0]?.length ?? 1)) * 0.11);
    return (
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'Inter Variable, Inter, sans-serif',
            fontSize: cellSize,
            color: style.tokens.ink,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <tbody>
            {layer.grid.cells.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    style={{
                      padding: `${cellSize * 0.5}px ${cellSize * 0.6}px`,
                      borderBottom:
                        r < layer.grid!.headerRows
                          ? `1px solid ${style.tokens.rule}`
                          : `1px solid ${style.tokens.rule}55`,
                      fontWeight: r < layer.grid!.headerRows ? 600 : 400,
                      color: r < layer.grid!.headerRows ? style.tokens.ink : style.tokens.inkSoft,
                      textAlign: c === 0 ? 'left' : 'right',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        background: style.tokens.figureFrame,
        border: `1px solid ${style.tokens.rule}`,
        borderRadius: style.figure.radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: style.figure.pad * height,
      }}
    >
      {layer.src ? (
        <img
          src={layer.src}
          alt={layer.altText ?? ''}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            ...imageTransform(motion),
          }}
          draggable={false}
        />
      ) : null}
    </div>
  );
}

function QuoteContent({
  layer,
  style,
  height,
}: {
  layer: Extract<Layer, { type: 'quote' }>;
  style: VisualStyle;
  height: number;
}) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <p style={{ margin: 0, ...typeStyle(style.type.quote, height, style.tokens.ink) }}>
        “{layer.text}”
      </p>
      {layer.attribution && (
        <p
          style={{
            margin: 0,
            marginTop: height * 0.028,
            ...typeStyle(style.type.label, height, style.tokens.inkFaint),
          }}
        >
          {layer.attribution}
        </p>
      )}
    </div>
  );
}

/* ============================================================================
   Type
   ========================================================================== */

export function typeStyle(spec: TypeSpec, height: number, color: string): CSSProperties {
  return {
    fontFamily: spec.family,
    fontWeight: spec.weight,
    fontSize: spec.size * height,
    lineHeight: spec.leading,
    letterSpacing: spec.tracking,
    textTransform: spec.transform,
    fontStyle: spec.italic ? 'italic' : 'normal',
    color,
  };
}

export type { TypeSpec };

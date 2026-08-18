import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp } from '@/state/store';
import { INSTRUMENTS, suggestFor, type Instrument } from './instruments';
import { coverage } from './pageText';
import { useApply } from './apply';
import { useReader } from './readerStore';
import { beginPassageDrag } from './useDragEngine';
import { Glyph } from './glyphs';
import { clip } from './pageText';
import { anchorRect, type Passage } from './selection';

/**
 * The bar that arrives on a highlight.
 *
 * It follows the mark as the page scrolls, because it belongs to the mark
 * rather than to the window. The leading button is whatever the passage most
 * wants to be — a number becomes a number, a phrase inside a sentence becomes a
 * spotlight — so the fast path is one click and the powerful path is one drag.
 */

interface Props {
  passage: Passage;
  onExpand: () => void;
  onShrink: () => void;
  onDismiss: () => void;
}

export function MarkerBar({ passage, onExpand, onShrink, onDismiss }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const { ctx, apply } = useApply();
  const keep = useReader((s) => s.keep);
  const tray = useReader((s) => s.tray);
  const dragging = useReader((s) => !!s.drag?.live);
  const scenes = useApp((s) => s.project?.scenes);
  const seekScene = useApp((s) => s.seekScene);

  /* Scenes this passage is already in, so the mark leads back to its work. */
  const used = useMemo(() => {
    if (!scenes) return [];
    return scenes
      .map((scene, i) => ({ scene, index: i + 1 }))
      .filter(({ scene }) =>
        scene.sourceRefs.some((ref) =>
          passage.spans.some(
            (span) =>
              span.page === ref.page &&
              ref.quads.some((q) => span.quads.some((s) => coverage(q, s) > 0.4)),
          ),
        ),
      )
      .slice(0, 3);
  }, [scenes, passage]);

  const place = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const rect = liveRect() ?? regionRect(passage) ?? passage.clientRect;
    if (!rect) return;
    const width = el.offsetWidth || 320;
    const height = el.offsetHeight || 34;
    const x = Math.min(
      Math.max(12 + width / 2, rect.x + rect.w / 2),
      window.innerWidth - width / 2 - 12,
    );
    // Above the mark when there is room below the reader's own toolbar.
    const above = rect.y - height - 10;
    const y = above > 96 ? above : Math.min(rect.y + rect.h + 10, window.innerHeight - height - 12);
    el.style.transform = `translate3d(${Math.round(x - width / 2)}px, ${Math.round(y)}px, 0)`;
    el.style.opacity = rect.y > window.innerHeight || rect.y + rect.h < 40 ? '0' : '1';
  }, [passage]);

  useLayoutEffect(place, [place]);

  useEffect(() => {
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [place]);

  if (!ctx) return null;

  const suggested = suggestFor(passage, ctx);
  const others = INSTRUMENTS.filter(
    (i) => i.id !== suggested.id && !i.blocked(passage, ctx) && i.group !== 'combine',
  ).slice(0, 5);
  const kept = tray.some((t) => t.id === passage.id);

  return (
    <div
      ref={host}
      role="toolbar"
      aria-label={`What to do with “${clip(passage.text, 40)}”`}
      data-coach="marker"
      className="fixed left-0 top-0 z-[70] flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--rule-strong)] bg-[var(--surface-raised)] p-1 motion-safe:animate-[chip-pop_160ms_var(--ease-out)]"
      style={{
        boxShadow: 'var(--shadow-float)',
        willChange: 'transform',
        visibility: dragging ? 'hidden' : 'visible',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* the passage itself, as something you can pick up */}
      <button
        type="button"
        aria-label="Drag this passage onto a tool or the storyboard"
        title="Drag onto a tool, a scene, or between scenes"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          beginPassageDrag(passage, e);
        }}
        className="flex h-7 w-5 cursor-grab items-center justify-center text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-primary)]"
        style={{ touchAction: 'none' }}
      >
        <svg width="9" height="15" viewBox="0 0 9 15" aria-hidden="true">
          <g fill="currentColor">
            {[2, 7, 12].map((y) => (
              <g key={y}>
                <circle cx="2" cy={y} r="1.2" />
                <circle cx="7" cy={y} r="1.2" />
              </g>
            ))}
          </g>
        </svg>
      </button>

      <Primary instrument={suggested} onClick={() => void apply(suggested, passage)} />

      {others.map((instrument) => (
        <IconButton
          key={instrument.id}
          label={`${instrument.label} (${instrument.key.toUpperCase()})`}
          onClick={() => void apply(instrument, passage)}
        >
          <Glyph id={instrument.id} size={15} />
        </IconButton>
      ))}

      {used.length > 0 && (
        <>
          <span className="mx-0.5 h-5 w-px bg-[var(--rule-hairline)]" />
          {used.map(({ scene, index }) => (
            <button
              key={scene.id}
              type="button"
              onClick={() => seekScene(scene.id)}
              title={`Already in scene ${index}: ${scene.title}`}
              aria-label={`Go to scene ${index}, ${scene.title}`}
              className="flex h-6 min-w-6 items-center justify-center rounded-[3px] px-1 text-[10px] font-semibold tabular-nums transition-transform hover:scale-110"
              style={{ background: 'var(--ev-extracted-bg)', color: 'var(--ev-extracted)' }}
            >
              {index}
            </button>
          ))}
        </>
      )}

      <span className="mx-0.5 h-5 w-px bg-[var(--rule-hairline)]" />

      <IconButton label="Widen the mark (⌥↑)" onClick={onExpand}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M7 2.4v9.2M4 5.4 7 2.4l3 3M4 8.6l3 3 3-3" />
        </svg>
      </IconButton>
      <IconButton label="Narrow the mark (⌥↓)" onClick={onShrink}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M4 3.2 7 6.2l3-3M4 10.8l3-3 3 3" />
        </svg>
      </IconButton>
      <IconButton
        label={kept ? 'Kept for a comparison (⇧K)' : 'Keep this passage (⇧K)'}
        onClick={() => keep(passage)}
        active={kept}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <path d="M3.6 2.2h6.8v9.6L7 9.2l-3.4 2.6z" fill={kept ? 'currentColor' : 'none'} />
        </svg>
      </IconButton>
      <IconButton label="Clear the mark (Esc)" onClick={onDismiss}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="m4 4 6 6M10 4l-6 6" />
        </svg>
      </IconButton>
    </div>
  );
}

function Primary({ instrument, onClick }: { instrument: Instrument; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={instrument.hint}
      className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-2xs font-medium transition-transform active:scale-[0.97]"
      style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
    >
      <Glyph id={instrument.id} size={14} />
      {instrument.label}
      <kbd className="rounded-[2px] bg-white/20 px-1 text-[9px] leading-[1.4]">
        {instrument.key.toUpperCase()}
      </kbd>
    </button>
  );
}

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] transition-colors hover:bg-[var(--surface-sunken)]"
      style={{ color: active ? 'var(--accent)' : 'var(--ink-tertiary)' }}
    >
      {children}
    </button>
  );
}

/** A dragged-out region is not a text selection, so it is measured from the page. */
function regionRect(passage: Passage): { x: number; y: number; w: number; h: number } | null {
  if (!passage.region) return null;
  const r = anchorRect({
    page: passage.region.page,
    quads: [passage.region.quad],
    text: passage.text,
  });
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

function liveRect(): { x: number; y: number; w: number; h: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

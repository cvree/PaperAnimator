import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  boardBounds,
  cameraFor,
  cardsInStop,
  rectContains,
  stopSteps,
} from './board';
import { cardHtml, edgesSvg, surfaceVars } from './paint';
import { useBoardUi } from './boardStore';
import type { Board, Card, Stop } from './types';

/**
 * Presenting.
 *
 * A slide here is a region of the board, not a copy of one, so the audience can
 * always see where the current point sits in the argument — the camera pulls
 * back over the whole board on the way between two distant stops, and pushing
 * Escape shows the lot at once. Nothing is ever hidden that you cannot get back
 * to by looking.
 */

export function Present({
  board,
  title,
  onExit,
}: {
  board: Board;
  title: string;
  /** Absent when the talk is being watched rather than rehearsed. */
  onExit?: () => void;
}) {
  const camera = useBoardUi((s) => s.camera);
  const viewport = useBoardUi((s) => s.viewport);
  const stopIndex = useBoardUi((s) => s.stopIndex);
  const step = useBoardUi((s) => s.step);

  const host = useRef<HTMLDivElement>(null);
  const [overview, setOverview] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [laserOn, setLaserOn] = useState(false);

  const stops = board.stops;
  const stop: Stop | null = stops[stopIndex] ?? null;
  const steps = stop ? stopSteps(board, stop) : 0;

  /* The talk being read is whatever was handed in, which is not always the
     project — a published link opens one that no project exists for. */
  const live = useRef(board);
  live.current = board;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => useBoardUi.getState().setViewport(el.clientWidth, el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- the camera follows the talk -------------------------------------- */
  useEffect(() => {
    if (viewport.w === 0) return;
    const ui = useBoardUi.getState();
    if (overview) {
      const bounds = boardBounds(board);
      if (bounds) ui.flyTo(cameraFor(bounds, viewport.w, viewport.h, 0.88), 620);
      return;
    }
    const target = board.stops[stopIndex];
    if (target) ui.flyTo(cameraFor(target.rect, viewport.w, viewport.h, 0.97), 780);
  }, [board, stopIndex, overview, viewport.w, viewport.h]);

  const go = useCallback(
    (delta: number) => {
      const ui = useBoardUi.getState();
      const current = live.current;
      const here = current.stops[ui.stopIndex];
      const total = here ? stopSteps(current, here) : 0;
      if (delta > 0) {
        if (ui.step < total) ui.goTo(ui.stopIndex, ui.step + 1);
        else if (ui.stopIndex < current.stops.length - 1) ui.goTo(ui.stopIndex + 1, 0);
      } else {
        if (ui.step > 0) ui.goTo(ui.stopIndex, ui.step - 1);
        else if (ui.stopIndex > 0) {
          const prev = current.stops[ui.stopIndex - 1];
          ui.goTo(ui.stopIndex - 1, prev ? stopSteps(current, prev) : 0);
        }
      }
      setOverview(false);
    },
    [],
  );

  /* ---- keys -------------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          go(1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          go(-1);
          break;
        case 'Escape':
          e.preventDefault();
          if (overview) setOverview(false);
          else onExit?.();
          break;
        case 'o':
        case 'O':
          setOverview((v) => !v);
          break;
        case 'b':
        case 'B':
          setBlackout((v) => !v);
          break;
        case 'n':
        case 'N':
          setNotesOpen((v) => !v);
          break;
        case 'l':
        case 'L':
          setLaserOn((v) => !v);
          break;
        case 'f':
        case 'F':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void host.current?.requestFullscreen?.();
          break;
        case 'Home':
          useBoardUi.getState().goTo(0, 0);
          break;
        case 'End':
          useBoardUi.getState().goTo(Math.max(0, stops.length - 1), 0);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onExit, overview, stops.length]);

  /* ---- a stop that runs itself ------------------------------------------- */
  useEffect(() => {
    if (!stop || !stop.autoAdvanceMs || overview) return;
    const timer = setTimeout(() => go(1), stop.autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [stop, step, overview, go]);

  const cards = useMemo(() => [...board.cards].sort((a, b) => a.z - b.z), [board]);

  const world: CSSProperties = {
    transform: `translate(${viewport.w / 2}px, ${viewport.h / 2}px) scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  };

  const inFocus = (card: Card): boolean => !stop || overview || rectContains(stop.rect, card.rect);

  /**
   * A card that waits for a click waits everywhere: showing it dimmed in the
   * background of the stop before its own would give away the line you were
   * about to deliver.
   */
  const visible = (card: Card): boolean =>
    overview || card.step === 0 || (inFocus(card) && card.step <= step);

  const onCard = (card: Card) => {
    if (!card.action) {
      go(1);
      return;
    }
    switch (card.action.kind) {
      case 'stop': {
        const target = card.action.stopId;
        const i = board.stops.findIndex((s) => s.id === target);
        if (i >= 0) {
          useBoardUi.getState().goTo(i, 0);
          setOverview(false);
        }
        break;
      }
      case 'zoom':
        useBoardUi
          .getState()
          .flyTo(cameraFor(card.rect, viewport.w, viewport.h, 0.85), 620);
        break;
      case 'link':
        if (card.action.href) window.open(card.action.href, '_blank', 'noopener');
        break;
    }
  };

  const total = stops.length;
  const notes = stop
    ? [stop.notes, ...cardsInStop(board, stop).filter((c) => c.note).map((c) => c.note)]
        .filter(Boolean)
        .join('\n\n')
    : '';

  return (
    <div
      ref={host}
      className="bx-root fixed inset-0 z-[60]"
      style={{ ...(surfaceVars(board.surface) as CSSProperties), cursor: laserOn ? 'none' : 'default' }}
      onPointerMove={(e) => {
        if (!laserOn) return;
        const rect = host.current?.getBoundingClientRect();
        if (rect) setLaser({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const id = target.closest('[data-card-id]')?.getAttribute('data-card-id');
        const card = id ? board.cards.find((c) => c.id === id) : null;
        if (card) onCard(card);
        else go(1);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        go(-1);
      }}
      role="application"
      aria-label={`Presenting: ${title}`}
    >
      <div className="bx-world" style={world}>
        <div
          className="pointer-events-none absolute left-0 top-0"
          style={{ opacity: overview ? 1 : 0.55 }}
          dangerouslySetInnerHTML={{ __html: edgesSvg(board) }}
        />
        {cards.map((card) => {
          const shown = visible(card);
          const focused = inFocus(card);
          return (
            <div
              key={card.id}
              data-card-id={card.id}
              className="bx-card bx-fade"
              style={{
                left: card.rect.x,
                top: card.rect.y,
                width: card.rect.w,
                height: card.rect.h,
                zIndex: Math.round(card.z),
                transform: `${card.rotation ? `rotate(${card.rotation}deg)` : ''} ${shown ? '' : 'translateY(24px)'}`.trim(),
                opacity: shown ? (focused ? 1 : 0.22) : 0,
                pointerEvents: shown && card.action ? 'auto' : 'none',
                cursor: card.action ? 'pointer' : undefined,
              }}
              dangerouslySetInnerHTML={{ __html: cardHtml(card, board.surface) }}
            />
          );
        })}
      </div>

      {blackout && <div className="absolute inset-0" style={{ background: '#000' }} />}

      {laserOn && laser && (
        <span
          className="pointer-events-none absolute"
          style={{
            left: laser.x - 9,
            top: laser.y - 9,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,64,64,0.95) 0%, rgba(255,64,64,0.35) 55%, transparent 70%)',
            boxShadow: '0 0 18px rgba(255,64,64,0.7)',
          }}
        />
      )}

      {/* ---------- chrome ---------- */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4"
        style={{ color: 'var(--bx-ink-soft)' }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <Chip onClick={() => go(-1)} label="Back">
            ‹
          </Chip>
          <Chip onClick={() => go(1)} label="Forward">
            ›
          </Chip>
          <span className="numeral px-1 text-xs tabular-nums">
            {total ? stopIndex + 1 : 0} / {total}
            {steps > 0 && ` · ${step}/${steps}`}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <Chip onClick={() => setOverview((v) => !v)} label="Overview (O)">
            ⊞
          </Chip>
          <Chip onClick={() => setLaserOn((v) => !v)} label="Pointer (L)" active={laserOn}>
            ◉
          </Chip>
          <Chip onClick={() => setNotesOpen((v) => !v)} label="Notes (N)" active={notesOpen}>
            ≡
          </Chip>
          {onExit && (
            <Chip onClick={onExit} label="Leave (Esc)">
              ✕
            </Chip>
          )}
        </div>
      </div>

      {total > 1 && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px]"
          style={{ background: 'color-mix(in oklch, var(--bx-ink) 12%, transparent)' }}
        >
          <div
            style={{
              height: '100%',
              width: `${((stopIndex + (steps ? step / (steps + 1) : 0) + 1) / total) * 100}%`,
              background: 'var(--bx-accent)',
              transition: 'width 420ms cubic-bezier(.2,.7,.2,1)',
            }}
          />
        </div>
      )}

      {notesOpen && (
        <aside
          className="absolute bottom-16 left-4 max-h-[40vh] w-[26rem] max-w-[80vw] overflow-y-auto rounded-[var(--radius-md)] p-4"
          style={{
            background: 'var(--bx-ground-edge)',
            color: 'var(--bx-ink)',
            border: '1px solid var(--bx-rule)',
            boxShadow: '0 20px 60px var(--bx-shadow)',
          }}
        >
          <p className="label mb-2" style={{ color: 'var(--bx-ink-faint)' }}>
            {stop?.title ?? 'Notes'}
          </p>
          <p className="whitespace-pre-wrap text-xs leading-[1.6]">
            {notes || 'No notes for this stop.'}
          </p>
        </aside>
      )}

      {stops.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
          <p className="max-w-[40ch] text-base leading-[1.6]" style={{ color: 'var(--bx-ink-soft)' }}>
            This board has no stops yet. Leave with Escape, draw a slide with <b>F</b> around the
            part you want to talk about, and the run will build itself in the order you draw them.
          </p>
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  label,
  active,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-sm transition-opacity"
      style={{
        background: active ? 'var(--bx-accent)' : 'color-mix(in oklch, var(--bx-ink) 8%, transparent)',
        color: active ? 'var(--bx-ground)' : 'var(--bx-ink-soft)',
      }}
    >
      {children}
    </button>
  );
}

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
import { cardBody, countFrame, countPlan, edgesSvg, motionOf, paletteOf, surfaceVars } from './paint';
import { createLive, type LiveLayer } from './live.js';
import { useBoardUi } from './boardStore';
import type { Board, Camera, Card, CardId, Stop } from './types';

/**
 * Presenting.
 *
 * A slide here is a region of the board, not a copy of one, so the audience can
 * always see where the current point sits in the argument — the camera pulls
 * back over the whole board on the way between two distant stops, and pushing
 * Escape shows the lot at once. Nothing is ever hidden that you cannot get back
 * to by looking.
 *
 * Everything a card does on arrival is CSS defined in `paint.ts`, which the
 * published page uses too: an entrance you liked in rehearsal is the entrance
 * the file you mail out performs.
 *
 * What you do to a slide while you are standing in front of it — ink, the
 * pointer, pushing in on a figure somebody asked about — is `live.js`, mounted
 * here and inlined into the published page, so the gestures are the same
 * wherever the talk is being given from.
 */

/** Long enough to read the controls, short enough to be gone from a recording. */
const CHROME_IDLE_MS = 2600;

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
  const [idle, setIdle] = useState(false);
  const liveLayer = useRef<LiveLayer | null>(null);
  /* Bumped by movement, throttled — the effect below reads it as "still here". */
  const [awake, setAwake] = useState(0);
  const lastWake = useRef(0);

  const stops = board.stops;
  const stop: Stop | null = stops[stopIndex] ?? null;
  const steps = stop ? stopSteps(board, stop) : 0;
  const motion = motionOf(board);
  /* The stylesheet already refuses to animate under this; the count-up is
     script rather than CSS, so it has to be told separately. */
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* ---- what you do to the slide while you are standing in front of it ---- */

  /* The camera the live layer puts back when you let go of a magnifier. */
  const framing = useRef<() => void>(() => {});
  framing.current = () => {
    const { viewport: v } = useBoardUi.getState();
    const target = board.stops[stopIndex];
    if (target && v.w) useBoardUi.getState().flyTo(cameraFor(target.rect, v.w, v.h, 0.97), 420);
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const layer = createLive({
      host: el,
      getCamera: () => useBoardUi.getState().camera,
      setCamera: (c: Camera) => useBoardUi.getState().setCamera(c),
      refit: () => framing.current(),
      dark: paletteOf(board.surface).dark,
      reduced,
    });
    liveLayer.current = layer;
    return () => {
      layer.destroy();
      liveLayer.current = null;
    };
    // The surface is the only thing here worth remounting for: it decides the
    // ink colours and how a highlighter blends with the board underneath it.
  }, [board.surface, reduced]);

  /* Ink belongs to the slide it was drawn on. */
  useEffect(() => {
    liveLayer.current?.slide(overview ? 'overview' : stopIndex);
  }, [stopIndex, overview]);

  /* Every stroke is held in world units, so a camera that moves has to
     re-project them — which is also what makes ink stick to a figure you then
     push in on. */
  useEffect(() => {
    liveLayer.current?.moved();
  }, [camera]);

  useEffect(() => {
    liveLayer.current?.chrome(!idle);
  }, [idle]);

  /* ---- the controls get out of the way ----------------------------------- */
  const wake = useCallback(() => {
    const now = performance.now();
    if (now - lastWake.current < 200) return;
    lastWake.current = now;
    setAwake((n) => n + 1);
  }, []);

  useEffect(() => {
    setIdle(false);
    const timer = setTimeout(() => setIdle(true), CHROME_IDLE_MS);
    return () => clearTimeout(timer);
  }, [awake]);

  const cards = useMemo(() => [...board.cards].sort((a, b) => a.z - b.z), [board]);
  const edges = useMemo(() => ({ __html: edgesSvg(board) }), [board]);

  /**
   * The order things arrive in, which is reading order within the click they
   * belong to — so a stop builds down the way a person's eye goes, and a card
   * that waits for a click still leads its own group.
   */
  const arrivalOrder = useMemo(() => {
    const order = new Map<CardId, number>();
    if (!stop) return order;
    const groups = new Map<number, Card[]>();
    for (const card of cardsInStop(board, stop)) {
      const list = groups.get(card.step) ?? [];
      list.push(card);
      groups.set(card.step, list);
    }
    for (const list of groups.values()) {
      list
        .slice()
        .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
        .forEach((card, i) => order.set(card.id, i));
    }
    return order;
  }, [board, stop]);

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
  const progress = total ? ((stopIndex + (steps ? step / (steps + 1) : 0) + 1) / total) * 100 : 0;
  const chromeShown = !idle || notesOpen;

  return (
    <div
      ref={host}
      className="bx-root fixed inset-0 z-[60]"
      data-present="1"
      data-motion={motion}
      style={{
        ...(surfaceVars(board.surface) as CSSProperties),
        cursor: idle ? 'none' : 'default',
      }}
      onPointerMove={wake}
      onClick={(e) => {
        if (liveLayer.current?.busy()) return;
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
        {/* In overview the frames are the map: without them the whole board is
            an undifferentiated field of cards. */}
        {overview &&
          stops.map((s, i) => (
            <div
              key={s.id}
              className="pointer-events-none absolute"
              style={{
                left: s.rect.x,
                top: s.rect.y,
                width: s.rect.w,
                height: s.rect.h,
                border: `${Math.max(2, 3 / camera.zoom)}px solid var(--bx-accent)`,
                borderRadius: 8 / camera.zoom,
                opacity: i === stopIndex ? 0.95 : 0.34,
                boxShadow: i === stopIndex ? `0 0 ${60 / camera.zoom}px var(--bx-glow)` : undefined,
                zIndex: 2,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: -30 / camera.zoom,
                  display: 'flex',
                  alignItems: 'center',
                  height: 26 / camera.zoom,
                  padding: `0 ${10 / camera.zoom}px`,
                  borderRadius: `${5 / camera.zoom}px`,
                  background: 'var(--bx-accent)',
                  color: 'var(--bx-accent-ink)',
                  font: `600 ${15 / camera.zoom}px/1 system-ui, sans-serif`,
                  whiteSpace: 'nowrap',
                }}
              >
                {i + 1}. {s.title}
              </span>
            </div>
          ))}

        <div
          className="pointer-events-none absolute left-0 top-0"
          style={{ opacity: overview ? 1 : 0.55 }}
          dangerouslySetInnerHTML={edges}
        />

        {cards.map((card) => (
          <PresentCard
            key={card.id}
            card={card}
            surface={board.surface}
            shown={visible(card)}
            focused={inFocus(card)}
            index={arrivalOrder.get(card.id) ?? 0}
            /* A new stop is a new arrival, so the entrances play again. */
            playKey={`${stopIndex}:${overview ? 'o' : 'p'}`}
            animate={motion !== 'none' && !reduced}
          />
        ))}
      </div>

      {/* ---------- the room ---------- */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          zIndex: 30,
          background: '#000',
          opacity: blackout ? 1 : 0,
          transition: 'opacity 240ms ease',
          visibility: blackout ? 'visible' : 'hidden',
        }}
      />

      {/* ---------- chrome ---------- */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4"
        style={{
          color: 'var(--bx-ink-soft)',
          zIndex: 20,
          opacity: chromeShown ? 1 : 0,
          transform: chromeShown ? 'none' : 'translateY(10px)',
          transition: 'opacity 320ms ease, transform 320ms ease',
        }}
      >
        <div
          className="pointer-events-auto flex items-center gap-1.5 rounded-full p-1.5"
          style={glass}
        >
          <Chip onClick={() => go(-1)} label="Back">
            ‹
          </Chip>
          <Chip onClick={() => go(1)} label="Forward">
            ›
          </Chip>
          <span className="numeral px-2 text-xs tabular-nums" style={{ color: 'var(--bx-ink-soft)' }}>
            {total ? stopIndex + 1 : 0} / {total}
            {steps > 0 && ` · ${step}/${steps}`}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full p-1.5" style={glass}>
          <Chip onClick={() => setOverview((v) => !v)} label="Overview (O)" active={overview}>
            ⊞
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

      {/* The stop's own name, where a title bar would be if this had one. */}
      {stop && !overview && (
        <div
          className="pointer-events-none absolute left-1/2 bottom-5 -translate-x-1/2 rounded-full px-4 py-1.5"
          style={{
            ...glass,
            zIndex: 20,
            opacity: chromeShown ? 1 : 0,
            transition: 'opacity 320ms ease',
            color: 'var(--bx-ink-soft)',
            font: '500 12px/1.2 system-ui, -apple-system, sans-serif',
            letterSpacing: '0.02em',
            maxWidth: '46vw',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {stop.title}
        </div>
      )}

      {total > 1 && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px]"
          style={{
            zIndex: 21,
            background: 'color-mix(in oklch, var(--bx-ink) 12%, transparent)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, var(--bx-accent), var(--bx-accent-alt))',
              boxShadow: '0 0 12px var(--bx-glow), 0 0 3px var(--bx-glow)',
              transition: 'width 480ms cubic-bezier(.2,.7,.2,1)',
            }}
          />
        </div>
      )}

      {notesOpen && (
        <aside
          className="absolute bottom-16 left-4 max-h-[40vh] w-[26rem] max-w-[80vw] overflow-y-auto rounded-[var(--radius-md)] p-4"
          style={{
            zIndex: 22,
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
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center" style={{ zIndex: 20 }}>
          <p className="max-w-[40ch] text-base leading-[1.6]" style={{ color: 'var(--bx-ink-soft)' }}>
            This board has no stops yet. Leave with Escape, draw a slide with <b>F</b> around the
            part you want to talk about, and the run will build itself in the order you draw them.
          </p>
        </div>
      )}
    </div>
  );
}

/** The frosted pill every control sits in, so chrome never fights the board. */
const glass: CSSProperties = {
  background: 'color-mix(in oklch, var(--bx-ground) 62%, transparent)',
  border: '1px solid color-mix(in oklch, var(--bx-ink) 10%, transparent)',
  backdropFilter: 'blur(18px) saturate(150%)',
  WebkitBackdropFilter: 'blur(18px) saturate(150%)',
  boxShadow: '0 2px 6px var(--bx-shadow), 0 18px 40px -20px var(--bx-shadow-deep)',
};

/**
 * One card, and the moment it arrives.
 *
 * The entrance is a CSS animation on an inner element, which means it has to be
 * restarted rather than re-declared when the same card arrives a second time —
 * going back a slide and forward again should look exactly like the first pass.
 */
function PresentCard({
  card,
  surface,
  shown,
  focused,
  index,
  playKey,
  animate,
}: {
  card: Card;
  surface: Board['surface'];
  shown: boolean;
  focused: boolean;
  index: number;
  playKey: string;
  animate: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  /**
   * The whole prop object is memoised, not just the string inside it.
   *
   * React compares `dangerouslySetInnerHTML` by object identity, so a fresh
   * `{ __html }` on every render rewrites the element's children even when the
   * markup is identical — which throws away the entrance animation mid-flight
   * and starts it again. A card would then never finish arriving on any screen
   * that re-renders per frame, which is exactly what pushing in on one does.
   */
  const body = useMemo(() => ({ __html: cardBody(card, surface) }), [card, surface]);

  useEffect(() => {
    if (!shown || !animate) return;
    const root = host.current;
    if (!root) return;
    const anim = root.querySelector<HTMLElement>('.bx-anim');
    if (!anim) return;

    const parts: { style: CSSStyleDeclaration }[] = [
      anim,
      ...Array.from(root.querySelectorAll<HTMLElement>('.bx-w')),
      ...Array.from(root.querySelectorAll<SVGPathElement>('.bx-ink path')),
    ];
    for (const part of parts) part.style.animation = 'none';
    // One forced reflow is what makes the browser agree the animation is new.
    void anim.offsetWidth;
    for (const part of parts) part.style.animation = '';

    if (card.kind !== 'stat') return;
    const plan = countPlan(card.value);
    const number = root.querySelector<HTMLElement>('.bx-num');
    if (!plan || !number) return;

    /* A statistic that lands on its figure is a slide; one that runs up to it
       is the reason the figure is on screen at that size. */
    const ms = 900;
    const delay = index * 74;
    let raf = 0;
    const start = performance.now() + delay;
    number.textContent = countFrame(plan, 0);
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - Math.pow(1 - t, 3);
      number.textContent = countFrame(plan, eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      number.textContent = card.value;
    };
  }, [shown, playKey, animate, card, index]);

  return (
    <div
      ref={host}
      data-card-id={card.id}
      className="bx-card bx-fade"
      data-focus={focused ? '1' : '0'}
      data-raised={card.raised ? '1' : undefined}
      style={
        {
          left: card.rect.x,
          top: card.rect.y,
          width: card.rect.w,
          height: card.rect.h,
          zIndex: Math.round(card.z),
          transform: card.rotation ? `rotate(${card.rotation}deg)` : undefined,
          opacity: shown ? (focused ? 1 : 0.22) : 0,
          pointerEvents: shown && card.action ? 'auto' : 'none',
          cursor: card.action ? 'pointer' : undefined,
          '--bx-i': index,
        } as CSSProperties
      }
      dangerouslySetInnerHTML={body}
    />
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
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full text-sm transition-all hover:scale-105"
      style={{
        background: active
          ? 'linear-gradient(140deg, var(--bx-accent), var(--bx-accent-alt))'
          : 'color-mix(in oklch, var(--bx-ink) 8%, transparent)',
        color: active ? 'var(--bx-accent-ink)' : 'var(--bx-ink-soft)',
        boxShadow: active ? '0 0 16px var(--bx-glow)' : undefined,
      }}
    >
      {children}
    </button>
  );
}

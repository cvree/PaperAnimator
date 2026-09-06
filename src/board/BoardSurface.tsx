import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useApp } from '@/state/store';
import { newId } from '@/core/id';
import {
  CARD_SIZE,
  boardBounds,
  cameraFor,
  cardsInStop,
  makeCard,
  makeStop,
  pickCard,
  rectsOverlap,
  screenToWorld,
  snap,
  stopAround,
  topZ,
  unionRect,
  zoomAt,
} from './board';
import { cardHtml, cardShellVars, edgesSvg, gridStyle, smoothStroke, surfaceVars, TEXT_ROLES } from './paint';
import {
  atmosphereHtml,
  depthFactor,
  depthShift,
  dragDivisor,
  drawnRect,
  effectDefsSvg,
  effectVars,
  effectsAreOff,
  focusBlur,
  normaliseEffects,
} from './effects';
import { alignDrag, type Guide } from './guides';
import { normaliseRect, useBoardUi, type Tool } from './boardStore';
import type {
  Board,
  Card,
  CardId,
  InkCard,
  Stop,
  StopId,
  WorldPoint,
  WorldRect,
} from './types';

/**
 * The board itself: a surface with no edges.
 *
 * Panning never runs out of board and zooming never runs out of room, because
 * there is no document underneath — only a coordinate system and a camera. The
 * grid coarsens as you pull back so a hundred metres of board still reads as a
 * surface rather than as grey noise.
 *
 * Three rules keep it feeling like one thing under your hand. Every gesture
 * that changes the project commits once, at the end — a drag that wrote to the
 * store on every frame would put four hundred entries in the undo stack and
 * recompute integrity four hundred times, so the drag is drawn from local state
 * and the project hears about it when you let go. Every gesture is read at most
 * once a frame, no matter how fast the pointer reports. And every gesture stops
 * where the eye expects rather than where the arithmetic lands: momentum after
 * a pan, alignment while you drag, and depth taken off the pointer before a
 * click is resolved, so a card at depth is grabbed where it is *drawn*.
 */

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

type Gesture =
  | { kind: 'pan'; x: number; y: number; t: number; vx: number; vy: number }
  | { kind: 'pinch'; distance: number; x: number; y: number }
  | { kind: 'marquee'; origin: WorldPoint; additive: boolean }
  | {
      kind: 'move';
      origin: WorldPoint;
      ids: CardId[];
      stopId: StopId | null;
      stopRect: WorldRect | null;
    }
  | {
      kind: 'resize';
      id: CardId;
      handle: Handle;
      start: WorldRect;
      startScale: number;
      startRotation: number;
      shift: { dx: number; dy: number };
    }
  | { kind: 'stop-draw'; origin: WorldPoint }
  | { kind: 'pen'; points: number[] }
  | null;

const SNAP_UNIT = 10;

/** How close, in screen pixels, an edge has to be before it counts as aligned. */
const GUIDE_REACH = 7;

export function BoardSurface() {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const focusSource = useApp((s) => s.focusSource);

  const camera = useBoardUi((s) => s.camera);
  const viewport = useBoardUi((s) => s.viewport);
  const tool = useBoardUi((s) => s.tool);
  const selection = useBoardUi((s) => s.selection);
  const selectedStopId = useBoardUi((s) => s.selectedStopId);
  const editingCardId = useBoardUi((s) => s.editingCardId);

  const host = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(null);
  const spaceHeld = useRef(false);
  /** Live pointers in client coordinates, so two fingers can be told from one. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [ghost, setGhost] = useState<{
    dx: number;
    dy: number;
    ids: CardId[];
    stopId: StopId | null;
  } | null>(null);
  const [override, setOverride] = useState<{
    id: CardId;
    rect: WorldRect;
    scale: number;
    rotation: number;
  } | null>(null);
  const [marquee, setMarqueeRect] = useState<WorldRect | null>(null);
  const [stopDraft, setStopDraft] = useState<WorldRect | null>(null);
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);

  const board = project?.board;
  const fx = useMemo(() => normaliseEffects(board?.effects), [board?.effects]);
  const plain = effectsAreOff(fx);

  /* ---- viewport size --------------------------------------------------- */
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () =>
      useBoardUi.getState().setViewport(el.clientWidth, el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Open on something rather than on nowhere. */
  const framedOnce = useRef(false);
  useEffect(() => {
    if (framedOnce.current || !board || viewport.w === 0) return;
    framedOnce.current = true;
    const bounds = board.stops[0]?.rect ?? boardBounds(board);
    if (bounds) useBoardUi.getState().setCamera(cameraFor(bounds, viewport.w, viewport.h));
  }, [board, viewport.w, viewport.h]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): WorldPoint => {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToWorld(
        { x: clientX - rect.left, y: clientY - rect.top },
        useBoardUi.getState().camera,
        rect.width,
        rect.height,
      );
    },
    [],
  );

  /* ---- wheel: pan by default, zoom with a modifier --------------------- */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ui = useBoardUi.getState();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // A trackpad pinch arrives here as a ctrl-wheel, which is why the two
        // gestures share a path. Both are eased rather than applied raw.
        ui.zoomTowards(
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          Math.exp(-e.deltaY * 0.0022),
        );
      } else {
        ui.stopMotion();
        ui.panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---- space to pan, like every canvas ever made ------------------------ */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* ---- project edits ---------------------------------------------------- */

  const editBoard = useCallback(
    (label: string, recipe: (b: Board) => void, coalesceKey?: string) => {
      mutate(label, (d) => recipe(d.board), coalesceKey);
    },
    [mutate],
  );

  const removeCards = useCallback(
    (ids: CardId[]) => {
      editBoard('Delete', (b) => {
        b.cards = b.cards.filter((c) => !ids.includes(c.id));
        b.edges = b.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to));
      });
      useBoardUi.getState().select([]);
    },
    [editBoard],
  );

  const removeStop = useCallback(
    (id: StopId) => {
      editBoard('Delete stop', (b) => {
        b.stops = b.stops.filter((s) => s.id !== id);
      });
      useBoardUi.getState().selectStop(null);
    },
    [editBoard],
  );

  const duplicate = useCallback(
    (ids: CardId[]) => {
      const made: CardId[] = [];
      editBoard('Duplicate', (b) => {
        let z = topZ(b);
        for (const id of ids) {
          const card = b.cards.find((c) => c.id === id);
          if (!card) continue;
          const copy: Card = {
            ...card,
            id: newId('card'),
            z: z++,
            rect: { ...card.rect, x: card.rect.x + 40, y: card.rect.y + 40 },
          };
          made.push(copy.id);
          b.cards.push(copy);
        }
      });
      useBoardUi.getState().select(made);
    },
    [editBoard],
  );

  const nudge = useCallback(
    (ids: CardId[], dx: number, dy: number) => {
      editBoard(
        'Move',
        (b) => {
          for (const card of b.cards) {
            if (!ids.includes(card.id) || card.locked) continue;
            card.rect.x += dx;
            card.rect.y += dy;
          }
        },
        `nudge:${ids.join(',')}`,
      );
    },
    [editBoard],
  );

  /* ---- keyboard ---------------------------------------------------------*/
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const ui = useBoardUi.getState();
      const app = useApp.getState();
      const current = app.project?.board;
      if (!current) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === '0') {
        e.preventDefault();
        const bounds = boardBounds(current);
        if (bounds) ui.flyTo(cameraFor(bounds, ui.viewport.w, ui.viewport.h));
        return;
      }
      /* ⌘2 goes to what you are working on, which is almost never the whole
         board — the one shortcut people reach for and rarely get. */
      if (meta && e.key === '2') {
        e.preventDefault();
        const rects = current.cards.filter((c) => ui.selection.includes(c.id)).map((c) => c.rect);
        const target =
          unionRect(rects) ??
          current.stops.find((s) => s.id === ui.selectedStopId)?.rect ??
          boardBounds(current);
        if (target) ui.flyTo(cameraFor(target, ui.viewport.w, ui.viewport.h, 0.86));
        return;
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        ui.select(current.cards.map((c) => c.id));
        return;
      }
      if (meta && e.key.toLowerCase() === 'd' && ui.selection.length) {
        e.preventDefault();
        duplicate(ui.selection);
        return;
      }
      if (meta) return;

      switch (e.key) {
        case 'Escape':
          ui.select([]);
          ui.selectStop(null);
          ui.edit(null);
          ui.setTool('select');
          break;
        case 'Backspace':
        case 'Delete':
          if (ui.selection.length) {
            e.preventDefault();
            removeCards(ui.selection);
          } else if (ui.selectedStopId) {
            e.preventDefault();
            removeStop(ui.selectedStopId);
          }
          break;
        case 'Enter':
          if (ui.selection.length === 1) {
            e.preventDefault();
            ui.edit(ui.selection[0]);
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!ui.selection.length) return;
          e.preventDefault();
          const step = e.shiftKey ? SNAP_UNIT * 10 : SNAP_UNIT;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          nudge(ui.selection, dx, dy);
          break;
        }
        default: {
          const shortcut = TOOL_KEYS[e.key.toLowerCase()];
          if (shortcut) {
            e.preventDefault();
            ui.setTool(shortcut);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicate, nudge, removeCards, removeStop]);

  /* ---- pointer ---------------------------------------------------------- */

  /**
   * Pointers report far faster than a screen refreshes, and every report used
   * to redraw every card on the board. The newest one is kept and read once a
   * frame instead; nothing is lost, because a gesture only ever cares about
   * where the pointer is *now*.
   */
  const pending = useRef<{ x: number; y: number; alt: boolean; shift: boolean } | null>(null);
  const frame = useRef(0);

  const readPending = useCallback(() => {
    frame.current = 0;
    const at = pending.current;
    pending.current = null;
    const g = gesture.current;
    const current = useApp.getState().project?.board;
    if (!at || !g || !current) return;
    const ui = useBoardUi.getState();
    const point = toWorld(at.x, at.y);

    switch (g.kind) {
      case 'pan': {
        const now = performance.now();
        const dt = Math.max(1, now - g.t);
        const dx = at.x - g.x;
        const dy = at.y - g.y;
        ui.panBy(dx, dy);
        // Velocity is smoothed, or one stuttering frame at the end of a long
        // drag would decide where the whole board flies to.
        gesture.current = {
          kind: 'pan',
          x: at.x,
          y: at.y,
          t: now,
          vx: g.vx * 0.32 + (dx / dt) * 0.68,
          vy: g.vy * 0.32 + (dy / dt) * 0.68,
        };
        break;
      }
      case 'pinch': {
        const two = [...pointers.current.values()];
        if (two.length < 2) break;
        const distance = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
        const cx = (two[0].x + two[1].x) / 2;
        const cy = (two[0].y + two[1].y) / 2;
        const rect = host.current?.getBoundingClientRect();
        if (rect && g.distance > 8 && distance > 8) {
          ui.panBy(cx - g.x, cy - g.y);
          ui.setCamera(
            zoomAt(
              useBoardUi.getState().camera,
              { x: cx - rect.left, y: cy - rect.top },
              distance / g.distance,
              rect.width,
              rect.height,
            ),
          );
        }
        gesture.current = { kind: 'pinch', distance, x: cx, y: cy };
        break;
      }
      case 'marquee':
        setMarqueeRect(normaliseRect(g.origin, point));
        break;
      case 'move': {
        const free = at.alt;
        const raw = { dx: point.x - g.origin.x, dy: point.y - g.origin.y };
        const aligned = free
          ? { ...raw, guides: [] as Guide[] }
          : alignDrag(
              current,
              g.ids,
              raw.dx,
              raw.dy,
              GUIDE_REACH / Math.max(0.0001, ui.camera.zoom),
              g.stopRect,
            );
        const onX = aligned.guides.some((line) => line.axis === 'x');
        const onY = aligned.guides.some((line) => line.axis === 'y');
        setGuides(aligned.guides);
        setGhost({
          // An edge that has found another edge is not then rounded off it.
          dx: onX ? aligned.dx : snap(aligned.dx, !free, SNAP_UNIT),
          dy: onY ? aligned.dy : snap(aligned.dy, !free, SNAP_UNIT),
          ids: g.ids,
          stopId: g.stopId,
        });
        break;
      }
      case 'resize': {
        const at3 = { x: point.x - g.shift.dx, y: point.y - g.shift.dy };
        const next = resizeRect(g.start, g.handle, at3, at.shift);
        const ratio = g.start.w > 0 ? next.rect.w / g.start.w : 1;
        setOverride({
          id: g.id,
          rect: next.rect,
          scale: next.scales ? g.startScale * ratio : g.startScale,
          rotation: next.rotation ?? g.startRotation,
        });
        break;
      }
      case 'stop-draw':
        setStopDraft(normaliseRect(g.origin, point));
        break;
      case 'pen':
        setStrokes([[...g.points]]);
        break;
    }
  }, [toWorld]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    const ui = useBoardUi.getState();
    const el = host.current;
    if (!el || !board) return;
    ui.stopMotion();
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    /* Two fingers are a camera, whatever tool is in your hand. */
    if (pointers.current.size === 2) {
      const two = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch',
        distance: Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y),
        x: (two[0].x + two[1].x) / 2,
        y: (two[0].y + two[1].y) / 2,
      };
      setGhost(null);
      setMarqueeRect(null);
      setGuides([]);
      setStrokes([]);
      return;
    }

    const point = toWorld(e.clientX, e.clientY);
    const panning = tool === 'hand' || spaceHeld.current || e.button === 1;
    if (panning) {
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
      return;
    }

    const target = e.target as HTMLElement;
    const handle = target.dataset.handle as Handle | undefined;
    if (handle && selection.length === 1) {
      const card = board.cards.find((c) => c.id === selection[0]);
      if (card) {
        gesture.current = {
          kind: 'resize',
          id: card.id,
          handle,
          start: { ...card.rect },
          startScale: card.scale,
          startRotation: card.rotation,
          // Depth is held still for the length of the gesture, so a corner does
          // not slide away from the finger that is pulling it.
          shift: depthShift(card.rect, depthFactor(card.depth, fx), ui.camera),
        };
        setOverride({ id: card.id, rect: { ...card.rect }, scale: card.scale, rotation: card.rotation });
        return;
      }
    }

    if (tool === 'pen') {
      gesture.current = { kind: 'pen', points: [point.x, point.y] };
      setStrokes([[point.x, point.y]]);
      return;
    }

    if (tool === 'stop') {
      gesture.current = { kind: 'stop-draw', origin: point };
      setStopDraft({ x: point.x, y: point.y, w: 0, h: 0 });
      return;
    }

    if (tool === 'text' || tool === 'sticky' || tool === 'shape' || tool === 'stat') {
      // The browser's own focus handling for a press would take the caret
      // straight back out of the box we are about to open.
      e.preventDefault();
      const created = createAt(tool, point);
      ui.setTool('select');
      ui.select([created]);
      if (tool !== 'stat') ui.edit(created);
      return;
    }

    const stopHit = target.dataset.stopId as StopId | undefined;
    const hit = pickCard(board, point, ui.camera, fx);

    if (hit && !stopHit) {
      if (e.shiftKey) ui.toggleInSelection(hit.id);
      else if (!ui.selection.includes(hit.id)) ui.select([hit.id]);
      if (hit.source) focusSource(hit.source, 'layer');
      const ids = useBoardUi.getState().selection;
      gesture.current = { kind: 'move', origin: point, ids, stopId: null, stopRect: null };
      setGhost({ dx: 0, dy: 0, ids, stopId: null });
      return;
    }

    if (stopHit) {
      const stop = board.stops.find((s) => s.id === stopHit);
      ui.selectStop(stopHit);
      if (stop) {
        // Dragging a slide takes its contents with it; ⌥ moves the frame alone,
        // which is how you re-crop a stop without disturbing the board.
        const ids = e.altKey ? [] : cardsInStop(board, stop).map((c) => c.id);
        gesture.current = {
          kind: 'move',
          origin: point,
          ids,
          stopId: stop.id,
          stopRect: { ...stop.rect },
        };
        setGhost({ dx: 0, dy: 0, ids, stopId: stop.id });
      }
      return;
    }

    if (!e.shiftKey) {
      ui.select([]);
      ui.selectStop(null);
      ui.edit(null);
    }
    gesture.current = { kind: 'marquee', origin: point, additive: e.shiftKey };
    setMarqueeRect({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (fx.spotlight > 0) moveLight(host.current, e.clientX, e.clientY);
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = gesture.current;
    if (!g || !board) return;

    /* A stroke keeps every sample the pointer took between two frames, so a
       fast line comes back as a line rather than as three long chords. */
    if (g.kind === 'pen') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const samples = events.length ? events : [e.nativeEvent];
      for (const sample of samples) {
        const p = toWorld(sample.clientX, sample.clientY);
        g.points.push(p.x, p.y);
      }
    }

    pending.current = { x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey };
    if (!frame.current) frame.current = requestAnimationFrame(readPending);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch' && pointers.current.size >= 1) {
      // One finger left: carry on as a pan rather than dropping the gesture.
      const rest = [...pointers.current.values()][0];
      gesture.current = { kind: 'pan', x: rest.x, y: rest.y, t: performance.now(), vx: 0, vy: 0 };
      return;
    }
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = null;
    host.current?.releasePointerCapture(e.pointerId);
    if (!g || !board) return;

    switch (g.kind) {
      case 'pan':
        /* A hand that came to rest before it let go meant to stop there. The
           speed it was travelling at half a second ago is not a throw. */
        if (performance.now() - g.t < 90) useBoardUi.getState().glide(g.vx, g.vy);
        break;
      case 'pinch':
        break;
      case 'marquee': {
        if (marquee && (marquee.w > 4 || marquee.h > 4)) {
          const cam = useBoardUi.getState().camera;
          const inside = board.cards
            .filter((c) => rectsOverlap(drawnRect(c, cam, fx), marquee))
            .map((c) => c.id);
          const ui = useBoardUi.getState();
          ui.select(g.additive ? [...new Set([...ui.selection, ...inside])] : inside);
        }
        setMarqueeRect(null);
        break;
      }
      case 'move': {
        const delta = ghost;
        setGhost(null);
        setGuides([]);
        if (!delta || (delta.dx === 0 && delta.dy === 0)) break;
        editBoard('Move', (b) => {
          for (const card of b.cards) {
            if (!g.ids.includes(card.id) || card.locked) continue;
            // A card at depth is drawn away from where it lives, so the amount
            // it *lives* by is the amount the pointer moved, divided back out.
            const divisor = dragDivisor(card, fx);
            card.rect.x += delta.dx / divisor;
            card.rect.y += delta.dy / divisor;
          }
          if (g.stopId) {
            const stop = b.stops.find((s) => s.id === g.stopId);
            if (stop) {
              stop.rect.x += delta.dx;
              stop.rect.y += delta.dy;
            }
          }
        });
        break;
      }
      case 'resize': {
        const next = override;
        setOverride(null);
        if (!next) break;
        editBoard('Resize', (b) => {
          const card = b.cards.find((c) => c.id === next.id);
          if (!card) return;
          card.rect = next.rect;
          card.scale = next.scale;
          card.rotation = next.rotation;
        });
        break;
      }
      case 'stop-draw': {
        const draft = stopDraft;
        setStopDraft(null);
        useBoardUi.getState().setTool('select');
        if (!draft) break;
        const point = toWorld(e.clientX, e.clientY);
        const stop = makeStop(board, point);
        if (draft.w > 60 && draft.h > 60) {
          const aspect = board.stopAspect || 16 / 9;
          // Whatever you drew, the stop keeps the presentation's shape: a slide
          // that framed differently from its neighbours would jump on arrival.
          const h = Math.max(draft.h, draft.w / aspect);
          stop.rect = {
            x: draft.x,
            y: draft.y + (draft.h - h) / 2,
            w: h * aspect,
            h,
          };
        }
        editBoard('Add stop', (b) => {
          b.stops.push(stop);
        });
        useBoardUi.getState().selectStop(stop.id);
        break;
      }
      case 'pen': {
        const points = g.points;
        setStrokes([]);
        if (points.length < 6) break;
        const xs = points.filter((_, i) => i % 2 === 0);
        const ys = points.filter((_, i) => i % 2 === 1);
        const rect: WorldRect = {
          x: Math.min(...xs) - 8,
          y: Math.min(...ys) - 8,
          w: Math.max(16, Math.max(...xs) - Math.min(...xs) + 16),
          h: Math.max(16, Math.max(...ys) - Math.min(...ys) + 16),
        };
        editBoard('Draw', (b) => {
          const card = makeCard('ink', { x: 0, y: 0 }, topZ(b)) as InkCard;
          card.rect = rect;
          card.strokes = [points];
          b.cards.push(card);
        });
        break;
      }
    }
  };

  const createAt = useCallback(
    (kind: Tool, at: WorldPoint): CardId => {
      const made = makeCard(
        kind === 'text' ? 'text' : kind === 'sticky' ? 'sticky' : kind === 'stat' ? 'stat' : 'shape',
        at,
        0,
      );
      editBoard('Add card', (b) => {
        made.z = topZ(b);
        b.cards.push(made);
      });
      return made.id;
    },
    [editBoard],
  );

  /** Two clicks on bare board is the shortest route to a word on it. */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!board || tool !== 'select') return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-card-id]') || target.dataset.stopId) return;
    const ui = useBoardUi.getState();
    const point = toWorld(e.clientX, e.clientY);
    if (pickCard(board, point, ui.camera, fx)) return;
    const created = createAt('text', point);
    ui.select([created]);
    ui.edit(created);
  };

  const commitText = useCallback(
    (id: CardId, text: string) => {
      editBoard(
        'Edit text',
        (b) => {
          const card = b.cards.find((c) => c.id === id);
          if (!card) return;
          if (card.kind === 'text' || card.kind === 'sticky') card.text = text;
          else if (card.kind === 'shape') card.label = text;
          else if (card.kind === 'stat') card.value = text;
        },
        `text:${id}`,
      );
    },
    [editBoard],
  );

  /* ---- render ----------------------------------------------------------- */

  const cards = useMemo(() => {
    if (!board) return [];
    return [...board.cards].sort((a, b) => a.z - b.z);
  }, [board]);

  if (!project || !board) return null;

  const grid = gridStyle(board, camera.x, camera.y, camera.zoom, viewport.w, viewport.h);
  /* Chrome is drawn inside the scaled world, so it is divided back out: a
     selection ring must be two screen pixels at every zoom, not two world ones. */
  const k = 1 / Math.max(0.0001, camera.zoom);
  const world: CSSProperties = {
    transform: `translate(${viewport.w / 2}px, ${viewport.h / 2}px) scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  };
  const cursor =
    tool === 'hand'
      ? 'grab'
    : tool === 'pen'
      ? 'crosshair'
      : tool === 'select'
        ? 'default'
        : 'crosshair';

  return (
    <div
      ref={host}
      className="bx-root"
      data-mode="edit"
      data-bloom={fx.bloom > 0 ? '1' : '0'}
      data-reveal={fx.reveal ? '1' : '0'}
      style={{
        ...(surfaceVars(board.surface) as CSSProperties),
        ...(effectVars(fx, board.surface) as CSSProperties),
        ...grid,
        cursor,
        ['--bx-k' as string]: String(k),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Board"
    >
      {!plain && <span dangerouslySetInnerHTML={{ __html: effectDefsSvg() }} />}
      {fx.aurora > 0 && (
        <div
          className="bx-atmos bx-atmos-back"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: atmosphereHtml(fx, 'back') }}
        />
      )}

      <div className="bx-world" style={world}>
        {board.stops.map((stop, i) => (
          <StopFrame
            key={stop.id}
            stop={stop}
            index={i}
            selected={selectedStopId === stop.id}
            dx={ghost?.stopId === stop.id ? ghost.dx : 0}
            dy={ghost?.stopId === stop.id ? ghost.dy : 0}
            k={k}
          />
        ))}

        <div
          className="pointer-events-none absolute left-0 top-0"
          dangerouslySetInnerHTML={{ __html: edgesSvg(board) }}
        />

        {cards.map((card) => {
          const moving = ghost && ghost.ids.includes(card.id) && !card.locked;
          const over = override?.id === card.id ? override : null;
          const shown: Card = over
            ? ({ ...card, rect: over.rect, scale: over.scale, rotation: over.rotation } as Card)
            : card;
          const m = depthFactor(card.depth, fx);
          const dx = moving ? ghost.dx / (1 + m) : 0;
          const dy = moving ? ghost.dy / (1 + m) : 0;

          const shift = m
            ? depthShift({ ...shown.rect, x: shown.rect.x + dx, y: shown.rect.y + dy }, m, camera)
            : ZERO_SHIFT;
          return (
            <CardView
              key={card.id}
              card={shown}
              surface={board.surface}
              dx={dx + shift.dx}
              dy={dy + shift.dy}
              blur={focusBlur(card.depth, false, fx) * k}
              k={k}
              selected={selection.includes(card.id)}
              only={selection.length === 1 && selection[0] === card.id}
              editing={editingCardId === card.id}
              onEditEnd={() => useBoardUi.getState().edit(null)}
              onText={(value) => commitText(card.id, value)}
            />
          );
        })}

        {guides.map((line, i) => (
          <div
            key={`${line.axis}-${i}`}
            className="pointer-events-none absolute"
            style={
              line.axis === 'x'
                ? {
                    left: line.at,
                    top: line.from,
                    width: 0,
                    height: Math.max(1, line.to - line.from),
                    borderLeft: `${k}px dashed var(--bx-accent)`,
                    zIndex: 900002,
                  }
                : {
                    left: line.from,
                    top: line.at,
                    height: 0,
                    width: Math.max(1, line.to - line.from),
                    borderTop: `${k}px dashed var(--bx-accent)`,
                    zIndex: 900002,
                  }
            }
          />
        ))}

        {marquee && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
              border: `${k}px solid var(--bx-accent)`,
              background: 'color-mix(in oklch, var(--bx-accent) 12%, transparent)',
              zIndex: 900000,
            }}
          />
        )}

        {stopDraft && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: stopDraft.x,
              top: stopDraft.y,
              width: stopDraft.w,
              height: stopDraft.h,
              border: `${2 * k}px dashed var(--bx-accent)`,
              zIndex: 900000,
            }}
          />
        )}

        {strokes.length > 0 && (
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0, width: 1, height: 1, zIndex: 900001 }}
          >
            {strokes.map((points, i) => (
              <path
                key={i}
                d={smoothStroke(points)?.d ?? ''}
                fill="none"
                stroke="var(--bx-ink)"
                strokeWidth={4}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        )}
      </div>

      {!plain && (
        <div
          className="bx-atmos bx-atmos-front"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: atmosphereHtml(fx, 'front') }}
        />
      )}
    </div>
  );
}

/* ============================================================================
   Pieces
   ========================================================================== */

const ZERO_SHIFT = { dx: 0, dy: 0 };

function CardView({
  card,
  surface,
  dx,
  dy,
  blur,
  k,
  selected,
  only,
  editing,
  onEditEnd,
  onText,
}: {
  card: Card;
  surface: Board['surface'];
  dx: number;
  dy: number;
  /** How soft this card is, already in world units. */
  blur: number;
  /** World units per screen pixel, so chrome stays the same size at any zoom. */
  k: number;
  selected: boolean;
  only: boolean;
  editing: boolean;
  onEditEnd: () => void;
  onText: (value: string) => void;
}) {
  const editable = card.kind === 'text' || card.kind === 'sticky' || card.kind === 'shape' || card.kind === 'stat';
  const initial =
    card.kind === 'text' || card.kind === 'sticky'
      ? card.text
      : card.kind === 'shape'
        ? card.label
        : card.kind === 'stat'
          ? card.value
          : '';

  return (
    <div
      data-card-id={card.id}
      data-outline={card.outline ?? 'none'}
      className={blur > 0.05 ? 'bx-card bx-deep' : 'bx-card'}
      style={{
        left: card.rect.x + dx,
        top: card.rect.y + dy,
        width: card.rect.w,
        height: card.rect.h,
        zIndex: Math.round(card.z),
        transform: card.rotation ? `rotate(${card.rotation}deg)` : undefined,
        outline: selected ? `${2 * k}px solid var(--bx-accent)` : undefined,
        outlineOffset: `${3 * k}px`,
        ...(cardShellVars(card, surface) as CSSProperties),
        ...(blur > 0.05 ? ({ ['--bx-blur' as string]: `${blur.toFixed(2)}px` } as CSSProperties) : null),
      }}
      onDoubleClick={(e) => {
        if (!editable) return;
        e.stopPropagation();
        useBoardUi.getState().edit(card.id);
      }}
    >
      {editing && editable ? (
        <CardEditor card={card} initial={initial} onText={onText} onDone={onEditEnd} />
      ) : (
        <div
          className="pointer-events-none h-full w-full"
          dangerouslySetInnerHTML={{ __html: cardHtml(card, surface) }}
        />
      )}

      {card.step > 0 && (
        <span
          className="pointer-events-none absolute flex items-center justify-center rounded-full"
          style={{
            left: -13 * k,
            top: -13 * k,
            width: 26 * k,
            height: 26 * k,
            fontSize: 14 * k,
            background: 'var(--bx-accent)',
            color: 'var(--bx-ground)',
            fontFamily: 'system-ui, sans-serif',
          }}
          title={`Arrives on click ${card.step}`}
        >
          {card.step}
        </span>
      )}

      {only && !editing && !card.locked && <Handles k={k} />}
    </div>
  );
}

/**
 * Editing happens in place, in the card's own type, at the card's own size —
 * a modal text box would break the one thing a board is for, which is seeing
 * the thing you are changing where it will live.
 */
function CardEditor({
  card,
  initial,
  onText,
  onDone,
}: {
  card: Card;
  initial: string;
  onText: (value: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /**
   * Editing opens inside the very press that asked for it, and the browser
   * finishes that press by moving focus itself — so the caret is placed on the
   * next frame, and a blur arriving before then is the press, not a person
   * clicking away.
   */
  const armed = useRef(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.select();
      armed.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const role = card.kind === 'text' ? TEXT_ROLES[card.role] ?? TEXT_ROLES.body : null;
  const size =
    card.kind === 'text' && role
      ? role.size * card.scale
      : card.kind === 'stat'
        ? 96 * card.scale
        : 30 * card.scale;

  return (
    <textarea
      ref={ref}
      defaultValue={initial}
      onChange={(e) => onText(e.target.value)}
      onBlur={() => {
        if (armed.current) onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onDone();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      style={{
        width: '100%',
        height: '100%',
        resize: 'none',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'var(--bx-ink)',
        padding: card.kind === 'sticky' ? '26px 28px' : 0,
        fontFamily: role?.family ?? "'Inter Variable', Inter, system-ui, sans-serif",
        fontWeight: role?.weight ?? 400,
        fontSize: `${Math.round(size)}px`,
        lineHeight: role?.leading ?? 1.4,
        letterSpacing: role?.tracking ?? '0',
        textTransform: (role?.transform as CSSProperties['textTransform']) ?? 'none',
        fontStyle: role?.italic ? 'italic' : 'normal',
        textAlign: card.kind === 'text' ? card.align : 'start',
      }}
    />
  );
}

const HANDLES: { id: Handle; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

function Handles({ k }: { k: number }) {
  return (
    <>
      {HANDLES.map((h) => (
        <span
          key={h.id}
          data-handle={h.id}
          style={{
            position: 'absolute',
            left: `${h.x * 100}%`,
            top: `${h.y * 100}%`,
            width: 13 * k,
            height: 13 * k,
            marginLeft: -6.5 * k,
            marginTop: -6.5 * k,
            background: 'var(--bx-ground)',
            border: `${2 * k}px solid var(--bx-accent)`,
            borderRadius: 2 * k,
            cursor: h.cursor,
            zIndex: 5,
          }}
        />
      ))}
      <span
        data-handle="rotate"
        title="Turn"
        style={{
          position: 'absolute',
          left: '50%',
          top: -38 * k,
          width: 13 * k,
          height: 13 * k,
          marginLeft: -6.5 * k,
          borderRadius: '50%',
          background: 'var(--bx-accent)',
          cursor: 'grab',
          zIndex: 5,
        }}
      />
    </>
  );
}

function StopFrame({
  stop,
  index,
  selected,
  dx,
  dy,
  k,
}: {
  stop: Stop;
  index: number;
  selected: boolean;
  dx: number;
  dy: number;
  k: number;
}) {
  return (
    <div
      data-stop-id={stop.id}
      style={{
        position: 'absolute',
        left: stop.rect.x + dx,
        top: stop.rect.y + dy,
        width: stop.rect.w,
        height: stop.rect.h,
        border: `${(selected ? 3 : 1.5) * k}px solid var(--bx-accent)`,
        borderRadius: 4 * k,
        opacity: selected ? 0.95 : 0.4,
        zIndex: 0,
      }}
    >
      <span
        data-stop-id={stop.id}
        style={{
          position: 'absolute',
          left: -1.5 * k,
          top: -26 * k,
          height: 24 * k,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${8 * k}px`,
          background: 'var(--bx-accent)',
          color: 'var(--bx-ground)',
          borderRadius: `${3 * k}px ${3 * k}px 0 0`,
          font: `500 ${14 * k}px/1 system-ui, sans-serif`,
          whiteSpace: 'nowrap',
          maxWidth: stop.rect.w,
          overflow: 'hidden',
        }}
      >
        {index + 1}. {stop.title}
      </span>
    </div>
  );
}

/* ============================================================================
   Helpers
   ========================================================================== */

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  t: 'text',
  n: 'sticky',
  r: 'shape',
  p: 'pen',
  f: 'stop',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * The spotlight is moved by writing two custom properties, not by rendering.
 * A light that followed the cursor through React would redraw every card on the
 * board sixty times a second to move a gradient.
 */
function moveLight(el: HTMLElement | null, clientX: number, clientY: number): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  el.style.setProperty('--bx-spot-x', `${(((clientX - rect.left) / rect.width) * 100).toFixed(2)}%`);
  el.style.setProperty('--bx-spot-y', `${(((clientY - rect.top) / rect.height) * 100).toFixed(2)}%`);
}

/** A corner scales the card and its type; an edge only changes the wrap. */
function resizeRect(
  start: WorldRect,
  handle: Handle,
  point: WorldPoint,
  proportional: boolean,
): { rect: WorldRect; scales: boolean; rotation?: number } {
  if (handle === 'rotate') {
    const cx = start.x + start.w / 2;
    const cy = start.y + start.h / 2;
    const raw = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI + 90;
    const rotation = proportional ? Math.round(raw / 15) * 15 : Math.round(raw);
    return { rect: start, scales: false, rotation };
  }

  const min = 40;
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;

  if (handle.includes('w')) {
    x = Math.min(point.x, right - min);
    w = right - x;
  }
  if (handle.includes('e')) w = Math.max(min, point.x - x);
  if (handle.includes('n')) {
    y = Math.min(point.y, bottom - min);
    h = bottom - y;
  }
  if (handle.includes('s')) h = Math.max(min, point.y - y);

  const corner = handle.length === 2;
  if (corner) {
    // Corners keep the card's proportions, so type never stretches.
    const ratio = start.w / start.h;
    const byWidth = w / start.w > h / start.h;
    if (byWidth) h = w / ratio;
    else w = h * ratio;
    if (handle.includes('n')) y = bottom - h;
    if (handle.includes('w')) x = right - w;
  }

  return { rect: { x, y, w, h }, scales: corner, rotation: undefined };
}

/** Where a new stop should sit when it is asked for without a place. */
export function stopForSelection(board: Board, selection: CardId[]): WorldRect {
  const rects = board.cards.filter((c) => selection.includes(c.id)).map((c) => c.rect);
  if (rects.length) return stopAround(board, rects);
  const bounds = unionRect(board.cards.map((c) => c.rect));
  return bounds
    ? stopAround(board, [bounds])
    : { x: 0, y: 0, w: CARD_SIZE.image.w * 2, h: (CARD_SIZE.image.w * 2) / (board.stopAspect || 16 / 9) };
}

import { useEffect, useRef } from 'react';
import type { Paper, Quad, SceneId } from '@/core/types';
import { INSTRUMENT_BY_ID, type InstrumentId } from './instruments';
import { useReader, type Drag, type DragTarget } from './readerStore';
import { hitPage, passageFromQuads, passageFromRegion, type Passage } from './selection';
import { contains, union } from './pageText';

/**
 * The drag.
 *
 * A tool is picked up and carried onto the page; a marked passage is picked up
 * and carried onto a tool or into the storyboard. Both are the same engine.
 *
 * Nothing here re-renders per frame: the ghost is moved by writing a transform
 * to a registered element, and React is only told when the *target* changes —
 * which happens when the pointer crosses into a different sentence, a few times
 * a second at most.
 */

interface Runtime {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  ghost: HTMLElement | null;
  key: string;
  raf: number;
  moved: boolean;
}

const runtime: Runtime = {
  pointerId: -1,
  originX: 0,
  originY: 0,
  x: 0,
  y: 0,
  ghost: null,
  key: '',
  raf: 0,
  moved: false,
};

const THRESHOLD = 4;

export function registerGhost(el: HTMLElement | null): void {
  runtime.ghost = el;
  if (el) place(el, runtime.x, runtime.y);
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}

function start(e: { clientX: number; clientY: number; pointerId: number }): void {
  runtime.pointerId = e.pointerId;
  runtime.originX = e.clientX;
  runtime.originY = e.clientY;
  runtime.x = e.clientX;
  runtime.y = e.clientY;
  runtime.key = '';
  runtime.moved = false;
  if (runtime.ghost) place(runtime.ghost, e.clientX, e.clientY);
}

/** Pick up a tool. */
export function beginToolDrag(
  id: InstrumentId,
  e: { clientX: number; clientY: number; pointerId: number },
): void {
  start(e);
  useReader.getState().startDrag({ instrumentId: id, passage: null });
}

/** Pick up the marked passage itself. */
export function beginPassageDrag(
  passage: Passage,
  e: { clientX: number; clientY: number; pointerId: number },
): void {
  start(e);
  useReader.getState().startDrag({ instrumentId: null, passage });
}

export interface DropHandlers {
  /** A tool was released over a passage. */
  onToolDrop: (instrumentId: InstrumentId, passage: Passage) => void;
  /** A passage was released over a tool. */
  onPassageToTool: (passage: Passage, instrumentId: InstrumentId) => void;
  /** A passage was released over a scene card. */
  onPassageToScene: (passage: Passage, sceneId: SceneId) => void;
  /** A passage was released between two scene cards. */
  onPassageToGap: (passage: Passage, index: number) => void;
  /** Released over nothing at all. */
  onCancel: () => void;
}

export function useDragEngine(paper: Paper | null, handlers: DropHandlers): void {
  const drag = useReader((s) => s.drag);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!drag) return;

    const resolve = (): DragTarget => {
      const el = document.elementFromPoint(runtime.x, runtime.y);
      if (!el) return { kind: 'none' };

      const drop = el.closest<HTMLElement>('[data-drop]');
      if (drop) {
        const [kind, value] = (drop.dataset.drop ?? '').split(':');
        if (kind === 'instrument') return { kind: 'instrument', id: value as InstrumentId };
        if (kind === 'scene') return { kind: 'scene', id: value as SceneId };
        if (kind === 'gap') return { kind: 'gap', index: Number(value) };
      }

      // Carrying a passage: only the drop zones above mean anything.
      if (!drag.instrumentId || !paper) return { kind: 'none' };

      const pageEl = el.closest<HTMLElement>('[data-page]');
      if (!pageEl) return { kind: 'none' };
      const page = Number(pageEl.dataset.page);
      const box = pageEl.getBoundingClientRect();
      if (!Number.isFinite(page) || box.width < 1) return { kind: 'none' };
      const x = (runtime.x - box.left) / box.width;
      const y = (runtime.y - box.top) / box.height;

      const instrument = INSTRUMENT_BY_ID.get(drag.instrumentId);
      const marked = useReader.getState().passage;

      // Inside the passage the person actually marked? Then that is the target,
      // whatever else happens to be under the pointer.
      const span = marked?.spans.find((s) => s.page === page);
      if (marked && span && span.quads.some((q) => contains(q, x, y, 0.006))) {
        return { kind: 'passage', passage: marked, page, quads: span.quads };
      }

      const hit = hitPage(paper, page, x, y);

      if (instrument?.needsCrop) {
        const bounds = hit.region?.bounds ?? hit.paragraphBounds;
        if (bounds) {
          return {
            kind: 'passage',
            passage: passageFromRegion(paper, page, bounds),
            page,
            quads: [bounds],
          };
        }
        return { kind: 'none' };
      }

      if (hit.sentence) {
        return {
          kind: 'passage',
          passage: passageFromQuads(paper, page, hit.sentenceQuads, hit.sentence.text),
          page,
          quads: hit.sentenceQuads,
        };
      }
      if (hit.line) {
        return {
          kind: 'passage',
          passage: passageFromQuads(paper, page, [hit.line.quad], hit.line.text),
          page,
          quads: [hit.line.quad],
        };
      }
      return { kind: 'none' };
    };

    /** Targets are only rebuilt when the pointer moves onto something else. */
    const targetKey = (): string => {
      const el = document.elementFromPoint(runtime.x, runtime.y);
      const drop = el?.closest<HTMLElement>('[data-drop]');
      if (drop) return `drop:${drop.dataset.drop}`;
      const pageEl = el?.closest<HTMLElement>('[data-page]');
      if (!pageEl || !paper || !drag.instrumentId) return 'none';
      const page = Number(pageEl.dataset.page);
      const box = pageEl.getBoundingClientRect();
      if (box.width < 1) return 'none';
      const x = (runtime.x - box.left) / box.width;
      const y = (runtime.y - box.top) / box.height;
      const marked = useReader.getState().passage;
      const span = marked?.spans.find((s) => s.page === page);
      if (marked && span && span.quads.some((q) => contains(q, x, y, 0.006))) {
        return `marked:${marked.id}`;
      }
      const hit = hitPage(paper, page, x, y);
      const instrument = INSTRUMENT_BY_ID.get(drag.instrumentId);
      if (instrument?.needsCrop) {
        const bounds = hit.region?.bounds ?? hit.paragraphBounds;
        return bounds ? `region:${page}:${quadKey(bounds)}` : 'none';
      }
      if (hit.sentence) return `sent:${hit.sentence.id}`;
      return hit.line ? `line:${page}:${quadKey(hit.line.quad)}` : 'none';
    };

    const tick = () => {
      runtime.raf = 0;
      if (runtime.ghost) place(runtime.ghost, runtime.x, runtime.y);
      const key = targetKey();
      const moved =
        runtime.moved ||
        Math.hypot(runtime.x - runtime.originX, runtime.y - runtime.originY) > THRESHOLD;
      if (key === runtime.key && moved === runtime.moved) return;
      runtime.key = key;
      runtime.moved = moved;
      useReader.getState().moveDrag(resolve(), moved);
    };

    const onMove = (e: PointerEvent) => {
      if (runtime.pointerId !== -1 && e.pointerId !== runtime.pointerId) return;
      e.preventDefault();
      runtime.x = e.clientX;
      runtime.y = e.clientY;
      if (!runtime.raf) runtime.raf = requestAnimationFrame(tick);
    };

    const finish = (commit: boolean) => {
      if (runtime.raf) cancelAnimationFrame(runtime.raf);
      runtime.raf = 0;
      const state = useReader.getState();
      const current = state.drag;
      state.endDrag();
      runtime.pointerId = -1;
      if (!commit || !current) {
        ref.current.onCancel();
        return;
      }
      dispatch(current, ref.current);
    };

    const onUp = (e: PointerEvent) => {
      if (runtime.pointerId !== -1 && e.pointerId !== runtime.pointerId) return;
      // A press with no movement is a click, handled by the button itself.
      finish(runtime.moved);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };

    const onCancelEvent = () => finish(false);

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelEvent);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag, paper]);
}

function dispatch(drag: Drag, handlers: DropHandlers): void {
  const { target } = drag;
  if (drag.instrumentId) {
    if (target.kind === 'passage') handlers.onToolDrop(drag.instrumentId, target.passage);
    else handlers.onCancel();
    return;
  }
  if (!drag.passage) {
    handlers.onCancel();
    return;
  }
  if (target.kind === 'instrument') handlers.onPassageToTool(drag.passage, target.id);
  else if (target.kind === 'scene') handlers.onPassageToScene(drag.passage, target.id);
  else if (target.kind === 'gap') handlers.onPassageToGap(drag.passage, target.index);
  else handlers.onCancel();
}

function quadKey(q: Quad): string {
  return `${q.x.toFixed(3)},${q.y.toFixed(3)},${q.w.toFixed(3)}`;
}

/** Bounds of the thing a drop would land on, for the page to outline. */
export function targetQuadsFor(drag: Drag | null, page: number): Quad[] {
  if (!drag || drag.target.kind !== 'passage' || drag.target.page !== page) return [];
  const quads = drag.target.quads;
  return quads.length > 6 ? [union(quads)] : quads;
}

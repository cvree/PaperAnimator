import { create } from 'zustand';
import type { CardId, Camera, StopId, WorldRect } from './types';
import { clampZoom, easeInOut, flyCamera } from './board';

/**
 * Board-local state: where you are looking, what is selected, which tool is in
 * your hand. None of it belongs in the project — looking somewhere is not an
 * edit, and a camera in the undo stack would move the view out from under you
 * every time you took back a word.
 */

export type Tool = 'select' | 'hand' | 'text' | 'sticky' | 'shape' | 'stat' | 'pen' | 'stop';

export type Mode = 'edit' | 'present';

export interface Marquee {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BoardUi {
  camera: Camera;
  viewport: { w: number; h: number };
  tool: Tool;
  mode: Mode;

  selection: CardId[];
  selectedStopId: StopId | null;
  editingCardId: CardId | null;
  marquee: Marquee | null;

  /** Panels down the side, remembered between visits. */
  drawerOpen: boolean;
  inspectorOpen: boolean;

  /** Present mode's place in the talk. */
  stopIndex: number;
  step: number;

  setCamera: (c: Camera) => void;
  panBy: (dxScreen: number, dyScreen: number) => void;
  setViewport: (w: number, h: number) => void;
  flyTo: (target: Camera, ms?: number) => void;
  setTool: (t: Tool) => void;
  setMode: (m: Mode) => void;

  select: (ids: CardId[]) => void;
  addToSelection: (id: CardId) => void;
  toggleInSelection: (id: CardId) => void;
  selectStop: (id: StopId | null) => void;
  edit: (id: CardId | null) => void;
  setMarquee: (m: Marquee | null) => void;

  setDrawerOpen: (b: boolean) => void;
  setInspectorOpen: (b: boolean) => void;
  goTo: (stopIndex: number, step?: number) => void;
  reset: () => void;
}

let flightRaf = 0;

export const useBoardUi = create<BoardUi>((set, get) => ({
  camera: { x: 800, y: 450, zoom: 0.5 },
  viewport: { w: 0, h: 0 },
  tool: 'select',
  mode: 'edit',

  selection: [],
  selectedStopId: null,
  editingCardId: null,
  marquee: null,

  drawerOpen: true,
  inspectorOpen: true,

  stopIndex: 0,
  step: 0,

  setCamera: (camera) => {
    cancelAnimationFrame(flightRaf);
    flightRaf = 0;
    set({ camera: { ...camera, zoom: clampZoom(camera.zoom) } });
  },

  panBy: (dx, dy) =>
    set((s) => ({
      camera: { ...s.camera, x: s.camera.x - dx / s.camera.zoom, y: s.camera.y - dy / s.camera.zoom },
    })),

  setViewport: (w, h) => set({ viewport: { w, h } }),

  /**
   * A move the eye can follow. Instant jumps between two places on a board this
   * large are how an audience loses the thread, so every programmatic move is a
   * flight — and one already in progress is replaced, never queued.
   */
  flyTo: (target, ms = 720) => {
    cancelAnimationFrame(flightRaf);
    const from = get().camera;
    const to = { ...target, zoom: clampZoom(target.zoom) };
    const reduced =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || ms <= 0) {
      set({ camera: to });
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      set({ camera: flyCamera(from, to, easeInOut(t)) });
      if (t < 1) flightRaf = requestAnimationFrame(tick);
      else flightRaf = 0;
    };
    flightRaf = requestAnimationFrame(tick);
  },

  setTool: (tool) => set({ tool, editingCardId: null }),
  setMode: (mode) => set({ mode, editingCardId: null, marquee: null }),

  select: (selection) => set({ selection, selectedStopId: null }),
  addToSelection: (id) =>
    set((s) => (s.selection.includes(id) ? s : { selection: [...s.selection, id] })),
  toggleInSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((c) => c !== id)
        : [...s.selection, id],
      selectedStopId: null,
    })),
  selectStop: (selectedStopId) => set({ selectedStopId, selection: [] }),
  edit: (editingCardId) => set({ editingCardId }),
  setMarquee: (marquee) => set({ marquee }),

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),

  goTo: (stopIndex, step = 0) => set({ stopIndex, step }),

  reset: () => {
    cancelAnimationFrame(flightRaf);
    flightRaf = 0;
    set({
      camera: { x: 800, y: 450, zoom: 0.5 },
      tool: 'select',
      mode: 'edit',
      selection: [],
      selectedStopId: null,
      editingCardId: null,
      marquee: null,
      stopIndex: 0,
      step: 0,
    });
  },
}));

/** The rect a marquee describes, normalised so dragging up-left still works. */
export function normaliseRect(a: { x: number; y: number }, b: { x: number; y: number }): WorldRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

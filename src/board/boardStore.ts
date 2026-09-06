import { create } from 'zustand';
import type { CardId, Camera, StopId, WorldRect } from './types';
import { clampZoom, easeInOut, flyCamera, zoomAt } from './board';

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
  /** Let go of a pan and the board keeps going, then stops. Screen px per ms. */
  glide: (vxScreen: number, vyScreen: number) => void;
  /** Zoom about a point on screen, eased — see the note on {@link BoardUi.glide}. */
  zoomTowards: (screen: { x: number; y: number }, factor: number) => void;
  /** Cut every camera animation dead. Any deliberate input does this first. */
  stopMotion: () => void;
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
let glideRaf = 0;
let zoomRaf = 0;
let zoomTarget: { zoom: number; x: number; y: number } | null = null;

function halt(): void {
  cancelAnimationFrame(flightRaf);
  cancelAnimationFrame(glideRaf);
  cancelAnimationFrame(zoomRaf);
  flightRaf = 0;
  glideRaf = 0;
  zoomRaf = 0;
  zoomTarget = null;
}

/** Whether the person watching has asked for less of this. */
function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How much of its speed a glide keeps each frame, and the speed below which it
 * is over. Tuned by hand against a trackpad: high enough that a flick crosses
 * the board, low enough that the board never feels like it is escaping.
 */
const GLIDE_DECAY = 0.93;
const GLIDE_FLOOR = 0.015;

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
    halt();
    set({ camera: { ...camera, zoom: clampZoom(camera.zoom) } });
  },

  panBy: (dx, dy) =>
    set((s) => ({
      camera: { ...s.camera, x: s.camera.x - dx / s.camera.zoom, y: s.camera.y - dy / s.camera.zoom },
    })),

  stopMotion: halt,

  /**
   * Momentum.
   *
   * A board this large is mostly travelled across, and a pan that stops dead
   * the instant your finger lifts makes every journey a series of small
   * strokes. Letting go hands the board its own speed and lets friction take
   * it — and any deliberate input takes it straight back.
   */
  glide: (vx, vy) => {
    cancelAnimationFrame(glideRaf);
    glideRaf = 0;
    if (reducedMotion()) return;
    let x = vx;
    let y = vy;
    if (Math.hypot(x, y) < GLIDE_FLOOR * 6) return;
    let last = performance.now();
    const tick = (now: number) => {
      // Frames are not 16ms on every machine, so friction is applied per
      // millisecond of real time rather than per frame of hope.
      const dt = Math.min(64, now - last);
      last = now;
      const keep = Math.pow(GLIDE_DECAY, dt / 16);
      const { camera } = get();
      set({
        camera: { ...camera, x: camera.x - (x * dt) / camera.zoom, y: camera.y - (y * dt) / camera.zoom },
      });
      x *= keep;
      y *= keep;
      if (Math.hypot(x, y) > GLIDE_FLOOR) glideRaf = requestAnimationFrame(tick);
      else glideRaf = 0;
    };
    glideRaf = requestAnimationFrame(tick);
  },

  /**
   * Zoom that catches up rather than jumps.
   *
   * A trackpad sends a hundred tiny wheel events and a mouse sends four large
   * ones; applied straight, the first is smooth and the second is a staircase.
   * Both are accumulated into a target here and chased at a fixed fraction per
   * frame, which makes the two devices feel like the same board.
   */
  zoomTowards: (screen, factor) => {
    cancelAnimationFrame(flightRaf);
    cancelAnimationFrame(glideRaf);
    flightRaf = 0;
    glideRaf = 0;
    const { camera, viewport } = get();
    const base = zoomTarget ? zoomTarget.zoom : camera.zoom;
    zoomTarget = { zoom: clampZoom(base * factor), x: screen.x, y: screen.y };

    if (reducedMotion()) {
      const target = zoomTarget;
      zoomTarget = null;
      set({ camera: zoomAt(camera, target, target.zoom / camera.zoom, viewport.w, viewport.h) });
      return;
    }
    if (zoomRaf) return;

    const tick = () => {
      const target = zoomTarget;
      const s = get();
      if (!target) {
        zoomRaf = 0;
        return;
      }
      const gap = target.zoom - s.camera.zoom;
      const done = Math.abs(gap) / target.zoom < 0.002;
      const next = done ? target.zoom : s.camera.zoom + gap * 0.3;
      set({
        camera: zoomAt(s.camera, target, next / s.camera.zoom, s.viewport.w, s.viewport.h),
      });
      if (done) {
        zoomTarget = null;
        zoomRaf = 0;
      } else {
        zoomRaf = requestAnimationFrame(tick);
      }
    };
    zoomRaf = requestAnimationFrame(tick);
  },

  setViewport: (w, h) => set({ viewport: { w, h } }),

  /**
   * A move the eye can follow. Instant jumps between two places on a board this
   * large are how an audience loses the thread, so every programmatic move is a
   * flight — and one already in progress is replaced, never queued.
   */
  flyTo: (target, ms = 720) => {
    halt();
    const from = get().camera;
    const to = { ...target, zoom: clampZoom(target.zoom) };
    const reduced = reducedMotion();
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
    halt();
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

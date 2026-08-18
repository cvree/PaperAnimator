import { create } from 'zustand';
import type { Quad, SceneId } from '@/core/types';
import type { InstrumentId } from './instruments';
import type { Passage } from './selection';

/**
 * Reader-local state.
 *
 * Kept out of the project store on purpose: marking, dragging and hovering
 * change many times a second and must not re-render the canvas, the storyboard
 * or the exporter. Pointer *position* is not in here at all — it is written
 * straight to the ghost element, so a drag costs no React work per frame.
 */

export type DragTarget =
  | { kind: 'passage'; passage: Passage; page: number; quads: Quad[] }
  | { kind: 'instrument'; id: InstrumentId }
  | { kind: 'scene'; id: SceneId }
  | { kind: 'gap'; index: number }
  | { kind: 'none' };

export interface Drag {
  /** Set when a tool is being carried to the page. */
  instrumentId: InstrumentId | null;
  /** Set when the marked passage is being carried to a tool or the storyboard. */
  passage: Passage | null;
  target: DragTarget;
  /** True once the pointer has moved far enough to count as a drag. */
  live: boolean;
}

interface ReaderState {
  /** Page width as a fraction of the reader's available width. */
  zoom: number;
  passage: Passage | null;
  /** Passages set aside deliberately, for comparisons and multi-part scenes. */
  tray: Passage[];
  drag: Drag | null;
  /** Quads lit up because something outside the reader is pointing at them. */
  lit: { page: number; quads: Quad[] }[];
  /** The scene a just-made mark belongs to, for the after-drop flourish. */
  flash: { page: number; quads: Quad[]; at: number } | null;
  /** Armed by the Crop tool: the next drag draws a box instead of marking text. */
  cropArmed: boolean;

  setZoom: (z: number) => void;
  setPassage: (p: Passage | null) => void;
  keep: (p: Passage) => void;
  clearTray: () => void;
  startDrag: (d: Omit<Drag, 'target' | 'live'>) => void;
  moveDrag: (target: DragTarget, live?: boolean) => void;
  endDrag: () => void;
  setLit: (lit: { page: number; quads: Quad[] }[]) => void;
  setFlash: (f: { page: number; quads: Quad[] } | null) => void;
  setCropArmed: (b: boolean) => void;
  reset: () => void;
}

export const ZOOM_STEPS = [0.62, 0.78, 0.92, 1.1, 1.35, 1.7] as const;

export const useReader = create<ReaderState>((set, get) => ({
  zoom: 0.92,
  passage: null,
  tray: [],
  drag: null,
  lit: [],
  flash: null,
  cropArmed: false,

  setZoom: (zoom) => set({ zoom: Math.max(0.4, Math.min(2.4, zoom)) }),
  setPassage: (passage) => set({ passage }),
  keep: (p) =>
    set((s) => ({ tray: [...s.tray.filter((t) => t.id !== p.id), p].slice(-4) })),
  clearTray: () => set({ tray: [] }),

  startDrag: (d) => set({ drag: { ...d, target: { kind: 'none' }, live: false } }),
  moveDrag: (target, live = true) => {
    const drag = get().drag;
    if (!drag) return;
    if (drag.live === live && sameTarget(drag.target, target)) return;
    set({ drag: { ...drag, target, live: drag.live || live } });
  },
  endDrag: () => set({ drag: null }),

  setLit: (lit) => set({ lit }),
  setFlash: (f) => set({ flash: f ? { ...f, at: performance.now() } : null }),
  setCropArmed: (cropArmed) => set({ cropArmed }),

  reset: () =>
    set({ passage: null, tray: [], drag: null, lit: [], flash: null, cropArmed: false }),
}));

function sameTarget(a: DragTarget, b: DragTarget): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'passage':
      return b.kind === 'passage' && a.passage.id === b.passage.id;
    case 'instrument':
      return b.kind === 'instrument' && a.id === b.id;
    case 'scene':
      return b.kind === 'scene' && a.id === b.id;
    case 'gap':
      return b.kind === 'gap' && a.index === b.index;
    default:
      return true;
  }
}

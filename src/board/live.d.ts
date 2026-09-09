import type { Camera } from './types';

/**
 * Types for `live.js`, which is written in plain JavaScript because the
 * published page inlines it as source. The presenter imports it as a module and
 * the publisher inlines the same file, so there is one implementation of every
 * live gesture rather than two that drift.
 */

export interface LiveOptions {
  /** The `.bx-root` element the talk is drawn in. */
  host: HTMLElement;
  getCamera: () => Camera;
  setCamera: (camera: Camera) => void;
  /** Put the camera back on the stop the talk is at. */
  refit: () => void;
  /** Whether the board's lights are off, which sets the ink and the blend. */
  dark: boolean;
  reduced?: boolean;
}

export interface LiveLayer {
  /** Ink belongs to the slide it was drawn on; this says which one that is. */
  slide: (key: string | number) => void;
  /** The camera moved, so every stroke has to be re-projected. */
  moved: () => void;
  /** Show or hide the tools with the rest of the presenter's chrome. */
  chrome: (visible: boolean) => void;
  /** True while a drawing tool owns the pointer. */
  busy: () => boolean;
  destroy: () => void;
}

export function createLive(options: LiveOptions): LiveLayer;

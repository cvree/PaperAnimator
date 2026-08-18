import { useEffect, useState } from 'react';

/**
 * One clock for every looping preview on screen.
 *
 * A gallery of animated tiles must not become a gallery of animation loops:
 * a single rAF drives all of them, at a rate chosen for tiles rather than for
 * the stage, and it stops the moment nothing is watching.
 */

type Listener = (t: number) => void;

const listeners = new Set<Listener>();
let raf = 0;
let started = 0;
let last = 0;

/** Tiles are small and numerous; 32fps is indistinguishable and much cheaper. */
const STEP_MS = 1000 / 32;

function tick(now: number) {
  raf = requestAnimationFrame(tick);
  if (now - last < STEP_MS) return;
  last = now;
  const t = now - started;
  for (const fn of listeners) fn(t);
}

function subscribe(fn: Listener): () => void {
  if (listeners.size === 0) {
    started = performance.now();
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/**
 * Milliseconds within a loop of `loopMs`, offset by `phase` so a grid of tiles
 * does not pulse in unison — which reads as one flashing block rather than as
 * a set of separate animations.
 */
export function useLoopTime(loopMs: number, phase = 0, running = true): number {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!running) return;
    return subscribe((now) => setT((now + phase) % Math.max(200, loopMs)));
  }, [loopMs, phase, running]);

  return running ? t : Math.max(0, loopMs - 1);
}

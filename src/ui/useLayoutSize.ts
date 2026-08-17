import { useSyncExternalStore } from 'react';

/**
 * Which of the three editor layouts applies.
 *
 * The editor cannot render all three and hide two with CSS: each carries a live
 * canvas, and a hidden canvas still runs its animation loop and its narrator.
 * Three voices reading the same paper at once is not a styling problem.
 */

export type LayoutSize = 'mobile' | 'tablet' | 'desktop';

const TABLET = '(min-width: 768px)';
const DESKTOP = '(min-width: 1024px)';

function read(): LayoutSize {
  if (typeof matchMedia === 'undefined') return 'desktop';
  if (matchMedia(DESKTOP).matches) return 'desktop';
  if (matchMedia(TABLET).matches) return 'tablet';
  return 'mobile';
}

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => {};
  const queries = [matchMedia(TABLET), matchMedia(DESKTOP)];
  for (const q of queries) q.addEventListener('change', onChange);
  return () => {
    for (const q of queries) q.removeEventListener('change', onChange);
  };
}

export function useLayoutSize(): LayoutSize {
  return useSyncExternalStore(subscribe, read, () => 'desktop' as const);
}

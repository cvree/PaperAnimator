import { useEffect, useLayoutEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { useReader } from '@/reader/readerStore';

/**
 * Four steps, each requiring a real action, each anchored to a real element.
 * Under a minute end to end — after which the user has performed all three
 * signature interactions and can be left alone.
 *
 * The card is placed against the element it is talking about and draws a line
 * to it, because an instruction floating in the middle of the screen makes the
 * reader hunt for its subject.
 */

const STEPS = [
  {
    id: 'mark',
    anchor: 'paper',
    side: 'right',
    title: 'Highlight something in the paper',
    body: 'Drag across any words, or click a sentence to take the whole of it. This is the real PDF — what you mark is what gets cited.',
  },
  {
    id: 'make',
    anchor: 'dock',
    side: 'above',
    title: 'Drop a tool on your highlight',
    body: 'Drag one of these onto the passage — or just click it. You will see the scene before you let go.',
  },
  {
    id: 'prove',
    anchor: 'stage',
    side: 'below',
    title: 'Click something on the scene',
    body: 'A thread is drawn back to the exact words on the page it came from.',
  },
  {
    id: 'play',
    anchor: 'transport',
    side: 'above',
    title: 'Press space to watch it',
    body: 'The marker follows the narration, word by word.',
  },
] as const;

const KEY = 'pa:onboarded';
const CARD_W = 380;
const GAP = 14;

interface Placement {
  left: number;
  top: number;
  target: DOMRect;
}

export function Onboarding() {
  const project = useApp((s) => s.project);
  const selectedLayerIds = useApp((s) => s.selectedLayerIds);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<Placement | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });

  const sceneCount = project?.scenes.length ?? 0;
  const marked = useReader((s) => !!s.passage);
  const [baseline] = useState(sceneCount);
  const current = STEPS[step];

  /* Advance on real progress, never on a timer. */
  useEffect(() => {
    if (dismissed) return;
    if (step === 0 && marked) setStep(1);
    if (step === 1 && sceneCount > baseline) setStep(2);
    if (step === 2 && selectedLayerIds.length > 0) setStep(3);
  }, [step, marked, sceneCount, baseline, selectedLayerIds.length, dismissed]);

  /* Follow the anchor wherever it is, including across a resize. */
  useLayoutEffect(() => {
    if (dismissed) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-coach="${current.anchor}"]`);
      if (!el) {
        setPlace(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const cardH = 150;
      let left: number;
      let top: number;
      if (current.side === 'right') {
        // Low against the anchor, so the card sits over the quiet corner of the
        // stage rather than across whatever the scene is showing.
        left = r.right + GAP;
        top = r.bottom - cardH;
      } else if (current.side === 'below') {
        left = r.left + r.width / 2 - CARD_W / 2;
        top = r.bottom + GAP;
      } else {
        left = r.left + r.width / 2 - CARD_W / 2;
        top = r.top - GAP - cardH;
      }
      left = Math.max(12, Math.min(left, window.innerWidth - CARD_W - 12));
      top = Math.max(12, Math.min(top, window.innerHeight - cardH - 12));
      setPlace({ left, top, target: r });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    const id = window.setTimeout(measure, 260);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearTimeout(id);
    };
  }, [current.anchor, current.side, dismissed]);

  const finish = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode */
    }
  };

  if (dismissed || !project) return null;

  return (
    <div role="region" aria-label="Getting started">
      {place && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[var(--z-overlay)]"
          style={{
            left: place.target.left,
            top: place.target.top,
            width: place.target.width,
            height: place.target.height,
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'inset 0 0 0 2px color-mix(in oklch, var(--accent) 42%, transparent)',
          }}
        />
      )}

      <div
        className="fixed z-[var(--z-overlay)]"
        style={
          place
            ? { left: place.left, top: place.top, width: CARD_W }
            : { left: '50%', bottom: 16, width: CARD_W, transform: 'translateX(-50%)' }
        }
      >
        <div
          className="rounded-[var(--radius-md)] border border-[var(--rule-strong)] bg-[var(--surface-raised)] p-4"
          style={{
            boxShadow: 'var(--shadow-float)',
            animation: reducedMotion ? undefined : 'coach-in 320ms var(--ease-out)',
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <div className="flex gap-1" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span
                  key={s.id}
                  className="h-1 w-5 rounded-full transition-colors duration-300"
                  style={{ background: i <= step ? 'var(--accent)' : 'var(--rule-hairline)' }}
                />
              ))}
            </div>
            <span className="label ml-auto">
              {step + 1} of {STEPS.length}
            </span>
          </div>

          <p className="text-base font-medium leading-snug text-[var(--ink-primary)]">
            {current.title}
          </p>
          <p className="mt-1 text-xs leading-[1.5] text-[var(--ink-tertiary)]">{current.body}</p>

          <div className="mt-3 flex items-center gap-3">
            {step === 3 && (
              <button
                type="button"
                onClick={finish}
                className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-2xs font-medium text-[var(--accent-ink)]"
              >
                Got it
              </button>
            )}
            <button
              type="button"
              onClick={finish}
              className="ml-auto text-2xs text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-primary)]"
            >
              Skip
            </button>
          </div>
          <style>{`@keyframes coach-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
        </div>
      </div>
    </div>
  );
}

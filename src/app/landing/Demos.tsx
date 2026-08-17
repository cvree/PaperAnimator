import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/state/store';

/**
 * The three interaction demos on the landing page.
 *
 * They are the real interactions at small scale, not looping illustrations of
 * them: the marker is driven by a clock, the figure is dragged by the pointer,
 * and the thread is measured from the live DOM — the same mechanisms the editor
 * uses. A page that animates a promise it cannot keep is worse than a still.
 *
 * The words and numbers are illustrative, and the page says so; what is being
 * demonstrated is the mechanism.
 */

const SENTENCE =
  'Extended sleep reduced recovery time by 31.4% relative to habitual sleep.';
const WORDS = SENTENCE.split(' ');

function useReduced(): boolean {
  return useApp((s) => s.reducedMotion);
}

/* ============================================================================
   01 — Highlight it
   ========================================================================== */

export function HighlightDemo() {
  const reduced = useReduced();
  const [spoken, setSpoken] = useState(0);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);

  const start = useCallback(() => {
    if (running) {
      setRunning(false);
      setSpoken(0);
      return;
    }
    setRunning(true);
    if (reduced) {
      setSpoken(WORDS.length);
      return;
    }
    const began = performance.now();
    const perWord = 190;
    const step = (now: number) => {
      const n = (now - began) / perWord;
      setSpoken(Math.min(WORDS.length, n));
      if (n < WORDS.length) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [running, reduced]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const made = spoken >= WORDS.length;

  return (
    <DemoFrame>
      <button
        type="button"
        onClick={start}
        aria-pressed={running}
        className="group/demo block h-full w-full text-left"
      >
        <p
          className="font-display text-[0.78rem] leading-[1.55] text-[var(--ink-primary)]"
          style={{ letterSpacing: '-0.008em' }}
        >
          {WORDS.map((w, i) => {
            const covered = spoken - i;
            const pct = covered >= 1 ? 100 : covered <= 0 ? 0 : covered * 100;
            return (
              <span key={i}>
                <span
                  style={{
                    backgroundImage:
                      pct > 0
                        ? 'linear-gradient(var(--hl-yellow), var(--hl-yellow))'
                        : undefined,
                    backgroundSize: `${pct}% 100%`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'left center',
                    boxDecorationBreak: 'clone',
                    WebkitBoxDecorationBreak: 'clone',
                  }}
                >
                  {w}
                </span>
                <span
                  style={{
                    backgroundImage:
                      spoken > i + 1
                        ? 'linear-gradient(var(--hl-yellow), var(--hl-yellow))'
                        : undefined,
                  }}
                >
                  {' '}
                </span>
              </span>
            );
          })}
        </p>

        <div
          className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-1.5"
          style={{
            borderColor: made ? 'var(--rule-strong)' : 'var(--rule-hairline)',
            background: made ? 'var(--surface-raised)' : 'transparent',
            opacity: made ? 1 : 0.45,
            transform: made ? 'translateY(0)' : 'translateY(3px)',
            transition: reduced ? 'none' : 'all 320ms var(--ease-out)',
            boxShadow: made ? 'var(--shadow-raised)' : 'none',
          }}
        >
          <span className="numeral text-2xs text-[var(--ink-primary)]">31.4%</span>
          <span className="text-2xs text-[var(--ink-tertiary)]">
            {made ? 'Scene made · page 1' : 'becomes a scene'}
          </span>
        </div>

        <p className="mt-2.5 text-2xs text-[var(--accent)] opacity-70 group-hover/demo:opacity-100">
          {running ? 'Reset' : 'Read it aloud →'}
        </p>
      </button>
    </DemoFrame>
  );
}

/* ============================================================================
   02 — Pull it out
   ========================================================================== */

export function DragDemo() {
  const reduced = useReduced();
  const frame = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [landed, setLanded] = useState(false);
  const grabbed = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (landed) {
      setLanded(false);
      return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    grabbed.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ x: e.clientX - grabbed.current.x, y: e.clientY - grabbed.current.y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const target = slot.current?.getBoundingClientRect();
    const inside =
      !!target &&
      e.clientX >= target.left &&
      e.clientX <= target.right &&
      e.clientY >= target.top &&
      e.clientY <= target.bottom;
    setLanded(inside);
    setDrag(null);
  };

  const over =
    drag !== null &&
    (() => {
      const t = slot.current?.getBoundingClientRect();
      const f = frame.current?.getBoundingClientRect();
      if (!t || !f) return false;
      return Math.abs(drag.x) > 40;
    })();

  return (
    <DemoFrame>
      <div ref={frame} className="flex h-full items-center gap-3">
        <div className="flex flex-1 flex-col gap-[6px]">
          <Bar w="88%" />
          <Bar w="72%" />
          <div
            role="button"
            tabIndex={0}
            aria-label={
              landed ? 'Figure 3 is on the slide. Activate to send it back.' : 'Drag Figure 3 onto the slide'
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
                e.preventDefault();
                setLanded((v) => !v);
              }
            }}
            className="mt-1 cursor-grab touch-none rounded-[2px] border border-[var(--rule-hairline)] bg-[var(--surface-sunken)] p-2 active:cursor-grabbing"
            style={{
              transform: drag ? `translate(${drag.x}px, ${drag.y}px) rotate(-1.5deg) scale(1.03)` : 'none',
              boxShadow: drag ? 'var(--shadow-float)' : 'none',
              opacity: landed ? 0.32 : 1,
              transition: drag || reduced ? 'none' : 'transform 340ms var(--ease-lift), opacity 220ms, box-shadow 220ms',
              position: drag ? 'relative' : 'static',
              zIndex: drag ? 5 : undefined,
            }}
          >
            <MiniChart />
          </div>
        </div>

        <svg width="20" height="10" viewBox="0 0 22 10" fill="none" aria-hidden="true" className="shrink-0">
          <path
            d="M0 5h19m0 0-4-4m4 4-4 4"
            stroke="var(--ink-faint)"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity={over || landed ? 1 : 0.5}
          />
        </svg>

        <div
          ref={slot}
          className="flex h-[4.6rem] flex-1 items-center justify-center rounded-[2px] p-1.5"
          style={{
            border: landed ? '1px solid var(--rule-strong)' : '1px dashed var(--rule-strong)',
            background: landed ? 'var(--surface-raised)' : 'var(--surface-sunken)',
            boxShadow: landed ? 'var(--shadow-raised)' : 'none',
            transition: reduced ? 'none' : 'all 260ms var(--ease-out)',
          }}
        >
          {landed ? (
            <div className="w-full">
              <MiniChart />
            </div>
          ) : (
            <span className="label" style={{ fontSize: '0.55rem' }}>
              {over ? 'Drop it' : 'Scene 4'}
            </span>
          )}
        </div>
      </div>
    </DemoFrame>
  );
}

function MiniChart() {
  return (
    <svg viewBox="0 0 60 26" className="w-full" aria-hidden="true">
      {[0.4, 0.7, 0.55, 0.9].map((v, i) => (
        <rect
          key={i}
          x={4 + i * 14}
          y={22 - v * 18}
          width="8"
          height={v * 18}
          fill={i === 3 ? 'var(--accent)' : 'var(--ink-faint)'}
          opacity={i === 3 ? 0.9 : 0.45}
        />
      ))}
    </svg>
  );
}

/* ============================================================================
   03 — Prove it
   ========================================================================== */

export function ProveDemo() {
  const reduced = useReduced();
  const frame = useRef<HTMLDivElement>(null);
  const claim = useRef<HTMLButtonElement>(null);
  const source = useRef<HTMLButtonElement>(null);
  const [linked, setLinked] = useState(false);
  const [path, setPath] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!linked) {
      setPath(null);
      return;
    }
    const measure = () => {
      const f = frame.current?.getBoundingClientRect();
      const a = claim.current?.getBoundingClientRect();
      const b = source.current?.getBoundingClientRect();
      if (!f || !a || !b) return;
      const x1 = a.right - f.left;
      const y1 = a.top + a.height / 2 - f.top;
      const x2 = b.left - f.left;
      const y2 = b.top + 14 - f.top;
      const dx = Math.max(14, (x2 - x1) * 0.55);
      setPath(`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frame.current) ro.observe(frame.current);
    return () => ro.disconnect();
  }, [linked]);

  const toggle = () => setLinked((v) => !v);

  return (
    <DemoFrame>
      <div ref={frame} className="relative flex h-full items-center gap-3">
        <button
          ref={claim}
          type="button"
          onClick={toggle}
          aria-pressed={linked}
          aria-label="Show where this number came from"
          className="flex-1 rounded-[2px] border p-2.5 text-left"
          style={{
            borderColor: linked ? 'var(--accent)' : 'var(--rule-hairline)',
            background: linked ? 'var(--accent-subtle)' : 'var(--surface-sunken)',
            transition: reduced ? 'none' : 'all 220ms var(--ease-out)',
          }}
        >
          <span className="numeral block text-lg leading-none text-[var(--ink-primary)]">31.4%</span>
          <span className="mt-1.5 block text-[0.55rem] text-[var(--ink-faint)]">
            95% CI 24.8–37.9
          </span>
        </button>

        {path && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            fill="none"
            aria-hidden="true"
            style={{ overflow: 'visible' }}
          >
            <path d={path} stroke="var(--accent)" strokeWidth="4" opacity="0.1" strokeLinecap="round" />
            <path
              d={path}
              stroke="var(--accent)"
              strokeWidth="1"
              opacity="0.8"
              strokeLinecap="round"
              style={{
                strokeDasharray: 400,
                animation: reduced ? undefined : 'demo-thread 420ms var(--ease-out)',
              }}
            />
          </svg>
        )}

        <button
          ref={source}
          type="button"
          onClick={toggle}
          aria-pressed={linked}
          aria-label="Show which claim uses this sentence"
          className="flex-1 rounded-[2px] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-2.5 text-left"
        >
          <span className="label mb-1.5 block" style={{ fontSize: '0.5rem' }}>
            Page 7
          </span>
          <span className="flex flex-col gap-[4px]">
            <Bar w="100%" h={2.5} />
            <span className="relative block">
              <span
                className="absolute inset-x-[-2px] inset-y-[-1px] rounded-[1px]"
                style={{
                  background: 'var(--accent)',
                  opacity: linked ? 0.18 : 0,
                  transition: reduced ? 'none' : 'opacity 260ms var(--ease-out)',
                }}
              />
              <Bar w="86%" h={2.5} tone="ink" />
            </span>
            <Bar w="94%" h={2.5} />
            <Bar w="52%" h={2.5} />
          </span>
        </button>

        <style>{`@keyframes demo-thread{from{stroke-dashoffset:400}to{stroke-dashoffset:0}}`}</style>
      </div>
    </DemoFrame>
  );
}

/* ============================================================================
   Shared
   ========================================================================== */

function DemoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[9.5rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-3.5">
      {children}
    </div>
  );
}

function Bar({ w, h = 3, tone = 'faint' }: { w: string; h?: number; tone?: 'ink' | 'faint' }) {
  return (
    <span
      className="block"
      style={{
        width: w,
        height: h,
        borderRadius: 1,
        background: tone === 'ink' ? 'var(--ink-primary)' : 'var(--ink-faint)',
        opacity: tone === 'ink' ? 0.7 : 0.34,
      }}
    />
  );
}

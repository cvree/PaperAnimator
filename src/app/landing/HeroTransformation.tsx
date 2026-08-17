import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';

/**
 * The hero mechanism: a page of a paper disassembling into a storyboard, with
 * threads drawn back to where each piece came from.
 *
 * It runs once — its impact comes from scarcity, not from looping. Under reduced
 * motion it renders its final composed state immediately, which carries exactly
 * the same information.
 *
 * The threads are measured from the live DOM, so they connect the real elements
 * at any viewport size rather than approximating with hardcoded coordinates.
 */

type Thread = { id: string; d: string };

const ANCHORS = ['stat', 'figure', 'quote'] as const;

export function HeroTransformation({ reducedMotion }: { reducedMotion: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const sourceRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  /* ---- measure the threads from the live layout ----------------------- */
  useLayoutEffect(() => {
    const measure = () => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      const next: Thread[] = [];
      for (const key of ANCHORS) {
        const from = sourceRefs.current[key]?.getBoundingClientRect();
        const to = cardRefs.current[key]?.getBoundingClientRect();
        if (!from || !to) continue;
        const x1 = from.right - box.left;
        const y1 = from.top + from.height / 2 - box.top;
        const x2 = to.left - box.left;
        const y2 = to.top + to.height / 2 - box.top;
        const dx = Math.max(28, (x2 - x1) * 0.52);
        next.push({ id: key, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}` });
      }
      setThreads(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 240);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, []);

  /* ---- the choreography ----------------------------------------------- */
  useEffect(() => {
    if (!root.current) return;

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);

      if (reducedMotion) {
        gsap.set(q('[data-piece]'), { opacity: 0.42, x: 0, y: 0, scale: 1 });
        gsap.set(q('[data-card]'), { opacity: 1, y: 0, scale: 1 });
        gsap.set(q('[data-thread]'), { opacity: 0.5, strokeDashoffset: 0 });
        gsap.set(q('[data-lift]'), { opacity: 1 });
        gsap.set(q('[data-scan]'), { opacity: 0 });
        gsap.set(q('[data-marker]'), { scaleX: 1 });
        return;
      }

      gsap.set(q('[data-card]'), { opacity: 0, y: 26, scale: 0.965 });
      gsap.set(q('[data-thread]'), { opacity: 0 });
      gsap.set(q('[data-lift]'), { opacity: 0 });
      gsap.set(q('[data-marker]'), { scaleX: 0, transformOrigin: 'left center' });
      gsap.set(q('[data-scan]'), { opacity: 0, y: 0 });
      gsap.set(q('[data-sheet]'), { opacity: 0, y: 18, rotateX: 3 });
      gsap.set(q('[data-greek]'), { opacity: 0, scaleX: 0.82, transformOrigin: 'left center' });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, delay: 0.15 });

      // 1 — the page arrives and settles. A beat of stillness before anything moves.
      tl.to(q('[data-sheet]'), { opacity: 1, y: 0, rotateX: 0, duration: 0.85 })
        .to(
          q('[data-greek]'),
          { opacity: 1, scaleX: 1, duration: 0.5, stagger: { each: 0.012, from: 'start' } },
          '-=0.55',
        )

        // 2 — a reading pass sweeps down the page
        .to(q('[data-scan]'), { opacity: 1, duration: 0.18 }, '+=0.12')
        .to(q('[data-scan]'), { y: '100%', duration: 1.25, ease: 'power2.inOut' }, '<')
        .to(q('[data-scan]'), { opacity: 0, duration: 0.28 }, '-=0.3')

        // 3 — what it found lights up, in reading order
        .to(q('[data-marker]'), { scaleX: 1, duration: 0.42, ease: 'power2.inOut' }, '-=1.05')
        .to(q('[data-lift]'), { opacity: 1, duration: 0.3, stagger: 0.1 }, '-=0.85')

        // 4 — the pieces detach and cross to the storyboard
        .to(
          q('[data-piece]'),
          {
            x: (i: number) => 40 + i * 6,
            y: (i: number) => -8 + i * 4,
            scale: 1.03,
            duration: 0.5,
            ease: 'power2.in',
            stagger: 0.08,
          },
          '-=0.2',
        )
        .to(q('[data-piece]'), { opacity: 0, duration: 0.28, stagger: 0.08 }, '-=0.34')

        // 5 — and land as scenes
        .to(
          q('[data-card]'),
          { opacity: 1, y: 0, scale: 1, duration: 0.62, stagger: 0.11, ease: 'power3.out' },
          '-=0.42',
        )

        // the page keeps what it always had — the presentation only refers to it
        .to(
          q('[data-piece]'),
          { x: 0, y: 0, scale: 1, opacity: 0.42, duration: 0.5, ease: 'power2.out' },
          '-=0.5',
        )

        // 6 — each scene proves where it came from
        .to(
          q('[data-thread]'),
          { opacity: 0.55, duration: 0.3, stagger: 0.09 },
          '-=0.3',
        )
        .fromTo(
          q('[data-thread]'),
          { strokeDashoffset: (_i: number, el: Element) => (el as SVGPathElement).getTotalLength?.() ?? 400 },
          { strokeDashoffset: 0, duration: 0.75, stagger: 0.09, ease: 'power2.inOut' },
          '<',
        )

        // 7 — stillness
        .to(q('[data-lift]'), { opacity: 0.55, duration: 0.6 }, '+=0.15');
    }, root);

    return () => ctx.revert();
  }, [reducedMotion, threads.length]);

  return (
    <div
      ref={root}
      className="relative w-full"
      style={{ perspective: '1400px' }}
      aria-hidden="true"
    >
      {/* Threads sit above the page and below the cards' text */}
      <svg
        className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
        fill="none"
      >
        {threads.map((t) => {
          const len = 900;
          return (
            <path
              key={t.id}
              data-thread
              d={t.d}
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray={len}
              strokeDashoffset={len}
              strokeLinecap="round"
              opacity={0}
            />
          );
        })}
      </svg>

      <div className="grid grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] gap-[clamp(1.25rem,3vw,2.75rem)] items-center">
        <PaperSheet sourceRefs={sourceRefs} />
        <Storyboard cardRefs={cardRefs} />
      </div>
    </div>
  );
}

/* ============================================================================
   The page
   ========================================================================== */

function PaperSheet({ sourceRefs }: { sourceRefs: React.RefObject<Record<string, HTMLElement | null>> }) {
  return (
    <div
      data-sheet
      className="sheen grain relative aspect-[1/1.33] w-full overflow-hidden rounded-[3px] bg-[var(--surface-raised)]"
      style={{
        boxShadow: 'var(--shadow-lift)',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* the reading pass */}
      <div
        data-scan
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[22%]"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, color-mix(in oklch, var(--accent) 9%, transparent) 62%, color-mix(in oklch, var(--accent) 22%, transparent) 96%, var(--accent) 100%)',
        }}
      />

      <div className="flex h-full flex-col gap-[2.6%] p-[7.5%]">
        {/* masthead */}
        <div className="space-y-[3px]">
          <Greek w="34%" h={2.5} tone="faint" />
        </div>
        <div className="space-y-[5px]">
          <Greek w="96%" h={6} tone="ink" />
          <Greek w="72%" h={6} tone="ink" />
        </div>
        <div className="flex gap-[6px] pt-[2px]">
          <Greek w="18%" h={2.5} tone="faint" />
          <Greek w="14%" h={2.5} tone="faint" />
          <Greek w="20%" h={2.5} tone="faint" />
        </div>

        <div className="mt-[3%] h-px w-full bg-[var(--rule-hairline)]" />

        {/* two columns */}
        <div className="grid flex-1 grid-cols-2 gap-[7%] pt-[3%]">
          <div className="flex flex-col gap-[9px]">
            <GreekBlock lines={6} />
            {/* the sentence that becomes a statistic */}
            <div
              ref={(el) => {
                sourceRefs.current.stat = el;
              }}
              className="relative py-[2px]"
            >
              <div
                data-marker
                className="absolute inset-x-[-3px] inset-y-[-1px] rounded-[1px]"
                style={{ background: 'var(--hl-yellow)', opacity: 0.62 }}
              />
              <div data-piece className="relative flex flex-col gap-[5px]">
                <Greek w="100%" h={2.5} tone="ink" />
                <Greek w="88%" h={2.5} tone="ink" />
              </div>
              <div
                data-lift
                className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            </div>
            <GreekBlock lines={7} />
          </div>

          <div className="flex flex-col gap-[9px]">
            <GreekBlock lines={3} />
            {/* the figure */}
            <div
              ref={(el) => {
                sourceRefs.current.figure = el;
              }}
              className="relative"
            >
              <div data-piece>
                <MiniChart />
              </div>
              <div
                data-lift
                className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            </div>
            <Greek w="70%" h={2} tone="faint" />
            <GreekBlock lines={3} />
            {/* the quotable line */}
            <div
              ref={(el) => {
                sourceRefs.current.quote = el;
              }}
              className="relative"
            >
              <div data-piece className="flex flex-col gap-[5px]">
                <Greek w="94%" h={2.5} tone="ink" />
                <Greek w="64%" h={2.5} tone="ink" />
              </div>
              <div
                data-lift
                className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            </div>
            <GreekBlock lines={4} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Greek({ w, h, tone }: { w: string; h: number; tone: 'ink' | 'faint' }) {
  const isTitle = h >= 5;
  const alpha = isTitle ? 62 : tone === 'ink' ? 26 : 18;
  return (
    <div
      data-greek
      style={{
        width: w,
        height: h,
        borderRadius: h > 4 ? 2 : 1,
        background: `color-mix(in oklch, var(--ink-primary) ${alpha}%, transparent)`,
      }}
    />
  );
}

const BLOCK_WIDTHS = ['100%', '97%', '99%', '94%', '100%', '88%', '96%', '92%'];

function GreekBlock({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-[6px]">
      {Array.from({ length: lines }, (_, i) => (
        <Greek key={i} w={BLOCK_WIDTHS[i % BLOCK_WIDTHS.length]} h={2} tone="ink" />
      ))}
    </div>
  );
}

/** A small honest chart — the same data appears on the storyboard card. */
function MiniChart({ large = false }: { large?: boolean }) {
  const bars = [0.42, 0.66, 0.58, 0.86, 0.74];
  return (
    <svg
      viewBox="0 0 100 62"
      className="w-full"
      style={{ height: large ? '100%' : 'auto' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1="9" y1="52" x2="97" y2="52" stroke="var(--rule-strong)" strokeWidth="0.6" />
      <line x1="9" y1="4" x2="9" y2="52" stroke="var(--rule-strong)" strokeWidth="0.6" />
      {bars.map((v, i) => (
        <rect
          key={i}
          x={15 + i * 16}
          y={52 - v * 44}
          width="9.5"
          height={v * 44}
          fill={i === 3 ? 'var(--accent)' : 'var(--ink-faint)'}
          opacity={i === 3 ? 0.92 : 0.5}
        />
      ))}
    </svg>
  );
}

/* ============================================================================
   The storyboard
   ========================================================================== */

function Storyboard({ cardRefs }: { cardRefs: React.RefObject<Record<string, HTMLElement | null>> }) {
  return (
    <div className="relative flex flex-col gap-[clamp(0.6rem,1.4vw,1rem)]">
      <SceneCard
        innerRef={(el) => {
          cardRefs.current.stat = el;
        }}
        index={1}
        kind="Finding"
      >
        <div className="flex h-full flex-col justify-center px-[8%]">
          <div
            className="numeral leading-none text-[var(--ink-primary)]"
            style={{ fontSize: 'clamp(1.6rem,3.6vw,2.6rem)', letterSpacing: '-0.04em' }}
          >
            31.4%
          </div>
          <div
            className="mt-[3%] text-[var(--ink-tertiary)]"
            style={{ fontSize: 'clamp(0.5rem,0.85vw,0.7rem)' }}
          >
            95% CI 24.8–37.9
          </div>
        </div>
      </SceneCard>

      <SceneCard
        innerRef={(el) => {
          cardRefs.current.figure = el;
        }}
        index={2}
        kind="Figure 3"
      >
        <div className="flex h-full items-center px-[8%] py-[6%]">
          <MiniChart large />
        </div>
      </SceneCard>

      <SceneCard
        innerRef={(el) => {
          cardRefs.current.quote = el;
        }}
        index={3}
        kind="Quote"
      >
        <div className="flex h-full flex-col justify-center px-[8%]">
          <div
            className="font-display leading-[1.24] text-[var(--ink-primary)]"
            style={{ fontSize: 'clamp(0.62rem,1.15vw,0.92rem)', letterSpacing: '-0.01em' }}
          >
            “The effect persisted at twelve months.”
          </div>
        </div>
      </SceneCard>
    </div>
  );
}

function SceneCard({
  innerRef,
  index,
  kind,
  children,
}: {
  innerRef: (el: HTMLElement | null) => void;
  index: number;
  kind: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-card
      ref={innerRef}
      className="sheen relative overflow-hidden rounded-[3px] border border-[var(--rule-hairline)] bg-[var(--surface-raised)]"
      style={{ boxShadow: 'var(--shadow-raised)', aspectRatio: '16 / 7.6' }}
    >
      <div className="absolute left-0 top-0 z-10 flex items-center gap-1.5 px-[6%] py-[4%]">
        <span
          className="numeral text-[var(--ink-faint)]"
          style={{ fontSize: 'clamp(0.42rem,0.72vw,0.6rem)' }}
        >
          {String(index).padStart(2, '0')}
        </span>
        <span
          className="label"
          style={{ fontSize: 'clamp(0.4rem,0.66vw,0.55rem)', letterSpacing: '0.11em' }}
        >
          {kind}
        </span>
      </div>
      {children}
      <div
        className="absolute bottom-0 left-0 h-[2px] bg-[var(--ev-extracted)]"
        style={{ width: '100%', opacity: 0.85 }}
      />
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/state/store';

/**
 * A segmented control with a single physical selector that slides.
 *
 * Recolouring one of several boxes reads as a state change; moving one object
 * reads as a mechanism. The indicator is measured from the real buttons so it
 * stays exact at any text length or zoom, and it settles rather than stops —
 * the small overshoot in the easing is what makes it feel like an object.
 *
 * Keyboard follows the radiogroup pattern: one tab stop, arrows move and select.
 */

export interface SegmentedOption {
  value: string;
  label: string;
}

export function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const reducedMotion = useApp((s) => s.reducedMotion);
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ x: number; w: number; h: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const settled = useRef(false);

  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current[index];
      const host = track.current;
      if (!el || !host) return;
      const a = el.getBoundingClientRect();
      const b = host.getBoundingClientRect();
      setIndicator({ x: a.left - b.left, w: a.width, h: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (track.current) ro.observe(track.current);
    for (const b of buttons.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [index, options.length]);

  // The first placement must not animate in from the left edge.
  useEffect(() => {
    if (indicator) {
      const id = requestAnimationFrame(() => {
        settled.current = true;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [indicator]);

  const move = (delta: number) => {
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
      className="relative isolate flex w-full rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-sunken)] p-[3px]"
    >
      {indicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-[3px] -z-10 rounded-[calc(var(--radius-sm)-3px)]"
          style={{
            width: indicator.w,
            height: indicator.h,
            background: 'var(--surface-inverse)',
            boxShadow: '0 1px 2px color-mix(in oklch, var(--ink-primary) 22%, transparent)',
            transform: `translate3d(${indicator.x}px,0,0) scaleX(${pressed ? 0.96 : 1})`,
            transition:
              reducedMotion || !settled.current
                ? 'none'
                : 'transform 380ms cubic-bezier(.22,1.2,.36,1)',
          }}
        />
      )}
      {options.map((o, i) => {
        const active = i === index;
        return (
          <button
            key={o.value}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            onClick={() => onChange(o.value)}
            className="relative flex-1 whitespace-nowrap rounded-[calc(var(--radius-sm)-3px)] px-2.5 py-[0.4rem] text-center text-2xs outline-offset-2"
            style={{
              color: active ? 'var(--ink-inverse)' : 'var(--ink-tertiary)',
              fontWeight: active ? 500 : 400,
              transition: reducedMotion ? 'none' : 'color 220ms ease',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

const base =
  'relative inline-flex items-center justify-center gap-2 font-medium select-none ' +
  'transition-[background-color,color,border-color,box-shadow,transform] duration-[160ms] ' +
  '[transition-timing-function:var(--ease-out)] disabled:opacity-45 disabled:pointer-events-none ' +
  'active:translate-y-[0.5px] whitespace-nowrap';

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] ' +
    'shadow-[0_1px_2px_oklch(20%_0.012_85/0.18)] hover:shadow-[0_2px_8px_oklch(20%_0.012_85/0.22)]',
  secondary:
    'bg-[var(--surface-raised)] text-[var(--ink-primary)] border border-[var(--rule-strong)] ' +
    'hover:border-[var(--ink-faint)] hover:bg-[var(--surface-page)]',
  ghost:
    'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--surface-sunken)]',
  quiet:
    'text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)] border border-transparent hover:border-[var(--rule-hairline)]',
  danger: 'bg-[var(--danger)] text-white hover:brightness-110',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-[var(--radius-sm)]',
  md: 'h-9 px-3.5 text-xs rounded-[var(--radius-md)]',
  lg: 'h-12 px-6 text-base rounded-[var(--radius-md)]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={clsx(base, variants[variant], sizes[size], className)}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 7 7"
          to="360 7 7"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

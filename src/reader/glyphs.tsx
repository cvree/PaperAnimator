import type { InstrumentId } from './instruments';

/**
 * One glyph per instrument. Drawn rather than lettered, so the dock reads at a
 * glance and stays legible at 16px in both themes.
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Glyph({ id, size = 16 }: { id: InstrumentId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {paths[id]}
    </svg>
  );
}

const paths: Record<InstrumentId, React.ReactNode> = {
  statement: (
    <g {...S}>
      <path d="M2.5 4.5h11" strokeWidth={2.2} />
      <path d="M2.5 8h8M2.5 11.5h10" />
    </g>
  ),
  number: (
    <g {...S}>
      <path d="M3 12.5V5.2L5.6 3.6v8.9" strokeWidth={1.8} />
      <circle cx="11" cy="6" r="2.1" />
      <path d="M9.2 12.4 12.8 4" />
    </g>
  ),
  quote: (
    <g {...S}>
      <path d="M5.6 4.2C4 5 3.2 6.2 3.2 7.9h2.1v3.9H2.4V8.3C2.4 6 3.5 4.5 5.2 3.6zM13 4.2c-1.6.8-2.4 2-2.4 3.7h2.1v3.9H9.8V8.3c0-2.3 1.1-3.8 2.8-4.7z" />
    </g>
  ),
  build: (
    <g {...S}>
      <path d="M2.6 4.4h1.2M2.6 8h1.2M2.6 11.6h1.2" strokeWidth={2} />
      <path d="M6.4 4.4h7M6.4 8h7M6.4 11.6h4.6" />
    </g>
  ),
  beats: (
    <g {...S}>
      <rect x="1.6" y="4.6" width="3.6" height="6.8" rx="0.7" />
      <rect x="6.2" y="4.6" width="3.6" height="6.8" rx="0.7" />
      <rect x="10.8" y="4.6" width="3.6" height="6.8" rx="0.7" />
    </g>
  ),
  figure: (
    <g {...S}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="5.6" cy="6.3" r="1.1" />
      <path d="m2.6 11.4 3.2-3 2.4 2.2 2.6-2.8 3.1 3.4" />
    </g>
  ),
  spotlight: (
    <g {...S}>
      <path d="m3.2 12.8 1.2-3 5.9-5.9a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1l-5.9 5.9z" />
      <path d="M2.2 14.6h5.6" strokeWidth={2} />
    </g>
  ),
  append: (
    <g {...S}>
      <rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.2" />
      <path d="M8 5.8v4.4M5.8 8h4.4" />
    </g>
  ),
  narrate: (
    <g {...S}>
      <path d="M8 2.6a2 2 0 0 1 2 2v3.6a2 2 0 1 1-4 0V4.6a2 2 0 0 1 2-2z" />
      <path d="M3.8 8.2a4.2 4.2 0 0 0 8.4 0M8 12.4v2" />
    </g>
  ),
  title: (
    <g {...S}>
      <path d="M3 4.2h10M8 4.2v6.4" strokeWidth={1.9} />
      <path d="M2.4 13.4h11.2" />
    </g>
  ),
  compare: (
    <g {...S}>
      <path d="M2.4 3.6h4.2M2.4 6.6h4.2M2.4 9.6h3" />
      <path d="M9.4 3.6h4.2M9.4 6.6h4.2M9.4 9.6h3" />
      <path d="M8 2v12" strokeDasharray="1.6 1.8" />
    </g>
  ),
};

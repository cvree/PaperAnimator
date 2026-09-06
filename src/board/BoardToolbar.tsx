import type { ReactNode } from 'react';
import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { boardBounds, cameraFor, clampZoom } from './board';
import { EffectsMenu } from './EffectsMenu';
import { useBoardUi, type Tool } from './boardStore';
import type { Surface } from './types';

/**
 * The tools, the surface and the way out.
 *
 * The surface switch is the loudest control here on purpose: turning the board
 * black is the one change that touches every card at once, and it is the first
 * thing anybody tries.
 */

const TOOLS: { id: Tool; label: string; key: string; glyph: ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', glyph: <Cursor /> },
  { id: 'hand', label: 'Pan', key: 'H', glyph: <Hand /> },
  { id: 'text', label: 'Text', key: 'T', glyph: <TextGlyph /> },
  { id: 'sticky', label: 'Note', key: 'N', glyph: <Square /> },
  { id: 'shape', label: 'Shape', key: 'R', glyph: <Shape /> },
  { id: 'pen', label: 'Pen', key: 'P', glyph: <Pen /> },
  { id: 'stop', label: 'Slide', key: 'F', glyph: <Frame /> },
];

export function BoardToolbar({ onPublish }: { onPublish: () => void }) {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const tool = useBoardUi((s) => s.tool);
  const setTool = useBoardUi((s) => s.setTool);
  const camera = useBoardUi((s) => s.camera);
  const viewport = useBoardUi((s) => s.viewport);
  const setMode = useBoardUi((s) => s.setMode);
  const drawerOpen = useBoardUi((s) => s.drawerOpen);
  const setDrawerOpen = useBoardUi((s) => s.setDrawerOpen);

  const board = project?.board;
  if (!board) return null;

  const setSurface = (surface: Surface) =>
    mutate('Change the board', (d) => {
      d.board.surface = surface;
    });

  const zoomBy = (factor: number) =>
    useBoardUi.getState().setCamera({ ...camera, zoom: clampZoom(camera.zoom * factor) });

  const fit = () => {
    const bounds = boardBounds(board);
    if (bounds) useBoardUi.getState().flyTo(cameraFor(bounds, viewport.w, viewport.h));
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-2">
      <button
        type="button"
        onClick={() => setDrawerOpen(!drawerOpen)}
        aria-pressed={drawerOpen}
        title="Content from the paper"
        className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-2xs transition-colors"
        style={{
          borderColor: drawerOpen ? 'var(--accent)' : 'var(--rule-hairline)',
          background: drawerOpen ? 'var(--accent-subtle)' : 'transparent',
          color: 'var(--ink-secondary)',
        }}
      >
        Paper
      </button>

      <div className="mx-0.5 h-6 w-px bg-[var(--rule-hairline)]" />

      <div className="flex items-center gap-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
            title={`${t.label} · ${t.key}`}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors"
            style={{
              background: tool === t.id ? 'var(--surface-inverse)' : 'transparent',
              color: tool === t.id ? 'var(--ink-inverse)' : 'var(--ink-tertiary)',
            }}
          >
            {t.glyph}
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="mx-0.5 h-6 w-px bg-[var(--rule-hairline)]" />

      {/* The board itself: lights on, lights off. */}
      <div
        role="group"
        aria-label="Board colour"
        className="flex items-center gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] p-0.5"
      >
        {(['white', 'black'] as Surface[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSurface(s)}
            aria-pressed={board.surface === s}
            title={s === 'white' ? 'Whiteboard' : 'Blackboard'}
            className="flex h-7 w-7 items-center justify-center rounded-[2px] transition-transform"
            style={{
              background: s === 'white' ? '#fbfaf7' : '#14171a',
              border: `1px solid ${board.surface === s ? 'var(--accent)' : 'var(--rule-hairline)'}`,
              boxShadow: board.surface === s ? '0 0 0 2px var(--accent-quiet)' : 'none',
            }}
          >
            <span className="sr-only">{s === 'white' ? 'Whiteboard' : 'Blackboard'}</span>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 2,
                background: s === 'white' ? '#171614' : '#f2f4f6',
                borderRadius: 1,
              }}
            />
          </button>
        ))}
      </div>

      <select
        aria-label="Grid"
        value={board.grid}
        onChange={(e) =>
          mutate('Change the grid', (d) => {
            d.board.grid = e.target.value as typeof board.grid;
          })
        }
        className="h-8 rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-transparent px-2 text-2xs text-[var(--ink-secondary)]"
      >
        <option value="dots">Dots</option>
        <option value="lines">Lines</option>
        <option value="none">Plain</option>
      </select>

      <EffectsMenu />

      <div className="ml-auto flex items-center gap-1.5">
        <div className="hidden items-center gap-0.5 sm:flex">
          <IconBtn label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            −
          </IconBtn>
          <button
            type="button"
            onClick={fit}
            title="Fit everything · ⌘0"
            className="numeral h-8 min-w-[3.6rem] rounded-[var(--radius-sm)] px-1 text-2xs tabular-nums text-[var(--ink-secondary)] hover:bg-[var(--surface-sunken)]"
          >
            {Math.round(camera.zoom * 100)}%
          </button>
          <IconBtn label="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </IconBtn>
        </div>

        <Button size="sm" variant="secondary" onClick={() => setMode('present')}>
          Present
        </Button>
        <Button size="sm" variant="primary" onClick={onPublish}>
          Get the link
        </Button>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-sm text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-primary)]"
    >
      {children}
    </button>
  );
}

/* ---- glyphs: drawn, not imported ---------------------------------------- */

function Cursor() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 2l8 4.6-3.4.9L6.4 11 3 2z" fill="currentColor" />
    </svg>
  );
}
function Hand() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5 7V3.6a1 1 0 1 1 2 0V6m0 0V2.8a1 1 0 1 1 2 0V6m0 0V4.2a1 1 0 1 1 2 0V8.5c0 2-1.4 3.2-3.3 3.2S3 10.6 3 8.8V7.4a1 1 0 0 1 2 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function TextGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3h8M7 3v8M5.5 11h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function Square() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3h8v5.5L8.5 11H3V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M11 8.5H8.5V11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
function Shape() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2.5" y="4" width="9" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function Pen() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 11.5l1-2.6 5.2-5.2 1.6 1.6-5.2 5.2-2.6 1zM9.4 2.7l1-1a.8.8 0 0 1 1.1 0l.8.8a.8.8 0 0 1 0 1.1l-1 1"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Frame() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="10" height="7" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 2v10M9.5 2v10" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
    </svg>
  );
}

import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { Mark } from '../landing/Landing';
import { STYLES, STYLE_ORDER } from '@/render/styles';
import { Segmented } from '@/ui/Segmented';
import type { StyleId } from '@/core/types';
import { useState } from 'react';

export function EditorTopBar() {
  const project = useApp((s) => s.project);
  const integrity = useApp((s) => s.integrity);
  const view = useApp((s) => s.editorView);
  const setView = useApp((s) => s.setEditorView);
  const disclosure = useApp((s) => s.disclosure);
  const setDisclosure = useApp((s) => s.setDisclosure);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const past = useApp((s) => s.past.length);
  const future = useApp((s) => s.future.length);
  const setStyle = useApp((s) => s.setStyle);
  const [styleOpen, setStyleOpen] = useState(false);

  if (!project) return null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Mark />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium leading-tight text-[var(--ink-primary)]">
            {project.title}
          </p>
          <p className="hidden text-2xs leading-tight text-[var(--ink-faint)] sm:block">
            {project.scenes.length} scenes · {project.paper.meta.pageCount} pages
          </p>
        </div>
      </div>

      <div className="mx-1 hidden h-6 w-px shrink-0 bg-[var(--rule-hairline)] sm:block" />

      {/* Undo and redo need room the phone does not have; they stay on the
          keyboard there, and the storyboard offers the same corrections. */}
      <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
        <IconBtn label="Undo" disabled={past === 0} onClick={undo}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M4 5H9a3 3 0 0 1 0 6H6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="m6 2.5-2.6 2.6L6 7.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconBtn>
        <IconBtn label="Redo" disabled={future === 0} onClick={redo}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M10 5H5a3 3 0 0 0 0 6h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="m8 2.5 2.6 2.6L8 7.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconBtn>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* style picker */}
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setStyleOpen((v) => !v)}
            aria-expanded={styleOpen}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] px-2.5 text-2xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--rule-strong)]"
          >
            <StyleChip id={project.style} size={16} />
            {STYLES[project.style].name}
            <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" className="opacity-50">
              <path
                d="M1 1l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {styleOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setStyleOpen(false)} />
              <div
                className="absolute right-0 top-9 z-50 w-52 overflow-hidden rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] py-1"
                style={{ boxShadow: 'var(--shadow-float)' }}
              >
                {STYLE_ORDER.map((id: StyleId) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setStyle(id);
                      setStyleOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)]"
                  >
                    <StyleChip id={id} size={26} />
                    <span className="min-w-0">
                      <span className="block text-xs text-[var(--ink-primary)]">
                        {STYLES[id].name}
                      </span>
                      <span className="block truncate text-2xs text-[var(--ink-faint)]">
                        {STYLES[id].description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* disclosure */}
        <div className="hidden w-[13rem] md:block">
          <Segmented
            label="How much of the editor to show"
            options={[
              { value: 'simple', label: 'Simple' },
              { value: 'studio', label: 'Studio' },
              { value: 'pro', label: 'Pro' },
            ]}
            value={disclosure}
            onChange={(d) => setDisclosure(d as typeof disclosure)}
          />
        </div>

        <IntegrityMeter
          score={integrity?.score ?? 100}
          issues={integrity?.issues.length ?? 0}
          active={view === 'integrity'}
          onClick={() => setView(view === 'integrity' ? 'compose' : 'integrity')}
        />

        <Button variant="primary" size="md" onClick={() => setView('export')}>
          Export
        </Button>
      </div>
    </header>
  );
}

/**
 * A style shown as what it produces: its ground, its ink, its accent. A plain
 * swatch of Broadsheet's paper white against a white toolbar looks like an
 * empty checkbox.
 */
function StyleChip({ id, size }: { id: StyleId; size: number }) {
  const t = STYLES[id].tokens;
  return (
    <span
      className="flex shrink-0 flex-col justify-end gap-[2px] rounded-[2px] border border-[var(--rule-hairline)] p-[3px]"
      style={{ width: size, height: size, background: t.ground }}
      aria-hidden="true"
    >
      <span style={{ height: Math.max(1, size / 10), background: t.ink, borderRadius: 1 }} />
      <span
        style={{ height: Math.max(1, size / 14), width: '58%', background: t.accent, borderRadius: 1 }}
      />
    </span>
  );
}

function IconBtn({
  label,
  children,
  disabled,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-primary)] disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export function IntegrityMeter({
  score,
  issues,
  active,
  onClick,
}: {
  score: number;
  issues: number;
  active: boolean;
  onClick: () => void;
}) {
  const tone =
    score >= 90 ? 'var(--ev-extracted)' : score >= 70 ? 'var(--ev-unsupported)' : 'var(--danger)';
  const r = 9;
  const c = 2 * Math.PI * r;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Source integrity: ${score} of 100${issues ? ` · ${issues} to review` : ''}`}
      className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border px-2 transition-colors"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--rule-hairline)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
      }}
    >
      <span className="relative flex h-[22px] w-[22px] items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90" aria-hidden="true">
          <circle cx="11" cy="11" r={r} fill="none" stroke="var(--rule-hairline)" strokeWidth="2" />
          <circle
            cx="11"
            cy="11"
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
            style={{ transition: 'stroke-dashoffset 400ms var(--ease-out)' }}
          />
        </svg>
      </span>
      <span className="numeral hidden text-2xs tabular-nums text-[var(--ink-secondary)] sm:inline">
        {score}
      </span>
      <span className="sr-only">{score} out of 100 grounded</span>
    </button>
  );
}

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import type { Artifact, ProgressStage } from '@/extract/pdf';
import type { Figure, PaperMeta, Section } from '@/core/types';
import { Button } from '@/ui/Button';
import { Mark } from '../landing/Landing';

/**
 * Processing shows real partial results as they land. There is no spinner
 * standing in for work — the title appears when the title is parsed, figures
 * appear as they are cropped, the outline builds itself.
 */

export interface ProcessingState {
  stage: ProgressStage | null;
  artifacts: Artifact[];
  error: { title: string; detail: string; remedy?: string } | null;
  fileName: string;
}

const STAGE_ORDER = [
  { key: 'intake', label: 'Opening the file' },
  { key: 'pages', label: 'Reading pages' },
  { key: 'structure', label: 'Finding the structure' },
  { key: 'figures', label: 'Lifting figures' },
  { key: 'tables', label: 'Reading tables' },
  { key: 'references', label: 'Matching citations' },
  { key: 'statistics', label: 'Binding numbers' },
  { key: 'comprehension', label: 'Reading for the argument' },
] as const;

export function Processing({
  state,
  onCancel,
  reducedMotion,
}: {
  state: ProcessingState;
  onCancel: () => void;
  reducedMotion: boolean;
}) {
  const stageIndex = state.stage
    ? STAGE_ORDER.findIndex((s) => s.key === state.stage!.stage)
    : 0;

  const meta = lastOf(state.artifacts, 'meta')?.meta ?? null;
  const sections = state.artifacts.filter((a) => a.type === 'section') as Extract<Artifact, { type: 'section' }>[];
  const figures = state.artifacts.filter((a) => a.type === 'figure') as Extract<Artifact, { type: 'figure' }>[];
  const pages = state.artifacts.filter((a) => a.type === 'page').length;
  const stats = lastOf(state.artifacts, 'statistic')?.count ?? 0;

  const pageProgress =
    state.stage?.stage === 'pages' ? state.stage.done / Math.max(1, state.stage.total) : 1;
  const overall = Math.min(
    0.99,
    (stageIndex + (state.stage?.stage === 'pages' ? pageProgress : 0.5)) / STAGE_ORDER.length,
  );

  if (state.error) {
    return <ExtractionError error={state.error} onCancel={onCancel} fileName={state.fileName} />;
  }

  return (
    <div className="grain relative flex min-h-dvh flex-col">
      <header className="border-b border-[var(--rule-hairline)]">
        <div className="mx-auto flex h-14 w-full max-w-[86rem] items-center justify-between px-[max(1.25rem,4vw)]">
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="font-display text-base font-medium text-[var(--ink-primary)]">
              Paper Animator
            </span>
          </div>
          <Button variant="quiet" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[86rem] flex-1 flex-col px-[max(1.25rem,4vw)] py-[clamp(2rem,5vw,4rem)]">
        <div className="grid flex-1 gap-[clamp(2rem,5vw,4.5rem)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {/* ---- left: what is happening ---- */}
          <div className="flex flex-col">
            <p className="label mb-4">Reading your paper</p>
            <h1 className="display-md max-w-[16ch] text-[var(--ink-primary)]">
              {meta?.title ?? state.fileName.replace(/\.pdf$/i, '')}
            </h1>

            <div
              className="mt-8 h-px w-full overflow-hidden bg-[var(--rule-hairline)]"
              role="progressbar"
              aria-valuenow={Math.round(overall * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Extraction progress"
            >
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                style={{ width: `${overall * 100}%` }}
              />
            </div>

            <ol className="mt-7 space-y-2.5">
              {STAGE_ORDER.map((s, i) => {
                const status = i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'waiting';
                return (
                  <li key={s.key} className="flex items-center gap-3">
                    <StageDot status={status} />
                    <span
                      className="text-xs transition-colors duration-300"
                      style={{
                        color:
                          status === 'waiting'
                            ? 'var(--ink-faint)'
                            : status === 'active'
                              ? 'var(--ink-primary)'
                              : 'var(--ink-tertiary)',
                        fontWeight: status === 'active' ? 500 : 400,
                      }}
                    >
                      {status === 'active' && state.stage
                        ? stageLabel(state.stage)
                        : s.label}
                    </span>
                  </li>
                );
              })}
            </ol>

            <dl className="mt-auto grid grid-cols-2 gap-x-6 gap-y-4 pt-10 sm:grid-cols-4 lg:grid-cols-2">
              <Counter label="Pages" value={pages} />
              <Counter label="Sections" value={sections.length} />
              <Counter label="Figures" value={figures.length} />
              <Counter label="Statistics" value={stats} />
            </dl>
          </div>

          {/* ---- right: real artifacts as they land ---- */}
          <div className="relative min-h-[24rem]">
            <ArtifactStream
              meta={meta}
              sections={sections.map((s) => s.section)}
              figures={figures.map((f) => f.figure)}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function stageLabel(stage: ProgressStage): string {
  if (stage.stage === 'pages') return stage.label;
  return stage.label;
}

function StageDot({ status }: { status: 'done' | 'active' | 'waiting' }) {
  if (status === 'done') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M3 7.2 5.9 10 11 4.5" stroke="var(--ev-extracted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center" aria-hidden="true">
        <span
          className="absolute h-[9px] w-[9px] rounded-full motion-safe:animate-[ping2_1.5s_ease-out_infinite]"
          style={{ background: 'var(--accent)', opacity: 0.28 }}
        />
        <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--accent)' }} />
        <style>{`@keyframes ping2{0%{transform:scale(0.6);opacity:0.4}100%{transform:scale(2.4);opacity:0}}`}</style>
      </span>
    );
  }
  return (
    <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center" aria-hidden="true">
      <span className="h-[5px] w-[5px] rounded-full border border-[var(--rule-strong)]" />
    </span>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="label mb-1">{label}</dt>
      <dd className="numeral text-xl leading-none text-[var(--ink-primary)] tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/* ============================================================================
   The artifact stream — real extracted things, appearing as they are found
   ========================================================================== */

function ArtifactStream({
  meta,
  sections,
  figures,
  reducedMotion,
}: {
  meta: PaperMeta | null;
  sections: Section[];
  figures: Figure[];
  reducedMotion: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (reducedMotion || !root.current) return;
    const nodes = root.current.querySelectorAll<HTMLElement>('[data-artifact]');
    const fresh: HTMLElement[] = [];
    nodes.forEach((n) => {
      const key = n.dataset.artifact!;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        fresh.push(n);
      }
    });
    if (fresh.length === 0) return;
    gsap.fromTo(
      fresh,
      { opacity: 0, y: 14, filter: 'blur(3px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.55, stagger: 0.05, ease: 'power3.out' },
    );
  });

  return (
    <div ref={root} className="flex flex-col gap-3">
      {meta?.abstract && (
        <div
          data-artifact="abstract"
          className="rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-5"
        >
          <p className="label mb-2.5">Abstract</p>
          <p className="line-clamp-4 text-xs leading-[1.6] text-[var(--ink-secondary)]">
            {meta.abstract}
          </p>
        </div>
      )}

      {figures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {figures.slice(-6).map((f) => (
            <figure
              key={f.id}
              data-artifact={`fig-${f.id}`}
              className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)]"
            >
              {f.image ? (
                <img
                  src={f.image}
                  alt={f.altText}
                  className="h-[5.5rem] w-full bg-white object-contain"
                />
              ) : (
                <div className="h-[5.5rem] w-full bg-[var(--surface-sunken)]" />
              )}
              <figcaption className="label border-t border-[var(--rule-hairline)] px-2.5 py-1.5">
                {f.label}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {sections.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-5">
          <p className="label mb-3">Outline</p>
          <ul className="space-y-1.5">
            {sections.slice(0, 12).map((s) => (
              <li
                key={s.id}
                data-artifact={`sec-${s.id}`}
                className="flex items-baseline gap-2.5 text-xs"
                style={{ paddingLeft: `${(s.level - 1) * 0.9}rem` }}
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--ink-faint)]" />
                <span className="truncate text-[var(--ink-secondary)]">{s.title}</span>
                {s.kind !== 'other' && (
                  <span className="label shrink-0" style={{ fontSize: '0.55rem' }}>
                    {s.kind.replace('-', ' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!meta && sections.length === 0 && figures.length === 0 && (
        <div className="flex h-full min-h-[18rem] items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--rule-hairline)]">
          <p className="text-xs text-[var(--ink-faint)]">
            What we find will appear here as it is read.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   Failure
   ========================================================================== */

function ExtractionError({
  error,
  onCancel,
  fileName,
}: {
  error: { title: string; detail: string; remedy?: string };
  onCancel: () => void;
  fileName: string;
}) {
  return (
    <div className="grain flex min-h-dvh items-center justify-center px-[max(1.25rem,4vw)]">
      <div className="w-full max-w-[34rem]">
        <p className="label mb-4">Could not read this file</p>
        <h1 className="display-md text-[var(--ink-primary)]">{error.title}</h1>
        <p className="mt-5 text-lg leading-[1.6] text-[var(--ink-secondary)]">
          {error.detail}
        </p>
        {error.remedy && (
          <p className="mt-3 text-base leading-[1.6] text-[var(--ink-tertiary)]">
            {error.remedy}
          </p>
        )}
        <p className="mt-6 text-xs text-[var(--ink-faint)]">
          <span className="numeral">{fileName}</span> is still on your machine. Nothing was sent
          anywhere.
        </p>
        <div className="mt-8">
          <Button variant="primary" size="lg" onClick={onCancel}>
            Try another paper
          </Button>
        </div>
      </div>
    </div>
  );
}

function lastOf<T extends Artifact['type']>(
  artifacts: Artifact[],
  type: T,
): Extract<Artifact, { type: T }> | null {
  for (let i = artifacts.length - 1; i >= 0; i--) {
    if (artifacts[i].type === type) return artifacts[i] as Extract<Artifact, { type: T }>;
  }
  return null;
}

export const PROCESSING_STAGES = STAGE_ORDER;

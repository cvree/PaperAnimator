import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useApp, DEFAULT_SETTINGS } from '@/state/store';
import { composeScenes } from '@/compose/compose';
import { newId } from '@/core/id';
import type { Aspect, Audience, Project, ProjectSettings, Scene, StyleId } from '@/core/types';
import { Button } from '@/ui/Button';
import { Mark } from '../landing/Landing';
import { STYLES } from '@/render/styles';
import { ScenePreview } from '@/render/ScenePreview';
import { Segmented } from '@/ui/Segmented';
import { formatDuration } from '@/core/format';

/**
 * Setup is the reveal. The pieces that were pulled off the page during
 * extraction arrive here as scenes, and the paper becomes a storyboard.
 *
 * Every control changes something real and immediately visible — the previews
 * are rendered by the same code that renders the editor and the export.
 */

const DURATIONS = [
  { label: '60 sec', ms: 60_000 },
  { label: '3 min', ms: 180_000 },
  { label: '5 min', ms: 300_000 },
  { label: 'Full', ms: null },
] as const;

export function Setup({ onBack }: { onBack: () => void }) {
  const session = useApp((s) => s.session);
  const setProject = useApp((s) => s.setProject);
  const setPhase = useApp((s) => s.setPhase);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const markRevealDone = useApp((s) => s.markRevealDone);

  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [style, setStyle] = useState<StyleId>('broadsheet');
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);

  const paper = session?.paper ?? null;

  const scenes = useMemo(() => {
    if (!paper) return [];
    return composeScenes(paper, { settings, targetDurationMs: settings.targetDurationMs });
  }, [paper, settings]);

  const kept = useMemo(() => scenes.filter((s) => !dropped.has(s.id)), [scenes, dropped]);
  const totalMs = kept.reduce((sum, s) => sum + s.durationMs, 0);

  /* ---- the reveal ------------------------------------------------------ */
  useEffect(() => {
    if (!root.current || revealed.current) return;
    revealed.current = true;
    markRevealDone();

    if (reducedMotion) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('[data-reveal-title]', { y: 20, opacity: 0, duration: 0.7 })
        .from('[data-reveal-sub]', { y: 14, opacity: 0, duration: 0.55 }, '-=0.42')
        .from(
          '[data-scene-card]',
          {
            y: 34,
            opacity: 0,
            scale: 0.94,
            duration: 0.66,
            stagger: { each: 0.055, from: 'start' },
          },
          '-=0.3',
        )
        .from('[data-setup-panel]', { x: 18, opacity: 0, duration: 0.6 }, '-=0.5');
    }, root);
    return () => ctx.revert();
  }, [reducedMotion, markRevealDone]);

  if (!paper || !session) return null;

  const start = () => {
    const project: Project = {
      id: newId('project'),
      version: 1,
      title: paper.meta.title ?? 'Untitled paper',
      paper,
      settings,
      scenes: kept,
      style,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProject(project);
    setPhase('editor');
  };

  const degradations = paper.extraction.degradations;

  return (
    <div ref={root} className="grain flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--rule-hairline)] bg-[var(--surface-page)]">
        <div className="mx-auto flex h-14 w-full max-w-[92rem] items-center justify-between px-[max(1.25rem,3vw)]">
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="font-display text-base font-medium text-[var(--ink-primary)]">
              Paper Animator
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="quiet" size="sm" onClick={onBack}>
              Start over
            </Button>
            <Button variant="primary" size="md" onClick={start}>
              Open the editor
            </Button>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto w-full max-w-[92rem] flex-1 px-[max(1.25rem,3vw)] py-[clamp(2rem,4vw,3.5rem)]"
      >
        <div className="grid gap-[clamp(2rem,4vw,3.5rem)] lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* ---- storyboard ---- */}
          <div>
            <p className="label mb-3">Your storyboard</p>
            <h1
              data-reveal-title
              className="display-md max-w-[22ch] text-[var(--ink-primary)]"
            >
              {paper.meta.title ?? 'Untitled paper'}
            </h1>
            <p
              data-reveal-sub
              className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-tertiary)]"
            >
              <Count n={kept.length} one="scene" many="scenes" />
              <Dot />
              <span className="numeral">{formatDuration(totalMs)}</span>
              <Dot />
              <Count
                n={paper.figures.length + paper.tables.length}
                one="exhibit"
                many="exhibits"
              />
              <Dot />
              <Count n={paper.statistics.length} one="statistic" many="statistics" />
              <Dot />
              <span>
                traced to{' '}
                <strong className="numeral font-medium text-[var(--ink-secondary)]">
                  {paper.meta.pageCount}
                </strong>{' '}
                {paper.meta.pageCount === 1 ? 'page' : 'pages'}
              </span>
            </p>

            <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-4">
              {scenes.map((scene, i) => (
                <SceneTile
                  key={scene.id}
                  scene={scene}
                  index={i + 1}
                  style={style}
                  aspect={settings.aspect}
                  dropped={dropped.has(scene.id)}
                  onToggle={() =>
                    setDropped((prev) => {
                      const next = new Set(prev);
                      if (next.has(scene.id)) next.delete(scene.id);
                      else next.add(scene.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>

            {degradations.length > 0 && (
              <div className="mt-8 space-y-2">
                <p className="label mb-3">What we could not do</p>
                {degradations.map((d, i) => (
                  <div
                    key={i}
                    className="rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-4"
                  >
                    <p className="text-xs leading-[1.55] text-[var(--ink-primary)]">
                      {d.reason}
                    </p>
                    <p className="mt-1 text-xs leading-[1.55] text-[var(--ink-tertiary)]">
                      {d.impact}
                    </p>
                    {d.remedy && (
                      <p className="mt-1 text-2xs text-[var(--ink-faint)]">{d.remedy}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---- settings ---- */}
          <aside data-setup-panel className="lg:sticky lg:top-[5.5rem] lg:self-start">
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] shadow-[var(--shadow-raised)]">
              <div className="flex items-baseline justify-between border-b border-[var(--rule-hairline)] px-4 py-3">
                <p className="label">How it should look</p>
                <p className="numeral text-2xs text-[var(--ink-faint)]">
                  {formatDuration(totalMs)}
                </p>
              </div>

              <Field label="Visual style">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(STYLES) as StyleId[]).map((id) => (
                    <StyleSwatch
                      key={id}
                      id={id}
                      active={style === id}
                      onSelect={() => setStyle(id)}
                    />
                  ))}
                </div>
              </Field>

              <Field
                label="Audience"
                hint="Changes nothing about the facts — only what is explained."
              >
                <Segmented
                  label="Audience"
                  options={[
                    { value: 'expert', label: 'Expert' },
                    { value: 'informed', label: 'Informed' },
                    { value: 'general', label: 'General' },
                  ]}
                  value={settings.audience}
                  onChange={(audience) =>
                    setSettings((s) => ({ ...s, audience: audience as Audience }))
                  }
                />
              </Field>

              <Field label="Length" hint="Scenes are trimmed, never the evidence behind them.">
                <Segmented
                  label="Length"
                  options={DURATIONS.map((d) => ({ value: String(d.ms), label: d.label }))}
                  value={String(settings.targetDurationMs)}
                  onChange={(v) =>
                    setSettings((s) => ({ ...s, targetDurationMs: v === 'null' ? null : Number(v) }))
                  }
                />
              </Field>

              <Field label="Shape">
                <Segmented
                  label="Shape"
                  options={[
                    { value: '16:9', label: '16:9' },
                    { value: '1:1', label: '1:1' },
                    { value: '9:16', label: '9:16' },
                  ]}
                  value={settings.aspect}
                  onChange={(v) => setSettings((s) => ({ ...s, aspect: v as Aspect }))}
                />
              </Field>

              <Field label="Citations">
                <Segmented
                  label="Citations"
                  options={[
                    { value: 'corner', label: 'Corner' },
                    { value: 'inline', label: 'Inline' },
                    { value: 'end-card', label: 'End card' },
                    { value: 'none', label: 'None' },
                  ]}
                  value={settings.citationMode}
                  onChange={(v) =>
                    setSettings((s) => ({ ...s, citationMode: v as ProjectSettings['citationMode'] }))
                  }
                />
              </Field>

              <div className="border-t border-[var(--rule-hairline)] bg-[var(--surface-sunken)] px-4 py-4">
                <p className="label mb-2">Grounded by construction</p>
                <p className="text-xs leading-[1.55] text-[var(--ink-secondary)]">
                  Every sentence in these scenes is taken from your paper. Nothing was written for
                  you, so there is nothing to fact-check that the paper does not already say.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Dot() {
  return (
    <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--rule-strong)]" aria-hidden="true" />
  );
}

function Count({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <span>
      <strong className="numeral font-medium text-[var(--ink-secondary)]">{n}</strong>{' '}
      {n === 1 ? one : many}
    </span>
  );
}

function SceneTile({
  scene,
  index,
  style,
  aspect,
  dropped,
  onToggle,
}: {
  scene: Scene;
  index: number;
  style: StyleId;
  aspect: Aspect;
  dropped: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      data-scene-card
      className="group relative transition-opacity duration-200"
      style={{ opacity: dropped ? 0.38 : 1 }}
    >
      <div
        className="overflow-hidden rounded-[var(--radius-md)] border transition-all duration-200"
        style={{
          borderColor: dropped ? 'var(--rule-hairline)' : 'var(--rule-strong)',
          boxShadow: dropped ? 'none' : 'var(--shadow-raised)',
        }}
      >
        <ScenePreview scene={scene} styleId={style} aspect={aspect} />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="numeral text-2xs text-[var(--ink-faint)]">
          {String(index).padStart(2, '0')}
        </span>
        <span className="flex-1 truncate text-xs text-[var(--ink-secondary)]">
          {scene.title}
        </span>
        <span className="numeral text-2xs text-[var(--ink-faint)]">
          {(scene.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-2 top-2 rounded-[var(--radius-xs)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-2 py-1 text-2xs text-[var(--ink-secondary)] opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {dropped ? 'Include' : 'Skip'}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--rule-hairline)] px-4 py-4 last:border-b-0">
      <p className="label mb-2.5">{label}</p>
      {children}
      {hint && (
        <p className="mt-2.5 text-2xs leading-[1.5] text-[var(--ink-faint)]">{hint}</p>
      )}
    </div>
  );
}

function StyleSwatch({
  id,
  active,
  onSelect,
}: {
  id: StyleId;
  active: boolean;
  onSelect: () => void;
}) {
  const style = STYLES[id];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="group overflow-hidden rounded-[var(--radius-sm)] border text-left transition-all duration-200"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--rule-hairline)',
        boxShadow: active ? '0 0 0 1px var(--accent)' : 'none',
      }}
    >
      <div
        className="relative flex h-14 flex-col justify-end gap-1 p-2.5"
        style={{ background: style.tokens.ground }}
      >
        <div
          style={{
            width: '72%',
            height: 4,
            borderRadius: 1,
            background: style.tokens.ink,
            opacity: 0.9,
          }}
        />
        <div
          style={{ width: '46%', height: 2, borderRadius: 1, background: style.tokens.accent }}
        />
      </div>
      <div
        className="border-t px-2.5 py-1.5 text-2xs"
        style={{
          borderColor: 'var(--rule-hairline)',
          color: active ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
          fontWeight: active ? 500 : 400,
        }}
      >
        {style.name}
      </div>
    </button>
  );
}

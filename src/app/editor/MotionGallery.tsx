import { useEffect, useMemo, useState } from 'react';
import { produce } from 'immer';
import { useApp } from '@/state/store';
import type { Aspect, HoldPreset, Layer, Scene, SceneId, StyleId } from '@/core/types';
import { ScenePreview } from '@/render/ScenePreview';
import { useLoopTime } from '@/render/useClock';
import { LOOKS, applyLook, currentLook, type LookDef } from '@/render/choreography';
import {
  GROUP_LABEL,
  HOLDS,
  TRANSITIONS,
  affinityOf,
  holdDef,
  motionGroupsFor,
  unsuitedReason,
  type MotionAffinity,
  type MotionDef,
  type TransitionDef,
} from '@/render/motion';

/**
 * The animation gallery.
 *
 * Every tile is the *actual scene*, animating with the thing it offers, drawn
 * by resolveFrame — the same function the stage and the exporter use. You are
 * not choosing from a list of names and hoping; you are watching your own scene
 * do the thing before you pick it.
 *
 * It is arranged as a staircase, widest step first: a look sets the whole scene
 * at once and is where most people should stop; below it the same decisions are
 * available one at a time, for the times when the whole is right and one
 * element is not.
 *
 * Choosing applies immediately and is a single undo away, because a gallery
 * with an OK button is a gallery nobody experiments in.
 */

export type MotionTargetKind = 'all' | MotionAffinity;

const TARGET_LABEL: Record<MotionTargetKind, string> = {
  all: 'Everything',
  text: 'Text',
  image: 'Figures',
  number: 'Numbers',
  any: 'Everything',
};

export function MotionGallery({
  sceneId,
  layerId,
  onClose,
}: {
  sceneId: SceneId;
  /** When set, only this element is being animated. */
  layerId?: string | null;
  onClose: () => void;
}) {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const showToast = useApp((s) => s.showToast);
  const scene = project?.scenes.find((s) => s.id === sceneId) ?? null;

  const kinds = useMemo<MotionTargetKind[]>(() => {
    if (!scene) return ['all'];
    const present = new Set<MotionAffinity>(scene.layers.map(affinityOf));
    const ordered: MotionTargetKind[] = ['all', 'text', 'image', 'number'];
    return ordered.filter((k) => k === 'all' || present.has(k as MotionAffinity));
  }, [scene]);

  const [target, setTarget] = useState<MotionTargetKind>('all');
  /** Whether a look lands on this scene or on the whole talk. */
  const [wholeTalk, setWholeTalk] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!project || !scene) return null;

  const single = layerId ? (scene.layers.find((l) => l.id === layerId) ?? null) : null;
  const targets = single ? [single] : pickLayers(scene, target);
  const affinity: MotionAffinity = single
    ? affinityOf(single)
    : target === 'all' || target === 'any'
      ? dominantAffinity(targets)
      : (target as MotionAffinity);

  const groups = motionGroupsFor(affinity);
  const currentPreset = commonValue(targets.map((l) => l.enter.preset));
  const currentHold = commonValue(targets.map((l) => l.enter.hold ?? 'none'));
  const currentIntensity = commonValue(targets.map((l) => l.enter.intensity ?? 1)) ?? 1;
  const wornLook = currentLook(scene);

  const sceneIndex = project.scenes.filter((s) => !s.hidden).findIndex((s) => s.id === sceneId);
  const previousScene =
    sceneIndex > 0 ? (project.scenes.filter((s) => !s.hidden)[sceneIndex - 1] ?? null) : null;

  const editTargets = (label: string, edit: (enter: Layer['enter'], index: number) => void) => {
    const ids = new Set(targets.map((l) => l.id));
    mutate(label, (draft) => {
      const s = draft.scenes.find((x) => x.id === sceneId);
      if (!s) return;
      let i = 0;
      for (const layer of s.layers) {
        if (!ids.has(layer.id)) continue;
        edit(layer.enter, i);
        i++;
      }
    });
  };

  /* ---- the wide step: one look, whole scene ----------------------------- */
  const pickLook = (look: LookDef) => {
    mutate(wholeTalk ? `Look: ${look.name}, whole talk` : `Look: ${look.name}`, (draft) => {
      for (const s of draft.scenes) {
        if (!wholeTalk && s.id !== sceneId) continue;
        if (s.hidden) continue;
        applyLook(s, look);
      }
      // The first scene has nothing to be cut from, so it is never given a
      // join — a talk that dissolves in from nothing starts on a stumble.
      const first = draft.scenes.find((s) => !s.hidden);
      if (first) first.transitionIn = 'cut';
    });
    showToast(
      wholeTalk ? `${look.name} — every scene` : `${look.name} — ${scene.title}`,
      { label: 'Undo', run: () => useApp.getState().undo() },
    );
  };

  const applyPreset = (def: MotionDef) => {
    editTargets(`Animate: ${def.name}`, (enter) => {
      enter.preset = def.id;
      enter.durationMs = def.durationMs;
      enter.reducedMotion = def.reducedMotion;
    });
    showToast(`${def.name} — ${describeTargets(targets, single)}`, {
      label: 'Undo',
      run: () => useApp.getState().undo(),
    });
  };

  const applyHold = (id: HoldPreset) => {
    const def = holdDef(id);
    editTargets(`Hold: ${def.name}`, (enter) => {
      enter.hold = id;
    });
  };

  const applyTransition = (def: TransitionDef) => {
    mutate(`Join: ${def.name}`, (draft) => {
      const s = draft.scenes.find((x) => x.id === sceneId);
      if (s) s.transitionIn = def.id;
    });
  };

  const applyChoreography = (gapMs: number, label: string) => {
    // Delays are handed out in the order the layers are stacked, so the eye is
    // led down the composition rather than hit with all of it at once.
    editTargets(`Choreography: ${label}`, (enter, i) => {
      enter.delayMs = Math.round(i * gapMs);
    });
    showToast(`${label} — elements arrive ${(gapMs / 1000).toFixed(2)}s apart`, {
      label: 'Undo',
      run: () => useApp.getState().undo(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Animation"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--surface-scrim)] backdrop-blur-[2px]"
      />

      <div
        className="relative flex max-h-[92dvh] w-full max-w-[62rem] flex-col overflow-hidden rounded-t-[var(--radius-xl)] border border-[var(--rule-hairline)] bg-[var(--surface-page)] sm:rounded-[var(--radius-xl)]"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        {/* ---- header ---- */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--rule-hairline)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="label">Animation</p>
            <p className="truncate text-xs text-[var(--ink-secondary)]">
              {single ? elementName(single) : scene.title}
            </p>
          </div>

          {!single && kinds.length > 1 && (
            <div className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] p-0.5">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTarget(k)}
                  aria-pressed={target === k}
                  className="rounded-[var(--radius-xs)] px-2.5 py-1 text-2xs transition-colors"
                  style={{
                    background: target === k ? 'var(--surface-raised)' : 'transparent',
                    color: target === k ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
                    fontWeight: target === k ? 550 : 400,
                    boxShadow: target === k ? 'var(--shadow-raised)' : 'none',
                  }}
                >
                  {TARGET_LABEL[k]}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-primary)]"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path
                d="m1.5 1.5 8 8m0-8-8 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet px-4 pb-5 pt-4">
          {targets.length === 0 ? (
            <p className="py-10 text-center text-xs text-[var(--ink-faint)]">
              This scene has nothing of that kind on it yet.
            </p>
          ) : (
            <>
              {/* ---- looks: the one choice most people should make ---- */}
              {!single && (
                <>
                  <SectionHead
                    title="Look"
                    hint="Sets every element on the scene at once. Start here."
                  >
                    <div className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] p-0.5">
                      {(
                        [
                          [false, 'This scene'],
                          [true, 'Every scene'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setWholeTalk(value)}
                          aria-pressed={wholeTalk === value}
                          className="rounded-[var(--radius-xs)] px-2 py-0.5 text-2xs transition-colors"
                          style={{
                            background:
                              wholeTalk === value ? 'var(--surface-raised)' : 'transparent',
                            color:
                              wholeTalk === value ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
                            fontWeight: wholeTalk === value ? 550 : 400,
                            boxShadow: wholeTalk === value ? 'var(--shadow-raised)' : 'none',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </SectionHead>

                  <div
                    data-tiles="look"
                    className="grid grid-cols-2 items-start gap-x-3 gap-y-4 sm:grid-cols-4"
                  >
                    {LOOKS.map((look, i) => (
                      <LookTile
                        key={look.id}
                        look={look}
                        scene={scene}
                        styleId={project.style}
                        aspect={project.settings.aspect}
                        active={wornLook === look.id}
                        phase={i * 220}
                        onPick={() => pickLook(look)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* ---- one element at a time ---- */}
              <SectionHead
                title="How it arrives"
                hint={
                  single
                    ? 'Every tile is this scene, animating for real.'
                    : `Applies to ${describeTargets(targets, null)} on this scene.`
                }
                className="mt-8"
              />

              {groups.map(({ group, motions }, gi) => (
                <div key={group} className={gi === 0 ? '' : 'mt-5'}>
                  <p className="mb-2 flex items-baseline gap-2">
                    <span className="text-2xs font-medium text-[var(--ink-secondary)]">
                      {GROUP_LABEL[group].title}
                    </span>
                    <span className="min-w-0 truncate text-2xs text-[var(--ink-faint)]">
                      {GROUP_LABEL[group].hint}
                    </span>
                  </p>
                  <div
                    data-tiles="motion"
                    /* Five across, because every group but one holds exactly
                       five — a four-column grid orphans the fifth tile on a
                       row of its own under each heading. */
                    className="grid grid-cols-2 items-start gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5"
                  >
                    {motions.map((def, i) => (
                      <MotionTile
                        key={def.id}
                        def={def}
                        scene={scene}
                        styleId={project.style}
                        aspect={project.settings.aspect}
                        targetIds={targets.map((l) => l.id)}
                        intensity={currentIntensity}
                        active={currentPreset === def.id}
                        unsuited={unsuitedReason(def, affinity)}
                        phase={(gi * 4 + i) * 160}
                        onPick={() => applyPreset(def)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <SectionHead
                title="While it stays on screen"
                hint="What keeps happening after the entrance has landed."
                className="mt-8"
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {HOLDS.map((h) => (
                  <HoldTile
                    key={h.id}
                    id={h.id}
                    name={h.name}
                    blurb={h.blurb}
                    active={currentHold === h.id}
                    onPick={() => applyHold(h.id)}
                  />
                ))}
              </div>

              {/* ---- the join into this scene ---- */}
              {!single && previousScene && (
                <>
                  <SectionHead
                    title="Coming from the scene before"
                    hint="How the cut into this scene is made."
                    className="mt-8"
                  />
                  <div
                    data-tiles="transition"
                    className="grid grid-cols-2 items-start gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5"
                  >
                    {TRANSITIONS.map((t, i) => (
                      <TransitionTile
                        key={t.id}
                        def={t}
                        scene={scene}
                        before={previousScene}
                        styleId={project.style}
                        aspect={project.settings.aspect}
                        active={scene.transitionIn === t.id}
                        phase={i * 240}
                        onPick={() => applyTransition(t)}
                      />
                    ))}
                  </div>
                </>
              )}

              {!single && targets.length > 1 && (
                <>
                  <SectionHead
                    title="Choreography"
                    hint="How far apart the elements arrive."
                    className="mt-8"
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Together', gap: 0 },
                      { label: 'Tight', gap: 90 },
                      { label: 'Measured', gap: 200 },
                      { label: 'Dramatic', gap: 420 },
                    ].map((c) => (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() => applyChoreography(c.gap, c.label)}
                        className="rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] px-3 py-1.5 text-2xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--rule-strong)] hover:bg-[var(--surface-sunken)]"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <SectionHead title="Volume" hint="The same move, quieter or louder." className="mt-8" />
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.25}
                  max={2}
                  step={0.05}
                  value={currentIntensity}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    editTargets('Change intensity', (enter) => {
                      enter.intensity = v;
                    });
                  }}
                  className="h-1 max-w-[22rem] flex-1 cursor-pointer accent-[var(--accent)]"
                  aria-label="Intensity"
                />
                <span className="numeral w-10 text-right text-2xs text-[var(--ink-secondary)]">
                  {currentIntensity.toFixed(2)}×
                </span>
              </div>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--rule-hairline)] bg-[var(--surface-sunken)] px-4 py-2.5">
          <p className="text-2xs text-[var(--ink-faint)]">
            {targets.length === 1 ? '1 element' : `${targets.length} elements`} · every choice is
            one undo away
            {/* A phone has no Escape key, so it is not offered one. */}
            <span className="hidden sm:inline"> · Esc to close</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] bg-[var(--surface-inverse)] px-3 py-1.5 text-2xs text-[var(--ink-inverse)] transition-transform duration-150 active:scale-95"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ============================================================================
   Tiles
   ========================================================================== */

/** The frame a tile holds while it waits, so the grid never twitches. */
function TileFrame({
  active,
  dimmed,
  children,
}: {
  active: boolean;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-sm)] border transition-all duration-150"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--rule-hairline)',
        boxShadow: active ? '0 0 0 1px var(--accent)' : 'none',
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      {children}
    </div>
  );
}

function TileCaption({
  name,
  blurb,
  active,
}: {
  name: string;
  blurb: string;
  active: boolean;
}) {
  return (
    <>
      <div className="mt-1.5 flex items-baseline gap-1.5 px-0.5">
        <span
          data-tile-name
          className="truncate text-2xs"
          style={{
            color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: active ? 560 : 440,
          }}
        >
          {name}
        </span>
        {active && (
          <span className="numeral shrink-0 text-2xs text-[var(--accent)]" aria-hidden="true">
            ●
          </span>
        )}
      </div>
      {/* A fixed measure for the caption, so a two-line blurb next to a
          one-line blurb does not stagger the whole grid. */}
      <p className="mt-0.5 line-clamp-2 min-h-[2.1em] px-0.5 text-2xs leading-[1.4] text-[var(--ink-faint)]">
        {blurb}
      </p>
    </>
  );
}

/** A whole scene under one look, looping. */
function LookTile({
  look,
  scene,
  styleId,
  aspect,
  active,
  phase,
  onPick,
}: {
  look: LookDef;
  scene: Scene;
  styleId: StyleId;
  aspect: Aspect;
  active: boolean;
  phase: number;
  onPick: () => void;
}) {
  const candidate = useMemo(() => produce(scene, (draft) => applyLook(draft, look)), [scene, look]);
  const loopMs = useMemo(() => entrancesEnd(candidate) + 1400, [candidate]);
  const t = useLoopTime(loopMs, phase);

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={look.blurb}
      className="group flex w-full flex-col text-left"
    >
      <TileFrame active={active}>
        <ScenePreview scene={candidate} styleId={styleId} aspect={aspect} atMs={t} />
      </TileFrame>
      <TileCaption name={look.name} blurb={look.blurb} active={active} />
    </button>
  );
}

function MotionTile({
  def,
  scene,
  styleId,
  aspect,
  targetIds,
  intensity,
  active,
  unsuited,
  phase,
  onPick,
}: {
  def: MotionDef;
  scene: Scene;
  styleId: StyleId;
  aspect: Aspect;
  targetIds: string[];
  intensity: number;
  active: boolean;
  unsuited: string | null;
  phase: number;
  onPick: () => void;
}) {
  /** The scene as it would be with this preset — nothing is guessed at. */
  const candidate = useMemo(
    () =>
      produce(scene, (draft) => {
        const ids = new Set(targetIds);
        for (const layer of draft.layers) {
          if (!ids.has(layer.id)) continue;
          layer.enter.preset = def.id;
          layer.enter.durationMs = def.durationMs;
          layer.enter.reducedMotion = def.reducedMotion;
          layer.enter.intensity = intensity;
        }
      }),
    [scene, targetIds, def, intensity],
  );

  const loopMs = useMemo(() => Math.max(2000, entrancesEnd(candidate) + 1100), [candidate]);
  const t = useLoopTime(loopMs, phase);

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={unsuited ?? def.blurb}
      className="group flex w-full flex-col text-left"
    >
      <TileFrame active={active} dimmed={!!unsuited}>
        <ScenePreview scene={candidate} styleId={styleId} aspect={aspect} atMs={t} />
      </TileFrame>
      <TileCaption name={def.name} blurb={unsuited ?? def.blurb} active={active} />
    </button>
  );
}

/**
 * A join cannot be shown from one side of it, so the tile runs the two scenes
 * that meet: the outgoing one, settled and holding, then the cut.
 */
function TransitionTile({
  def,
  scene,
  before,
  styleId,
  aspect,
  active,
  phase,
  onPick,
}: {
  def: TransitionDef;
  scene: Scene;
  before: Scene;
  styleId: StyleId;
  aspect: Aspect;
  active: boolean;
  phase: number;
  onPick: () => void;
}) {
  const HOLD_BEFORE = 700;

  /** The outgoing scene with its entrances already over — it is not the subject. */
  const settledBefore = useMemo(
    () =>
      produce(before, (draft) => {
        draft.durationMs = HOLD_BEFORE;
        for (const layer of draft.layers) {
          layer.enter.delayMs = 0;
          layer.enter.durationMs = 1;
        }
      }),
    [before],
  );

  const candidate = useMemo(
    () =>
      produce(scene, (draft) => {
        draft.transitionIn = def.id;
      }),
    [scene, def.id],
  );

  const loopMs = HOLD_BEFORE + Math.max(def.durationMs, 260) + 900;
  const t = useLoopTime(loopMs, phase);

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={def.blurb}
      className="group flex w-full flex-col text-left"
    >
      <TileFrame active={active}>
        <ScenePreview
          scene={candidate}
          before={settledBefore}
          styleId={styleId}
          aspect={aspect}
          atMs={t}
        />
      </TileFrame>
      <TileCaption name={def.name} blurb={def.blurb} active={active} />
    </button>
  );
}

/**
 * Sustained motion has nothing to show in a still, and showing it in a tile
 * the size of a stamp would show nothing either. It is named and described,
 * and proven on the stage the instant it is chosen.
 */
function HoldTile({
  id,
  name,
  blurb,
  active,
  onPick,
}: {
  id: HoldPreset;
  name: string;
  blurb: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={blurb}
      className="rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-colors"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--rule-hairline)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
      }}
    >
      <span className="flex items-center gap-1.5">
        <HoldGlyph id={id} />
        <span
          className="truncate text-2xs"
          style={{
            color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: active ? 560 : 440,
          }}
        >
          {name}
        </span>
      </span>
      <span className="mt-1 block text-2xs leading-[1.35] text-[var(--ink-faint)]">{blurb}</span>
    </button>
  );
}

function HoldGlyph({ id }: { id: HoldPreset }) {
  const glyph: Record<HoldPreset, string> = {
    none: '▪',
    'ken-burns': '⤢',
    drift: '→',
    breathe: '◍',
    float: '↕',
    sway: '⟲',
  };
  return (
    <span aria-hidden="true" className="text-[var(--ink-faint)]">
      {glyph[id]}
    </span>
  );
}

function SectionHead({
  title,
  hint,
  className = '',
  children,
}: {
  title: string;
  hint: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`mb-2.5 flex flex-wrap items-baseline gap-2 ${className}`}>
      <p className="label">{title}</p>
      <p className="min-w-0 flex-1 truncate text-2xs text-[var(--ink-faint)]">{hint}</p>
      {children}
    </div>
  );
}

/* ============================================================================
   Picking what to animate
   ========================================================================== */

/** When the last entrance on a scene has finished. */
function entrancesEnd(scene: Scene): number {
  return scene.layers.reduce(
    (max, l) => Math.max(max, l.enter.delayMs + l.enter.durationMs),
    0,
  );
}

function pickLayers(scene: Scene, target: MotionTargetKind): Layer[] {
  const visible = scene.layers.filter((l) => !l.hidden && !l.decorative);
  if (target === 'all' || target === 'any') {
    // Rules and other decoration follow the content rather than being animated
    // as if they were content; when a scene is nothing but decoration, it is
    // still better to animate it than to offer an empty gallery.
    return visible.length ? visible : scene.layers.filter((l) => !l.hidden);
  }
  return visible.filter((l) => affinityOf(l) === target);
}

/**
 * What the scene is *about*, which decides which presets lead.
 *
 * Counting layers gets this wrong: a figure scene is a kicker, a picture and a
 * caption, so text wins two to one and the picture presets end up buried under
 * word animations that a picture cannot perform. The biggest element on the
 * scene is the subject of the scene, so area decides.
 */
function dominantAffinity(layers: Layer[]): MotionAffinity {
  let best: MotionAffinity = 'any';
  let area = 0;
  for (const l of layers) {
    const a = l.frame.w * l.frame.h;
    if (a > area) {
      area = a;
      best = affinityOf(l);
    }
  }
  return best;
}

function commonValue<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

function elementName(layer: Layer): string {
  switch (layer.type) {
    case 'text':
      return layer.atoms.map((a) => a.text).join(' ').slice(0, 60) || 'Text';
    case 'stat':
      return layer.display;
    case 'figure':
      return layer.caption ?? 'Figure';
    case 'table':
      return layer.caption ?? 'Table';
    case 'quote':
      return `“${layer.text.slice(0, 46)}”`;
    case 'citation':
      return layer.text;
    default:
      return 'Element';
  }
}

function describeTargets(targets: Layer[], single: Layer | null): string {
  if (single) return elementName(single).slice(0, 40);
  return targets.length === 1 ? '1 element' : `${targets.length} elements`;
}

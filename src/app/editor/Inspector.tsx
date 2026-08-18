import { useMemo, useState } from 'react';
import { useApp, useSelectedScene } from '@/state/store';
import { PROVENANCE_META, provenanceRef, type Layer, type Provenance } from '@/core/types';
import { listVoices, speechSupported, type Voice } from '@/narrate/speech';
import { HOLDS, MOTIONS, motionDef } from '@/render/motion';
import { Spark } from './SceneRail';
import { useEffect } from 'react';

/**
 * Contextual properties for what is selected. Everything here edits the project
 * and is visible on the canvas immediately — there are no settings that only
 * take effect somewhere else.
 */

type Tab = 'content' | 'source' | 'motion' | 'voice' | 'access';

export function Inspector() {
  const scene = useSelectedScene();
  const selectedLayerIds = useApp((s) => s.selectedLayerIds);
  const [tab, setTab] = useState<Tab>('content');

  const layer = useMemo(
    () => scene?.layers.find((l) => l.id === selectedLayerIds[0]) ?? null,
    [scene, selectedLayerIds],
  );

  if (!scene) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-center text-xs text-[var(--ink-faint)]">
          Select a scene to see its properties.
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'content', label: 'Content' },
    { id: 'source', label: 'Source' },
    { id: 'motion', label: 'Motion' },
    { id: 'voice', label: 'Voice' },
    { id: 'access', label: 'Access' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      <div className="flex shrink-0 gap-px overflow-x-auto border-b border-[var(--rule-hairline)] bg-[var(--rule-hairline)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className="flex-1 whitespace-nowrap px-2 py-2 text-2xs transition-colors"
            style={{
              background: tab === t.id ? 'var(--surface-page)' : 'var(--surface-raised)',
              color: tab === t.id ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
              fontWeight: tab === t.id ? 550 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet p-3">
        {tab === 'content' && <ContentTab layer={layer} />}
        {tab === 'source' && <SourceTab layer={layer} />}
        {tab === 'motion' && <MotionTab layer={layer} />}
        {tab === 'voice' && <VoiceTab />}
        {tab === 'access' && <AccessTab layer={layer} />}
      </div>
    </div>
  );
}

/* ============================================================================
   Content
   ========================================================================== */

function ContentTab({ layer }: { layer: Layer | null }) {
  const scene = useSelectedScene()!;
  const mutate = useApp((s) => s.mutate);

  return (
    <div className="space-y-5">
      <Field label="Scene title">
        <input
          value={scene.title}
          onChange={(e) =>
            mutate(
              'Rename scene',
              (d) => {
                const s = d.scenes.find((x) => x.id === scene.id);
                if (s) s.title = e.target.value;
              },
              `title:${scene.id}`,
            )
          }
          className="input"
        />
      </Field>

      <Field label="Duration" hint="Derived from the narration unless you set it.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1200}
            max={20000}
            step={100}
            value={scene.durationMs}
            onChange={(e) =>
              mutate(
                'Change duration',
                (d) => {
                  const s = d.scenes.find((x) => x.id === scene.id);
                  if (s) {
                    s.durationMs = Number(e.target.value);
                    s.durationPinned = true;
                  }
                },
                `dur:${scene.id}`,
              )
            }
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="numeral w-12 text-right text-2xs text-[var(--ink-secondary)]">
            {(scene.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </Field>

      {!layer && (
        <p className="text-2xs leading-[1.5] text-[var(--ink-faint)]">
          Click an element on the canvas to edit it.
        </p>
      )}

      {layer?.type === 'text' && (
        <Field label="Text">
          <textarea
            value={layer.atoms.map((a) => a.text).join(' ')}
            rows={5}
            onChange={(e) =>
              mutate(
                'Edit text',
                (d) => {
                  const s = d.scenes.find((x) => x.id === scene.id);
                  const l = s?.layers.find((x) => x.id === layer.id);
                  if (l && l.type === 'text') {
                    const original = l.atoms.map((a) => a.text).join(' ');
                    // Editing extracted text makes it yours, and says so.
                    l.atoms = [
                      {
                        id: l.atoms[0]?.id ?? (`atom_${Date.now()}` as never),
                        text: e.target.value,
                        provenance:
                          e.target.value.trim() === original.trim()
                            ? l.atoms[0].provenance
                            : { kind: 'authored' },
                      },
                    ];
                  }
                },
                `text:${layer.id}`,
              )
            }
            className="input resize-y"
          />
        </Field>
      )}

      {layer?.type === 'stat' && (
        <>
          <Field label="Value">
            <input
              value={layer.display}
              onChange={(e) =>
                mutate(
                  'Edit value',
                  (d) => {
                    const s = d.scenes.find((x) => x.id === scene.id);
                    const l = s?.layers.find((x) => x.id === layer.id);
                    if (l && l.type === 'stat') {
                      l.display = e.target.value;
                      const ref = provenanceRef(l.provenance);
                      // A number that no longer matches its source stops being grounded.
                      if (ref && !ref.text.includes(e.target.value.replace(/\s/g, ''))) {
                        l.provenance = {
                          kind: 'unsupported',
                          reason: 'value-mismatch',
                          reviewed: false,
                          detail: `The paper says “${ref.text.slice(0, 120)}”. This shows “${e.target.value}”.`,
                        };
                      }
                    }
                  },
                  `stat:${layer.id}`,
                )
              }
              className="input numeral"
            />
          </Field>
          {layer.qualifiers.length > 0 && (
            <Toggle
              label="Show qualifiers"
              hint="A percentage without its interval is a different claim."
              checked={layer.showQualifiers}
              onChange={(v) =>
                mutate('Toggle qualifiers', (d) => {
                  const s = d.scenes.find((x) => x.id === scene.id);
                  const l = s?.layers.find((x) => x.id === layer.id);
                  if (l && l.type === 'stat') l.showQualifiers = v;
                })
              }
            />
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================================
   Source
   ========================================================================== */

function SourceTab({ layer }: { layer: Layer | null }) {
  const scene = useSelectedScene()!;
  const focusSource = useApp((s) => s.focusSource);
  const hoverSource = useApp((s) => s.hoverSource);
  const mutate = useApp((s) => s.mutate);

  const entries = useMemo(() => {
    if (layer) {
      if (layer.type === 'text') return layer.atoms.map((a) => ({ id: a.id, p: a.provenance }));
      if (layer.type === 'rule') return [];
      return [{ id: layer.id, p: layer.provenance }];
    }
    return scene.narration.map((c) => ({ id: c.id, p: c.provenance }));
  }, [layer, scene]);

  if (entries.length === 0) {
    return <p className="text-2xs text-[var(--ink-faint)]">Nothing to trace here.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(({ id, p }) => (
        <ProvenanceCard
          key={id}
          provenance={p}
          onGo={() => {
            const ref = provenanceRef(p);
            if (ref) focusSource(ref, 'layer');
          }}
          onHover={(on) => {
            const ref = provenanceRef(p);
            hoverSource(on ? ref : null);
          }}
          onAccept={
            p.kind === 'unsupported' && !p.reviewed
              ? () =>
                  mutate('Mark reviewed', (d) => {
                    for (const s of d.scenes) {
                      for (const l of s.layers) {
                        if (l.type === 'text') {
                          for (const a of l.atoms) {
                            if (a.id === id && a.provenance.kind === 'unsupported')
                              a.provenance.reviewed = true;
                          }
                        } else if ('provenance' in l && l.id === id && l.provenance.kind === 'unsupported') {
                          l.provenance.reviewed = true;
                        }
                      }
                      for (const c of s.narration) {
                        if (c.id === id && c.provenance.kind === 'unsupported')
                          c.provenance.reviewed = true;
                      }
                    }
                  })
              : undefined
          }
        />
      ))}
    </div>
  );
}

export function ProvenanceCard({
  provenance,
  onGo,
  onHover,
  onAccept,
}: {
  provenance: Provenance;
  onGo?: () => void;
  onHover?: (on: boolean) => void;
  onAccept?: () => void;
}) {
  const meta = PROVENANCE_META[provenance.kind];
  const ref = provenanceRef(provenance);

  return (
    <div
      className="rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-3"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span aria-hidden="true" style={{ color: `var(--ev-${meta.token})` }}>
          {meta.glyph}
        </span>
        <span
          className="text-2xs font-medium"
          style={{ color: `var(--ev-${meta.token})` }}
        >
          {meta.label}
        </span>
        {ref && (
          <span className="numeral ml-auto text-2xs text-[var(--ink-faint)]">
            p.{ref.page}
          </span>
        )}
      </div>

      {ref ? (
        <p className="text-2xs leading-[1.5] text-[var(--ink-secondary)]">
          “{ref.text.length > 220 ? ref.text.slice(0, 220) + '…' : ref.text}”
        </p>
      ) : (
        <p className="text-2xs leading-[1.5] text-[var(--ink-tertiary)]">
          {provenance.kind === 'unsupported' ? provenance.detail : meta.description}
        </p>
      )}

      <div className="mt-2.5 flex gap-2">
        {ref && onGo && (
          <button
            type="button"
            onClick={onGo}
            className="text-2xs font-medium text-[var(--accent)] transition-opacity hover:opacity-75"
          >
            Show me in the paper →
          </button>
        )}
        {onAccept && (
          <button
            type="button"
            onClick={onAccept}
            className="ml-auto text-2xs text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
          >
            Keep it — I checked
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   Motion
   ========================================================================== */

function MotionTab({ layer }: { layer: Layer | null }) {
  const scene = useSelectedScene()!;
  const mutate = useApp((s) => s.mutate);
  const openMotionPicker = useApp((s) => s.openMotionPicker);

  const gallery = (
    <button
      type="button"
      onClick={() => openMotionPicker(scene.id, layer?.id ?? null)}
      className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--accent-subtle)] px-3 py-2 text-2xs text-[var(--accent)] transition-colors hover:bg-[var(--accent-quiet)]"
    >
      <Spark />
      {layer ? 'Animate this element' : 'Animate this scene'}
      <span className="text-[var(--ink-faint)]">M</span>
    </button>
  );

  if (!layer) {
    return (
      <div className="space-y-4">
        {gallery}
        <Field label="Transition in">
          <select
            value={scene.transitionIn}
            onChange={(e) =>
              mutate('Change transition', (d) => {
                const s = d.scenes.find((x) => x.id === scene.id);
                if (s) s.transitionIn = e.target.value as typeof scene.transitionIn;
              })
            }
            className="input"
          >
            {['dissolve', 'crop', 'turn', 'recompose', 'cut'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-2xs leading-[1.5] text-[var(--ink-faint)]">
          The gallery animates every element on the scene at once. Select one to give it its own
          entrance.
        </p>
      </div>
    );
  }

  const set = (patch: Partial<Layer['enter']>) =>
    mutate(
      'Change motion',
      (d) => {
        const s = d.scenes.find((x) => x.id === scene.id);
        const l = s?.layers.find((x) => x.id === layer.id);
        if (l) Object.assign(l.enter, patch);
      },
      `motion:${layer.id}`,
    );

  const def = motionDef(layer.enter.preset);

  return (
    <div className="space-y-5">
      {gallery}

      <Field label="Entrance" hint={def.blurb}>
        <select
          value={layer.enter.preset}
          onChange={(e) => {
            const next = motionDef(e.target.value as Layer['enter']['preset']);
            set({
              preset: next.id,
              durationMs: next.durationMs,
              reducedMotion: next.reducedMotion,
            });
          }}
          className="input"
        >
          {MOTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="While it stays on screen">
        <select
          value={layer.enter.hold ?? 'none'}
          onChange={(e) => set({ hold: e.target.value as Layer['enter']['hold'] })}
          className="input"
        >
          {HOLDS.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Volume" hint="The same move, quieter or louder.">
        <Range
          min={0.25}
          max={2}
          step={0.05}
          value={layer.enter.intensity ?? 1}
          onChange={(v) => set({ intensity: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </Field>

      <Field label="Delay">
        <Range
          min={0}
          max={3000}
          step={20}
          value={layer.enter.delayMs}
          onChange={(v) => set({ delayMs: v })}
          format={(v) => `${(v / 1000).toFixed(2)}s`}
        />
      </Field>

      <Field label="Duration">
        <Range
          min={100}
          max={2500}
          step={20}
          value={layer.enter.durationMs}
          onChange={(v) => set({ durationMs: v })}
          format={(v) => `${(v / 1000).toFixed(2)}s`}
        />
      </Field>

      <Field
        label="With reduced motion"
        hint="Required. Every motion has to say what it becomes when movement is off."
      >
        <select
          value={layer.enter.reducedMotion}
          onChange={(e) => set({ reducedMotion: e.target.value as 'fade' | 'none' })}
          className="input"
        >
          <option value="fade">Short fade</option>
          <option value="none">Appear instantly</option>
        </select>
      </Field>
    </div>
  );
}

/* ============================================================================
   Voice
   ========================================================================== */

function VoiceTab() {
  const project = useApp((s) => s.project)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const [voices, setVoices] = useState<Voice[]>([]);

  useEffect(() => {
    void listVoices().then(setVoices);
  }, []);

  if (!speechSupported()) {
    return (
      <p className="text-2xs leading-[1.5] text-[var(--ink-tertiary)]">
        This browser has no speech engine, so narration will not be read aloud. Captions and the
        transcript still export.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <Field label="Voice" hint="Your browser's own voices. Nothing is sent anywhere.">
        <select
          value={project.settings.voiceURI ?? ''}
          onChange={(e) => updateSettings({ voiceURI: e.target.value || null })}
          className="input"
        >
          <option value="">System default</option>
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.name} {v.local ? '' : '(network)'}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Rate">
        <Range
          min={0.6}
          max={1.6}
          step={0.05}
          value={project.settings.speakingRate}
          onChange={(v) => updateSettings({ speakingRate: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </Field>

      <Toggle
        label="Captions"
        checked={project.settings.captionsEnabled}
        onChange={(v) => updateSettings({ captionsEnabled: v })}
      />

      <p className="text-2xs leading-[1.5] text-[var(--ink-faint)]">
        As it speaks, the engine reports where each word begins. Those timings are saved, so the
        marker tracks the voice exactly on the next play.
      </p>
    </div>
  );
}

/* ============================================================================
   Accessibility
   ========================================================================== */

function AccessTab({ layer }: { layer: Layer | null }) {
  const scene = useSelectedScene()!;
  const mutate = useApp((s) => s.mutate);

  if (!layer || (layer.type !== 'figure' && layer.type !== 'table')) {
    return (
      <div className="space-y-3">
        <p className="text-2xs leading-[1.5] text-[var(--ink-tertiary)]">
          Select a figure or table to write its description.
        </p>
        <p className="text-2xs leading-[1.5] text-[var(--ink-faint)]">
          Descriptions travel into the exported slide deck and the tagged PDF, so they are worth
          getting right once.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Field
        label="Description"
        hint="What someone who cannot see it needs to know."
      >
        <textarea
          rows={4}
          value={layer.altText ?? ''}
          onChange={(e) =>
            mutate(
              'Edit description',
              (d) => {
                const s = d.scenes.find((x) => x.id === scene.id);
                const l = s?.layers.find((x) => x.id === layer.id);
                if (l) l.altText = e.target.value;
              },
              `alt:${layer.id}`,
            )
          }
          className="input resize-y"
        />
      </Field>

      <Toggle
        label="Decorative"
        hint="Screen readers will skip it entirely."
        checked={layer.decorative}
        onChange={(v) =>
          mutate('Toggle decorative', (d) => {
            const s = d.scenes.find((x) => x.id === scene.id);
            const l = s?.layers.find((x) => x.id === layer.id);
            if (l) l.decorative = v;
          })
        }
      />
    </div>
  );
}

/* ============================================================================
   Primitives
   ========================================================================== */

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
    <div>
      <p className="label mb-1.5">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-2xs leading-[1.45] text-[var(--ink-faint)]">{hint}</p>}
    </div>
  );
}

function Range({
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--accent)]"
      />
      <span className="numeral w-12 shrink-0 text-right text-2xs text-[var(--ink-secondary)]">
        {format(value)}
      </span>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        <span className="text-xs text-[var(--ink-primary)]">{label}</span>
      </label>
      {hint && <p className="mt-1 pl-6 text-2xs leading-[1.45] text-[var(--ink-faint)]">{hint}</p>}
    </div>
  );
}

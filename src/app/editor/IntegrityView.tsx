import { useMemo, useState } from 'react';
import { useApp } from '@/state/store';
import { PROVENANCE_META, provenanceRef, type IntegrityIssue, type ProvenanceKind } from '@/core/types';
import { Button } from '@/ui/Button';

/**
 * Source integrity gets a full view rather than a modal, because reviewing
 * accuracy is real work. Every issue offers a concrete fix, and "keep it — I
 * checked" is always available: the user's judgement is final, but it is
 * recorded, so an export knows the claim was consciously accepted.
 */

export function IntegrityView({ embedded = false }: { embedded?: boolean }) {
  const project = useApp((s) => s.project);
  const integrity = useApp((s) => s.integrity);
  const setView = useApp((s) => s.setEditorView);
  const seekScene = useApp((s) => s.seekScene);
  const focusSource = useApp((s) => s.focusSource);
  const mutate = useApp((s) => s.mutate);
  const [filter, setFilter] = useState<'all' | 'blocking' | 'warning'>('all');

  const issues = useMemo(() => {
    if (!integrity) return [];
    if (filter === 'all') return integrity.issues;
    return integrity.issues.filter((i) => i.severity === filter);
  }, [integrity, filter]);

  if (!project || !integrity) return null;

  const accept = (issue: IntegrityIssue) => {
    mutate('Mark reviewed', (d) => {
      const scene = d.scenes.find((s) => s.id === issue.sceneId);
      if (!scene) return;
      for (const layer of scene.layers) {
        if (issue.layerId && layer.id !== issue.layerId) continue;
        if (layer.type === 'text') {
          for (const a of layer.atoms) {
            if (a.provenance.kind === 'unsupported') a.provenance.reviewed = true;
          }
        } else if ('provenance' in layer && layer.provenance.kind === 'unsupported') {
          layer.provenance.reviewed = true;
        }
        if (layer.type === 'figure' || layer.type === 'table') {
          if (issue.reason === 'missing-alt-text' && layer.id === issue.layerId) {
            layer.decorative = true;
          }
        }
      }
      for (const cue of scene.narration) {
        if (cue.provenance.kind === 'unsupported') cue.provenance.reviewed = true;
      }
    });
  };

  const goTo = (issue: IntegrityIssue) => {
    seekScene(issue.sceneId);
    const scene = project.scenes.find((s) => s.id === issue.sceneId);
    const layer = scene?.layers.find((l) => l.id === issue.layerId);
    const p =
      layer?.type === 'text'
        ? layer.atoms[0]?.provenance
        : layer && 'provenance' in layer
          ? layer.provenance
          : null;
    const ref = p ? provenanceRef(p) : (scene?.sourceRefs[0] ?? null);
    if (ref) focusSource(ref, 'issue');
    if (!embedded) setView('compose');
  };

  const body = (
    <div className="mx-auto w-full max-w-[64rem] px-[max(1rem,3vw)] py-6">
      {/* score */}
      <div className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label mb-2">Source integrity</p>
            <div className="flex items-baseline gap-3">
              <span className="numeral text-4xl leading-none text-[var(--ink-primary)]">
                {integrity.score}
              </span>
              <span className="text-base text-[var(--ink-faint)]">/ 100</span>
            </div>
          </div>
          <p className="max-w-[32ch] text-xs leading-[1.5] text-[var(--ink-tertiary)]">
            {integrity.groundedAtoms} of {integrity.factualAtoms} factual statements trace back to
            a page in your paper.
          </p>
        </div>

        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[var(--surface-inset)]">
          {(Object.keys(PROVENANCE_META) as ProvenanceKind[]).map((kind) => {
            const count = integrity.counts[kind];
            const totalCount = Object.values(integrity.counts).reduce((a, b) => a + b, 0);
            if (!count || !totalCount) return null;
            return (
              <span
                key={kind}
                style={{
                  width: `${(count / totalCount) * 100}%`,
                  background: `var(--ev-${PROVENANCE_META[kind].token})`,
                }}
                title={`${PROVENANCE_META[kind].label}: ${count}`}
              />
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {(Object.keys(PROVENANCE_META) as ProvenanceKind[]).map((kind) => {
            const count = integrity.counts[kind];
            if (!count) return null;
            const meta = PROVENANCE_META[kind];
            return (
              <span key={kind} className="flex items-center gap-1.5 text-2xs">
                <span aria-hidden="true" style={{ color: `var(--ev-${meta.token})` }}>
                  {meta.glyph}
                </span>
                <span className="numeral text-[var(--ink-secondary)]">{count}</span>
                <span className="text-[var(--ink-faint)]">{meta.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* issues */}
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-medium text-[var(--ink-primary)]">
          {issues.length === 0 ? 'Nothing needs review' : `${issues.length} to review`}
        </h2>
        <div className="ml-auto flex gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--rule-hairline)]">
          {(['all', 'blocking', 'warning'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="px-2.5 py-1 text-2xs capitalize"
              style={{
                background: filter === f ? 'var(--surface-inverse)' : 'var(--surface-raised)',
                color: filter === f ? 'var(--ink-inverse)' : 'var(--ink-tertiary)',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-8 text-center">
          {/* Read off the report rather than asserted. Claiming that everything
              traces back while the counts above say 28 of 37 is exactly the
              kind of contradiction that costs an accuracy feature its credit. */}
          <p className="text-base text-[var(--ink-primary)]">
            {integrity.groundedAtoms === integrity.factualAtoms
              ? 'Every claim in this presentation traces back to your paper.'
              : `${integrity.groundedAtoms} of ${integrity.factualAtoms} claims trace back to your paper. Nothing is flagged.`}
          </p>
          <p className="mx-auto mt-2 max-w-[46ch] text-xs leading-[1.55] text-[var(--ink-tertiary)]">
            The composer selects sentences rather than writing them, so there is nothing to
            fact-check that the paper does not already say.
            {integrity.counts.connective > 0 &&
              ` The other ${integrity.counts.connective} line${
                integrity.counts.connective === 1 ? '' : 's'
              } are labels and transitions, which carry no claim.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={issue.id}
              className="rounded-[var(--radius-md)] border bg-[var(--surface-raised)] p-4"
              style={{
                borderColor:
                  issue.severity === 'blocking'
                    ? 'color-mix(in oklch, var(--ev-unsupported) 45%, transparent)'
                    : 'var(--rule-hairline)',
              }}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  style={{
                    color:
                      issue.severity === 'blocking'
                        ? 'var(--ev-unsupported)'
                        : 'var(--ink-tertiary)',
                  }}
                >
                  {issue.severity === 'blocking' ? '△' : '·'}
                </span>
                <p className="text-base font-medium text-[var(--ink-primary)]">
                  {issue.message}
                </p>
                <span className="label ml-auto shrink-0">
                  {project.scenes.find((s) => s.id === issue.sceneId)?.title ?? 'Scene'}
                </span>
              </div>
              <p className="mb-3 max-w-[70ch] text-xs leading-[1.55] text-[var(--ink-secondary)]">
                {issue.detail}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => goTo(issue)}>
                  Open the scene
                </Button>
                <Button size="sm" variant="ghost" onClick={() => accept(issue)}>
                  {issue.reason === 'missing-alt-text' ? 'Mark as decorative' : 'Keep it — I checked'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (embedded) return <div className="h-full overflow-y-auto">{body}</div>;

  return (
    <div className="absolute inset-0 top-14 z-20 overflow-y-auto bg-[var(--surface-page)]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--rule-hairline)] bg-[var(--surface-page)] px-[max(1rem,3vw)] py-2.5">
        <span className="label">Review</span>
        <Button size="sm" variant="secondary" onClick={() => setView('compose')}>
          Back to the editor
        </Button>
      </div>
      {body}
    </div>
  );
}

import type {
  IntegrityIssue,
  IntegrityReport,
  Layer,
  Project,
  Provenance,
  ProvenanceKind,
  Scene,
} from './types';
import { isFactual, isGrounded } from './types';

/**
 * The integrity report is derived, never stored as truth. It recomputes on every
 * mutation so the score in the top bar can never be stale.
 */

export function computeIntegrity(project: Project): IntegrityReport {
  const counts: Record<ProvenanceKind, number> = {
    extracted: 0,
    paraphrase: 0,
    explanation: 0,
    connective: 0,
    authored: 0,
    unsupported: 0,
  };

  const issues: IntegrityIssue[] = [];
  let factualAtoms = 0;
  let groundedAtoms = 0;

  for (const scene of project.scenes) {
    if (scene.hidden) continue;

    for (const layer of scene.layers) {
      for (const p of provenancesOf(layer)) {
        counts[p.kind]++;
        if (isFactual(p)) {
          factualAtoms++;
          if (isGrounded(p)) groundedAtoms++;
        }
        const issue = issueFor(p, scene, layer);
        if (issue) issues.push(issue);
      }

      if (needsAltText(layer)) {
        issues.push({
          id: `${layer.id}:alt`,
          severity: 'warning',
          reason: 'missing-alt-text',
          sceneId: scene.id,
          layerId: layer.id,
          message: 'This image has no description',
          detail:
            'Screen readers and the exported slide deck will announce nothing for it. A one-line description of what the figure shows is enough.',
          fixes: [
            { id: 'write-alt', label: 'Write a description', kind: 'navigate' },
            { id: 'decorative', label: 'Mark as decorative', kind: 'auto' },
          ],
        });
      }
    }

    for (const cue of scene.narration) {
      counts[cue.provenance.kind]++;
      if (isFactual(cue.provenance)) {
        factualAtoms++;
        if (isGrounded(cue.provenance)) groundedAtoms++;
      }
      const issue = issueFor(cue.provenance, scene, null, cue.text);
      if (issue) issues.push(issue);
    }

    if (scene.narration.length === 0 && !scene.hidden) {
      issues.push({
        id: `${scene.id}:no-narration`,
        severity: 'info',
        reason: 'no-narration',
        sceneId: scene.id,
        message: `“${scene.title}” has no narration`,
        detail: 'It will play silently for its full duration. That can be deliberate.',
        fixes: [{ id: 'open', label: 'Open the scene', kind: 'navigate' }],
      });
    }
  }

  const coverage = factualAtoms === 0 ? 1 : groundedAtoms / factualAtoms;
  const blocking = issues.filter((i) => i.severity === 'blocking').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  const score = Math.max(
    0,
    Math.min(100, Math.round(coverage * 100 - blocking * 9 - warnings * 2.5)),
  );

  return {
    score,
    coverage,
    counts,
    issues: issues.sort(bySeverity),
    factualAtoms,
    groundedAtoms,
  };
}

function bySeverity(a: IntegrityIssue, b: IntegrityIssue): number {
  const rank = { blocking: 0, warning: 1, info: 2 };
  return rank[a.severity] - rank[b.severity];
}

function issueFor(
  p: Provenance,
  scene: Scene,
  layer: Layer | null,
  cueText?: string,
): IntegrityIssue | null {
  if (p.kind === 'unsupported') {
    if (p.reviewed) return null;
    return {
      id: `${layer?.id ?? scene.id}:${p.reason}:${hash(cueText ?? '')}`,
      severity: 'blocking',
      reason: p.reason,
      sceneId: scene.id,
      layerId: layer?.id,
      message: REASON_MESSAGE[p.reason],
      detail: p.detail,
      fixes: [
        { id: 'goto', label: 'Open the scene', kind: 'navigate' },
        { id: 'accept', label: 'Keep it — I checked', kind: 'accept' },
      ],
    };
  }

  if ((p.kind === 'extracted' || p.kind === 'paraphrase' || p.kind === 'explanation') && p.confidence < 0.5) {
    return {
      id: `${layer?.id ?? scene.id}:low`,
      severity: 'warning',
      reason: 'low-confidence',
      sceneId: scene.id,
      layerId: layer?.id,
      message: 'Weak match to the source',
      detail: `We traced this to page ${p.ref.page}, but the match is uncertain. Worth a look before you present it.`,
      fixes: [
        { id: 'goto', label: 'Compare with the page', kind: 'navigate' },
        { id: 'accept', label: 'Keep it — I checked', kind: 'accept' },
      ],
    };
  }

  return null;
}

const REASON_MESSAGE: Record<string, string> = {
  'no-source': 'This states a fact with no source',
  'value-mismatch': "This number doesn't match the paper",
  'hedge-strengthened': 'This claims more than the paper does',
  'citation-unmatched': 'This citation points nowhere',
  'source-deleted': 'The source passage was removed',
};

export function provenancesOf(layer: Layer): Provenance[] {
  if (layer.type === 'text') return layer.atoms.map((a) => a.provenance);
  if (layer.type === 'rule') return [];
  return [layer.provenance];
}

function needsAltText(layer: Layer): boolean {
  if (layer.type !== 'figure' && layer.type !== 'table') return false;
  if (layer.decorative) return false;
  return !layer.altText || layer.altText.trim().length < 4;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Number fidelity: any numeral shown must appear in the source it claims to come
 * from. This is the check that catches a rounded or drifted statistic.
 */
export function verifyNumbers(display: string, sourceText: string): boolean {
  const numerals = display.match(/\d[\d.,]*/g);
  if (!numerals) return true;
  const normalizedSource = sourceText.replace(/[−–—]/g, '-').replace(/\s/g, '');
  return numerals.every((n) => normalizedSource.includes(n.replace(/\s/g, '')));
}

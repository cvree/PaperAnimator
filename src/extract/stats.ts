import { newId } from '@/core/id';
import type { AtomId, Sentence, Statistic, StatKind, StatQualifier } from '@/core/types';

/**
 * Statistic extraction.
 *
 * The point of this module is not to find numbers — that is easy. It is to keep
 * a number attached to its qualifiers, so a confidence interval or a sample size
 * can never be silently dropped on the way to a slide.
 */

interface Pattern {
  re: RegExp;
  kind: StatKind;
}

const PATTERNS: Pattern[] = [
  { re: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?%/g, kind: 'percentage' },
  { re: /\bp\s?[<>=≤≥]\s?\.?\d+(?:\.\d+)?\b/gi, kind: 'p-value' },
  {
    re: /\b\d{1,3}\s?%\s?(?:CI|confidence interval)[:\s]*\[?[-−]?\d+(?:\.\d+)?\s?(?:[–—-]|to)\s?[-−]?\d+(?:\.\d+)?\]?/gi,
    kind: 'confidence-interval',
  },
  { re: /\bn\s?=\s?\d{1,3}(?:,\d{3})*\b/gi, kind: 'sample-size' },
  { re: /\b(?:OR|RR|HR|AUC|β|r|d|F|t|χ2|R2)\s?=\s?[-−]?\d+(?:\.\d+)?\b/g, kind: 'ratio' },
  { re: /\b\d+(?:\.\d+)?\s?±\s?\d+(?:\.\d+)?\b/g, kind: 'mean-sd' },
  { re: /\b\d+(?:\.\d+)?\s?(?:times|fold|×|x)\s?(?:higher|lower|greater|more|less|increase|decrease)\b/gi, kind: 'ratio' },
  {
    re: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:ms|s|min|h|hours?|days?|weeks?|months?|years?|mg|kg|g|mL|L|nm|µm|mm|cm|m|km|Hz|kHz|GHz|MB|GB|TB|participants?|patients?|subjects?|samples?|trials?|studies)\b/g,
    kind: 'count',
  },
];

const QUALIFIER_PATTERNS: { re: RegExp; kind: StatQualifier['kind'] }[] = [
  { re: /\b\d{1,3}\s?%\s?(?:CI|confidence interval)[:\s]*\[?[-−]?\d+(?:\.\d+)?\s?(?:[–—-]|to)\s?[-−]?\d+(?:\.\d+)?\]?/gi, kind: 'ci' },
  { re: /\bp\s?[<>=≤≥]\s?\.?\d+(?:\.\d+)?\b/gi, kind: 'p' },
  { re: /\bn\s?=\s?\d{1,3}(?:,\d{3})*\b/gi, kind: 'n' },
  { re: /\bSD\s?[=:]\s?\d+(?:\.\d+)?\b/gi, kind: 'sd' },
  { re: /\bSE\s?[=:]\s?\d+(?:\.\d+)?\b/gi, kind: 'se' },
];

const UNIT_RE =
  /\b\d[\d,.]*\s?(ms|s|min|h|hours?|days?|weeks?|months?|years?|mg|kg|g|mL|L|nm|µm|mm|cm|m|km|Hz|kHz|GHz|MB|GB|TB|%)\b/;

export function extractStatistics(sentences: Sentence[]): Statistic[] {
  const out: Statistic[] = [];

  for (const sentence of sentences) {
    const text = sentence.text;
    const claimed: { start: number; end: number }[] = [];
    const qualifiers = findQualifiers(text);

    // Qualifier spans are reserved so "95% CI" never becomes a standalone "95%".
    for (const q of qualifiers) claimed.push({ start: q.start, end: q.end });

    const found: { raw: string; kind: StatKind; start: number; end: number }[] = [];
    for (const { re, kind } of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const start = m.index;
        const end = start + m[0].length;
        if (kind !== 'confidence-interval' && overlaps(claimed, start, end)) continue;
        found.push({ raw: m[0].trim(), kind, start, end });
        claimed.push({ start, end });
      }
    }

    if (found.length === 0) continue;
    found.sort((a, b) => a.start - b.start);

    // Primary statistics carry the qualifiers found in the same sentence.
    const primary = found.filter((f) => f.kind !== 'p-value' && f.kind !== 'sample-size');
    const carriers = primary.length > 0 ? primary : found;

    for (const f of found) {
      const isCarrier = carriers.includes(f);
      const stat: Statistic = {
        id: newId('atom'),
        raw: f.raw,
        value: parseValue(f.raw),
        unit: UNIT_RE.exec(f.raw)?.[1] ?? null,
        kind: f.kind,
        qualifiers: isCarrier
          ? qualifiers
              .filter((q) => !isSameSpan(q, f))
              .map((q) => ({ kind: q.kind, raw: q.raw }))
          : [],
        ref: sentence.ref,
        sentenceId: sentence.id,
      };
      out.push(stat);
      sentence.statIds.push(stat.id);
    }
  }

  return out;
}

function findQualifiers(text: string) {
  const found: { kind: StatQualifier['kind']; raw: string; start: number; end: number }[] = [];
  for (const { re, kind } of QUALIFIER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      found.push({ kind, raw: m[0].trim(), start: m.index, end: m.index + m[0].length });
    }
  }
  return found;
}

function overlaps(spans: { start: number; end: number }[], start: number, end: number) {
  return spans.some((s) => start < s.end && end > s.start);
}

function isSameSpan(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start === b.start && a.end === b.end;
}

function parseValue(raw: string): number | null {
  const m = /[-−]?\d+(?:,\d{3})*(?:\.\d+)?/.exec(raw.replace('−', '-'));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Render a statistic for display, keeping qualifiers attached.
 * This is the function that stops "12.4%" from losing its interval.
 */
export function formatStat(stat: Statistic, includeQualifiers: boolean): string {
  if (!includeQualifiers || stat.qualifiers.length === 0) return stat.raw;
  return `${stat.raw} (${stat.qualifiers.map((q) => q.raw).join(', ')})`;
}

export function statById(stats: Statistic[], id: AtomId): Statistic | undefined {
  return stats.find((s) => s.id === id);
}

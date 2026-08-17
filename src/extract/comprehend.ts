import type { Comprehension, Grounded, Section, Sentence, Statistic } from '@/core/types';

/**
 * Comprehension by selection, not generation.
 *
 * Every value here is a sentence that actually appears in the paper, carrying its
 * own SourceRef. Nothing is written; things are chosen. That makes the result
 * grounded by construction — and it makes an empty answer a legitimate one.
 *
 * A paper that never states its limitations gets an empty array, and the interface
 * says so. That absence is information about the paper.
 */

interface Candidate {
  sentence: Sentence;
  section: Section;
  score: number;
}

const CUES = {
  question:
    /\b(we (?:ask|investigate|examine|explore|study|address|test whether)|this (?:paper|study|work|article) (?:investigates?|examines?|asks?|addresses?|explores?|considers?)|the (?:aim|goal|objective|purpose|question) (?:of|is|was)|we (?:hypothesi[sz]ed?|set out to)|it (?:remains|is) unclear|little is known)\b/i,
  method:
    /\b(we (?:used|use|performed|conducted|applied|trained|measured|collected|analy[sz]ed|recruited|randomi[sz]ed|implemented|evaluated|compared)|using (?:a|an|the)|participants were|data were (?:collected|obtained)|(?:randomi[sz]ed|controlled|double[- ]blind|cross[- ]sectional|longitudinal|retrospective|prospective) (?:trial|study|design)|cohort|survey|questionnaire|simulation|dataset|corpus|benchmark|ablation)\b/i,
  finding:
    /\b(we (?:show|found|find|observe[d]?|demonstrate[d]?|report)|results? (?:show|showed|indicate[d]?|suggest(?:ed)?|demonstrate[d]?|reveal(?:ed)?)|(?:significantly|substantially|markedly) (?:higher|lower|greater|better|worse|increased|decreased|improved|reduced)|compared (?:to|with) (?:the )?(?:control|baseline)|outperform(?:s|ed)?|associated with|no significant)\b/i,
  limitation:
    /\b(limitation|caveat|however,? (?:our|this|the|we)|we did not|was not (?:possible|assessed|measured)|cannot (?:be )?(?:rule[d]? out|exclude[d]?|determine[d]?)|may not generali[sz]e|generali[sz]ability|small sample|future (?:work|research|studies)|further (?:work|research|studies) (?:is|are) needed|remains? unclear|beyond the scope)\b/i,
  conclusion:
    /\b(in (?:conclusion|summary)|we conclude|taken together|overall,|these (?:results?|findings?) (?:suggest|indicate|imply|demonstrate|support)|our (?:results?|findings?) (?:suggest|indicate|imply|demonstrate|support)|this (?:work|study|paper) (?:shows|demonstrates|establishes|provides))\b/i,
};

const SECTION_WEIGHT: Record<string, Partial<Record<keyof typeof CUES, number>>> = {
  abstract: { question: 0.5, method: 0.35, finding: 0.55, conclusion: 0.4, limitation: 0.1 },
  introduction: { question: 0.6, method: 0.05, finding: 0.05, conclusion: 0.02, limitation: 0.05 },
  background: { question: 0.25, method: 0.05, finding: 0.02, conclusion: 0.02, limitation: 0.05 },
  methods: { question: 0.05, method: 0.8, finding: 0.05, conclusion: 0.02, limitation: 0.1 },
  results: { question: 0.02, method: 0.1, finding: 0.85, conclusion: 0.1, limitation: 0.05 },
  discussion: { question: 0.1, method: 0.05, finding: 0.35, conclusion: 0.45, limitation: 0.5 },
  limitations: { question: 0.02, method: 0.02, finding: 0.05, conclusion: 0.05, limitation: 0.95 },
  conclusion: { question: 0.05, method: 0.02, finding: 0.3, conclusion: 0.9, limitation: 0.2 },
};

export function comprehend(sections: Section[], statistics: Statistic[]): Comprehension {
  const candidates: Candidate[] = [];
  for (const section of sections) {
    if (section.kind === 'references' || section.kind === 'acknowledgements') continue;
    for (const para of section.paragraphs) {
      for (const sentence of para.sentences) {
        candidates.push({ sentence, section, score: sentence.salience });
      }
    }
  }

  const statSentences = new Set(statistics.map((s) => s.sentenceId));

  const rate = (aspect: keyof typeof CUES, c: Candidate) => {
    const cueHit = CUES[aspect].test(c.sentence.text) ? 1 : 0;
    const sectionWeight = SECTION_WEIGHT[c.section.kind]?.[aspect] ?? 0.05;
    const statBonus = aspect === 'finding' && statSentences.has(c.sentence.id) ? 0.28 : 0;
    const lengthPenalty = penalizeLength(c.sentence.text);
    const score =
      cueHit * 0.55 + sectionWeight * 0.6 + statBonus + c.sentence.salience * 0.3 - lengthPenalty;
    // A cue hit OR a strong section signal is required — never a bare high score,
    // which would let an arbitrary sentence become "the paper's question".
    const eligible = cueHit === 1 || sectionWeight >= 0.8;
    return { score, eligible };
  };

  /*
   * Every sentence argues for one thing best.
   *
   * "These results suggest X, though the mechanism remains unclear" trips both
   * the finding cue and the limitation cue, and without this it would appear
   * twice — once as a finding, once as a caveat — which reads as a bug to
   * anyone watching. Each sentence is assigned to its strongest aspect and is
   * only available to that one, so the storyboard never repeats itself.
   */
  const ASPECTS = ['question', 'method', 'finding', 'limitation', 'conclusion'] as const;
  const role = new Map<string, keyof typeof CUES>();
  for (const c of candidates) {
    let best: keyof typeof CUES | null = null;
    let bestScore = -Infinity;
    for (const aspect of ASPECTS) {
      const { score, eligible } = rate(aspect, c);
      if (!eligible || score <= bestScore) continue;
      bestScore = score;
      best = aspect;
    }
    if (best) role.set(c.sentence.id, best);
  }

  // Near-duplicates are suppressed across aspects too: an abstract commonly
  // restates its own discussion almost word for word.
  const taken: string[] = [];

  const pick = (aspect: keyof typeof CUES, limit: number, minScore: number): Grounded<string>[] => {
    const scored = candidates
      .filter((c) => role.get(c.sentence.id) === aspect)
      .map((c) => ({ c, score: rate(aspect, c).score }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score);

    const chosen: Grounded<string>[] = [];
    for (const { c, score } of scored) {
      const key = normalize(c.sentence.text);
      if (taken.some((t) => t === key || similar(t, key))) continue;
      taken.push(key);
      chosen.push({
        value: c.sentence.text,
        refs: [c.sentence.ref],
        hedge: c.sentence.hedge,
        confidence: Math.max(0.35, Math.min(0.95, score)),
        sentenceId: c.sentence.id,
      });
      if (chosen.length >= limit) break;
    }
    return chosen;
  };

  const questions = pick('question', 1, 0.45);
  const methods = pick('method', 1, 0.45);
  const findings = pick('finding', 6, 0.5);
  const limitations = pick('limitation', 4, 0.5);
  const conclusions = pick('conclusion', 3, 0.5);

  return {
    question: questions[0] ?? null,
    method: methods[0] ?? null,
    findings,
    limitations,
    conclusions,
  };
}

function penalizeLength(text: string): number {
  const words = text.split(/\s+/).length;
  if (words < 7) return 0.35;
  if (words > 55) return 0.3;
  if (words > 40) return 0.12;
  return 0;
}

function normalize(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(
  ('the a an of in to and that is was were with for on as by from this these those it at be are ' +
    'or but we our their its than then so such which who whom while have has had not no')
    .split(' '),
);

/**
 * Two sentences say the same thing if their content words largely coincide.
 *
 * Jaccard alone misses the common case where a discussion sentence is the
 * abstract's sentence with the qualifiers stripped off, so containment of the
 * shorter one inside the longer counts too.
 */
function similar(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return inter / union > 0.5 || inter / Math.min(A.size, B.size) > 0.6;
}

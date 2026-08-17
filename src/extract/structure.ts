import { newId } from '@/core/id';
import type { AtomId, HedgeLevel, Paragraph, Section, SectionKind, Sentence } from '@/core/types';
import type { Line, PageStats } from './text';
import { unionQuad } from './text';

/* ============================================================================
   Headings
   ========================================================================== */

const SECTION_SYNONYMS: [RegExp, SectionKind][] = [
  [/^abstract/i, 'abstract'],
  [/^(1\.?\s*)?introduction/i, 'introduction'],
  [/^(background|preliminaries)/i, 'background'],
  [/^related\s+work/i, 'related-work'],
  [/^(materials?\s+and\s+methods?|methods?|methodology|experimental|approach|study\s+design)/i, 'methods'],
  [/^(results?|findings)/i, 'results'],
  [/^(discussion|interpretation)/i, 'discussion'],
  [/^(limitations?|threats?\s+to\s+validity)/i, 'limitations'],
  [/^(conclusions?|summary|concluding)/i, 'conclusion'],
  [/^(references|bibliography|works\s+cited|literature\s+cited)/i, 'references'],
  [/^(appendix|supplement)/i, 'appendix'],
  [/^(acknowledge?ments?|funding|author\s+contributions)/i, 'acknowledgements'],
];

const NUMBERED = /^((\d+(\.\d+)*)|([IVXLC]+\.)|([A-Z]\.))\s+\S/;

export function headingScore(line: Line, stats: PageStats): number {
  const sizeRatio = line.fontSize / (stats.bodyFontSize || 1);
  const words = line.text.split(/\s+/).length;
  let s = 0;

  s += 2.4 * Math.max(0, Math.min(2.5, (sizeRatio - 1) * 4));
  if (line.bold) s += 1.6;
  if (NUMBERED.test(line.text)) s += 1.3;
  if (words <= 8) s += 1.0;
  if (words <= 4) s += 0.4;
  if (line.gapAbove > 1.5) s += 0.9;
  if (line.gapAbove > 2.6) s += 0.5;
  if (/^[A-Z][A-Za-z0-9 ,:'’\-–—]+$/.test(line.text) && !/[.;]$/.test(line.text)) s += 0.7;
  if (line.text === line.text.toUpperCase() && words <= 8 && /[A-Z]/.test(line.text)) s += 0.8;
  if (/[.;,]$/.test(line.text)) s -= 1.8;
  if (words > 14) s -= 2.2;
  if (/^(figure|fig\.?|table)\s*\d/i.test(line.text)) s -= 4;

  for (const [re] of SECTION_SYNONYMS) {
    if (re.test(line.text.trim())) {
      s += 2.2;
      break;
    }
  }
  return s;
}

export function classifySection(title: string): { kind: SectionKind; confidence: number } {
  const t = title.trim().replace(/^\d+(\.\d+)*\s*/, '');
  for (const [re, kind] of SECTION_SYNONYMS) {
    if (re.test(t)) return { kind, confidence: 0.95 };
  }
  return { kind: 'other', confidence: 0.4 };
}

/* ============================================================================
   Sentences
   ========================================================================== */

const ABBREVIATIONS = new Set([
  'fig', 'figs', 'eq', 'eqs', 'ref', 'refs', 'al', 'et', 'vs', 'cf', 'ie', 'eg', 'approx',
  'ca', 'no', 'nos', 'p', 'pp', 'vol', 'ch', 'sec', 'tab', 'dr', 'prof', 'mr', 'mrs', 'ms',
  'inc', 'ltd', 'st', 'jr', 'sr', 'e.g', 'i.e',
]);

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('en', { granularity: 'sentence' })
    : null;

export function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const raw: { text: string; start: number; end: number }[] = [];

  if (segmenter) {
    for (const seg of segmenter.segment(text)) {
      const t = seg.segment;
      if (t.trim()) raw.push({ text: t, start: seg.index, end: seg.index + t.length });
    }
  } else {
    const re = /[^.!?]+[.!?]+\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) raw.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  // Re-join splits that landed on an abbreviation, an initial, or a decimal.
  const out: { text: string; start: number; end: number }[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (prev && shouldRejoin(prev.text)) {
      prev.text += s.text;
      prev.end = s.end;
    } else {
      out.push({ ...s });
    }
  }

  return out
    .map((s) => ({ ...s, text: s.text.trim(), end: s.start + s.text.trimEnd().length }))
    .filter((s) => s.text.length > 1);
}

function shouldRejoin(prev: string): boolean {
  const trimmed = prev.trimEnd();
  const lastWord = trimmed.split(/[\s(]/).pop() ?? '';
  const bare = lastWord.replace(/\.$/, '').toLowerCase().replace(/[^a-z.]/g, '');
  if (ABBREVIATIONS.has(bare)) return true;
  if (/\b[A-Z]\.$/.test(trimmed)) return true; // author initial
  if (/\d\.$/.test(trimmed) && !/[.!?]\s*$/.test(trimmed.slice(0, -1))) return true;
  if (/\(\s*$/.test(trimmed)) return true;
  return false;
}

/* ============================================================================
   Hedging — the grade of a claim is data, not prose
   ========================================================================== */

const HEDGE_PATTERNS: [RegExp, HedgeLevel][] = [
  [/\b(no significant|not significant|did not differ|no (?:significant )?difference|failed to (?:reach|show)|null result)\b/i, 'null-result'],
  [/\b(did not|does not|was not|were not|no evidence|neither|nor did)\b/i, 'negative'],
  [/\b(might|could(?: potentially)?|may(?: possibly)?|it is possible|conceivably|speculat)/i, 'speculation'],
  [/\b(suggest|indicate|imply|appear(?:s|ed)? to|seem(?:s|ed)? to|consistent with|point(?:s|ed)? to)\b/i, 'suggestion'],
  [/\b(associated with|correlat|linked (?:to|with)|relationship between|predict(?:s|ed|or)?)\b/i, 'association'],
];

export function detectHedge(text: string): HedgeLevel {
  for (const [re, level] of HEDGE_PATTERNS) {
    if (re.test(text)) return level;
  }
  return 'assertion';
}

/* ============================================================================
   Salience — which sentences carry the paper's argument
   ========================================================================== */

const SALIENT_CUES =
  /\b(we (?:show|find|found|demonstrate|present|propose|report|observe|introduce)|our (?:results?|findings?|analysis|study|work|approach)|this (?:paper|study|work|article)|results? (?:show|indicate|suggest|demonstrate)|these (?:results?|findings?)|in (?:conclusion|summary)|significantly|compared (?:to|with)|increase[ds]?|decrease[ds]?|reduc(?:e|ed|tion)|improv(?:e|ed|ement)|outperform)/i;

export function scoreSalience(text: string, kind: SectionKind, hasStat: boolean): number {
  let s = 0.25;
  if (SALIENT_CUES.test(text)) s += 0.3;
  if (hasStat) s += 0.22;
  if (kind === 'results' || kind === 'conclusion') s += 0.18;
  if (kind === 'abstract') s += 0.24;
  if (kind === 'discussion') s += 0.1;
  if (kind === 'limitations') s += 0.14;
  if (kind === 'references' || kind === 'acknowledgements') s -= 0.4;
  const words = text.split(/\s+/).length;
  if (words < 6) s -= 0.25;
  if (words > 45) s -= 0.15;
  if (/^\(?(fig|table)/i.test(text)) s -= 0.2;
  return Math.max(0, Math.min(1, s));
}

/* ============================================================================
   Assembly
   ========================================================================== */

export interface PageLines {
  page: number;
  lines: Line[];
  stats: PageStats;
}

export interface BuildResult {
  sections: Section[];
  sentenceIndex: Map<AtomId, Sentence>;
}

const CAPTION_RE = /^\s*(fig(?:ure)?\.?|table|tab\.?|scheme|algorithm)\s*\.?\s*\d+/i;

/** A section name set on the same line as its first sentence. */
const RUN_IN_HEADING = /^\s*(abstract|summary|introduction|background)\s*[—–\-:.]\s*/i;

export function buildStructure(pages: PageLines[], docBodySize: number): BuildResult {
  const sections: Section[] = [];
  const sentenceIndex = new Map<AtomId, Sentence>();

  let current: {
    title: string;
    kind: SectionKind;
    confidence: number;
    level: 1 | 2 | 3;
    lines: { line: Line; page: number }[];
    startPage: number;
  } | null = null;

  const flush = () => {
    if (!current) return;
    const section = materializeSection(current, sentenceIndex);
    if (section.paragraphs.length > 0 || section.title) sections.push(section);
    current = null;
  };

  const docStats: PageStats = { bodyFontSize: docBodySize, medianLeading: 1 };
  let headingCount = 0;

  for (const p of pages) {
    for (const line of p.lines) {
      if (CAPTION_RE.test(line.text)) continue; // captions belong to figures, not prose

      const score = headingScore(line, docStats);
      const isHeading = score >= 3.4 && line.text.length < 110;
      const runIn = RUN_IN_HEADING.exec(line.text);

      if (isHeading) {
        headingCount++;
        flush();
        const { kind, confidence } = classifySection(line.text);
        const sizeRatio = line.fontSize / docBodySize;
        const level: 1 | 2 | 3 = sizeRatio > 1.28 ? 1 : sizeRatio > 1.1 ? 2 : 3;
        current = {
          title: line.text.replace(/^((\d+(\.\d+)*)|([IVXLC]+\.)|([A-Z]\.))\s+/, '').trim(),
          kind,
          confidence,
          level,
          lines: [],
          startPage: p.page,
        };
      } else {
        // "Abstract — Sleep is widely believed…" is a heading printed as a run-in,
        // which is how most journals set it. Scoring it as body text leaves the
        // paper's most-quoted section with no name at all.
        if (!current && runIn) {
          const title = runIn[1].replace(/\b\w/, (c: string) => c.toUpperCase());
          const { kind, confidence } = classifySection(title);
          current = {
            title,
            kind,
            confidence,
            level: 1,
            lines: [],
            startPage: p.page,
          };
          headingCount++;
          current.lines.push({
            line: { ...line, text: line.text.slice(runIn[0].length) },
            page: p.page,
          });
          continue;
        }
        if (!current) {
          current = {
            title: '',
            kind: 'other',
            confidence: 0.3,
            level: 1,
            lines: [],
            startPage: p.page,
          };
        }
        current.lines.push({ line, page: p.page });
      }
    }
  }
  flush();

  // Fallback: a paper with almost no detected headings gets one section per page
  // rather than a confidently wrong outline.
  if (headingCount < 3 && pages.length > 4) {
    return {
      sections: pages.map((p) => {
        const sec = materializeSection(
          {
            title: `Page ${p.page}`,
            kind: 'other',
            confidence: 0.2,
            level: 1,
            lines: p.lines.map((line) => ({ line, page: p.page })),
            startPage: p.page,
          },
          sentenceIndex,
        );
        return sec;
      }),
      sentenceIndex,
    };
  }

  return { sections, sentenceIndex };
}

function materializeSection(
  cur: {
    title: string;
    kind: SectionKind;
    confidence: number;
    level: 1 | 2 | 3;
    lines: { line: Line; page: number }[];
    startPage: number;
  },
  sentenceIndex: Map<AtomId, Sentence>,
): Section {
  const paragraphs: Paragraph[] = [];
  let buffer: { line: Line; page: number }[] = [];

  const flushPara = () => {
    if (buffer.length === 0) return;
    const page = buffer[0].page;
    const lines = buffer.map((b) => b.line);
    const text = joinLines(lines);
    const quad = unionQuad(lines.map((l) => l.quad));
    const paraRef = { page, quads: [quad], text };

    const sentences: Sentence[] = splitSentences(text).map((s) => {
      const id = newId('atom');
      const quads = quadsForRange(lines, s.start, s.end);
      const sentence: Sentence = {
        id,
        text: s.text,
        ref: { page, quads: quads.length ? quads : [quad], text: s.text },
        hedge: detectHedge(s.text),
        statIds: [],
        citationIds: [],
        salience: scoreSalience(s.text, cur.kind, /\d/.test(s.text)),
      };
      sentenceIndex.set(id, sentence);
      return sentence;
    });

    if (sentences.length > 0) {
      paragraphs.push({ id: newId('atom'), sentences, ref: paraRef });
    }
    buffer = [];
  };

  for (let i = 0; i < cur.lines.length; i++) {
    const entry = cur.lines[i];
    const prev = cur.lines[i - 1];

    let paragraphBreak = false;
    if (prev) {
      const endsSentence = /[.!?]["'’)\]]?$/.test(prev.line.text);
      // A short last line is how a paragraph looks when it ends.
      const prevRunsShort = prev.line.quad.w < entry.line.quad.w * 0.82;
      const flowChanged = prev.line.column !== entry.line.column || prev.page !== entry.page;

      // Prose continues across a column or page break; only a finished sentence
      // starts a new paragraph there. Splitting mid-sentence would put half a
      // claim on one slide and half on another.
      if (flowChanged) {
        paragraphBreak = endsSentence && prevRunsShort;
      } else {
        const indented = entry.line.quad.x > prev.line.quad.x + 0.012 && endsSentence;
        paragraphBreak = entry.line.gapAbove > 1.7 || indented;
      }
    }

    if (paragraphBreak && buffer.length > 0) flushPara();
    buffer.push(entry);
  }
  flushPara();

  const pagesTouched = cur.lines.map((l) => l.page);
  return {
    id: newId('atom'),
    level: cur.level,
    // Text that arrives before any heading gets located rather than labelled
    // "untitled", which reads as a failure rather than as a place in the paper.
    title: cur.title || `Page ${cur.startPage}`,
    kind: cur.kind,
    paragraphs,
    pageRange: [
      pagesTouched.length ? Math.min(...pagesTouched) : cur.startPage,
      pagesTouched.length ? Math.max(...pagesTouched) : cur.startPage,
    ],
    confidence: cur.confidence,
  };
}

/** Join lines into prose, healing hyphenated line breaks. */
function joinLines(lines: Line[]): string {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (i === 0) {
      out = t;
      continue;
    }
    // Heal a hyphenated line break, but only when it really is one.
    if (/[a-z]{2}[-\u00ad]$/.test(out) && /^[a-z]/.test(t)) {
      out = out.replace(/[-\u00ad]$/, '') + t;
    } else {
      out += ' ' + t;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Map a character range in the joined text back to per-line quads. */
function quadsForRange(lines: Line[], start: number, end: number) {
  const quads = [];
  let cursor = 0;
  for (const line of lines) {
    const len = line.text.length;
    const lineStart = cursor;
    const lineEnd = cursor + len;
    if (lineEnd > start && lineStart < end) {
      const from = Math.max(0, start - lineStart) / Math.max(1, len);
      const to = Math.min(len, end - lineStart) / Math.max(1, len);
      quads.push({
        x: line.quad.x + line.quad.w * from,
        y: line.quad.y,
        w: Math.max(0.004, line.quad.w * (to - from)),
        h: line.quad.h,
      });
    }
    cursor = lineEnd + 1;
    if (cursor > end) break;
  }
  return quads;
}

import { newId } from '@/core/id';
import type { Reference, Section } from '@/core/types';

/**
 * References and in-text citation linking.
 *
 * An in-text citation that cannot be matched to an entry is recorded as such
 * rather than dropped — an unmatched attribution is exactly the kind of thing
 * the integrity view exists to surface.
 */

const NUMBERED_ENTRY = /^\s*\[?(\d{1,3})[\].]\s+(.{20,})$/;
const AUTHOR_YEAR_ENTRY = /^\s*([A-Z][^.]{3,80}?)\s*[.,]\s*\(?((?:19|20)\d{2})\)?[.,]\s*(.+)$/;

const INTEXT_NUMERIC = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g;
const INTEXT_AUTHOR = /\(([A-Z][A-Za-z'’-]+(?:\s+(?:et\s+al\.?|and|&)\s+[A-Z][A-Za-z'’-]+)?),?\s*((?:19|20)\d{2}[a-z]?)\)/g;

export function extractReferences(sections: Section[]): Reference[] {
  const refSection = sections.find((s) => s.kind === 'references');
  const references: Reference[] = [];

  if (refSection) {
    for (const para of refSection.paragraphs) {
      // Reference lists rarely segment as sentences; work from the raw paragraph.
      const text = para.ref.text;
      const chunks = splitEntries(text);
      for (const chunk of chunks) {
        const parsed = parseEntry(chunk);
        if (!parsed) continue;
        references.push({
          id: newId('reference'),
          marker: parsed.marker,
          raw: chunk,
          authors: parsed.authors,
          title: parsed.title,
          year: parsed.year,
          ref: { page: para.ref.page, quads: para.ref.quads, text: chunk },
        });
      }
    }
  }

  // Link in-text citations to entries (and record the ones that do not resolve).
  const byMarker = new Map(references.map((r) => [r.marker.toLowerCase(), r]));
  for (const section of sections) {
    if (section.kind === 'references') continue;
    for (const para of section.paragraphs) {
      for (const sentence of para.sentences) {
        INTEXT_NUMERIC.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INTEXT_NUMERIC.exec(sentence.text))) {
          for (const token of expandRange(m[1])) {
            const hit = byMarker.get(token);
            if (hit) sentence.citationIds.push(hit.id);
          }
        }
        INTEXT_AUTHOR.lastIndex = 0;
        while ((m = INTEXT_AUTHOR.exec(sentence.text))) {
          const key = `${m[1].split(/\s+/)[0].toLowerCase()}${m[2].slice(0, 4)}`;
          const hit = byMarker.get(key);
          if (hit) sentence.citationIds.push(hit.id);
        }
      }
    }
  }

  return references;
}

function splitEntries(text: string): string[] {
  // Numbered lists split cleanly on their markers.
  const numbered = text.split(/(?=\[\d{1,3}\]\s)|(?=(?:^|\s)\d{1,3}\.\s+[A-Z])/g);
  if (numbered.length > 2) {
    return numbered.map((s) => s.trim()).filter((s) => s.length > 25);
  }
  // Author–year lists: split before a capitalised surname following a year+period.
  const authorYear = text.split(/(?<=\.\s)(?=[A-Z][a-z]+,\s+[A-Z])/g);
  return authorYear.map((s) => s.trim()).filter((s) => s.length > 25);
}

function parseEntry(
  chunk: string,
): { marker: string; authors: string | null; title: string | null; year: number | null } | null {
  const numbered = NUMBERED_ENTRY.exec(chunk);
  if (numbered) {
    const body = numbered[2];
    const year = /\b(19|20)\d{2}\b/.exec(body);
    return {
      marker: numbered[1],
      authors: body.split(/[.,]/)[0]?.trim() || null,
      title: guessTitle(body),
      year: year ? Number(year[0]) : null,
    };
  }

  const ay = AUTHOR_YEAR_ENTRY.exec(chunk);
  if (ay) {
    const surname = ay[1].split(/[,\s]+/)[0].toLowerCase();
    return {
      marker: `${surname}${ay[2]}`,
      authors: ay[1].trim(),
      title: guessTitle(ay[3]),
      year: Number(ay[2]),
    };
  }

  const bareYear = /\b(19|20)\d{2}\b/.exec(chunk);
  if (bareYear && chunk.length > 40) {
    const surname = chunk.trim().split(/[,\s]+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    if (surname.length > 2) {
      return {
        marker: `${surname}${bareYear[0]}`,
        authors: chunk.split(/[.,]/)[0]?.trim() || null,
        title: guessTitle(chunk),
        year: Number(bareYear[0]),
      };
    }
  }
  return null;
}

function guessTitle(body: string): string | null {
  // The title is usually the longest sentence-like run before the venue.
  const parts = body
    .split(/\.\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 12);
  if (parts.length === 0) return null;
  const candidate = parts.sort((a, b) => b.length - a.length)[0];
  return candidate.length > 140 ? candidate.slice(0, 140) + '…' : candidate;
}

function expandRange(token: string): string[] {
  const out: string[] = [];
  for (const part of token.split(/\s*,\s*/)) {
    const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to - from < 60) for (let i = from; i <= to; i++) out.push(String(i));
    } else {
      out.push(part.trim());
    }
  }
  return out;
}

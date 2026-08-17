import type { NarrationCue, WordTiming } from '@/core/types';

/**
 * Narration uses the browser's own speech engine, which reports word-boundary
 * events as it speaks. Those events are the real word timings — the same data a
 * cloud TTS provider would return — so the highlight can track the voice exactly
 * rather than approximating it.
 *
 * Captured timings are written back into the project, which means the marker is
 * self-correcting: the first play refines it, and every play after that (and the
 * exported captions) are exact.
 */

export interface Voice {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
}

let cachedVoices: Voice[] | null = null;

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function listVoices(): Promise<Voice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  if (cachedVoices && cachedVoices.length) return Promise.resolve(cachedVoices);

  return new Promise((resolve) => {
    const read = () => {
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) return false;
      cachedVoices = voices
        .filter((v) => v.lang.toLowerCase().startsWith('en'))
        .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }))
        .sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
      if (cachedVoices.length === 0) {
        cachedVoices = voices.map((v) => ({
          uri: v.voiceURI,
          name: v.name,
          lang: v.lang,
          local: v.localService,
        }));
      }
      resolve(cachedVoices);
      return true;
    };
    if (read()) return;
    const onChange = () => {
      if (read()) speechSynthesis.removeEventListener('voiceschanged', onChange);
    };
    speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(cachedVoices ?? []);
    }, 1200);
  });
}

export interface SpeakOptions {
  voiceURI: string | null;
  rate: number;
  /** Called with refined timings when the engine reports boundaries. */
  onTimings?: (cueId: string, words: WordTiming[]) => void;
  onEnd?: (cueId: string) => void;
}

/**
 * Drives one cue. Returns a handle that can be cancelled — playback control must
 * never leave a dangling utterance behind.
 */
export class Narrator {
  private spokenCue: string | null = null;
  private cancelled = false;

  constructor(private options: SpeakOptions) {}

  update(options: Partial<SpeakOptions>) {
    this.options = { ...this.options, ...options };
  }

  /** Idempotent: speaking the same cue twice in a row is a no-op. */
  speak(cue: NarrationCue) {
    if (!speechSupported()) return;
    if (this.spokenCue === cue.id) return;
    this.stop();
    this.cancelled = false;
    this.spokenCue = cue.id;

    const utterance = new SpeechSynthesisUtterance(cue.text);
    utterance.rate = clamp(this.options.rate, 0.5, 2);
    utterance.pitch = 1;
    utterance.volume = 1;

    if (this.options.voiceURI) {
      const match = speechSynthesis.getVoices().find((v) => v.voiceURI === this.options.voiceURI);
      if (match) {
        utterance.voice = match;
        utterance.lang = match.lang;
      }
    }

    const started = performance.now();
    const words = cue.text.split(/\s+/).filter(Boolean);
    const captured: WordTiming[] = words.map((text) => ({ text, startMs: -1, endMs: -1 }));
    let index = 0;

    utterance.onboundary = (event) => {
      if (this.cancelled) return;
      if (event.name && event.name !== 'word') return;
      const at = performance.now() - started;
      // Map the character index the engine reports onto our word list.
      const i = charIndexToWord(cue.text, event.charIndex, words);
      const target = i >= 0 ? i : index;
      if (target < captured.length && captured[target].startMs < 0) {
        captured[target].startMs = at;
        if (target > 0 && captured[target - 1].endMs < 0) {
          captured[target - 1].endMs = at;
        }
        index = target + 1;
      }
    };

    utterance.onend = () => {
      if (this.cancelled) return;
      const total = performance.now() - started;
      this.options.onTimings?.(cue.id, finalize(captured, total));
      this.options.onEnd?.(cue.id);
    };

    try {
      speechSynthesis.speak(utterance);
    } catch {
      /* the engine can refuse while another utterance is cancelling */
    }
  }

  stop() {
    this.cancelled = true;
    this.spokenCue = null;
    if (!speechSupported()) return;
    try {
      speechSynthesis.cancel();
    } catch {
      /* some engines throw when idle */
    }
  }

  /** Forget the last cue so it can be spoken again after a seek. */
  reset() {
    this.spokenCue = null;
  }
}

function finalize(words: WordTiming[], totalMs: number): WordTiming[] {
  const out = words.map((w) => ({ ...w }));
  // Fill any boundary the engine skipped by interpolating between known points.
  for (let i = 0; i < out.length; i++) {
    if (out[i].startMs < 0) {
      const prev = i > 0 ? out[i - 1].startMs : 0;
      let nextIdx = i + 1;
      while (nextIdx < out.length && out[nextIdx].startMs < 0) nextIdx++;
      const next = nextIdx < out.length ? out[nextIdx].startMs : totalMs;
      const span = nextIdx - i + 1;
      out[i].startMs = prev + ((next - prev) / span) * 1;
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i].endMs = i + 1 < out.length ? out[i + 1].startMs : totalMs;
    if (out[i].endMs <= out[i].startMs) out[i].endMs = out[i].startMs + 90;
  }
  return out;
}

function charIndexToWord(text: string, charIndex: number, words: string[]): number {
  if (charIndex <= 0) return 0;
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const found = text.indexOf(words[i], cursor);
    if (found < 0) continue;
    const end = found + words[i].length;
    if (charIndex <= end) return i;
    cursor = end;
  }
  return words.length - 1;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

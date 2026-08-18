import { produce } from 'immer';
import type { Paper, ProjectSettings, Scene, SceneId } from '@/core/types';
import {
  appendToScene,
  beatScenes,
  bulletScene,
  compareScene,
  emphasiseInScene,
  figureScene,
  narrateOverScene,
  quoteScene,
  spotlightScene,
  statementScene,
  statisticScene,
  titleScene,
} from '@/compose/fromPassage';
import { clip } from './pageText';
import type { Passage } from './selection';

/**
 * The instruments.
 *
 * One entry per thing a person can do to a marked passage. Each says when it
 * applies and what it would produce — nothing else in the product decides what
 * a tool means, so adding a tool is adding an entry here and nowhere else.
 *
 * `plan` is pure: it returns the scenes it *would* make without touching the
 * project. That is what lets the same call drive the drag preview, the keyboard
 * shortcut and the actual drop, and guarantees the preview cannot lie.
 */

export type InstrumentId =
  | 'statement'
  | 'number'
  | 'quote'
  | 'build'
  | 'beats'
  | 'figure'
  | 'spotlight'
  | 'append'
  | 'narrate'
  | 'title'
  | 'compare';

export type InstrumentGroup = 'make' | 'add' | 'combine';

export interface InstrumentContext {
  paper: Paper;
  settings: ProjectSettings;
  scenes: Scene[];
  currentSceneId: SceneId | null;
  tray: Passage[];
  /** A rendered crop, when the passage is a dragged-out region. */
  crop?: string | null;
}

export interface Plan {
  /** Undo label. */
  label: string;
  toast: string;
  insert: Scene[];
  patch: { sceneId: SceneId; apply: (scene: Scene) => void } | null;
  /** What the drag preview shows. */
  preview: Scene | null;
}

export interface Instrument {
  id: InstrumentId;
  group: InstrumentGroup;
  label: string;
  /** One line, written as what will happen. */
  hint: string;
  key: string;
  /** Needs a rendered crop before it can be applied. */
  needsCrop?: boolean;
  /**
   * Clicking this tool puts the reader into a mode rather than acting at once.
   * Such a tool is never shown as unavailable: it is the way you *get* to a
   * passage it can accept.
   */
  arms?: 'crop';
  /** Why it cannot run right now, or null when it can. */
  blocked(passage: Passage | null, ctx: InstrumentContext): string | null;
  plan(passage: Passage, ctx: InstrumentContext): Plan | null;
}

const NO_TEXT = 'Mark some text first';

function currentScene(ctx: InstrumentContext): Scene | null {
  return ctx.scenes.find((s) => s.id === ctx.currentSceneId) ?? ctx.scenes[0] ?? null;
}

function insertPlan(label: string, toast: string, scenes: Scene[]): Plan | null {
  if (!scenes.length) return null;
  return { label, toast, insert: scenes, patch: null, preview: scenes[0] };
}

function patchPlan(
  label: string,
  toast: string,
  scene: Scene,
  apply: (draft: Scene) => void,
): Plan {
  return {
    label,
    toast,
    insert: [],
    patch: { sceneId: scene.id, apply },
    preview: produce(scene, apply),
  };
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'statement',
    group: 'make',
    label: 'Statement',
    hint: 'A scene that shows the passage and reads it aloud',
    key: 's',
    blocked: (p) => (p && p.text.length > 1 ? null : NO_TEXT),
    plan: (p, ctx) =>
      insertPlan('Make a statement', `Added “${clip(p.text, 34)}”`, [statementScene(p, ctx)]),
  },
  {
    id: 'number',
    group: 'make',
    label: 'Big number',
    hint: 'The number at full size, with the sentence that qualifies it',
    key: 'n',
    blocked: (p) =>
      !p || !p.text ? NO_TEXT : p.statistics.length ? null : 'No number in this passage',
    plan: (p, ctx) => {
      const scene = statisticScene(p, ctx);
      return scene ? insertPlan('Make a number', `Added “${scene.title}”`, [scene]) : null;
    },
  },
  {
    id: 'quote',
    group: 'make',
    label: 'Pull quote',
    hint: 'Set as a quotation, attributed to its page',
    key: 'q',
    blocked: (p) => (p && p.text.length > 1 ? null : NO_TEXT),
    plan: (p, ctx) => insertPlan('Make a quote', 'Added a pull quote', [quoteScene(p, ctx)]),
  },
  {
    id: 'build',
    group: 'make',
    label: 'Build a list',
    hint: 'One line per sentence, arriving as each is spoken',
    key: 'b',
    blocked: (p) => (p && p.text.length > 1 ? null : NO_TEXT),
    plan: (p, ctx) => insertPlan('Make a build', 'Added a build', [bulletScene(p, ctx)]),
  },
  {
    id: 'beats',
    group: 'make',
    label: 'Beat by beat',
    hint: 'Every sentence becomes its own scene, in order',
    key: 'x',
    blocked: (p) =>
      !p || !p.text ? NO_TEXT : p.sentences.length > 1 ? null : 'Mark more than one sentence',
    plan: (p, ctx) => {
      const scenes = beatScenes(p, ctx);
      return insertPlan(
        'Make beats',
        `Added ${scenes.length} scene${scenes.length === 1 ? '' : 's'}`,
        scenes,
      );
    },
  },
  {
    id: 'figure',
    group: 'make',
    label: 'Figure',
    hint: 'Crop what you marked and show it, with its caption',
    key: 'f',
    needsCrop: true,
    arms: 'crop',
    blocked: (p) =>
      !p
        ? 'Drag a box around a figure'
        : p.figure || p.table || p.region
          ? null
          : 'Drag a box around a figure instead',
    plan: (p, ctx) => {
      const scene = figureScene(p, ctx, ctx.crop ?? null);
      return scene ? insertPlan('Add a figure', `Added “${scene.title}”`, [scene]) : null;
    },
  },
  {
    id: 'title',
    group: 'make',
    label: 'Title card',
    hint: 'Open the talk with this line and the paper’s byline',
    key: 't',
    blocked: (p) => (p && p.text.length > 1 ? null : NO_TEXT),
    plan: (p, ctx) => insertPlan('Make a title card', 'Added a title card', [titleScene(p, ctx)]),
  },

  {
    id: 'append',
    group: 'add',
    label: 'Add to scene',
    hint: 'Put the passage into the scene you are on',
    key: 'a',
    blocked: (p, ctx) =>
      !p || !p.text ? NO_TEXT : currentScene(ctx) ? null : 'No scene to add to yet',
    plan: (p, ctx) => {
      const scene = currentScene(ctx);
      if (!scene) return null;
      return patchPlan('Add to scene', `Added to “${scene.title}”`, scene, (draft) =>
        appendToScene(draft, p, ctx.settings),
      );
    },
  },
  {
    id: 'spotlight',
    group: 'add',
    label: 'Spotlight',
    hint: 'Mark these exact words inside the sentence around them',
    key: 'h',
    blocked: (p) => (p && p.text.length > 1 ? null : NO_TEXT),
    plan: (p, ctx) => {
      const scene = currentScene(ctx);
      // Marking words inside a scene that already shows them is the precise act;
      // when no scene shows them, the sentence comes along so the words have
      // something to be marked inside of.
      if (scene && produce(scene, (d) => void emphasiseInScene(d, p)) !== scene) {
        return patchPlan('Spotlight words', `Marked “${clip(p.text, 26)}”`, scene, (draft) => {
          emphasiseInScene(draft, p);
        });
      }
      return insertPlan('Spotlight words', `Added “${clip(p.text, 26)}”`, [spotlightScene(p, ctx)]);
    },
  },
  {
    id: 'narrate',
    group: 'add',
    label: 'Voice-over',
    hint: 'Spoken over the current scene, without appearing on it',
    key: 'v',
    blocked: (p, ctx) =>
      !p || !p.text ? NO_TEXT : currentScene(ctx) ? null : 'No scene to speak over yet',
    plan: (p, ctx) => {
      const scene = currentScene(ctx);
      if (!scene) return null;
      return patchPlan('Add voice-over', `Speaking over “${scene.title}”`, scene, (draft) =>
        narrateOverScene(draft, p, ctx.settings),
      );
    },
  },

  {
    id: 'compare',
    group: 'combine',
    label: 'Side by side',
    hint: 'Set this against the passage you kept, in two columns',
    key: 'c',
    blocked: (p, ctx) =>
      !p || !p.text ? NO_TEXT : ctx.tray.length ? null : 'Keep another passage first (⇧K)',
    plan: (p, ctx) => {
      const other = ctx.tray[ctx.tray.length - 1];
      if (!other) return null;
      const scene = compareScene([other, p], ctx);
      return scene ? insertPlan('Compare passages', 'Added a comparison', [scene]) : null;
    },
  },
];

export const INSTRUMENT_BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export function instrumentByKey(key: string): Instrument | null {
  const k = key.toLowerCase();
  return INSTRUMENTS.find((i) => i.key === k) ?? null;
}

/**
 * The instrument that best suits a passage, used for double-click and for the
 * marker bar's leading button. A number wants to be a number; a figure wants to
 * be a figure; a few words inside a sentence want to be spotlit.
 */
export function suggestFor(passage: Passage | null, ctx: InstrumentContext): Instrument {
  const fallback = INSTRUMENT_BY_ID.get('statement')!;
  if (!passage) return fallback;
  // Nothing made yet: the first thing a talk needs is an opening card.
  if (!ctx.scenes.length) return INSTRUMENT_BY_ID.get('title')!;
  if (passage.region || passage.figure || passage.table) return INSTRUMENT_BY_ID.get('figure')!;
  // Several sentences want to arrive one at a time; a single one carrying a
  // number wants to be that number.
  if (passage.sentences.length > 2) return INSTRUMENT_BY_ID.get('build')!;
  if (passage.statistics.length) return INSTRUMENT_BY_ID.get('number')!;
  const inner = passage.sentences[0];
  if (inner && passage.words >= 2 && passage.text.length < inner.text.length * 0.7) {
    return INSTRUMENT_BY_ID.get('spotlight')!;
  }
  return fallback;
}

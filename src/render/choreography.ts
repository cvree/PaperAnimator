import type { HoldPreset, Layer, MotionPreset, Scene } from '@/core/types';
import { affinityOf, motionDef, type MotionAffinity } from './motion';

/**
 * Looks: whole-scene motion direction, in one click.
 *
 * Choosing an entrance for every element on every scene is the part of this
 * job that nobody enjoys and almost nobody does well — it is how decks end up
 * with a headline that tumbles, a figure that irises and a caption that wipes,
 * all in the same six seconds. A look is the alternative: one coherent set of
 * decisions, made once by someone who does this for a living, applied to the
 * whole scene at once.
 *
 * A look decides four things together, because they are not separable:
 *   · which entrance suits each kind of element,
 *   · what keeps moving once the entrance has landed,
 *   · how far apart the elements arrive,
 *   · and how this scene is joined to the one before it.
 *
 * Everything a look sets stays editable afterwards. It is a starting point with
 * taste in it, not a mode you are locked into.
 */

export type LookId = 'editorial' | 'documentary' | 'keynote' | 'minimal';

export interface LookDef {
  id: LookId;
  name: string;
  blurb: string;
  /** How this scene is joined to the one before it. */
  transition: Scene['transitionIn'];
  /** Gap between one element arriving and the next, in ms. */
  gapMs: number;
  /** Volume applied to every entrance in the scene. */
  intensity: number;
  /** The entrance each kind of element gets. */
  entrance: Record<MotionAffinity, MotionPreset>;
  /** What keeps happening after the entrance lands, by kind. */
  hold: Partial<Record<MotionAffinity, HoldPreset>>;
}

export const LOOKS: LookDef[] = [
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'Calm and printed. Everything lifts quietly into place.',
    transition: 'dissolve',
    gapMs: 130,
    intensity: 1,
    entrance: { text: 'rise', number: 'weigh-in', image: 'crop-in', any: 'rise' },
    hold: { image: 'ken-burns' },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    blurb: 'Slower and filmic. The lens finds each thing in turn.',
    transition: 'recompose',
    gapMs: 240,
    intensity: 1.1,
    entrance: { text: 'focus-pull', number: 'focus-pull', image: 'develop', any: 'focus-pull' },
    hold: { image: 'ken-burns', any: 'float' },
  },
  {
    id: 'keynote',
    name: 'Keynote',
    blurb: 'Crisp and spoken. Lines land word by word, on the beat.',
    transition: 'turn',
    gapMs: 90,
    intensity: 0.9,
    entrance: { text: 'cascade', number: 'typeset', image: 'shutter', any: 'settle' },
    hold: {},
  },
  {
    id: 'minimal',
    name: 'Minimal',
    blurb: 'Nearly nothing. Content appears; the motion stays out of it.',
    transition: 'dissolve',
    gapMs: 60,
    intensity: 0.45,
    entrance: { text: 'rise', number: 'rise', image: 'rise', any: 'rise' },
    hold: {},
  },
];

export const LOOK_BY_ID = new Map<LookId, LookDef>(LOOKS.map((l) => [l.id, l]));

export function lookDef(id: LookId): LookDef {
  return LOOK_BY_ID.get(id) ?? LOOKS[0];
}

/**
 * Reading order: down the page, then across it.
 *
 * Delays handed out in stacking order lead the eye wherever the composer
 * happened to push layers, which on a two-column scene means jumping back and
 * forth. Position is what a viewer actually reads in, so position is what
 * decides who arrives first. The row tolerance keeps two things that sit
 * side by side on one line from being treated as separate beats.
 */
const ROW_TOLERANCE = 0.06;

function readingOrder(layers: Layer[]): Layer[] {
  return [...layers].sort((a, b) => {
    const dy = a.frame.y - b.frame.y;
    if (Math.abs(dy) > ROW_TOLERANCE) return dy;
    return a.frame.x - b.frame.x;
  });
}

/**
 * Apply a look to one scene. Call inside a mutate recipe — it edits in place.
 *
 * Decoration rides the beat of the content it belongs to rather than taking a
 * beat of its own: a rule under a headline that waits its turn stops being a
 * rule under a headline and becomes a second event.
 */
export function applyLook(scene: Scene, look: LookDef): void {
  scene.transitionIn = look.transition;

  const visible = scene.layers.filter((l) => !l.hidden);
  let beat = 0;

  for (const layer of readingOrder(visible)) {
    const affinity = affinityOf(layer);
    const preset = look.entrance[affinity] ?? look.entrance.any;
    const def = motionDef(preset);

    if (layer.decorative) {
      // Just behind the element it belongs to, and it does not advance the beat.
      layer.enter.delayMs = Math.max(0, Math.round(beat * look.gapMs - look.gapMs + 70));
    } else {
      layer.enter.delayMs = Math.round(beat * look.gapMs);
      beat++;
    }

    layer.enter.preset = preset;
    layer.enter.durationMs = def.durationMs;
    layer.enter.reducedMotion = def.reducedMotion;
    layer.enter.intensity = look.intensity;

    const hold = look.hold[affinity] ?? look.hold.any ?? 'none';
    // A hold on something that is about to leave the screen has no room to
    // read, and a hold on a rule is only ever a wobble.
    layer.enter.hold = layer.decorative ? 'none' : hold;
  }
}

/**
 * Which look a scene is already wearing, if any.
 *
 * A scene matches when every visible element carries the entrance and volume
 * the look would have given it. Partial matches are not matches — a scene one
 * hand-edited caption away from Editorial is a scene someone has since edited,
 * and saying otherwise would tell them their edit did not land.
 */
export function currentLook(scene: Scene): LookId | null {
  for (const look of LOOKS) {
    if (scene.transitionIn !== look.transition) continue;
    const visible = scene.layers.filter((l) => !l.hidden);
    if (visible.length === 0) continue;
    const matches = visible.every((l) => {
      const wanted = look.entrance[affinityOf(l)] ?? look.entrance.any;
      const volume = l.enter.intensity ?? 1;
      return l.enter.preset === wanted && Math.abs(volume - look.intensity) < 0.02;
    });
    if (matches) return look.id;
  }
  return null;
}

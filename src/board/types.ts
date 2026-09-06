import type { Id, SourceRef, TableGrid } from '@/core/types';

/**
 * The board — an unbounded surface you arrange a talk on.
 *
 * The storyboard next door is a sequence: one scene, then the next. The board
 * is a place. Things sit near each other because they belong near each other,
 * and a presentation is a route through them rather than a list of them. Both
 * describe the same paper; neither replaces the other.
 *
 * Everything here is in world units — a coordinate system with no edges, no
 * origin worth mentioning and no page. A card at x = 9,000,000 is as ordinary
 * as one at x = 0. The camera decides what is on screen; the board itself has
 * no idea a screen exists.
 */

export type BoardId = Id<'board'>;
export type CardId = Id<'card'>;
export type StopId = Id<'stop'>;
export type EdgeId = Id<'edge'>;

/** A rectangle in world units, origin top-left. */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Where the eye is. `x`/`y` is the world point held at the centre of the
 * viewport, `zoom` is screen pixels per world unit.
 *
 * The camera is deliberately not part of the board: looking somewhere is not an
 * edit, and undo should never move the view out from under you.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Whiteboard or blackboard. It is one switch because it is one decision: a
 * room with the lights on, or a room with the lights off. Every card reads its
 * colours from the surface, so the switch restyles the whole board at once
 * instead of leaving black text stranded on black.
 */
export type Surface = 'white' | 'black';

/** The paper-grid under the cards. Off is a legitimate choice. */
export type Grid = 'dots' | 'lines' | 'none';

/**
 * A card's colour, named for what it does rather than for a hex value, so the
 * same card reads correctly on both surfaces.
 */
export type Tone = 'plain' | 'ink' | 'accent' | 'yellow' | 'mint' | 'sky' | 'rose' | 'lilac';

export const TONES: Tone[] = ['plain', 'ink', 'accent', 'yellow', 'mint', 'sky', 'rose', 'lilac'];

/** What a click on this card does while presenting. Null is the common case. */
export type CardAction =
  | { kind: 'stop'; stopId: StopId }
  | { kind: 'zoom' }
  | { kind: 'flip'; back: string }
  | { kind: 'link'; href: string };

export type TextRoleOnBoard = 'title' | 'heading' | 'body' | 'quote' | 'label' | 'mono';

/**
 * How a card is edged.
 *
 * A whiteboard is a place where people draw boxes round things, so the edges
 * are the vocabulary: a rule is a rule, a circled thing was circled by hand,
 * a taped thing was brought from somewhere else. Each one is drawn from the
 * card's own tone, so an outline never introduces a colour the board has not
 * already agreed to.
 */
export type Outline = 'none' | 'hairline' | 'sketch' | 'marker' | 'tape' | 'glow' | 'cut';

export const OUTLINES: { id: Outline; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'hairline', label: 'Rule' },
  { id: 'sketch', label: 'Drawn by hand' },
  { id: 'marker', label: 'Circled in marker' },
  { id: 'tape', label: 'Taped on' },
  { id: 'glow', label: 'Lit' },
  { id: 'cut', label: 'Cut out' },
];

export interface CardBase {
  id: CardId;
  rect: WorldRect;
  rotation: number;
  z: number;
  /**
   * Type size relative to the card's natural one. Dragging a corner scales the
   * whole card, the way a person expects a handle to behave; dragging an edge
   * only changes the wrap.
   */
  scale: number;
  tone: Tone;
  locked: boolean;
  /**
   * 0 shows with its stop. 1 and up wait for a click, so a card can arrive on
   * cue in front of an audience instead of being read ahead of you.
   */
  step: number;
  action: CardAction | null;
  /** Only ever spoken, never drawn — the presenter's own view shows it. */
  note: string;
  /** Where in the paper this came from, when it came from the paper. */
  source: SourceRef | null;
  /**
   * How far from the eye, −1 (behind the board) to +1 (in front of it). 0 is
   * the board itself, where everything sits until somebody says otherwise.
   *
   * Depth is not decoration: it is what parallax reads off, what the lens
   * focuses on, and how a background stops competing with the point. It costs
   * nothing when it is zero, which it is by default.
   */
  depth: number;
  /** The card's edge. See {@link Outline}. */
  outline: Outline;
}

export interface TextCard extends CardBase {
  kind: 'text';
  text: string;
  role: TextRoleOnBoard;
  align: 'start' | 'center' | 'end';
}

export interface StickyCard extends CardBase {
  kind: 'sticky';
  text: string;
}

export interface ImageCard extends CardBase {
  kind: 'image';
  src: string | null;
  caption: string | null;
  alt: string;
  fit: 'contain' | 'cover';
}

export interface TableCard extends CardBase {
  kind: 'table';
  grid: TableGrid | null;
  src: string | null;
  caption: string | null;
}

export interface StatCard extends CardBase {
  kind: 'stat';
  value: string;
  caption: string | null;
  qualifiers: string[];
}

export interface ShapeCard extends CardBase {
  kind: 'shape';
  shape: 'rect' | 'ellipse' | 'diamond';
  label: string;
  filled: boolean;
}

export interface InkCard extends CardBase {
  kind: 'ink';
  /** Flat [x, y, x, y, …] in world units, one array per stroke. */
  strokes: number[][];
  weight: number;
}

export type Card =
  | TextCard
  | StickyCard
  | ImageCard
  | TableCard
  | StatCard
  | ShapeCard
  | InkCard;

export type CardKind = Card['kind'];

/** A drawn connection between two cards. Arrows point at the target. */
export interface Edge {
  id: EdgeId;
  from: CardId;
  to: CardId;
  label: string;
  arrow: boolean;
  dashed: boolean;
}

/**
 * A stop is a place the camera goes and a moment the talk pauses. It is a
 * rectangle on the board, not a copy of anything: move the cards under it and
 * the slide changes, because the slide *is* the region.
 */
export interface Stop {
  id: StopId;
  title: string;
  rect: WorldRect;
  notes: string;
  /** Seconds to hold here when the presentation is left to run itself. 0 = wait for a person. */
  autoAdvanceMs: number;
}

/**
 * The board's atmosphere — everything that is true of the room rather than of
 * any one card.
 *
 * Every field is a 0–1 dial and every one of them is off at zero, so a board
 * that asks for nothing renders exactly the flat, fast surface it rendered
 * before any of this existed. They are dials rather than switches because the
 * difference between a good effect and a bad one is almost always how much of
 * it there is.
 */
export interface BoardEffects {
  /** Depth drift: cards at different depths slide past each other as you move. */
  parallax: number;
  /** The lens. Cards away from what you are looking at go soft. */
  focus: number;
  /** A light that follows the cursor, and rests on the stop while presenting. */
  spotlight: number;
  /** Ink and accents bloom, the way a lit sign does. */
  bloom: number;
  /** The tooth of the surface: paper grain on white, chalk dust on black. */
  grain: number;
  /** A slow colour field drifting behind the grid. */
  aurora: number;
  /** The corners fall away, so the middle is where the eye goes. */
  vignette: number;
  /** Drawings draw themselves on, and cards arrive rather than appear. */
  reveal: boolean;
}

/** The name of the look these dials came from, for the picker to show. */
export type EffectPreset = 'plain' | 'desk' | 'studio' | 'cinema' | 'neon' | 'custom';

export interface Board {
  id: BoardId;
  surface: Surface;
  grid: Grid;
  /** See {@link BoardEffects}. */
  effects: BoardEffects;
  /** Which look {@link effects} came from, or `custom` once it was adjusted. */
  look: EffectPreset;
  cards: Card[];
  edges: Edge[];
  stops: Stop[];
  /** Sticks the presentation's aspect to a shape so a stop frames predictably. */
  stopAspect: number;
}

/* ============================================================================
   Defaults
   ========================================================================== */

/** Roughly a 16:9 slide at a comfortable reading size, in world units. */
export const STOP_W = 1600;
export const STOP_H = 900;

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

export const GRID_UNIT = 40;

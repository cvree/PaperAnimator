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
 * The room the talk happens in.
 *
 * It began as one switch — lights on, lights off — and that is still the
 * decision most people make. The rest are the same idea taken seriously: a
 * board is a lit surface, and the light it is lit by is the single thing that
 * sets the whole look. Every card reads its colours from here, so changing the
 * surface restyles the board at once instead of leaving black text stranded on
 * black.
 */
export type Surface = 'white' | 'black' | 'slate' | 'midnight' | 'blueprint' | 'sand';

export const SURFACE_ORDER: Surface[] = ['white', 'sand', 'slate', 'black', 'midnight', 'blueprint'];

/**
 * How hard the board moves.
 *
 * Motion is a house style, not a per-card decision: a deck where every element
 * arrives its own way is a deck nobody can follow. One control sets the pace of
 * every entrance, and `none` is a legitimate answer — some rooms, and some
 * people, want the thing to simply be there.
 */
export type Motion = 'none' | 'calm' | 'lively' | 'cinematic';

export const MOTIONS: Motion[] = ['none', 'calm', 'lively', 'cinematic'];

/**
 * How a card arrives. `auto` picks by what the card is — a headline reads in
 * word by word, a figure focuses, a drawn stroke draws itself — which is right
 * often enough that most cards never need this set.
 */
export type Reveal =
  | 'auto'
  | 'fade'
  | 'rise'
  | 'pop'
  | 'zoom'
  | 'blur'
  | 'wipe'
  | 'cascade'
  | 'flip'
  | 'drop'
  | 'draw';

export const REVEALS: Reveal[] = [
  'auto',
  'fade',
  'rise',
  'pop',
  'zoom',
  'blur',
  'wipe',
  'cascade',
  'flip',
  'drop',
  'draw',
];

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
   * How it arrives when the talk reaches it. Absent means `auto`, which is what
   * every card made before this existed gets — the board reads it defensively
   * so an older project opens looking better rather than looking broken.
   */
  reveal?: Reveal;
  /**
   * Lifts the card off the board with a real shadow. Off by default, because a
   * board where everything floats is a board where nothing does.
   */
  raised?: boolean;
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

export interface Board {
  id: BoardId;
  surface: Surface;
  grid: Grid;
  cards: Card[];
  edges: Edge[];
  stops: Stop[];
  /** Sticks the presentation's aspect to a shape so a stop frames predictably. */
  stopAspect: number;
  /** The pace of every entrance. Absent means `lively`. */
  motion?: Motion;
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

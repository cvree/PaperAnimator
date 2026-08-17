import type { StyleId, TextRole } from '@/core/types';

/**
 * A visual style is a token set + type treatment + a motion character.
 * Switching one restyles the whole project deterministically.
 *
 * These tokens are resolved values rather than CSS variables because the render
 * surface must produce identical output in the editor, in a static preview, and
 * in the export — where the page's theme variables are not in play.
 */

export interface StyleTokens {
  ground: string;
  groundEdge: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  rule: string;
  accent: string;
  marker: string;
  figureFrame: string;
  grain: number;
}

export interface TypeSpec {
  family: string;
  weight: number;
  /** Size as a fraction of canvas height, so type scales with the frame. */
  size: number;
  leading: number;
  tracking: string;
  transform?: 'uppercase';
  italic?: boolean;
}

export interface VisualStyle {
  id: StyleId;
  name: string;
  description: string;
  tokens: StyleTokens;
  type: Record<TextRole, TypeSpec>;
  /** Decorative rule under a display heading, etc. */
  rules: { display: boolean; label: boolean };
  figure: { border: boolean; radius: number; pad: number };
  motionBias: 'ink' | 'sketch' | 'optical' | 'human';
}

const DISPLAY = 'Newsreader Variable, Newsreader, Georgia, serif';
const UI = 'Inter Variable, Inter, system-ui, sans-serif';
const MONO = 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace';

export const STYLES: Record<StyleId, VisualStyle> = {
  broadsheet: {
    id: 'broadsheet',
    name: 'Broadsheet',
    description: 'Editorial and printed. Strict grid, serif display, hairline rules.',
    tokens: {
      ground: '#faf8f4',
      groundEdge: '#efece5',
      ink: '#1b1a18',
      inkSoft: '#4a4741',
      inkFaint: '#8b877e',
      rule: '#d8d4ca',
      accent: '#1b4b8f',
      marker: '#ffe8a3',
      figureFrame: '#e4e0d6',
      grain: 0.03,
    },
    type: {
      display: { family: DISPLAY, weight: 500, size: 0.115, leading: 1.03, tracking: '-0.028em' },
      headline: { family: DISPLAY, weight: 460, size: 0.072, leading: 1.16, tracking: '-0.018em' },
      body: { family: DISPLAY, weight: 400, size: 0.042, leading: 1.42, tracking: '-0.005em' },
      quote: { family: DISPLAY, weight: 420, size: 0.062, leading: 1.28, tracking: '-0.014em', italic: true },
      caption: { family: UI, weight: 400, size: 0.026, leading: 1.45, tracking: '0' },
      label: { family: UI, weight: 570, size: 0.021, leading: 1.2, tracking: '0.13em', transform: 'uppercase' },
    },
    rules: { display: true, label: true },
    figure: { border: true, radius: 0, pad: 0 },
    motionBias: 'ink',
  },

  notebook: {
    id: 'notebook',
    name: 'Lab Notebook',
    description: 'Tactile and annotated. Margin notes, pencil rules, working feel.',
    tokens: {
      ground: '#f7f4ea',
      groundEdge: '#ece7d8',
      ink: '#252420',
      inkSoft: '#55524a',
      inkFaint: '#918d80',
      rule: '#cfc8b4',
      accent: '#9a3412',
      marker: '#d6ecc8',
      figureFrame: '#ffffff',
      grain: 0.055,
    },
    type: {
      display: { family: UI, weight: 600, size: 0.098, leading: 1.08, tracking: '-0.022em' },
      headline: { family: UI, weight: 550, size: 0.062, leading: 1.22, tracking: '-0.014em' },
      body: { family: UI, weight: 400, size: 0.038, leading: 1.52, tracking: '0' },
      quote: { family: DISPLAY, weight: 420, size: 0.056, leading: 1.32, tracking: '-0.01em', italic: true },
      caption: { family: UI, weight: 400, size: 0.025, leading: 1.48, tracking: '0' },
      label: { family: MONO, weight: 500, size: 0.02, leading: 1.2, tracking: '0.1em', transform: 'uppercase' },
    },
    rules: { display: false, label: true },
    figure: { border: true, radius: 2, pad: 0.018 },
    motionBias: 'sketch',
  },

  signal: {
    id: 'signal',
    name: 'Signal',
    description: 'Quiet futurism. Near-black ground, thin type, precise hairlines.',
    tokens: {
      ground: '#0e1013',
      groundEdge: '#16191d',
      ink: '#f2f4f6',
      inkSoft: '#a8b0b8',
      inkFaint: '#6b747d',
      rule: '#2a2f35',
      accent: '#4cc9d9',
      marker: '#2b4a52',
      figureFrame: '#1a1d21',
      grain: 0.05,
    },
    type: {
      display: { family: UI, weight: 300, size: 0.104, leading: 1.06, tracking: '-0.012em' },
      headline: { family: UI, weight: 350, size: 0.064, leading: 1.24, tracking: '-0.008em' },
      body: { family: UI, weight: 350, size: 0.038, leading: 1.55, tracking: '0.002em' },
      quote: { family: UI, weight: 300, size: 0.058, leading: 1.34, tracking: '-0.006em' },
      caption: { family: MONO, weight: 400, size: 0.024, leading: 1.5, tracking: '0' },
      label: { family: MONO, weight: 450, size: 0.019, leading: 1.2, tracking: '0.16em', transform: 'uppercase' },
    },
    rules: { display: true, label: false },
    figure: { border: true, radius: 3, pad: 0.02 },
    motionBias: 'optical',
  },

  chalk: {
    id: 'chalk',
    name: 'Chalk',
    description: 'Teaching and spoken. Large type, few elements, warm slate.',
    tokens: {
      ground: '#1e2422',
      groundEdge: '#252b29',
      ink: '#f4f1e8',
      inkSoft: '#c3c0b4',
      inkFaint: '#8a8880',
      rule: '#3a413e',
      accent: '#e8b04b',
      marker: '#4a4327',
      figureFrame: '#f8f6f0',
      grain: 0.06,
    },
    type: {
      display: { family: DISPLAY, weight: 500, size: 0.122, leading: 1.04, tracking: '-0.022em' },
      headline: { family: DISPLAY, weight: 460, size: 0.082, leading: 1.18, tracking: '-0.016em' },
      body: { family: DISPLAY, weight: 400, size: 0.046, leading: 1.44, tracking: '-0.004em' },
      quote: { family: DISPLAY, weight: 440, size: 0.07, leading: 1.26, tracking: '-0.014em', italic: true },
      caption: { family: UI, weight: 400, size: 0.027, leading: 1.45, tracking: '0' },
      label: { family: UI, weight: 560, size: 0.022, leading: 1.2, tracking: '0.14em', transform: 'uppercase' },
    },
    rules: { display: false, label: true },
    figure: { border: false, radius: 2, pad: 0.022 },
    motionBias: 'human',
  },
};

export const STYLE_ORDER: StyleId[] = ['broadsheet', 'notebook', 'signal', 'chalk'];

/** True when a style's ground is dark, so overlaid chrome can adapt. */
export function isDarkStyle(id: StyleId): boolean {
  return id === 'signal' || id === 'chalk';
}

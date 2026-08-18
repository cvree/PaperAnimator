import { createRoot } from 'react-dom/client';
// The surface is styled by the app's own sheet — without it the absolutely
// positioned layers have nothing to be positioned inside of.
import '@/styles/base.css';
import { SceneSurface } from '@/render/SceneSurface';
import { paintFrame, loadImages } from '@/export/paint';
import { resolveFrame } from '@/render/resolveFrame';
import { MOTIONS } from '@/render/motion';
import type { Layer, MotionPreset, Project, Scene } from '@/core/types';

/**
 * Preview equals export, proved rather than asserted.
 *
 * For every entrance in the catalogue this draws the same resolved frame twice
 * — once through the DOM surface the editor uses, once through the canvas
 * painter the exporter uses — at the same instants. Anything that renders in
 * one and not the other is visible immediately, side by side.
 *
 * Served by the dev server: `npm run dev`, then /tools/parity.html.
 */

const W = 320;
const H = 180;
const SAMPLES = [0.3, 0.62, 1];

const provenance = { kind: 'connective' } as const;

function textLayer(preset: MotionPreset): Layer {
  return {
    id: 'l_text' as never,
    type: 'text',
    atoms: [{ id: 'a1' as never, text: 'Extended sleep reduced recovery time by a third', provenance }],
    role: 'headline',
    align: 'start',
    frame: { x: 0.08, y: 0.26, w: 0.84, h: 0.4 },
    z: 1,
    opacity: 1,
    rotation: 0,
    locked: false,
    hidden: false,
    enter: { preset, delayMs: 0, durationMs: 1000, reducedMotion: 'fade' },
    emphasis: [],
    altText: null,
    decorative: false,
  };
}

function sceneFor(preset: MotionPreset): Scene {
  return {
    id: 's1' as never,
    title: preset,
    kind: 'finding',
    durationMs: 2000,
    durationPinned: true,
    layers: [textLayer(preset)],
    narration: [],
    transitionIn: 'cut',
    sourceRefs: [],
    locked: false,
    hidden: false,
  };
}

function projectFor(scene: Scene): Project {
  return {
    id: 'p' as never,
    version: 1,
    title: '',
    paper: null as never,
    settings: null as never,
    scenes: [scene],
    style: 'broadsheet',
    createdAt: '',
    updatedAt: '',
  };
}

const sheet = document.getElementById('sheet')!;
const images = await loadImages([]);
// The painter measures text with the real faces; waiting avoids comparing a
// fallback font against the one the DOM has already loaded.
await document.fonts.ready;

for (const def of MOTIONS) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<div class="name">${def.name}</div>`;

  for (const share of SAMPLES) {
    const scene = sceneFor(def.id);
    const project = projectFor(scene);
    const t = Math.min(scene.durationMs - 1, def.durationMs * share);
    const frame = resolveFrame(project, t, { reducedMotion: false });

    const pair = document.createElement('div');
    pair.className = 'pair';
    pair.innerHTML = `<span class="tag">${Math.round(share * 100)}%</span>`;

    const dom = document.createElement('div');
    dom.style.width = `${W}px`;
    dom.style.height = `${H}px`;
    pair.appendChild(dom);
    createRoot(dom).render(
      <SceneSurface frame={frame} styleId="broadsheet" width={W} height={H} showReviewChips={false} />,
    );

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    pair.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    paintFrame(ctx, frame, 'broadsheet', { width: W, height: H, captions: false, images });

    row.appendChild(pair);
  }

  sheet.appendChild(row);
}

/* ---- the reduced-motion contract -------------------------------------- *
 * With movement off, nothing may travel, turn, scale or stagger: content
 * appears on time and stays put. This asserts it for every entrance rather
 * than trusting each one to have remembered.
 */
const violations: string[] = [];
for (const def of MOTIONS) {
  const project = projectFor(sceneFor(def.id));
  for (const share of [0.3, 0.7, 1]) {
    const rl = resolveFrame(project, def.durationMs * share, { reducedMotion: true }).layers[0];
    if (!rl) continue;
    const moved =
      Math.abs(rl.tx) > 1e-6 ||
      Math.abs(rl.ty) > 1e-6 ||
      Math.abs(rl.scale - 1) > 1e-6 ||
      Math.abs(rl.rotate) > 1e-6 ||
      rl.blur > 1e-6 ||
      Math.abs(rl.trackingEm) > 1e-6 ||
      rl.mask !== null ||
      rl.imageMotion !== null ||
      (rl.reveal?.units.some((u) => u.opacity < 1 || u.ty !== 0 || u.tx !== 0) ?? false);
    if (moved) violations.push(`${def.id} @ ${share}`);
  }
}
console.log(
  violations.length
    ? 'REDUCED MOTION VIOLATIONS: ' + violations.join(', ')
    : 'reduced motion: nothing moves, in every entrance',
);

// React renders on a microtask; the flag goes up once it has flushed.
await new Promise((r) => setTimeout(r, 400));
document.body.dataset.ready = 'true';

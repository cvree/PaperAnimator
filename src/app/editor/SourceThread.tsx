import { useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { layerRef } from '@/core/types';
import { findSourceElement } from './SourcePane';

/**
 * The thread. When a claim on the canvas is selected, a line is drawn from it to
 * the exact sentence in the paper it came from.
 *
 * It is measured from the live DOM on every frame it is visible, so it stays
 * attached while panes scroll — a thread that lies about what it connects would
 * be worse than no thread.
 */

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function SourceThread() {
  const project = useApp((s) => s.project);
  const selectedLayerIds = useApp((s) => s.selectedLayerIds);
  const selectedSceneId = useApp((s) => s.selectedSceneId);
  const [line, setLine] = useState<Line | null>(null);

  useEffect(() => {
    if (!project || selectedLayerIds.length !== 1) {
      setLine(null);
      return;
    }
    const scene = project.scenes.find((s) => s.id === selectedSceneId);
    const layer = scene?.layers.find((l) => l.id === selectedLayerIds[0]);
    if (!layer) {
      setLine(null);
      return;
    }

    const ref = layerRef(layer);
    if (!ref) {
      setLine(null);
      return;
    }

    let raf = 0;

    const measure = () => {
      const from = document.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`);
      const to =
        findSourceElement(ref) ??
        document.querySelector<HTMLElement>(`[data-page="${ref.page}"]`);

      if (!from || !to) {
        setLine(null);
      } else {
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        // Only draw when the source end is actually on screen.
        if (b.bottom < 0 || b.top > window.innerHeight) {
          setLine(null);
        } else {
          setLine({
            x1: a.left,
            y1: a.top + a.height / 2,
            x2: b.right,
            y2: Math.max(8, Math.min(window.innerHeight - 8, b.top + b.height / 2)),
          });
        }
      }
      raf = requestAnimationFrame(measure);
    };

    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [project, selectedLayerIds, selectedSceneId]);

  if (!line) return null;

  const dx = Math.max(36, (line.x1 - line.x2) * 0.45);
  const d = `M ${line.x2} ${line.y2} C ${line.x2 + dx} ${line.y2}, ${line.x1 - dx} ${line.y1}, ${line.x1} ${line.y1}`;

  return (
    // An <svg> with no width/height falls back to its intrinsic 300×150 and
    // silently clips the thread, so the size is stated outright.
    <svg
      className="pointer-events-none fixed inset-0 z-[var(--z-overlay)]"
      style={{ width: '100vw', height: '100vh', overflow: 'visible' }}
      aria-hidden="true"
      fill="none"
    >
      {/* A soft halo first, so the hairline reads over both the paper column
          and the scene, without either becoming a heavy graphic. */}
      <path
        d={d}
        stroke="var(--accent)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.1"
        className="motion-safe:animate-[thread-draw_460ms_var(--ease-out)]"
        style={{ strokeDasharray: 2400, strokeDashoffset: 0 }}
      />
      <path
        d={d}
        stroke="var(--accent)"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.75"
        className="motion-safe:animate-[thread-draw_460ms_var(--ease-out)]"
        style={{ strokeDasharray: 2400, strokeDashoffset: 0 }}
      />
      <circle cx={line.x2} cy={line.y2} r="3.5" fill="var(--accent)" opacity="0.9" />
      <circle cx={line.x2} cy={line.y2} r="7" fill="var(--accent)" opacity="0.16" />
      <circle cx={line.x1} cy={line.y1} r="2.5" fill="var(--accent)" opacity="0.9" />
      <style>{`@keyframes thread-draw{from{stroke-dashoffset:2400}to{stroke-dashoffset:0}}`}</style>
    </svg>
  );
}

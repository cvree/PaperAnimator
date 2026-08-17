import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Aspect, Project, Scene, StyleId } from '@/core/types';
import { ASPECT_DIMS } from '@/core/types';
import { resolveFrame, settledOffset } from './resolveFrame';
import { SceneSurface } from './SceneSurface';

/**
 * A still of a scene at its settled moment, drawn by the same resolveFrame the
 * live canvas and the exporter use. Previews therefore cannot drift from
 * playback — they are the same code at a fixed time.
 */

interface Props {
  scene: Scene;
  styleId: StyleId;
  aspect: Aspect;
  /** Time within the scene. Defaults to just past the last entrance. */
  atMs?: number;
  className?: string;
}

export function ScenePreview({ scene, styleId, aspect, atMs, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const dims = ASPECT_DIMS[aspect];
  const ratio = dims.h / dims.w;
  const height = width * ratio;

  const settled = useMemo(
    () => (atMs !== undefined ? atMs : settledOffset(scene)),
    [scene, atMs],
  );

  const frame = useMemo(() => {
    const single: Project = {
      id: 'preview' as never,
      version: 1,
      title: '',
      paper: null as never,
      settings: null as never,
      scenes: [scene],
      style: styleId,
      createdAt: '',
      updatedAt: '',
    };
    return resolveFrame(single, settled, { reducedMotion: false });
  }, [scene, styleId, settled]);

  return (
    <div ref={host} className={className} style={{ width: '100%', aspectRatio: `${dims.w} / ${dims.h}` }}>
      {width > 0 && (
        <SceneSurface
          frame={frame}
          styleId={styleId}
          width={width}
          height={height}
          showReviewChips={false}
        />
      )}
    </div>
  );
}

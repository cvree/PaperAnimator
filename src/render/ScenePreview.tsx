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
  /**
   * The scene this one is cut from. Supplying it makes the preview a timeline
   * of two scenes rather than one, which is the only way to show a transition
   * — a join cannot be previewed from one side of it.
   */
  before?: Scene | null;
  /**
   * Time within the scene — or, when `before` is given, within the pair,
   * measured from the start of the outgoing scene. Defaults to just past the
   * last entrance.
   */
  atMs?: number;
  className?: string;
}

export function ScenePreview({ scene, styleId, aspect, before, atMs, className }: Props) {
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
    () => (atMs !== undefined ? atMs : settledOffset(scene) + (before ? before.durationMs : 0)),
    [scene, before, atMs],
  );

  const frame = useMemo(() => {
    const preview: Project = {
      id: 'preview' as never,
      version: 1,
      title: '',
      paper: null as never,
      settings: null as never,
      scenes: before ? [before, scene] : [scene],
      style: styleId,
      createdAt: '',
      updatedAt: '',
    };
    return resolveFrame(preview, settled, { reducedMotion: false });
  }, [scene, before, styleId, settled]);

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

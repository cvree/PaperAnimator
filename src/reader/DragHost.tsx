import { useCallback } from 'react';
import { useApp } from '@/state/store';
import { appendToScene } from '@/compose/fromPassage';
import { INSTRUMENT_BY_ID, type InstrumentId } from './instruments';
import { useApply } from './apply';
import { useDragEngine } from './useDragEngine';
import { DragGhost } from './DragGhost';
import type { Passage } from './selection';

/**
 * Wires the drag engine to the project and paints what is being carried.
 *
 * Mounted once by the editor, above every surface a drag can cross, so a tool
 * picked up in the dock can be dropped on the page and a passage picked up on
 * the page can be dropped in the storyboard.
 */

export function DragHost() {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const seekScene = useApp((s) => s.seekScene);
  const showToast = useApp((s) => s.showToast);
  const { apply } = useApply();

  const run = useCallback(
    (id: InstrumentId, passage: Passage, at?: number) => {
      const instrument = INSTRUMENT_BY_ID.get(id);
      if (instrument) void apply(instrument, passage, at === undefined ? {} : { at });
    },
    [apply],
  );

  useDragEngine(project?.paper ?? null, {
    onToolDrop: (id, passage) => run(id, passage),
    onPassageToTool: (passage, id) => run(id, passage),
    onPassageToScene: (passage, sceneId) => {
      if (!project) return;
      const target = project.scenes.find((s) => s.id === sceneId);
      if (!target) return;
      mutate('Add to scene', (draft) => {
        const scene = draft.scenes.find((s) => s.id === sceneId);
        if (scene) appendToScene(scene, passage, draft.settings);
      });
      seekScene(sceneId);
      showToast(`Added to “${target.title}”`);
    },
    onPassageToGap: (passage, index) => run('statement', passage, index),
    onCancel: () => {},
  });

  return <DragGhost />;
}

import { useCallback, useMemo } from 'react';
import type { Scene, SceneId } from '@/core/types';
import { useApp } from '@/state/store';
import { useReader } from './readerStore';
import type { Instrument, InstrumentContext, Plan } from './instruments';
import type { Passage } from './selection';

/**
 * Turning an instrument and a passage into a change to the project.
 *
 * One path, used by the click, the keyboard shortcut and the drop alike — so
 * whatever the drag preview showed is literally what gets committed.
 */

export interface ApplyOptions {
  /** Insert position in the storyboard; defaults to after the current scene. */
  at?: number;
  /** Where the mark was, so the page can flash it. */
  flash?: { page: number; quads: { x: number; y: number; w: number; h: number }[] } | null;
}

export function useInstrumentContext(): InstrumentContext | null {
  const project = useApp((s) => s.project);
  const currentSceneId = useApp((s) => s.selectedSceneId);
  const tray = useReader((s) => s.tray);

  return useMemo(() => {
    if (!project) return null;
    return {
      paper: project.paper,
      settings: project.settings,
      scenes: project.scenes,
      currentSceneId,
      tray,
    };
  }, [project, currentSceneId, tray]);
}

export function useApply() {
  const ctx = useInstrumentContext();
  const session = useApp((s) => s.session);
  const mutate = useApp((s) => s.mutate);
  const seekScene = useApp((s) => s.seekScene);
  const showToast = useApp((s) => s.showToast);
  const setFlash = useReader((s) => s.setFlash);

  /** What a drop would produce, without producing it. Drives the preview. */
  const preview = useCallback(
    (instrument: Instrument, passage: Passage | null): Plan | null => {
      if (!ctx || !passage) return null;
      if (instrument.blocked(passage, ctx)) return null;
      try {
        return instrument.plan(passage, ctx);
      } catch {
        return null;
      }
    },
    [ctx],
  );

  const apply = useCallback(
    async (instrument: Instrument, passage: Passage | null, options: ApplyOptions = {}) => {
      if (!ctx) return;
      const why = instrument.blocked(passage, ctx);
      if (why || !passage) {
        showToast(why ?? 'Mark some text first');
        return;
      }

      // A cropped region has to be rendered before the scene can hold it.
      let crop: string | null = null;
      if (instrument.needsCrop && passage.region && session) {
        crop = await session.cropRegion(passage.region.page, passage.region.quad, 1400);
      }

      const plan = instrument.plan(passage, { ...ctx, crop });
      if (!plan) {
        showToast(`${instrument.label} does not fit this passage`);
        return;
      }

      let focus: SceneId | null = null;
      mutate(plan.label, (draft) => {
        if (plan.patch) {
          const scene = draft.scenes.find((s) => s.id === plan.patch!.sceneId);
          if (scene) {
            plan.patch.apply(scene);
            focus = scene.id;
          }
          return;
        }
        const currentIndex = draft.scenes.findIndex((s) => s.id === ctx.currentSceneId);
        const at =
          options.at !== undefined
            ? Math.max(0, Math.min(draft.scenes.length, options.at))
            : currentIndex >= 0
              ? currentIndex + 1
              : draft.scenes.length;
        draft.scenes.splice(at, 0, ...(plan.insert as Scene[]));
        focus = plan.insert[0]?.id ?? null;
      });

      if (focus) seekScene(focus);
      const flash = options.flash ?? firstSpan(passage);
      if (flash) setFlash(flash);
      showToast(plan.toast, { label: 'Undo', run: () => useApp.getState().undo() });
    },
    [ctx, session, mutate, seekScene, showToast, setFlash],
  );

  return { ctx, apply, preview };
}

function firstSpan(passage: Passage) {
  const span = passage.spans[0];
  return span && span.quads.length ? { page: span.page, quads: span.quads } : null;
}

import { useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { Canvas } from './Canvas';
import { SourcePane } from './SourcePane';
import { SceneRail } from './SceneRail';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { IntegrityView } from './IntegrityView';
import { ExportSheet } from './ExportSheet';
import { EditorTopBar } from './EditorTopBar';
import { SourceThread } from './SourceThread';
import { Onboarding } from './Onboarding';
import { useLayoutSize } from '@/ui/useLayoutSize';

/**
 * Four regions: the paper, the storyboard, the canvas, and the inspector, with a
 * timeline beneath. Disclosure level decides how many are visible — Simple mode
 * alone can produce a complete, exportable project.
 */

export function Editor() {
  const view = useApp((s) => s.editorView);
  const disclosure = useApp((s) => s.disclosure);
  const project = useApp((s) => s.project);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const playing = useApp((s) => s.playing);
  const size = useLayoutSize();
  const [mobilePane, setMobilePane] = useState<'paper' | 'scenes' | 'preview' | 'review'>(
    'preview',
  );

  /* ---- global keys ----------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing) return;

      const state = useApp.getState();
      switch (e.key) {
        case ' ':
          e.preventDefault();
          state.playing ? state.pause() : state.play();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          state.seek(state.timeMs - (e.shiftKey ? 1000 : 1000 / 30));
          break;
        case 'ArrowRight':
          e.preventDefault();
          state.seek(state.timeMs + (e.shiftKey ? 1000 : 1000 / 30));
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const scenes = state.project?.scenes.filter((s) => !s.hidden) ?? [];
          const i = scenes.findIndex((s) => s.id === state.selectedSceneId);
          const next =
            e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(scenes.length - 1, i + 1);
          if (scenes[next]) state.seekScene(scenes[next].id);
          break;
        }
        case 'Home':
          e.preventDefault();
          state.seek(0);
          break;
        default:
          if (meta && e.key === '.') {
            e.preventDefault();
            const order = ['simple', 'studio', 'pro'] as const;
            const idx = order.indexOf(state.disclosure);
            state.setDisclosure(order[(idx + 1) % order.length]);
          }
          if (meta && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            state.setEditorView(state.editorView === 'integrity' ? 'compose' : 'integrity');
          }
          if (meta && e.key.toLowerCase() === 'e') {
            e.preventDefault();
            state.setEditorView('export');
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /* Stop the voice if the tab is hidden — nothing worse than a page talking
     to itself in a background tab. */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && useApp.getState().playing) useApp.getState().pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!project) return null;

  const showTimeline = disclosure !== 'simple';
  const showInspector = disclosure !== 'simple';

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--surface-page)]">
      <EditorTopBar />

      {view === 'integrity' && <IntegrityView />}
      {view === 'export' && <ExportSheet />}

      <main
        id="main"
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ display: view === 'compose' ? undefined : 'none' }}
      >
        {/* ---------- desktop ---------- */}
        {size === 'desktop' && (
          <div className="flex min-h-0 flex-1">
            <section
              aria-label="Source paper"
              className="flex w-[clamp(17rem,21vw,23rem)] shrink-0 flex-col border-r border-[var(--rule-hairline)]"
            >
              <div data-coach="paper" className="min-h-0 flex-1">
                <SourcePane />
              </div>
              <div
                data-coach="rail"
                className="h-[38%] shrink-0 border-t border-[var(--rule-hairline)]"
              >
                <SceneRail />
              </div>
            </section>

            <section aria-label="Canvas" className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <Canvas />
              </div>
              {showTimeline && (
                <div className="h-[clamp(8rem,16vh,12rem)] shrink-0 border-t border-[var(--rule-hairline)]">
                  <Timeline />
                </div>
              )}
            </section>

            {showInspector && (
              <section
                aria-label="Inspector"
                className="w-[clamp(17rem,20vw,21rem)] shrink-0 border-l border-[var(--rule-hairline)]"
              >
                <Inspector />
              </section>
            )}
          </div>
        )}

        {/* ---------- tablet ---------- */}
        {size === 'tablet' && (
          <div className="flex min-h-0 flex-1">
            <section
              aria-label="Source paper"
              className="w-[18rem] shrink-0 border-r border-[var(--rule-hairline)]"
            >
              <SourcePane />
            </section>
            <section aria-label="Canvas" className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <Canvas />
              </div>
              <div className="h-[9rem] shrink-0 border-t border-[var(--rule-hairline)]">
                <SceneRail horizontal />
              </div>
            </section>
          </div>
        )}

        {/* ---------- mobile ---------- */}
        {size === 'mobile' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {mobilePane === 'paper' && <SourcePane />}
              {mobilePane === 'scenes' && <SceneRail />}
              {mobilePane === 'preview' && <Canvas />}
              {mobilePane === 'review' && <IntegrityView embedded />}
            </div>
            <nav
              aria-label="Sections"
              className="flex shrink-0 border-t border-[var(--rule-hairline)] bg-[var(--surface-raised)] pb-[env(safe-area-inset-bottom)]"
            >
              {(
                [
                  ['paper', 'Paper'],
                  ['scenes', 'Scenes'],
                  ['preview', 'Preview'],
                  ['review', 'Review'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMobilePane(key)}
                  aria-current={mobilePane === key}
                  className="flex-1 py-3 text-center text-2xs transition-colors"
                  style={{
                    color: mobilePane === key ? 'var(--ink-primary)' : 'var(--ink-faint)',
                    fontWeight: mobilePane === key ? 560 : 400,
                    boxShadow: mobilePane === key ? 'inset 0 2px 0 0 var(--accent)' : 'none',
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        )}

        <SourceThread />
        {!playing && <Onboarding />}
      </main>
    </div>
  );
}

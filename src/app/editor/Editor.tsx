import { useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { Canvas } from './Canvas';
import { SceneRail } from './SceneRail';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { IntegrityView } from './IntegrityView';
import { ExportSheet } from './ExportSheet';
import { EditorTopBar } from './EditorTopBar';
import { SourceThread } from './SourceThread';
import { Onboarding } from './Onboarding';
import { Reader } from '@/reader/Reader';
import { DragHost } from '@/reader/DragHost';
import { useReader } from '@/reader/readerStore';
import { useLayoutSize } from '@/ui/useLayoutSize';

/**
 * The editor is the paper, and everything else is what the paper produced.
 *
 * The reader holds the majority of the screen because marking it up is the
 * whole job: highlight a passage, drop a tool on it, watch the scene appear
 * beside you. The stage and the storyboard are the result, not the workspace.
 */

type Panel = 'storyboard' | 'inspector';

export function Editor() {
  const view = useApp((s) => s.editorView);
  const disclosure = useApp((s) => s.disclosure);
  const project = useApp((s) => s.project);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const playing = useApp((s) => s.playing);
  const size = useLayoutSize();
  const [panel, setPanel] = useState<Panel>('storyboard');
  const [mobilePane, setMobilePane] = useState<'paper' | 'scenes' | 'preview' | 'review'>('paper');

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
          // ⌥ belongs to the reader, where it walks the paper sentence by sentence.
          if (e.altKey) return;
          e.preventDefault();
          state.seek(state.timeMs - (e.shiftKey ? 1000 : 1000 / 30));
          break;
        case 'ArrowRight':
          if (e.altKey) return;
          e.preventDefault();
          state.seek(state.timeMs + (e.shiftKey ? 1000 : 1000 / 30));
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          // ⌥ belongs to the reader, where it widens and narrows the mark.
          if (e.altKey) return;
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

  /* The reader's marks belong to a paper, not to the app. */
  useEffect(() => () => useReader.getState().reset(), []);

  if (!project) return null;

  const showInspector = disclosure !== 'simple';
  const showTimeline = disclosure === 'pro';
  const activePanel: Panel = showInspector ? panel : 'storyboard';

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
        {/* ---------- desktop & tablet ---------- */}
        {size !== 'mobile' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <section aria-label="The paper" className="min-w-0 flex-1">
                <Reader compactDock={size === 'tablet'} />
              </section>

              <section
                aria-label="Your talk"
                className="flex shrink-0 flex-col border-l border-[var(--rule-hairline)] bg-[var(--surface-page)]"
                style={{ width: size === 'tablet' ? '20rem' : 'clamp(23rem, 30vw, 33rem)' }}
              >
                <div
                  className="min-h-[13rem] shrink-0 border-b border-[var(--rule-hairline)]"
                  style={{ height: size === 'tablet' ? '42%' : '46%' }}
                >
                  <Canvas />
                </div>

                {showInspector && (
                  <div
                    role="tablist"
                    aria-label="Panel"
                    className="flex shrink-0 border-b border-[var(--rule-hairline)]"
                  >
                    {(
                      [
                        ['storyboard', 'Storyboard'],
                        ['inspector', 'Inspector'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={activePanel === key}
                        onClick={() => setPanel(key)}
                        className="label flex-1 py-2 transition-colors"
                        style={{
                          color:
                            activePanel === key ? 'var(--ink-primary)' : 'var(--ink-faint)',
                          boxShadow:
                            activePanel === key ? 'inset 0 -2px 0 0 var(--accent)' : 'none',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <div data-coach="rail" className="min-h-0 flex-1">
                  {activePanel === 'storyboard' ? (
                    <SceneRail header={!showInspector} />
                  ) : (
                    <Inspector />
                  )}
                </div>
              </section>
            </div>

            {showTimeline && (
              <div className="h-[clamp(8rem,15vh,11rem)] shrink-0 border-t border-[var(--rule-hairline)]">
                <Timeline />
              </div>
            )}
          </div>
        )}

        {/* ---------- mobile ---------- */}
        {size === 'mobile' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {mobilePane === 'paper' && <Reader compactDock />}
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
        <DragHost />
        {!playing && <Onboarding />}
      </main>
    </div>
  );
}

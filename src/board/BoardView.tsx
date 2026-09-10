import { useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { BoardSurface } from './BoardSurface';
import { BoardToolbar } from './BoardToolbar';
import { BoardInspector } from './BoardInspector';
import { PaperDrawer } from './PaperDrawer';
import { Present } from './Present';
import { PublishSheet } from './PublishSheet';
import { boardCss } from './paint';
import { useBoardUi } from './boardStore';
import { useLayoutSize } from '@/ui/useLayoutSize';

/**
 * The board, its shelves and its exits.
 *
 * The paper is on the left because everything on the board should have come
 * from it; the board is the middle because that is the work; the run of the
 * talk is on the right because it is a consequence of the arrangement, not a
 * thing you write first.
 */

export function BoardView() {
  const project = useApp((s) => s.project);
  const mode = useBoardUi((s) => s.mode);
  const drawerOpen = useBoardUi((s) => s.drawerOpen);
  const inspectorOpen = useBoardUi((s) => s.inspectorOpen);
  const size = useLayoutSize();
  const [publishing, setPublishing] = useState(false);

  /* Leaving the board should not leave the pen in your hand. */
  useEffect(() => () => useBoardUi.getState().setTool('select'), []);

  if (!project) return null;
  const narrow = size === 'mobile';
  /* A board that arrived as a link has no paper behind it, so the shelf that
     holds the paper's figures is not offered rather than offered empty. */
  const hasPaper = project.paper.pages.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <style>{boardCss()}</style>

      {mode === 'present' ? (
        <Present
          board={project.board}
          title={project.title}
          onExit={() => useBoardUi.getState().setMode('edit')}
        />
      ) : (
        <>
          <BoardToolbar onPublish={() => setPublishing(true)} />
          <div className="flex min-h-0 flex-1">
            {drawerOpen && hasPaper && !narrow && (
              <aside
                aria-label="Content from the paper"
                className="w-64 shrink-0 border-r border-[var(--rule-hairline)]"
              >
                <PaperDrawer />
              </aside>
            )}

            <section aria-label="The board" className="relative min-w-0 flex-1">
              <BoardSurface />
            </section>

            {inspectorOpen && !narrow && (
              <aside
                aria-label="The selected thing"
                className="w-72 shrink-0 border-l border-[var(--rule-hairline)]"
              >
                <BoardInspector />
              </aside>
            )}
          </div>

          {narrow && (
            <div className="h-52 shrink-0 overflow-hidden border-t border-[var(--rule-hairline)]">
              <BoardInspector />
            </div>
          )}
        </>
      )}

      {publishing && <PublishSheet onClose={() => setPublishing(false)} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { Mark } from '@/app/landing/Landing';
import { Toasts } from '@/ui/Toasts';
import { BoardView } from './BoardView';
import { Present } from './Present';
import { ShareMenu } from './ShareMenu';
import { boardCss } from './paint';
import { useBoardUi } from './boardStore';
import { decodeShareLink, projectFromShare, type SharedBoardLink } from './share';

/**
 * A board that arrived as an address.
 *
 * The whole board is inside the fragment of the URL, which never leaves the
 * browser it was pasted into: opening somebody's link uploads nothing, asks
 * nothing, and works with the network off. What the link says decides what
 * opens — a viewer link runs the talk, an editor link opens the board with the
 * tools in reach — and a damaged address says so plainly rather than showing an
 * empty room.
 */

type State =
  | { status: 'reading' }
  | { status: 'ready'; shared: SharedBoardLink }
  | { status: 'broken' };

export function Shared({ hash }: { hash: string }) {
  const [state, setState] = useState<State>({ status: 'reading' });

  useEffect(() => {
    let live = true;
    void decodeShareLink(hash).then((shared) => {
      if (!live) return;
      setState(shared ? { status: 'ready', shared } : { status: 'broken' });
    });
    return () => {
      live = false;
      useBoardUi.getState().reset();
    };
  }, [hash]);

  if (state.status === 'reading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--surface-page)]">
        <p className="text-xs text-[var(--ink-tertiary)]">Opening the board…</p>
      </div>
    );
  }

  if (state.status === 'broken') {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--surface-page)] p-8">
        <p className="max-w-[42ch] text-center text-sm leading-[1.6] text-[var(--ink-secondary)]">
          This link is incomplete. Links that carry a whole board are long, and mail clients often
          break them across lines — ask whoever sent it for the file instead, or for the link on one
          line.
        </p>
      </div>
    );
  }

  if (state.shared.role === 'editor') return <SharedEditor shared={state.shared} />;

  return (
    <>
      <style>{boardCss()}</style>
      <Present board={state.shared.board} title={state.shared.title} />
    </>
  );
}

/**
 * The editor half.
 *
 * A shared board is nobody's paper, so the reader, the storyboard and the
 * export sheet are not offered — there is no PDF behind this and nothing they
 * could honestly show. What is here is the board itself, whole, with every tool
 * working and a share button of its own, because the person who received it is
 * as likely to be the next one to pass it on.
 */
function SharedEditor({ shared }: { shared: SharedBoardLink }) {
  const setProject = useApp((s) => s.setProject);
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setProject(projectFromShare(shared));
    /* Somebody handed this over to be looked at, not to be tidied: the paper
       shelf has nothing in it here, so the board opens with the room to itself. */
    useBoardUi.getState().setDrawerOpen(false);
    setInstalled(true);
    return () => useApp.getState().reset();
  }, [shared, setProject]);

  /* The board owns the rest of the keyboard; undo is the one thing it expects
     the app around it to provide. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      e.preventDefault();
      if (e.shiftKey) useApp.getState().redo();
      else useApp.getState().undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!installed || !project) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--surface-page)]">
        <p className="text-xs text-[var(--ink-tertiary)]">Opening the board…</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--surface-page)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-3">
        <a
          href={`${location.origin}${location.pathname}`}
          title="Paper Animator"
          className="flex shrink-0 items-center"
        >
          <Mark />
        </a>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            aria-label="Board title"
            value={project.title}
            onChange={(e) => {
              const title = e.target.value;
              mutate(
                'Rename the board',
                (d) => {
                  d.title = title;
                },
                'title',
              );
            }}
            className="min-w-0 max-w-[22rem] flex-1 truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-xs font-medium text-[var(--ink-primary)] outline-none hover:border-[var(--rule-hairline)] focus:border-[var(--accent)]"
          />
          <span
            className="hidden shrink-0 rounded-full border border-[var(--rule-hairline)] px-2 py-0.5 text-2xs text-[var(--ink-tertiary)] sm:inline"
            title="This board came to you as a link. Your changes are your own copy."
          >
            Shared with you · your copy
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              location.href = `${location.origin}${location.pathname}`;
            }}
            title="Start from a paper of your own"
            className="hidden sm:inline-flex"
          >
            Start your own
          </Button>
          <ShareMenu />
        </div>
      </header>

      <BoardView />
      <Toasts />
    </div>
  );
}

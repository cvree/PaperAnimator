import { useEffect, useState } from 'react';
import { Present } from './Present';
import { boardCss } from './paint';
import { decodeTalkLink } from './publish';
import { useBoardUi } from './boardStore';
import type { Board } from './types';

/**
 * A talk that arrived as an address.
 *
 * The whole board is inside the fragment of the URL, which never leaves the
 * browser it was pasted into: opening somebody's link uploads nothing, asks
 * nothing, and works with the network off. If the address is damaged we say so
 * plainly rather than showing an empty room.
 */

type State =
  | { status: 'reading' }
  | { status: 'ready'; board: Board; title: string }
  | { status: 'broken' };

export function TalkLink({ hash }: { hash: string }) {
  const [state, setState] = useState<State>({ status: 'reading' });

  useEffect(() => {
    let live = true;
    void decodeTalkLink(hash).then((result) => {
      if (!live) return;
      setState(result ? { status: 'ready', ...result } : { status: 'broken' });
    });
    return () => {
      live = false;
      useBoardUi.getState().reset();
    };
  }, [hash]);

  if (state.status === 'reading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--surface-page)]">
        <p className="text-xs text-[var(--ink-tertiary)]">Opening the talk…</p>
      </div>
    );
  }

  if (state.status === 'broken') {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--surface-page)] p-8">
        <p className="max-w-[42ch] text-center text-sm leading-[1.6] text-[var(--ink-secondary)]">
          This link is incomplete. Links that carry a whole talk are long, and mail clients often
          break them across lines — ask whoever sent it for the file instead, or for the link on one
          line.
        </p>
      </div>
    );
  }

  return (
    <>
      <style>{boardCss()}</style>
      <Present board={state.board} title={state.title} />
    </>
  );
}

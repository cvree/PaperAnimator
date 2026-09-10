import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { Segmented } from '@/ui/Segmented';
import { formatBytes } from '@/core/format';
import { PublishSheet } from './PublishSheet';
import { buildShareLink, ROLE_COPY, type ShareLink, type ShareRole } from './share';
import type { Board } from './types';

/**
 * Share.
 *
 * The control everybody already knows: one button at the top right, one line
 * saying who the link is for, one button that puts it on the clipboard. The
 * only decision it asks for is the one that actually matters — whether the
 * person opening it should watch the talk or be able to move things — and it is
 * a two-way switch, not a permissions dialog.
 *
 * The link carries the board inside its own fragment, so nothing is uploaded
 * and no account is involved. That has one consequence a person must not
 * discover the hard way, so the sheet says it out loud: an editor link hands
 * over a copy. It is not a live document, and this sheet never implies it is.
 */

export function ShareMenu({ label = 'Share' }: { label?: string }) {
  const project = useApp((s) => s.project);
  const showToast = useApp((s) => s.showToast);

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ShareRole>('viewer');
  const [link, setLink] = useState<ShareLink | null>(null);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const field = useRef<HTMLInputElement>(null);
  /* Both links for the board as it stands. Any edit throws them away, because a
     link that is one card out of date is worse than one that takes a moment. */
  const cache = useRef<{ board: Board | null; links: Map<ShareRole, ShareLink> }>({
    board: null,
    links: new Map(),
  });

  const board = project?.board ?? null;

  useEffect(() => {
    if (!open || !project || !board) return;
    if (cache.current.board !== board) cache.current = { board, links: new Map() };

    const hit = cache.current.links.get(role);
    if (hit) {
      setLink(hit);
      setBuilding(false);
      setFailed(false);
      return;
    }

    let live = true;
    setLink(null);
    setFailed(false);
    setBuilding(true);
    void buildShareLink(project, role)
      .then((made) => {
        cache.current.links.set(role, made);
        if (!live) return;
        setLink(made);
        setBuilding(false);
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        setBuilding(false);
      });
    return () => {
      live = false;
    };
  }, [open, role, board, project]);

  /* A copied badge is a receipt, not a state — it should fade on its own. */
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!project) return null;

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      showToast(`${ROLE_COPY[role].label} link copied`);
    } catch {
      /* Some browsers refuse the clipboard outside a trusted gesture. The link
         is on screen either way, so select it and let the keyboard finish. */
      field.current?.select();
      showToast('Press ⌘C to copy the link');
    }
  };

  return (
    <div className="relative">
      {/* On a phone the top bar has no room for the word, and a link glyph in
          the top right needs no explaining. */}
      <Button
        variant="primary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title="Share this board"
        icon={<LinkGlyph />}
      >
        <span className="hidden sm:inline">{label}</span>
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Share this board"
            className="absolute right-0 top-11 z-[61] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-4"
            style={{ boxShadow: 'var(--shadow-float)' }}
          >
            <p className="truncate text-xs font-medium text-[var(--ink-primary)]">
              Share “{project.title}”
            </p>
            <p className="mt-1 text-2xs leading-[1.5] text-[var(--ink-faint)]">
              {project.board.cards.length} card
              {project.board.cards.length === 1 ? '' : 's'} · {project.board.stops.length} stop
              {project.board.stops.length === 1 ? '' : 's'}
            </p>

            {/* Who the link is for. The whole permission model, in one switch. */}
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <PeopleGlyph />
                <span className="text-2xs text-[var(--ink-secondary)]">Anyone with the link</span>
              </div>
              <div className="mt-2">
                <Segmented
                  label="What the link lets them do"
                  options={[
                    { value: 'viewer', label: 'Viewer' },
                    { value: 'editor', label: 'Editor' },
                  ]}
                  value={role}
                  onChange={(v) => setRole(v as ShareRole)}
                />
              </div>
              <p className="mt-2 text-2xs leading-[1.5] text-[var(--ink-faint)]">
                {ROLE_COPY[role].blurb}
              </p>
            </div>

            {/* The link itself, visible so it can always be copied by hand. */}
            <div className="mt-4">
              <input
                ref={field}
                readOnly
                aria-label={`${ROLE_COPY[role].label} link`}
                value={building ? 'Making the link…' : (link?.url ?? '')}
                onFocus={(e) => e.currentTarget.select()}
                placeholder={failed || (link && !link.url) ? '—' : ''}
                className="h-8 w-full truncate rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-sunken)] px-2 text-2xs text-[var(--ink-secondary)] outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={copy}
                loading={building}
                disabled={!link?.url}
              >
                {copied ? 'Copied' : building ? 'Preparing…' : 'Copy link'}
              </Button>
              {link?.url && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(link.url!, '_blank', 'noopener')}
                  title={`Open the ${ROLE_COPY[role].label.toLowerCase()} link in a new tab`}
                >
                  Preview
                </Button>
              )}
              {link?.url && (
                <span className="ml-auto text-2xs tabular-nums text-[var(--ink-faint)]">
                  {formatBytes(link.bytes)}
                </span>
              )}
            </div>

            {/* Everything that could go wrong, said plainly and only when true. */}
            {failed && (
              <p className="mt-3 text-2xs leading-[1.5] text-[var(--ink-secondary)]">
                The link could not be written. Publishing it as a file works whatever the board
                weighs.
              </p>
            )}

            {link && !link.url && !failed && (
              <p className="mt-3 text-2xs leading-[1.5] text-[var(--ink-secondary)]">
                This board is {formatBytes(link.bytes)} once packed — too much for an address bar.
                Publish it as a file instead; that one has no size limit and works everywhere.
              </p>
            )}

            {link && link.assetsFailed > 0 && (
              <p className="mt-2 text-2xs leading-[1.5] text-[var(--ink-faint)]">
                {link.assetsFailed} image{link.assetsFailed === 1 ? '' : 's'} could not be packed
                into the link and will be missing for whoever opens it.
              </p>
            )}

            <p className="mt-3 border-t border-[var(--rule-hairline)] pt-3 text-2xs leading-[1.5] text-[var(--ink-faint)]">
              {role === 'editor'
                ? 'The whole board rides inside the address — nothing is uploaded. An editor link hands over a copy: their changes stay theirs, and yours stay yours, until one of you sends a new link.'
                : 'The whole talk rides inside the address — nothing is uploaded, and it opens with no account. A viewer link opens the talk rather than the tools, which decides what somebody is handed; the board still travels inside the address, so it is not a way to keep a board from anyone.'}
            </p>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPublishing(true);
              }}
              className="mt-3 text-2xs text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
            >
              Publish as a file instead…
            </button>
          </div>
        </>
      )}

      {publishing && <PublishSheet onClose={() => setPublishing(false)} />}
    </div>
  );
}

/* ---- glyphs: drawn, not imported ---------------------------------------- */

function LinkGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.8 8.2a2.4 2.4 0 0 0 3.4 0l1.9-1.9a2.4 2.4 0 0 0-3.4-3.4l-.8.8M8.2 5.8a2.4 2.4 0 0 0-3.4 0L2.9 7.7a2.4 2.4 0 0 0 3.4 3.4l.8-.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="5" r="2.1" stroke="var(--ink-tertiary)" strokeWidth="1.2" />
      <path
        d="M2.8 11.4c0-2 1.9-3.3 4.2-3.3s4.2 1.3 4.2 3.3"
        stroke="var(--ink-tertiary)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

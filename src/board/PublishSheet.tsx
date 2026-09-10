import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { formatBytes, slugify } from '@/core/format';
import { downloadPublished, publish, type Published } from './publish';

/**
 * "Finish it, and give me the link."
 *
 * There are three honest answers to that and this sheet gives all three, in
 * the order of how well they travel: a file that is the whole talk and works
 * anywhere; a link that carries the talk inside itself for a board light
 * enough to fit in one; and a way to open it right now to check it.
 *
 * What it will not do is imply we are hosting anything. Nobody's talk should
 * quietly depend on a service they never signed up for.
 */

export function PublishSheet({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project);
  const showToast = useApp((s) => s.showToast);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; value: number } | null>(null);
  const [result, setResult] = useState<Published | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!project) return null;
  const board = project.board;

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const published = await publish(project, {
        includeNotes,
        autoplay,
        onProgress: (stage, value) => setProgress({ stage, value }),
      });
      setResult(published);
    } catch (err) {
      setError((err as Error).message || 'The page could not be written.');
    } finally {
      setRunning(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what} copied`);
    } catch {
      showToast('This browser would not let us reach the clipboard');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: 'var(--surface-scrim)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Publish this talk"
        className="w-full max-w-[40rem] rounded-[var(--radius-lg)] border border-[var(--rule-hairline)] bg-[var(--surface-page)] p-6 sm:p-8"
        style={{ boxShadow: 'var(--shadow-lift)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display-sm text-[var(--ink-primary)]">Finish it</h2>
            <p className="mt-2 max-w-[46ch] text-xs leading-[1.6] text-[var(--ink-secondary)]">
              {board.stops.length || 0} slide{board.stops.length === 1 ? '' : 's'} ·{' '}
              {board.cards.length} card{board.cards.length === 1 ? '' : 's'} · a{' '}
              {board.surface === 'black' ? 'black' : 'white'} board. It all becomes one file that
              opens in any browser — no server, no account.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          <Toggle checked={includeNotes} onChange={setIncludeNotes} label="Include speaker notes">
            Anyone with the link can read them. Leave this off for an audience.
          </Toggle>
          <Toggle checked={autoplay} onChange={setAutoplay} label="Loop back to the start">
            For a talk left running on a screen at a poster session.
          </Toggle>
        </div>

        {board.stops.length === 0 && (
          <p className="mt-5 rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-3 text-2xs leading-[1.55] text-[var(--ink-secondary)]">
            This board has no slides, so the page will open on the whole board at once. Draw a few
            slides with <b>F</b> first if you want it to walk through them.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" onClick={run} loading={running} disabled={running}>
            {running ? 'Building…' : result ? 'Build it again' : 'Build the page'}
          </Button>
          {progress && running && (
            <span className="text-2xs text-[var(--ink-tertiary)]">{progress.stage}…</span>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-[var(--radius-md)] border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-3 text-xs text-[var(--ink-primary)]">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-7 space-y-3">
            <Row
              title="Open it now"
              detail="Opens in a new tab, to check it. The address only works while this tab is open."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => window.open(result.objectUrl, '_blank', 'noopener')}
                >
                  Open
                </Button>
              }
            />
            <Row
              title="The finished file"
              detail={`${formatBytes(result.bytes)}, images included · works offline, on a USB stick, or on any web host.`}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => downloadPublished(result, slugify(project.title))}
                >
                  Download
                </Button>
              }
            />
            <Row
              title="A link you can paste"
              detail={
                result.hashUrl
                  ? `${formatBytes(result.hashBytes)}. The whole talk travels inside the link — nothing is uploaded.`
                  : `Too big for a link${
                      result.assetsInlined ? ' — the figures make it heavy' : ''
                    }. Download the file above and put it anywhere instead.`
              }
              action={
                result.hashUrl ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copy(result.hashUrl!, 'Link')}
                  >
                    Copy link
                  </Button>
                ) : null
              }
            />

            {result.assetsFailed > 0 && (
              <p className="text-2xs leading-[1.5] text-[var(--ink-tertiary)]">
                {result.assetsFailed} image
                {result.assetsFailed === 1 ? ' could not be' : 's could not be'} packed into the
                file and will be missing.
              </p>
            )}

            <p className="pt-1 text-2xs leading-[1.6] text-[var(--ink-faint)]">
              In the published page: → to go on, ← to go back, <b>O</b> for the whole board,{' '}
              <b>L</b> for a pointer, <b>B</b> to black the screen, <b>F</b> for full screen.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--ink-primary)]">{title}</p>
        <p className="mt-0.5 text-2xs leading-[1.5] text-[var(--ink-tertiary)]">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
      />
      <span>
        <span className="block text-xs text-[var(--ink-primary)]">{label}</span>
        <span className="block text-2xs leading-[1.5] text-[var(--ink-faint)]">{children}</span>
      </span>
    </label>
  );
}

import { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
  compact?: boolean;
}

type Reject = { title: string; detail: string } | null;

export function Dropzone({ onFile, onSample, compact }: Props) {
  const [over, setOver] = useState(false);
  const [reject, setReject] = useState<Reject>(null);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const isPdf =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        const ext = file.name.split('.').pop()?.toUpperCase() ?? 'that file';
        setReject({
          title: `That's a ${ext} file`,
          detail: 'Paper Animator reads PDFs. Export it as a PDF and drop it here.',
        });
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        setReject({
          title: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB`,
          detail: 'We read papers up to 100 MB. Large scans are usually the cause.',
        });
        return;
      }
      setReject(null);
      onFile(file);
    },
    [onFile],
  );

  return (
    <div className={clsx('w-full', compact ? '' : 'max-w-[38rem]')}>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          depth.current--;
          if (depth.current <= 0) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          accept(e.dataTransfer.files[0]);
        }}
        className={clsx(
          'group relative overflow-hidden rounded-[var(--radius-lg)] border transition-all duration-[240ms]',
          '[transition-timing-function:var(--ease-out)]',
          over
            ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
            : 'border-dashed border-[var(--rule-strong)] bg-[var(--surface-raised)] hover:border-[var(--ink-faint)]',
        )}
        style={{
          boxShadow: over ? 'var(--shadow-float)' : 'var(--shadow-raised)',
          transform: over ? 'translateY(-2px)' : 'none',
        }}
      >
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = '';
          }}
          id="paper-upload"
        />

        <div className={clsx('flex flex-col items-start gap-4', compact ? 'p-5' : 'p-6 sm:p-8')}>
          <div className="flex items-center gap-3">
            <PageIcon over={over} />
            <div>
              <label
                htmlFor="paper-upload"
                className="block cursor-pointer font-display text-xl leading-tight tracking-[-0.015em] text-[var(--ink-primary)]"
              >
                {over ? 'Drop it' : 'Drop a paper here'}
              </label>
              <p className="mt-0.5 text-xs text-[var(--ink-tertiary)]">
                or{' '}
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="text-[var(--accent)] underline decoration-[var(--accent)]/35 underline-offset-[3px] transition-colors hover:decoration-[var(--accent)]"
                >
                  choose a file
                </button>
              </p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-[var(--ink-faint)]">
            <span>PDF · up to 100 MB · 400 pages</span>
            <span className="h-3 w-px bg-[var(--rule-hairline)]" aria-hidden="true" />
            <span className="inline-flex items-center gap-1.5">
              <LockIcon />
              Read in your browser. Nothing is uploaded.
            </span>
          </div>
        </div>

        {reject && (
          <div
            role="alert"
            className="border-t border-[var(--rule-hairline)] bg-[var(--danger-bg)] px-6 py-3.5 sm:px-8"
          >
            <p className="text-xs font-medium text-[var(--ink-primary)]">
              {reject.title}
            </p>
            <p className="mt-0.5 text-xs text-[var(--ink-secondary)]">
              {reject.detail}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-[var(--ink-faint)]">No paper to hand?</span>
        <button
          type="button"
          onClick={onSample}
          className="font-medium text-[var(--ink-secondary)] underline decoration-[var(--rule-strong)] underline-offset-[3px] transition-colors hover:text-[var(--ink-primary)] hover:decoration-[var(--ink-faint)]"
        >
          Try a sample paper
        </button>
      </div>
    </div>
  );
}

function PageIcon({ over }: { over: boolean }) {
  return (
    <svg
      width="34"
      height="42"
      viewBox="0 0 34 42"
      fill="none"
      aria-hidden="true"
      className="shrink-0 transition-transform duration-[240ms] [transition-timing-function:var(--ease-out)]"
      style={{ transform: over ? 'translateY(-2px) rotate(-2deg)' : 'none' }}
    >
      <path
        d="M4 3.5h16L30 13v25.5a1.5 1.5 0 0 1-1.5 1.5h-24A1.5 1.5 0 0 1 3 38.5V5a1.5 1.5 0 0 1 1-1.5Z"
        fill="var(--surface-raised)"
        stroke="var(--ink-faint)"
        strokeWidth="1.25"
      />
      <path d="M20 3.5V13h10" stroke="var(--ink-faint)" strokeWidth="1.25" />
      <g stroke={over ? 'var(--accent)' : 'var(--ink-faint)'} strokeWidth="1.25" strokeLinecap="round">
        <path d="M8.5 20h17" opacity="0.75" />
        <path d="M8.5 25h17" opacity="0.55" />
        <path d="M8.5 30h11" opacity="0.4" />
      </g>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <rect x="0.6" y="4.6" width="8.8" height="6.8" rx="1.4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.8 4.6V3.2a2.2 2.2 0 0 1 4.4 0v1.4" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

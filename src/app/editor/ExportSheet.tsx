import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { formatBytes, formatDuration } from '@/core/format';
import { projectDuration } from '@/render/resolveFrame';
import {
  download,
  exportDeck,
  exportPdf,
  exportProject,
  exportSlides,
  exportText,
  exportVideo,
  validateForExport,
  videoSupported,
  type ExportFormat,
  type ExportResult,
} from '@/export/exporters';

/**
 * Export. Every option here produces a file that opens in real software — there
 * are no formats listed that we cannot actually write.
 */

interface Preset {
  id: string;
  name: string;
  detail: string;
  formats: ExportFormat[];
}

const PRESETS: Preset[] = [
  { id: 'talk', name: 'Talk', detail: 'Video, captions and a transcript', formats: ['mp4', 'srt', 'transcript'] },
  { id: 'slides', name: 'Slides', detail: 'An editable deck and a PDF', formats: ['pptx', 'pdf'] },
  { id: 'stills', name: 'Stills', detail: 'One PNG per scene', formats: ['png'] },
  { id: 'archive', name: 'Archive', detail: 'Everything, plus the project file', formats: ['mp4', 'pptx', 'pdf', 'png', 'srt', 'vtt', 'transcript', 'project'] },
];

const FORMAT_LABEL: Record<ExportFormat, string> = {
  mp4: 'MP4 video',
  webm: 'WebM video',
  png: 'PNG slides',
  pptx: 'PowerPoint deck',
  pdf: 'PDF',
  srt: 'SRT captions',
  vtt: 'WebVTT captions',
  transcript: 'Transcript',
  project: 'Project file',
};

export function ExportSheet() {
  const project = useApp((s) => s.project);
  const setView = useApp((s) => s.setEditorView);
  const [preset, setPreset] = useState('talk');
  const [custom, setCustom] = useState<Set<ExportFormat>>(new Set());
  const [scale, setScale] = useState(1);
  const [burnCaptions, setBurnCaptions] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number; detail?: string } | null>(null);
  const [results, setResults] = useState<ExportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const issues = useMemo(() => (project ? validateForExport(project) : []), [project]);
  const blocking = issues.filter((i) => i.severity === 'blocking');

  if (!project) return null;

  const selected: ExportFormat[] =
    custom.size > 0 ? [...custom] : (PRESETS.find((p) => p.id === preset)?.formats ?? []);

  const run = async () => {
    setRunning(true);
    setResults([]);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;

    const out: ExportResult[] = [];
    try {
      for (const [i, format] of selected.entries()) {
        const base = i / selected.length;
        const span = 1 / selected.length;
        const options = {
          scale,
          fps: project.settings.fps,
          burnCaptions,
          signal: controller.signal,
          onProgress: (p: { stage: string; progress: number; detail?: string }) =>
            setProgress({
              stage: p.stage,
              progress: base + p.progress * span,
              detail: p.detail,
            }),
        };

        setProgress({ stage: `Preparing ${FORMAT_LABEL[format]}`, progress: base });

        let result: ExportResult;
        switch (format) {
          case 'mp4':
            result = await exportVideo(project, options, 'mp4');
            break;
          case 'webm':
            result = await exportVideo(project, options, 'webm');
            break;
          case 'png':
            result = await exportSlides(project, options);
            break;
          case 'pptx':
            result = await exportDeck(project, options);
            break;
          case 'pdf':
            result = await exportPdf(project, options);
            break;
          case 'project':
            result = await exportProject(project, options);
            break;
          default:
            result = exportText(project, format);
        }
        out.push(result);
        setResults([...out]);
      }
      setProgress({ stage: 'Done', progress: 1 });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Something went wrong while exporting.');
      }
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const total = projectDuration(project);

  return (
    <div className="absolute inset-0 top-14 z-20 overflow-y-auto bg-[var(--surface-page)]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--rule-hairline)] bg-[var(--surface-page)] px-[max(1rem,3vw)] py-2.5">
        <span className="label">Export</span>
        <Button size="sm" variant="secondary" onClick={() => setView('compose')}>
          Back to the editor
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[58rem] px-[max(1rem,3vw)] py-7">
        <h1 className="display-md text-[var(--ink-primary)]">Export</h1>
        <p className="mt-3 max-w-[52ch] text-base leading-[1.6] text-[var(--ink-secondary)]">
          {project.scenes.filter((s) => !s.hidden).length} scenes ·{' '}
          <span className="numeral">{formatDuration(total)}</span> · rendered in this browser from
          the same frame function that draws the preview.
        </p>

        {/* validation */}
        {issues.length > 0 && (
          <div className="mt-7 space-y-2">
            {issues.map((issue, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-md)] border p-3.5"
                style={{
                  borderColor:
                    issue.severity === 'blocking'
                      ? 'color-mix(in oklch, var(--ev-unsupported) 50%, transparent)'
                      : 'var(--rule-hairline)',
                  background:
                    issue.severity === 'blocking'
                      ? 'var(--ev-unsupported-bg)'
                      : 'var(--surface-raised)',
                }}
              >
                <p className="text-xs font-medium text-[var(--ink-primary)]">
                  {issue.message}
                </p>
                <p className="mt-0.5 text-xs leading-[1.5] text-[var(--ink-secondary)]">
                  {issue.detail}
                </p>
                {issue.severity === 'blocking' && (
                  <button
                    type="button"
                    onClick={() => setView('integrity')}
                    className="mt-2 text-2xs font-medium text-[var(--accent)]"
                  >
                    Review them →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* presets */}
        <div className="mt-8">
          <p className="label mb-3">What do you need?</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPreset(p.id);
                  setCustom(new Set());
                }}
                aria-pressed={custom.size === 0 && preset === p.id}
                className="rounded-[var(--radius-md)] border p-3.5 text-left transition-colors"
                style={{
                  borderColor:
                    custom.size === 0 && preset === p.id ? 'var(--accent)' : 'var(--rule-hairline)',
                  background:
                    custom.size === 0 && preset === p.id
                      ? 'var(--accent-subtle)'
                      : 'var(--surface-raised)',
                }}
              >
                <p className="text-base font-medium text-[var(--ink-primary)]">{p.name}</p>
                <p className="mt-0.5 text-2xs leading-[1.45] text-[var(--ink-tertiary)]">
                  {p.detail}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* individual formats */}
        <details className="mt-5 rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)]">
          <summary className="cursor-pointer px-4 py-3 text-xs text-[var(--ink-secondary)]">
            Pick formats individually
          </summary>
          <div className="flex flex-wrap gap-2 border-t border-[var(--rule-hairline)] p-4">
            {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => {
              const disabled = (f === 'mp4' || f === 'webm') && !videoSupported();
              const on = custom.has(f);
              return (
                <button
                  key={f}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setCustom((prev) => {
                      const next = new Set(prev);
                      if (next.has(f)) next.delete(f);
                      else next.add(f);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  title={disabled ? 'This browser cannot record video' : undefined}
                  className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-2xs transition-colors disabled:opacity-40"
                  style={{
                    borderColor: on ? 'var(--accent)' : 'var(--rule-hairline)',
                    background: on ? 'var(--accent-subtle)' : 'transparent',
                    color: on ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                  }}
                >
                  {FORMAT_LABEL[f]}
                </button>
              );
            })}
          </div>
        </details>

        {/* options */}
        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <p className="label mb-2">Resolution</p>
            <div className="flex gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--rule-hairline)]">
              {[
                { v: 0.5, l: '960p' },
                { v: 1, l: '1080p' },
                { v: 1.5, l: '1620p' },
              ].map((r) => (
                <button
                  key={r.v}
                  type="button"
                  onClick={() => setScale(r.v)}
                  aria-pressed={scale === r.v}
                  className="px-3 py-1.5 text-2xs"
                  style={{
                    background: scale === r.v ? 'var(--surface-inverse)' : 'var(--surface-raised)',
                    color: scale === r.v ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
                  }}
                >
                  {r.l}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 pt-5">
            <input
              type="checkbox"
              checked={burnCaptions}
              onChange={(e) => setBurnCaptions(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--ink-primary)]">
              Burn captions into the video
            </span>
          </label>
        </div>

        {/* run */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={run}
            disabled={running || selected.length === 0 || blocking.length > 0}
            loading={running}
          >
            {running ? 'Exporting…' : `Export ${selected.length} file${selected.length === 1 ? '' : 's'}`}
          </Button>
          {running && (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
          {blocking.length > 0 && (
            <p className="text-xs text-[var(--ink-tertiary)]">
              Resolve the blocking items above first.
            </p>
          )}
        </div>

        {/* progress */}
        {progress && running && (
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs text-[var(--ink-primary)]">{progress.stage}</span>
              {progress.detail && (
                <span className="numeral text-2xs text-[var(--ink-faint)]">
                  {progress.detail}
                </span>
              )}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${Math.round(progress.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-4">
            <p className="text-xs text-[var(--ink-primary)]">{error}</p>
          </div>
        )}

        {/* results */}
        {results.length > 0 && (
          <div className="mt-8">
            <p className="label mb-3">Ready</p>
            <ul className="space-y-2">
              {results.map((r) => (
                <li
                  key={r.name}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-3.5 motion-safe:animate-[file-in_300ms_var(--ease-out)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[var(--ink-primary)]">
                      {r.name}
                    </p>
                    <p className="text-2xs text-[var(--ink-tertiary)]">
                      {r.detail} · <span className="numeral">{formatBytes(r.bytes)}</span>
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => download(r)}>
                    Download
                  </Button>
                </li>
              ))}
            </ul>
            <style>{`@keyframes file-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
          </div>
        )}

        <p className="mt-10 max-w-[60ch] text-2xs leading-[1.55] text-[var(--ink-faint)]">
          Narration is read by your browser's own speech engine, which cannot be captured into a
          video file. Video exports are silent and carry captions; the SRT, WebVTT and transcript
          exports contain every spoken line with the page it came from.
        </p>
      </div>
    </div>
  );
}

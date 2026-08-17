import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import { sceneWindows, projectDuration } from '@/render/resolveFrame';
import { formatTimecode } from '@/core/format';

/**
 * The timeline. Scene blocks can be reordered by dragging and retimed by
 * dragging their trailing edge, with magnetic snapping to scene boundaries and
 * to the playhead — with a dead zone so precision is still possible.
 */

const SNAP_PX = 8;
const DEAD_ZONE_PX = 3;

export function Timeline() {
  const project = useApp((s) => s.project);
  const timeMs = useApp((s) => s.timeMs);
  const seek = useApp((s) => s.seek);
  const mutate = useApp((s) => s.mutate);
  const selectedSceneId = useApp((s) => s.selectedSceneId);
  const seekScene = useApp((s) => s.seekScene);

  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ sceneId: string; startX: number; startMs: number } | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const total = project ? projectDuration(project) : 0;
  const windows = useMemo(() => (project ? sceneWindows(project) : []), [project]);
  const pxPerMs = total > 0 ? ((width - 8) * zoom) / total : 0;

  const msToPx = useCallback((ms: number) => ms * pxPerMs, [pxPerMs]);
  const pxToMs = useCallback((px: number) => (pxPerMs > 0 ? px / pxPerMs : 0), [pxPerMs]);

  const snapTargets = useMemo(() => {
    const t = [0, timeMs];
    for (const w of windows) t.push(w.startMs, w.endMs);
    return t;
  }, [windows, timeMs]);

  const snap = useCallback(
    (ms: number, movedPx: number) => {
      if (Math.abs(movedPx) < DEAD_ZONE_PX) return ms;
      let best = ms;
      let bestD = Infinity;
      for (const target of snapTargets) {
        const d = Math.abs(msToPx(target - ms));
        if (d < SNAP_PX && d < bestD) {
          bestD = d;
          best = target;
        }
      }
      return best;
    },
    [snapTargets, msToPx],
  );

  const onScrub = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(pxToMs(e.clientX - rect.left));
  };

  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-sunken)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--rule-hairline)] px-3 py-1.5">
        <span className="label">Timeline</span>
        <span className="numeral text-2xs text-[var(--ink-faint)]">
          {formatTimecode(timeMs)} / {formatTimecode(total)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
            className="flex h-6 w-6 items-center justify-center rounded-[2px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--ink-primary)]"
          >
            −
          </button>
          <span className="numeral w-8 text-center text-2xs text-[var(--ink-faint)]">
            {zoom.toFixed(1)}×
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(12, z * 1.5))}
            className="flex h-6 w-6 items-center justify-center rounded-[2px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--ink-primary)]"
          >
            +
          </button>
        </div>
      </div>

      <div ref={host} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative h-full" style={{ width: Math.max(width, width * zoom) }}>
          {/* ruler */}
          <div
            className="relative h-5 cursor-ew-resize border-b border-[var(--rule-hairline)]"
            onPointerDown={onScrub}
            onPointerMove={(e) => e.buttons === 1 && onScrub(e)}
            role="slider"
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={timeMs}
            tabIndex={0}
          >
            {ticks(total, zoom).map((ms) => (
              <span
                key={ms}
                className="absolute top-0 h-full border-l border-[var(--rule-hairline)] pl-1 text-[0.55rem] leading-5 text-[var(--ink-faint)]"
                style={{ left: msToPx(ms) }}
              >
                {formatTimecode(ms).slice(0, 5)}
              </span>
            ))}
          </div>

          {/* tracks */}
          <div className="space-y-1 p-1">
            <Track label="Scenes">
              {windows.map((w) => {
                const selected = w.scene.id === selectedSceneId;
                return (
                  <div
                    key={w.scene.id}
                    className="absolute top-0 h-full"
                    style={{ left: msToPx(w.startMs), width: Math.max(6, msToPx(w.scene.durationMs) - 2) }}
                  >
                    <button
                      type="button"
                      onClick={() => seekScene(w.scene.id)}
                      className="h-full w-full overflow-hidden rounded-[2px] border px-1.5 text-left transition-colors"
                      style={{
                        borderColor: selected ? 'var(--accent)' : 'var(--rule-strong)',
                        background: selected ? 'var(--accent-subtle)' : 'var(--surface-raised)',
                      }}
                    >
                      <span className="block truncate text-[0.6rem] leading-[1.6] text-[var(--ink-secondary)]">
                        {w.index + 1}. {w.scene.title}
                      </span>
                    </button>
                    {/* trailing edge: retime */}
                    <div
                      role="separator"
                      aria-label={`Trim ${w.scene.title}`}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-[2px] hover:bg-[var(--accent)]"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        setDrag({ sceneId: w.scene.id, startX: e.clientX, startMs: w.scene.durationMs });
                      }}
                      onPointerMove={(e) => {
                        if (!drag || drag.sceneId !== w.scene.id) return;
                        const dx = e.clientX - drag.startX;
                        const raw = drag.startMs + pxToMs(dx);
                        const next = Math.max(600, snap(w.startMs + raw, dx) - w.startMs);
                        mutate(
                          'Retime scene',
                          (d) => {
                            const s = d.scenes.find((x) => x.id === w.scene.id);
                            if (s) {
                              s.durationMs = Math.round(next);
                              s.durationPinned = true;
                            }
                          },
                          `retime:${w.scene.id}`,
                        );
                      }}
                      onPointerUp={() => setDrag(null)}
                    />
                  </div>
                );
              })}
            </Track>

            <Track label="Narration">
              {windows.flatMap((w) =>
                w.scene.narration.map((cue) => (
                  <div
                    key={cue.id}
                    className="absolute top-0 h-full overflow-hidden rounded-[2px] px-1"
                    style={{
                      left: msToPx(w.startMs + cue.startMs),
                      width: Math.max(4, msToPx(cue.durationMs) - 2),
                      background: 'color-mix(in oklch, var(--ev-extracted) 22%, var(--surface-raised))',
                      border: '1px solid color-mix(in oklch, var(--ev-extracted) 45%, transparent)',
                    }}
                    title={cue.text}
                  >
                    <span className="block truncate text-[0.55rem] leading-[1.7] text-[var(--ink-secondary)]">
                      {cue.text}
                    </span>
                  </div>
                )),
              )}
            </Track>

            <Track label="Captions">
              {windows.flatMap((w) =>
                w.scene.narration.map((cue) =>
                  cue.words.slice(0, 40).map((word, i) => (
                    <div
                      key={`${cue.id}-${i}`}
                      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                      style={{
                        left: msToPx(w.startMs + cue.startMs + word.startMs),
                        width: Math.max(1.5, msToPx(word.endMs - word.startMs) - 1),
                        background: 'var(--ink-faint)',
                        opacity: 0.45,
                      }}
                    />
                  )),
                ),
              )}
            </Track>
          </div>

          {/* playhead */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px"
            style={{ left: msToPx(timeMs), background: 'var(--accent)' }}
          >
            <div
              className="absolute -left-[3px] top-0 h-2 w-[7px] rounded-b-[2px]"
              style={{ background: 'var(--accent)' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Track({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-2">
      <span className="label w-16 shrink-0 pt-1.5" style={{ fontSize: '0.55rem' }}>
        {label}
      </span>
      <div className="relative h-6 flex-1 rounded-[2px] bg-[var(--surface-inset)]">{children}</div>
    </div>
  );
}

function ticks(total: number, zoom: number): number[] {
  const targetCount = Math.max(4, Math.round(6 * zoom));
  const step = niceStep(total / targetCount);
  const out: number[] = [];
  for (let t = 0; t < total; t += step) out.push(t);
  return out;
}

function niceStep(raw: number): number {
  const candidates = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  for (const c of candidates) if (raw <= c) return c;
  return 600000;
}

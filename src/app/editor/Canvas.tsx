import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import { ASPECT_DIMS, layerRef, type WordTiming } from '@/core/types';
import { resolveFrame, projectDuration, type FrameState } from '@/render/resolveFrame';
import { SceneSurface } from '@/render/SceneSurface';
import { Narrator } from '@/narrate/speech';
import { formatTimecode } from '@/core/format';
import { isDarkStyle } from '@/render/styles';

/**
 * The live canvas. The playhead is a wall clock; every pixel comes from
 * resolveFrame. Narration is spoken alongside, and the word timings the engine
 * reports are written back into the project so the marker self-corrects.
 */

export function Canvas() {
  const project = useApp((s) => s.project);
  const playing = useApp((s) => s.playing);
  const timeMs = useApp((s) => s.timeMs);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const selectedLayerIds = useApp((s) => s.selectedLayerIds);
  const selectLayer = useApp((s) => s.selectLayer);
  const focusSource = useApp((s) => s.focusSource);
  const seek = useApp((s) => s.seek);
  const pause = useApp((s) => s.pause);
  const play = useApp((s) => s.play);
  const mutate = useApp((s) => s.mutate);
  const setSpeaking = useApp((s) => s.setSpeaking);

  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState<FrameState | null>(null);
  const rafRef = useRef(0);
  const lastTick = useRef(0);
  const narrator = useRef<Narrator | null>(null);

  const total = project ? projectDuration(project) : 0;
  const dims = project ? ASPECT_DIMS[project.settings.aspect] : ASPECT_DIMS['16:9'];

  /* ---- sizing ---------------------------------------------------------- */
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => {
      // The content box, not the border box: sizing the sheet to the padded box
      // makes it overflow its own column and paint over the inspector.
      const cs = getComputedStyle(el);
      const availW =
        el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      const availH =
        el.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0');
      const ratio = dims.w / dims.h;
      let w = Math.max(0, availW);
      let h = w / ratio;
      if (h > availH) {
        h = Math.max(0, availH);
        w = h * ratio;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [dims.w, dims.h]);

  /* ---- narration ------------------------------------------------------- */
  const applyTimings = useCallback(
    (cueId: string, words: WordTiming[]) => {
      mutate(
        'Capture narration timing',
        (draft) => {
          for (const scene of draft.scenes) {
            const cue = scene.narration.find((c) => c.id === cueId);
            if (!cue) continue;
            cue.words = words;
            const measured = words.at(-1)?.endMs ?? cue.durationMs;
            cue.durationMs = Math.max(600, measured);
            // Keep the scene long enough to contain what was actually said.
            if (!scene.durationPinned) {
              const end = cue.startMs + cue.durationMs;
              scene.durationMs = Math.max(scene.durationMs, end + 620);
            }
            break;
          }
        },
        `timing:${cueId}`,
      );
    },
    [mutate],
  );

  useEffect(() => {
    narrator.current = new Narrator({
      voiceURI: project?.settings.voiceURI ?? null,
      rate: project?.settings.speakingRate ?? 1,
      onTimings: applyTimings,
      onEnd: () => setSpeaking(false),
    });
    return () => {
      narrator.current?.stop();
      narrator.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    narrator.current?.update({
      voiceURI: project?.settings.voiceURI ?? null,
      rate: project?.settings.speakingRate ?? 1,
    });
  }, [project?.settings.voiceURI, project?.settings.speakingRate]);

  /* ---- the loop -------------------------------------------------------- */
  useEffect(() => {
    if (!project) return;

    const tick = (now: number) => {
      const dt = lastTick.current ? now - lastTick.current : 0;
      lastTick.current = now;

      const state = useApp.getState();
      if (state.playing) {
        const next = state.timeMs + dt;
        if (next >= total) {
          useApp.setState({ playing: false, timeMs: Math.max(0, total - 1) });
          narrator.current?.stop();
          setSpeaking(false);
        } else {
          useApp.setState({ timeMs: next });
        }
      }

      const t = useApp.getState().timeMs;
      const f = resolveFrame(project, t, { reducedMotion });
      setFrame(f);

      // Speak the cue that has just become active.
      if (useApp.getState().playing && f.activeCueId) {
        const scene = project.scenes.find((s) => s.id === f.sceneId);
        const cue = scene?.narration.find((c) => c.id === f.activeCueId);
        if (cue && f.sceneTMs - cue.startMs < 220) {
          narrator.current?.speak(cue);
          setSpeaking(true);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTick.current = 0;
    };
  }, [project, total, reducedMotion, setSpeaking]);

  /* Stop the voice the moment playback stops or the playhead jumps. */
  useEffect(() => {
    if (!playing) {
      narrator.current?.stop();
      setSpeaking(false);
    } else {
      narrator.current?.reset();
    }
  }, [playing, setSpeaking]);

  const captionText = useMemo(() => frame?.caption ?? null, [frame]);
  if (!project) return null;
  const dark = isDarkStyle(project.style);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* stage */}
      <div
        ref={host}
        data-coach="stage"
        className="relative flex min-h-0 flex-1 items-center justify-center p-[clamp(0.75rem,2vw,2rem)]"
        onPointerDown={() => selectLayer(null)}
      >
        <div
          className="relative"
          style={{
            width: box.w,
            height: box.h,
            boxShadow: 'var(--shadow-float)',
          }}
        >
          {frame && box.w > 0 && (
            <SceneSurface
              frame={frame}
              styleId={project.style}
              width={box.w}
              height={box.h}
              interactive
              selectedLayerIds={selectedLayerIds}
              onSelectLayer={(id, additive) => {
                selectLayer(id as never, additive);
                // Selecting a claim scrolls the paper to the sentence behind it,
                // so the thread always has both of its ends on screen.
                const scene = project.scenes.find((s) => s.id === frame?.sceneId);
                const layer = scene?.layers.find((l) => l.id === id);
                focusSource(layer ? layerRef(layer) : null, 'layer');
              }}
            />
          )}

          {/* Captions live above the surface, never inside it, so they can never
              reach the export by accident. Every value still comes from the
              resolved frame, so what moves is the reading position — nothing
              here transitions on its own. */}
          {project.settings.captionsEnabled && captionText && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-[6%] pb-[3.5%]"
              aria-live="off"
            >
              <p
                className="max-w-[84%] px-3.5 py-2 text-center"
                style={{
                  background: dark ? 'rgba(10,12,14,0.82)' : 'rgba(252,251,248,0.92)',
                  color: dark ? '#eef1f3' : '#16181b',
                  border: `1px solid ${dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'}`,
                  borderRadius: 4,
                  boxShadow: dark
                    ? '0 6px 22px rgba(0,0,0,0.35)'
                    : '0 6px 20px rgba(30,26,20,0.10)',
                  fontSize: Math.max(11, box.h * 0.033),
                  lineHeight: 1.5,
                  fontFamily: 'Inter Variable, Inter, sans-serif',
                  fontWeight: 440,
                  letterSpacing: '-0.004em',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {captionText.words.map((w, i) => (
                  <span
                    key={i}
                    style={{
                      // Read words stay lit, the word being said carries the
                      // marker, and what is still to come waits at low contrast.
                      opacity: w.spoken || w.active ? 1 : 0.4,
                      fontWeight: w.active ? 560 : 440,
                      backgroundImage: w.active
                        ? `linear-gradient(${caretColour(dark)}, ${caretColour(dark)})`
                        : undefined,
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '100% 2px',
                      backgroundPosition: '0 100%',
                      paddingBottom: 1,
                    }}
                  >
                    {w.text}{' '}
                  </span>
                ))}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* transport */}
      <Transport
        timeMs={timeMs}
        total={total}
        playing={playing}
        onPlay={play}
        onPause={pause}
        onSeek={seek}
        sceneIndex={frame?.sceneIndex ?? 0}
        sceneCount={project.scenes.filter((s) => !s.hidden).length}
      />
    </div>
  );
}

function Transport({
  timeMs,
  total,
  playing,
  onPlay,
  onPause,
  onSeek,
  sceneIndex,
  sceneCount,
}: {
  timeMs: number;
  total: number;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (ms: number) => void;
  sceneIndex: number;
  sceneCount: number;
}) {
  return (
    <div
      data-coach="transport"
      className="flex shrink-0 items-center gap-3 border-t border-[var(--rule-hairline)] px-4 py-2.5"
    >
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-inverse)] text-[var(--ink-inverse)] transition-transform duration-150 active:scale-95"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <rect x="2" y="1.5" width="3" height="9" rx="0.5" />
            <rect x="7" y="1.5" width="3" height="9" rx="0.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3 1.8v8.4a.5.5 0 0 0 .76.43l7-4.2a.5.5 0 0 0 0-.86l-7-4.2A.5.5 0 0 0 3 1.8Z" />
          </svg>
        )}
      </button>

      <span className="numeral shrink-0 text-2xs tabular-nums text-[var(--ink-secondary)]">
        {formatTimecode(timeMs)}
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(1, total)}
        value={Math.min(timeMs, total)}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--rule-hairline)] accent-[var(--accent)]"
        aria-label="Playhead"
        style={{
          background: `linear-gradient(to right, var(--accent) ${(timeMs / Math.max(1, total)) * 100}%, var(--rule-hairline) ${(timeMs / Math.max(1, total)) * 100}%)`,
        }}
      />

      <span className="numeral shrink-0 text-2xs tabular-nums text-[var(--ink-faint)]">
        {formatTimecode(total)}
      </span>

      <span className="label shrink-0 hidden sm:block">
        Scene {sceneIndex + 1} / {sceneCount}
      </span>
    </div>
  );
}

/** The reading marker under the word currently being spoken. */
function caretColour(dark: boolean): string {
  return dark ? 'rgba(120,190,255,0.85)' : 'rgba(27,75,143,0.55)';
}

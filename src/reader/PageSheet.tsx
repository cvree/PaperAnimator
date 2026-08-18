import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Page, Quad, SceneId } from '@/core/types';
import type { PaperSession } from '@/extract/pdf';
import { pageText } from './pageText';

/**
 * One page of the paper, with real text on top of it.
 *
 * The raster is the page as printed; over it sits a transparent text layer of
 * absolutely positioned runs, so the browser's own selection works — you drag
 * across the page and the words highlight, exactly as in a PDF reader. Each run
 * is scaled horizontally to sit on its printed counterpart, which is what makes
 * the highlight land on the ink rather than beside it.
 *
 * The scale factor is measured once and never again: font size is expressed in
 * container-query units, so both the run's natural width and its target width
 * scale with the page, and their ratio does not.
 */

export interface SceneMark {
  sceneId: SceneId;
  index: number;
  title: string;
  quads: Quad[];
}

interface Props {
  page: Page;
  session: PaperSession | null;
  marks: SceneMark[];
  lit: Quad[];
  flash: Quad[] | null;
  searchQuads: Quad[];
  /** The passage the pointer would act on, while a tool is being carried. */
  targetQuads: Quad[];
  onMarkClick: (sceneId: SceneId) => void;
  /** Fired when this page's text exists again, so a mark on it can be restored. */
  onTextReady: (pageNumber: number) => void;
  showGutter: boolean;
}

export const PageSheet = memo(function PageSheet({
  page,
  session,
  marks,
  lit,
  flash,
  searchQuads,
  targetQuads,
  onMarkClick,
  onTextReady,
  showGutter,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [src, setSrc] = useState<string | null>(page.raster);

  /* ---- only pages anywhere near the viewport exist in the DOM ---------- */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: '1400px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || src || !session) return;
    let alive = true;
    void session.raster(page.number).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [near, src, session, page.number]);

  const text = useMemo(() => (near ? pageText(page) : null), [near, page]);

  /* ---- one measure pass, batched read then batched write --------------- */
  const fitted = useRef(false);
  useLayoutEffect(() => {
    fitted.current = false;
    const el = layer.current;
    if (!el || !text) return;

    const measure = () => {
      if (fitted.current) return true;
      const box = el.getBoundingClientRect();
      if (box.width < 1) return false;
      const runs = (Array.from(el.children) as HTMLElement[]).filter((r) =>
        r.hasAttribute('data-run'),
      );
      // Every read happens before every write, so the browser lays out once.
      const natural = runs.map((run) => run.getBoundingClientRect().width);
      runs.forEach((run, i) => {
        const want = Number(run.dataset.w) * box.width;
        const have = natural[i];
        const k = have > 0.5 && want > 0.5 ? want / have : 1;
        run.style.transform = `scaleX(${k.toFixed(4)})`;
      });
      fitted.current = true;
      onTextReady(page.number);
      return true;
    };

    if (measure()) return;
    // Laid out at zero width — try again when the reader gives it one.
    const ro = new ResizeObserver(() => {
      if (measure()) ro.disconnect();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, onTextReady, page.number]);

  return (
    <div
      ref={host}
      className="pa-sheet relative mb-5"
      style={{ paddingLeft: showGutter ? '2.1rem' : 0 }}
    >
      {showGutter && (
        <div className="absolute left-0 top-0 flex w-[2.1rem] flex-col items-end gap-1 pr-1.5 pt-1">
          <span className="numeral select-none text-[10px] leading-none text-[var(--ink-faint)]">
            {page.number}
          </span>
        </div>
      )}

      <article
        data-page={page.number}
        className="pa-page relative overflow-hidden rounded-[var(--radius-sm)] bg-white"
        style={{
          aspectRatio: `${page.width} / ${page.height}`,
          containerType: 'size',
          boxShadow: 'var(--shadow-raised)',
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-[var(--surface-sunken)]" />
        )}

        {/* what scenes already use — under the text, like a printed highlight */}
        <div className="pointer-events-none absolute inset-0">
          {marks.flatMap((mark) =>
            mark.quads.map((q, j) => (
              <span
                key={`${mark.sceneId}-${j}`}
                className="absolute rounded-[1px]"
                style={{
                  left: pct(q.x),
                  top: pct(q.y),
                  width: pct(q.w),
                  height: pct(q.h),
                  background: 'color-mix(in oklch, var(--hl-mint) 30%, transparent)',
                  boxShadow: 'inset 0 -1.5px 0 0 color-mix(in oklch, var(--ev-extracted) 62%, transparent)',
                  mixBlendMode: 'multiply',
                }}
              />
            )),
          )}
          {lit.map((q, j) => (
            <span
              key={`lit-${j}`}
              className="absolute"
              style={{
                left: pct(q.x),
                top: pct(q.y),
                width: pct(q.w),
                height: pct(q.h),
                background: 'color-mix(in oklch, var(--accent) 30%, transparent)',
                outline: '1px solid var(--accent)',
                borderRadius: 1,
              }}
            />
          ))}
          {searchQuads.map((q, j) => (
            <span
              key={`s-${j}`}
              className="absolute"
              style={{
                left: pct(q.x),
                top: pct(q.y),
                width: pct(q.w),
                height: pct(q.h),
                background: 'color-mix(in oklch, var(--hl-sky) 70%, transparent)',
                mixBlendMode: 'multiply',
              }}
            />
          ))}
        </div>

        {/* the selectable text itself */}
        {text && (
          <div
            ref={layer}
            data-textlayer=""
            data-page={page.number}
            className="pa-textlayer absolute inset-0"
          >
            {text.runs.map((run, i) => (
              <Fragment key={i}>
                <span
                  data-run=""
                  data-w={run.quad.w}
                  data-quad={`${round(run.quad.x)},${round(run.quad.y)},${round(run.quad.w)},${round(run.quad.h)}`}
                  style={{
                    left: pct(run.quad.x),
                    top: pct(run.quad.y),
                    fontSize: `${(run.fontSize * 100).toFixed(3)}cqh`,
                    fontWeight: run.bold ? 600 : 400,
                    fontStyle: run.italic ? 'italic' : 'normal',
                  }}
                >
                  {run.text}
                </span>
                {run.after}
              </Fragment>
            ))}
          </div>
        )}

        {/* what a dropped tool would act on */}
        <div className="pointer-events-none absolute inset-0">
          {targetQuads.map((q, j) => (
            <span
              key={`t-${j}`}
              className="absolute transition-[opacity] duration-150"
              style={{
                left: pct(q.x - 0.004),
                top: pct(q.y - 0.004),
                width: pct(q.w + 0.008),
                height: pct(q.h + 0.008),
                background: 'color-mix(in oklch, var(--accent) 20%, transparent)',
                outline: '1.5px solid var(--accent)',
                borderRadius: 2,
              }}
            />
          ))}
          {flash?.map((q, j) => (
            <span
              key={`f-${j}`}
              className="absolute motion-safe:animate-[mark-in_760ms_var(--ease-out)]"
              style={{
                left: pct(q.x),
                top: pct(q.y),
                width: pct(q.w),
                height: pct(q.h),
                background: 'var(--hl-yellow)',
                mixBlendMode: 'multiply',
              }}
            />
          ))}
        </div>
      </article>

      {showGutter && marks.length > 0 && (
        <div className="absolute left-0 top-0 w-[2.1rem]">
          {dedupe(marks).map((mark) => (
            <button
              key={mark.sceneId}
              type="button"
              onClick={() => onMarkClick(mark.sceneId)}
              title={`Scene ${mark.index}: ${mark.title}`}
              className="absolute right-1.5 flex h-4 min-w-4 items-center justify-center rounded-[3px] px-1 text-[9px] font-semibold tabular-nums transition-transform hover:scale-110"
              style={{
                top: `calc(${pct(topOf(mark.quads))} + 0.9rem)`,
                background: 'var(--ev-extracted)',
                color: 'var(--accent-ink)',
              }}
            >
              {mark.index}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}

function round(v: number): string {
  return v.toFixed(4);
}

function topOf(quads: Quad[]): number {
  return Math.min(...quads.map((q) => q.y));
}

/** One chip per scene, at its first mark on the page. */
function dedupe(marks: SceneMark[]): SceneMark[] {
  const out = new Map<SceneId, SceneMark>();
  for (const mark of marks) {
    const existing = out.get(mark.sceneId);
    if (!existing || topOf(mark.quads) < topOf(existing.quads)) out.set(mark.sceneId, mark);
  }
  return [...out.values()];
}

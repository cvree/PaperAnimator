import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from '@/state/store';
import type { Quad, SceneId } from '@/core/types';
import { INSTRUMENT_BY_ID, instrumentByKey } from './instruments';
import { useApply } from './apply';
import { useReader, ZOOM_STEPS } from './readerStore';
import { PageSheet, type SceneMark } from './PageSheet';
import { MarkerBar } from './MarkerBar';
import { ToolDock } from './ToolDock';
import { targetQuadsFor } from './useDragEngine';
import {
  clearSelection,
  grow,
  hitPage,
  passageFromRegion,
  readSelection,
  selectQuads,
  shrink,
  stepSentence,
} from './selection';
import { union } from './pageText';

/**
 * The paper.
 *
 * This is the product's main surface: the real pages, rendered as printed, with
 * text you can drag across. Marking a passage and dropping a tool on it is the
 * whole of scene making — there is no separate composer, no form to fill in and
 * no step where a source has to be attached by hand.
 */

const EMPTY_QUADS: Quad[] = [];
const EMPTY_MARKS: SceneMark[] = [];

export function Reader({ compactDock = false }: { compactDock?: boolean }) {
  const project = useApp((s) => s.project);
  const session = useApp((s) => s.session);
  const seekScene = useApp((s) => s.seekScene);
  const sourceFocus = useApp((s) => s.sourceFocus);
  const hoveredRef = useApp((s) => s.hoveredSourceRef);
  const showToast = useApp((s) => s.showToast);

  const passage = useReader((s) => s.passage);
  const setPassage = useReader((s) => s.setPassage);
  const zoom = useReader((s) => s.zoom);
  const setZoom = useReader((s) => s.setZoom);
  const drag = useReader((s) => s.drag);
  const flash = useReader((s) => s.flash);
  const cropArmed = useReader((s) => s.cropArmed);
  const setCropArmed = useReader((s) => s.setCropArmed);
  const keep = useReader((s) => s.keep);

  const { ctx, apply } = useApply();

  const scroller = useRef<HTMLDivElement>(null);
  const marqueeEl = useRef<HTMLDivElement>(null);
  const pointerDown = useRef<{ x: number; y: number; page: number; px: number; py: number } | null>(
    null,
  );
  const marquee = useRef<{ page: number; box: DOMRect; x0: number; y0: number } | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const paper = project?.paper ?? null;

  /* ---- search ---------------------------------------------------------- */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 170);
    return () => clearTimeout(t);
  }, [query]);

  const searchByPage = useMemo(() => {
    const byPage = new Map<number, Quad[]>();
    if (!paper || debounced.length < 2) return byPage;
    for (const page of paper.pages) {
      const hits = page.items
        .filter((i) => i.text.toLowerCase().includes(debounced))
        .map((i) => i.quad);
      if (hits.length) byPage.set(page.number, hits);
    }
    return byPage;
  }, [paper, debounced]);

  const matchCount = useMemo(
    () => [...searchByPage.values()].reduce((n, list) => n + list.length, 0),
    [searchByPage],
  );

  /* ---- what scenes already use ---------------------------------------- */
  const marksByPage = useMemo(() => {
    const byPage = new Map<number, SceneMark[]>();
    if (!project) return byPage;
    project.scenes.forEach((scene, i) => {
      for (const ref of scene.sourceRefs) {
        if (!ref.quads.length) continue;
        const list = byPage.get(ref.page) ?? [];
        list.push({ sceneId: scene.id, index: i + 1, title: scene.title, quads: ref.quads });
        byPage.set(ref.page, list);
      }
    });
    return byPage;
  }, [project]);

  const litByPage = useMemo(() => {
    const byPage = new Map<number, Quad[]>();
    const add = (ref: { page: number; quads: Quad[] } | null | undefined) => {
      if (!ref?.quads.length) return;
      byPage.set(ref.page, [...(byPage.get(ref.page) ?? []), ...ref.quads]);
    };
    add(hoveredRef);
    add(sourceFocus?.ref);
    return byPage;
  }, [hoveredRef, sourceFocus]);

  /* ---- follow whatever the rest of the editor points at ---------------- */
  useEffect(() => {
    if (!sourceFocus) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${sourceFocus.ref.page}"]`);
    if (!el) return;
    const quad = sourceFocus.ref.quads.length ? union(sourceFocus.ref.quads) : null;
    const box = el.getBoundingClientRect();
    const host = scroller.current!;
    const hostBox = host.getBoundingClientRect();
    const offset = quad ? quad.y * box.height : 0;
    host.scrollTo({
      top: host.scrollTop + (box.top - hostBox.top) + offset - hostBox.height * 0.32,
      behavior: 'smooth',
    });
  }, [sourceFocus]);

  /* ---- committing a mark ---------------------------------------------- */
  const commit = useCallback(() => {
    if (!paper) return;
    const found = readSelection(scroller.current, paper);
    setPassage(found);
  }, [paper, setPassage]);

  /**
   * Put the mark on these quads and bring them into view.
   *
   * Scrolling comes first, because a page far from the viewport has no text in
   * the DOM to select yet — the mark is retried for a few frames while that
   * page arrives, which is what lets ⌥→ walk off the end of one page and onto
   * the next.
   */
  const markQuads = useCallback(
    (page: number, quads: Quad[]) => {
      const host = scroller.current;
      const pageEl = host?.querySelector<HTMLElement>(`[data-page="${page}"]`);
      if (host && pageEl && quads.length) {
        const box = pageEl.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        const top = box.top - hostBox.top + union(quads).y * box.height;
        if (top < hostBox.height * 0.12 || top > hostBox.height * 0.78) {
          host.scrollTo({ top: host.scrollTop + top - hostBox.height * 0.35, behavior: 'smooth' });
        }
      }

      const attempt = (tries: number) => {
        if (selectQuads(scroller.current, page, quads)) {
          commit();
          return;
        }
        if (tries > 0) window.setTimeout(() => attempt(tries - 1), 140);
      };
      attempt(5);
    },
    [commit],
  );

  const selectSentenceAt = useCallback(
    (page: number, x: number, y: number) => {
      if (!paper) return false;
      const hit = hitPage(paper, page, x, y);
      const quads = hit.sentence && hit.sentenceQuads.length
        ? hit.sentenceQuads
        : hit.line
          ? [hit.line.quad]
          : null;
      if (!quads) return false;
      if (!selectQuads(scroller.current, page, quads)) return false;
      commit();
      return true;
    },
    [paper, commit],
  );

  /* ---- marquee: drag a box around a figure ----------------------------- */
  const paintMarquee = useCallback((rect: DOMRect | null) => {
    const el = marqueeEl.current;
    if (!el) return;
    if (!rect) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !paper) return;
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (!pageEl) return;
      const page = Number(pageEl.dataset.page);
      const box = pageEl.getBoundingClientRect();
      pointerDown.current = {
        x: e.clientX,
        y: e.clientY,
        page,
        px: (e.clientX - box.left) / box.width,
        py: (e.clientY - box.top) / box.height,
      };

      if (cropArmed || e.altKey) {
        e.preventDefault();
        clearSelection();
        marquee.current = { page, box, x0: e.clientX, y0: e.clientY };
        paintMarquee(new DOMRect(e.clientX, e.clientY, 0, 0));
      }
    },
    [paper, cropArmed, paintMarquee],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const m = marquee.current;
      if (!m) return;
      const x = Math.min(m.x0, e.clientX);
      const y = Math.min(m.y0, e.clientY);
      paintMarquee(new DOMRect(x, y, Math.abs(e.clientX - m.x0), Math.abs(e.clientY - m.y0)));
    },
    [paintMarquee],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const m = marquee.current;
      const down = pointerDown.current;
      marquee.current = null;
      pointerDown.current = null;

      if (m && paper) {
        paintMarquee(null);
        setCropArmed(false);
        const x = Math.min(m.x0, e.clientX);
        const y = Math.min(m.y0, e.clientY);
        const w = Math.abs(e.clientX - m.x0);
        const h = Math.abs(e.clientY - m.y0);
        if (w < 14 || h < 14) return;
        const quad: Quad = {
          x: (x - m.box.left) / m.box.width,
          y: (y - m.box.top) / m.box.height,
          w: w / m.box.width,
          h: h / m.box.height,
        };
        const region = passageFromRegion(paper, m.page, quad, { x, y, w, h });
        setPassage(region);
        const figure = INSTRUMENT_BY_ID.get('figure');
        if (figure) void apply(figure, region);
        return;
      }

      // A press that did not travel is a click: take the sentence under it.
      const still = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4;
      if (still && down) {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          if (selectSentenceAt(down.page, down.px, down.py)) return;
          setPassage(null);
          return;
        }
      }
      commit();
    },
    [paper, commit, selectSentenceAt, setPassage, paintMarquee, setCropArmed, apply],
  );

  /* ---- keyboard -------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.tagName === 'SELECT');
      if (typing) return;

      if (e.key === 'Escape') {
        if (useReader.getState().cropArmed) {
          setCropArmed(false);
          return;
        }
        if (useReader.getState().passage) {
          clearSelection();
          setPassage(null);
          e.stopPropagation();
        }
        return;
      }

      const current = useReader.getState().passage;
      if (!paper || !ctx) return;

      // ⌥ + arrows is the whole reader, without a pointer: sideways walks the
      // paper a sentence at a time, up and down widen and narrow the mark.
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const next = stepSentence(paper, current, e.key === 'ArrowRight' ? 1 : -1);
        if (next) markQuads(next.page, next.quads);
        return;
      }
      if (!current) return;

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const next = e.key === 'ArrowUp' ? grow(paper, current) : shrink(paper, current);
        if (next) markQuads(next.page, next.quads);
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        keep(current);
        showToast('Kept — mark another passage and press C');
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const instrument = instrumentByKey(e.key);
      if (!instrument) return;
      e.preventDefault();
      if (instrument.arms === 'crop' && instrument.blocked(current, ctx)) {
        setCropArmed(true);
        showToast('Drag a box around the figure');
        return;
      }
      void apply(instrument, current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paper, ctx, apply, markQuads, keep, setPassage, setCropArmed, showToast]);

  /* ---- zoom by wheel --------------------------------------------------- */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(useReader.getState().zoom * (e.deltaY > 0 ? 0.92 : 1.08));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  const onMarkClick = useCallback((sceneId: SceneId) => seekScene(sceneId), [seekScene]);

  /**
   * A page far from the viewport drops its text to stay cheap. When it comes
   * back, the browser selection it held is gone — so the mark is redrawn from
   * the passage the reader still has, and scrolling away no longer loses it.
   */
  const onTextReady = useCallback((pageNumber: number) => {
    const current = useReader.getState().passage;
    if (!current || current.region) return;
    const span = current.spans.find((s) => s.page === pageNumber);
    if (!span?.quads.length) return;
    if (!window.getSelection()?.isCollapsed) return;
    selectQuads(scroller.current, pageNumber, span.quads);
  }, []);

  /* The after-drop flourish is a moment, not a state. */
  const setFlash = useReader((s) => s.setFlash);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash, setFlash]);

  const [wide, setWide] = useState(true);
  const zoomChosen = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = (width: number) => {
      setWide(width > 520);
      // A two-column page squeezed into a phone is a picture of a paper, not a
      // paper. Narrow readers open zoomed in far enough to read a column, and
      // scroll sideways — after which the zoom is the reader's to change.
      if (!zoomChosen.current && width > 0) {
        zoomChosen.current = true;
        if (width < 620) setZoom(Math.min(2.2, 700 / width));
      }
    };
    const ro = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    ro.observe(el);
    fit(el.clientWidth);
    return () => ro.disconnect();
  }, [setZoom]);

  if (!project || !paper) return null;

  const carrying = !!drag?.live && !!drag.instrumentId;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--surface-sunken)]">
      <ReaderBar
        query={query}
        onQuery={setQuery}
        matchCount={matchCount}
        sections={paper.sections.map((s) => ({ id: s.id, title: s.title, page: s.pageRange[0] }))}
        onJump={(page) => {
          scroller.current
            ?.querySelector<HTMLElement>(`[data-page="${page}"]`)
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }}
        onFindNext={() => {
          const first = [...searchByPage.keys()].sort((a, b) => a - b)[0];
          if (first) {
            scroller.current
              ?.querySelector<HTMLElement>(`[data-page="${first}"]`)
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }
        }}
        zoom={zoom}
        onZoom={setZoom}
        pageCount={paper.pages.length}
        compact={!wide}
      />

      <div
        ref={scroller}
        className="pa-reader relative min-h-0 flex-1 overflow-auto scroll-quiet px-3 pb-24 pt-4"
        data-carrying={carrying}
        data-cropping={cropArmed}
        data-coach="paper"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="mx-auto"
          style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom <= 1 ? '68rem' : 'none' }}
        >
          {paper.pages.map((page) => (
            <PageSheet
              key={page.number}
              page={page}
              session={session}
              marks={marksByPage.get(page.number) ?? EMPTY_MARKS}
              lit={litByPage.get(page.number) ?? EMPTY_QUADS}
              flash={flash?.page === page.number ? flash.quads : null}
              searchQuads={searchByPage.get(page.number) ?? EMPTY_QUADS}
              targetQuads={targetQuadsFor(drag, page.number)}
              onMarkClick={onMarkClick}
              onTextReady={onTextReady}
              showGutter={wide}
            />
          ))}
        </div>
      </div>

      {/* the marquee, painted outside React so dragging it costs nothing */}
      <div
        ref={marqueeEl}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[65] hidden rounded-[2px]"
        style={{
          background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
          outline: '1.5px dashed var(--accent)',
          willChange: 'transform',
        }}
      />

      {cropArmed && (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-[66] flex justify-center">
          <span
            className="rounded-[var(--radius-md)] px-2.5 py-1 text-2xs"
            style={{ background: 'var(--surface-inverse)', color: 'var(--ink-inverse)' }}
          >
            Drag a box around the figure · Esc to stop
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[60] flex justify-center px-3">
        <ToolDock compact={compactDock || !wide} />
      </div>

      {passage && !cropArmed && (
        <MarkerBar
          passage={passage}
          onExpand={() => {
            const next = grow(paper, passage);
            if (next) markQuads(next.page, next.quads);
          }}
          onShrink={() => {
            const next = shrink(paper, passage);
            if (next) markQuads(next.page, next.quads);
          }}
          onDismiss={() => {
            clearSelection();
            setPassage(null);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
   The bar above the pages
   ========================================================================== */

function ReaderBar({
  query,
  onQuery,
  matchCount,
  sections,
  onJump,
  onFindNext,
  zoom,
  onZoom,
  pageCount,
  compact,
}: {
  query: string;
  onQuery: (v: string) => void;
  matchCount: number;
  sections: { id: string; title: string; page: number }[];
  onJump: (page: number) => void;
  onFindNext: () => void;
  zoom: number;
  onZoom: (z: number) => void;
  pageCount: number;
  compact: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--rule-hairline)] bg-[var(--surface-page)] px-3 py-2">
      {!compact && (
        <select
          aria-label="Jump to a section"
          className="h-7 max-w-[9.5rem] rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-1.5 text-2xs text-[var(--ink-secondary)]"
          value=""
          onChange={(e) => {
            const page = Number(e.target.value);
            if (page) onJump(page);
            e.target.value = '';
          }}
        >
          <option value="">Contents</option>
          {sections.map((s) => (
            <option key={s.id} value={s.page}>
              {s.title}
            </option>
          ))}
        </select>
      )}

      <div className="relative min-w-0 flex-1">
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
        >
          <circle cx="5.5" cy="5.5" r="4" stroke="var(--ink-faint)" strokeWidth="1.3" />
          <path d="m8.6 8.6 3 3" stroke="var(--ink-faint)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFindNext();
          }}
          placeholder="Search the paper"
          aria-label="Search the paper"
          className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] pl-7 pr-14 text-2xs text-[var(--ink-primary)] placeholder:text-[var(--ink-faint)] focus-visible:border-[var(--accent)]"
        />
        {query.trim().length > 1 && (
          <span className="numeral pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--ink-faint)]">
            {matchCount}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)]">
        <ZoomButton label="Zoom out" onClick={() => onZoom(stepZoom(zoom, -1))}>
          −
        </ZoomButton>
        <span className="numeral w-9 text-center text-[10px] text-[var(--ink-tertiary)]">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomButton label="Zoom in" onClick={() => onZoom(stepZoom(zoom, 1))}>
          +
        </ZoomButton>
      </div>

      {!compact && (
        <span className="numeral shrink-0 text-[10px] text-[var(--ink-faint)]">
          {pageCount} pp
        </span>
      )}
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-7 w-6 text-xs text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-primary)]"
    >
      {children}
    </button>
  );
}

function stepZoom(current: number, direction: 1 | -1): number {
  const steps = ZOOM_STEPS as readonly number[];
  if (direction > 0) return steps.find((s) => s > current + 0.001) ?? current * 1.2;
  return [...steps].reverse().find((s) => s < current - 0.001) ?? current / 1.2;
}

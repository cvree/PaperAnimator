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
  anchorRect,
  captureSelection,
  clearSelection,
  completeSelection,
  extendMark,
  extendSelectionToPoint,
  grow,
  passageFromQuads,
  passageFromRegion,
  readSelection,
  restoreSelection,
  selectQuads,
  shrink,
  snapSelectionToWords,
  stepSentence,
  targetForClick,
  type MarkTarget,
  type Passage,
} from './selection';
import {
  beginTrace,
  marksByHand,
  readIntent,
  traceMove,
  type DragIntent,
  type DragTrace,
} from './intent';
import { coverage, union } from './pageText';

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
/** How long a rounded mark stays the thing a hand-drawn mark could be redoing. */
const REDO_WINDOW = 12_000;
/** How many times a session offers the rounding back before it stops asking. */
const ROUND_UP_OFFERS = 3;

/**
 * How much text a mark holds, for telling a mark redrawn smaller from one widened.
 *
 * Width along the lines, never area: a selection's rectangles are as tall as the
 * browser's line box and a sentence's quads are as tall as its printed glyphs,
 * so their areas are not on the same scale and their widths are.
 */
function spread(quads: Quad[]): number {
  return quads.reduce((sum, q) => sum + Math.max(0, q.w), 0);
}

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
  const pulse = useReader((s) => s.pulse);
  const setPulse = useReader((s) => s.setPulse);
  const hover = useReader((s) => s.hover);
  const setHover = useReader((s) => s.setHover);
  const byHand = useReader((s) => s.byHand);
  const setByHand = useReader((s) => s.setByHand);

  const { ctx, apply } = useApply();

  const scroller = useRef<HTMLDivElement>(null);
  const marqueeEl = useRef<HTMLDivElement>(null);
  const pointerDown = useRef<{
    x: number;
    y: number;
    page: number;
    px: number;
    py: number;
    /** The path the pointer took, which is what says whether a mark was aimed. */
    trace: DragTrace;
  } | null>(null);
  /** The last mark the reader rounded out, so redoing it by hand reads as a no. */
  const rounded = useRef<{ page: number; quads: Quad[]; at: number } | null>(null);
  /** Aimed marks seen so far, offers made, and whether rounding was asked back. */
  const handMarks = useRef({ aimed: 0, offers: 0, roundUpWanted: false });
  const marquee = useRef<{ page: number; box: DOMRect; x0: number; y0: number } | null>(null);
  /** Clicks in the same spot, in a row: 1 takes a sentence, 3 a paragraph. */
  const clicks = useRef({ n: 0, x: 0, y: 0, at: 0 });
  const hoverAt = useRef<{ x: number; y: number; el: HTMLElement | null }>({
    x: 0,
    y: 0,
    el: null,
  });
  const hoverRaf = useRef(0);
  const hoverKey = useRef('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const paper = project?.paper ?? null;
  const carrying = !!drag?.live && !!drag.instrumentId;

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

  /** Whatever is selected right now, made the mark. */
  const takeSelection = useCallback(
    (pulse: boolean) => {
      if (!paper) return null;
      const found = readSelection(scroller.current, paper);
      setPassage(found);
      const span = found?.spans.find((s) => s.quads.length);
      if (pulse && span) setPulse({ page: span.page, quads: span.quads });
      return found;
    },
    [paper, setPassage, setPulse],
  );

  /**
   * Stop rounding marks out, and say so once.
   *
   * The reader steps back and stays back: someone marking by hand at the top of
   * a paper is still marking by hand at the bottom of it, and a helpfulness that
   * comes and goes is worse than either. Nothing is taken away by stepping back
   * — a click still takes the sentence, ⌥↑ still climbs the ladder, and the
   * marker bar still widens — so the only thing lost is the guessing.
   */
  const stepBack = useCallback(() => {
    if (useReader.getState().byHand || handMarks.current.roundUpWanted) return;
    rounded.current = null;
    setByHand(true);
    showToast('Marking by hand — marks are kept exactly as dragged', {
      label: 'Round up again',
      run: () => {
        // Asked for, so remembered: the reader does not step back a second time.
        handMarks.current = { aimed: 0, offers: 0, roundUpWanted: true };
        setByHand(false);
      },
    });
  }, [setByHand, showToast]);

  /**
   * A mark redrawn by hand, smaller, over one the reader had just rounded out.
   *
   * That is somebody saying no to the rounding, in the only language a page
   * offers, and it does not have to be said twice.
   */
  const redoesRoundUp = useCallback((mark: Passage) => {
    const last = rounded.current;
    if (!last) return false;
    if (performance.now() - last.at > REDO_WINDOW) {
      rounded.current = null;
      return false;
    }
    const span = mark.spans.find((sp) => sp.page === last.page);
    if (!span?.quads.length) return false;
    const inside = span.quads.some((q) =>
      last.quads.some((r) => coverage(q, r) > 0.4 || coverage(r, q) > 0.4),
    );
    return inside && spread(span.quads) < spread(last.quads) * 0.92;
  }, []);

  /**
   * Round a mark out to the word or two it stopped short of, and offer it back.
   *
   * The offer is the point. A round-up that cannot be refused in one click is a
   * guess the reader is forcing on somebody; one that can is a suggestion —
   * and refusing it is also how the reader learns to stop suggesting.
   */
  const roundUp = useCallback(
    (dragged: Passage) => {
      if (!paper) return;
      const whole = completeSelection(paper, dragged);
      if (!whole) return;
      const asDragged = captureSelection(scroller.current);
      if (!selectQuads(scroller.current, whole.page, whole.quads)) return;
      rounded.current = { page: whole.page, quads: whole.quads, at: performance.now() };

      // Offered a few times and then left alone: somebody who has watched the
      // reader round three marks out without objecting is not being ambushed by
      // the fourth. Redrawing one by hand still says no, whether it was offered
      // or not, because that is recorded above rather than in the toast.
      if (handMarks.current.offers >= ROUND_UP_OFFERS) return;
      handMarks.current.offers += 1;

      showToast(
        dragged.sentences.length > 1
          ? 'Rounded out to the whole sentences'
          : 'Rounded out to the whole sentence',
        {
          label: 'Keep what I marked',
          run: () => {
            // The exact range first, and the words it covered if the page it was
            // on has since dropped its text — a mark put back to the word is
            // still the mark, and refusing to put it back at all is not.
            const span = dragged.spans.find((sp) => sp.quads.length);
            const back =
              restoreSelection(asDragged) ||
              (!!span && selectQuads(scroller.current, span.page, span.quads));
            if (!back) return;
            rounded.current = null;
            takeSelection(true);
            stepBack();
          },
        },
      );
    },
    [paper, showToast, stepBack, takeSelection],
  );

  /**
   * Read the browser's selection and make it the mark.
   *
   * `tidy` is set when the selection came from a drag, and is the whole of what
   * makes dragging forgiving: the ends round out to whole words, and a drag that
   * stopped a word short of a sentence takes the word. It is also the whole of
   * what makes dragging *presumptuous*, so it holds back the moment there is any
   * sign the mark was aimed — an aimed mark, and every mark after the reader has
   * seen two of them, is kept exactly as it was dragged.
   */
  const commit = useCallback(
    (options: { tidy?: boolean; pulse?: boolean; intent?: DragIntent | null } = {}) => {
      if (!paper) return null;
      const exact = useReader.getState().byHand || !!options.intent?.deliberate;
      if (options.tidy) snapSelectionToWords(scroller.current, { keepInsideWord: exact });

      const dragged = options.tidy && !exact ? readSelection(scroller.current, paper) : null;
      if (dragged && redoesRoundUp(dragged)) {
        // Redrawing a rounded mark by hand is a no. This one is left alone too.
        if (marksByHand(handMarks.current.aimed, true)) stepBack();
      } else if (dragged) {
        roundUp(dragged);
      }
      return takeSelection(!!options.pulse);
    },
    [paper, redoesRoundUp, roundUp, stepBack, takeSelection],
  );

  /** Where a set of quads sits on screen, for anchoring the marker bar. */
  const rectFor = useCallback((page: number, quads: Quad[]) => {
    const r = anchorRect({ page, quads, text: '' });
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  }, []);

  /**
   * Mark exactly this, whether or not there is selectable text under it.
   *
   * A figure, a table and a line drawn as artwork have no runs to select, so
   * they could never be marked by clicking. They can now: the mark falls back
   * to the geometry, and the bar arrives on it just the same.
   */
  const markTarget = useCallback(
    (target: MarkTarget) => {
      if (!paper) return;
      const rect = rectFor(target.page, target.quads);

      if (target.region) {
        clearSelection();
        setPassage(passageFromRegion(paper, target.page, target.quads[0], rect));
        setPulse({ page: target.page, quads: target.quads });
        return;
      }
      if (selectQuads(scroller.current, target.page, target.quads)) {
        commit({ pulse: true });
        return;
      }
      clearSelection();
      setPassage(passageFromQuads(paper, target.page, target.quads, target.text, rect));
      setPulse({ page: target.page, quads: target.quads });
    },
    [paper, commit, rectFor, setPassage, setPulse],
  );

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
          commit({ pulse: true });
          return;
        }
        if (tries > 0) window.setTimeout(() => attempt(tries - 1), 140);
      };
      attempt(5);
    },
    [commit],
  );

  /**
   * A click on the page.
   *
   * Clicking is never a caret: it always takes something, and the something is
   * the sentence under the pointer. Clicking again in the same place widens the
   * mark — sentence, paragraph, section — so a double click lands on the whole
   * sentence rather than on the single word a browser would have given, and the
   * ladder is reachable without knowing a shortcut exists.
   *
   * ⇧-click stretches the mark to wherever it lands instead, in either
   * direction, which is the gesture every text editor already taught everyone.
   * It lands on the sentence while the reader is helping, and on the character
   * once it has stepped back — by then the pointer is being aimed, and an aimed
   * pointer means the word it is on.
   */
  const clickPage = useCallback(
    (e: React.PointerEvent, down: { page: number; px: number; py: number }) => {
      if (!paper) return;

      const now = performance.now();
      const run = clicks.current;
      const again =
        now - run.at < 600 && Math.hypot(e.clientX - run.x, e.clientY - run.y) < 14;
      const n = again ? run.n + 1 : 1;
      clicks.current = { n, x: e.clientX, y: e.clientY, at: now };

      const current = useReader.getState().passage;
      if (e.shiftKey && current) {
        if (
          useReader.getState().byHand &&
          !current.region &&
          extendSelectionToPoint(scroller.current, e.clientX, e.clientY)
        ) {
          snapSelectionToWords(scroller.current, { keepInsideWord: true });
          commit({ pulse: true });
          return;
        }
        const next = extendMark(paper, current, down.page, down.px, down.py);
        if (next && selectQuads(scroller.current, next.page, next.quads)) {
          commit({ pulse: true });
          return;
        }
      }

      const target = targetForClick(paper, down.page, down.px, down.py, n);
      if (!target) {
        clearSelection();
        setPassage(null);
        return;
      }
      markTarget(target);
    },
    [paper, commit, markTarget, setPassage],
  );

  /* ---- what a click would take, before it is taken --------------------- */
  const clearHover = useCallback(() => {
    if (!hoverKey.current) return;
    hoverKey.current = '';
    setHover(null);
  }, [setHover]);

  const readHover = useCallback(() => {
    hoverRaf.current = 0;
    const { x, y, el } = hoverAt.current;
    if (!paper || !el) {
      clearHover();
      return;
    }
    const page = Number(el.dataset.page);
    const box = el.getBoundingClientRect();
    if (!Number.isFinite(page) || box.width < 1) {
      clearHover();
      return;
    }

    const target = targetForClick(
      paper,
      page,
      (x - box.left) / box.width,
      (y - box.top) / box.height,
      1,
    );
    // Nothing to preview once the mark is already on it — a second wash under
    // the selection would read as a second mark.
    const marked = useReader.getState().passage?.spans.find((sp) => sp.page === page);
    const covered =
      !!target &&
      !!marked &&
      target.quads.every((q) => marked.quads.some((m) => coverage(q, m) > 0.55));
    if (!target || covered) {
      clearHover();
      return;
    }

    const key = `${page}:${target.kind}:${target.quads
      .map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`)
      .join('|')}`;
    if (key === hoverKey.current) return;
    hoverKey.current = key;
    setHover({ page, quads: target.quads, region: !!target.region });
  }, [paper, clearHover, setHover]);

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
        trace: beginTrace(e.clientX, e.clientY, performance.now(), e.pointerType),
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
      if (m) {
        const x = Math.min(m.x0, e.clientX);
        const y = Math.min(m.y0, e.clientY);
        paintMarquee(new DOMRect(x, y, Math.abs(e.clientX - m.x0), Math.abs(e.clientY - m.y0)));
        return;
      }

      // Every sample of a press is kept: how far it travelled, where it slowed
      // and where it came back on itself is what tells a swipe from an aimed mark.
      if (pointerDown.current) {
        traceMove(pointerDown.current.trace, e.clientX, e.clientY, performance.now());
      }

      // The preview belongs to a pointer that is hovering, not working: while a
      // selection is being dragged, a tool carried or a box cropped, the page is
      // already saying what will happen.
      if (e.pointerType === 'touch' || pointerDown.current || cropArmed || carrying) {
        clearHover();
        return;
      }
      hoverAt.current = {
        x: e.clientX,
        y: e.clientY,
        el: (e.target as HTMLElement).closest<HTMLElement>('[data-page]'),
      };
      if (!hoverRaf.current) hoverRaf.current = requestAnimationFrame(readHover);
    },
    [paintMarquee, clearHover, readHover, cropArmed, carrying],
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

      const intent = down ? readIntent(down.trace, performance.now()) : null;

      // A press that did not travel is a click, and a click always takes
      // something. The tolerance is generous on purpose: a hand that moves two
      // pixels meant to click, and getting a two-character selection instead is
      // the single most annoying thing a page like this can do.
      //
      // Once the reader has stepped back it stops being so generous. A short
      // press that was aimed and left words behind it is a mark — two words
      // taken slowly are not a slip — and it is only read as a click when there
      // turns out to be nothing selected under it.
      const slop = e.pointerType === 'mouse' ? (byHand ? 4 : 6) : 12;
      const still = !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < slop;

      if (still && down) {
        const aimed = byHand && !!intent && intent.travel >= 5 && intent.duration >= 150;
        if (!aimed || !commit({ tidy: true, pulse: true, intent })) {
          clickPage(e, down);
          return;
        }
      } else {
        commit({ tidy: true, pulse: true, intent });
      }

      // Aimed marks are evidence. Two of them and the reader stops guessing.
      if (intent?.deliberate && useReader.getState().passage) {
        handMarks.current.aimed += 1;
        if (marksByHand(handMarks.current.aimed, false)) stepBack();
      }
    },
    [paper, byHand, commit, clickPage, paintMarquee, setCropArmed, apply, stepBack],
  );

  /**
   * The browser's own double click takes a word and its triple click takes a
   * block of runs; both are wrong here, and both happen on the *second*
   * mousedown — so that is where they are stopped, before they can flicker.
   */
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.detail >= 2 || (e.shiftKey && useReader.getState().passage)) e.preventDefault();
  }, []);

  const onPointerLeave = useCallback(() => clearHover(), [clearHover]);

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

  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 380);
    return () => clearTimeout(t);
  }, [pulse, setPulse]);

  useEffect(
    () => () => {
      if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
    },
    [],
  );

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
        data-byhand={byHand}
        data-coach="paper"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onMouseDown={onMouseDown}
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
              hoverQuads={hover?.page === page.number ? hover.quads : EMPTY_QUADS}
              hoverRegion={hover?.page === page.number && hover.region}
              pulse={pulse?.page === page.number ? pulse.quads : null}
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

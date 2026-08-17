import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import type { Sentence, SourceRef } from '@/core/types';
import { makeSceneFromSentence, addSentenceToScene, makeQuoteScene } from '@/compose/fromSelection';
import { PageView } from './PageView';

/**
 * The paper itself. Two modes: an outline you can read and select from, and the
 * real rendered pages with the quads drawn on them.
 *
 * Selecting a sentence is the primary act of the product: what you select
 * becomes a scene, and its provenance is the selection itself, so there is no
 * bookkeeping to get wrong.
 */

export function SourcePane() {
  const project = useApp((s) => s.project);
  const [mode, setMode] = useState<'outline' | 'pages'>('outline');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Sentence | null>(null);

  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--rule-hairline)] px-3 py-2">
        <SearchField value={query} onChange={setQuery} />
        <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)]">
          {(['outline', 'pages'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={m === 'outline' ? 'Read as an outline' : 'See the real pages'}
              className="px-2 py-1 text-2xs capitalize transition-colors"
              style={{
                background: mode === m ? 'var(--surface-inverse)' : 'var(--surface-raised)',
                color: mode === m ? 'var(--ink-inverse)' : 'var(--ink-tertiary)',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === 'outline' ? (
        <OutlineMode query={query} selected={selected} onSelect={setSelected} />
      ) : (
        <PagesMode query={query} />
      )}
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1">
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search the paper"
        aria-label="Search the paper"
        className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] pl-7 pr-2 text-2xs text-[var(--ink-primary)] placeholder:text-[var(--ink-faint)] focus-visible:border-[var(--accent)]"
      />
    </div>
  );
}

/* ============================================================================
   Outline
   ========================================================================== */

function OutlineMode({
  query,
  selected,
  onSelect,
}: {
  query: string;
  selected: Sentence | null;
  onSelect: (s: Sentence | null) => void;
}) {
  const project = useApp((s) => s.project)!;
  const focus = useApp((s) => s.sourceFocus);
  const hovered = useApp((s) => s.hoveredSourceRef);
  const scroller = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  /** Which sentences are already used by a scene, and by which. */
  const usage = useMemo(() => {
    const map = new Map<string, { sceneId: string; title: string; index: number }[]>();
    project.scenes.forEach((scene, i) => {
      for (const ref of scene.sourceRefs) {
        const key = refKey(ref);
        const list = map.get(key) ?? [];
        if (!list.some((e) => e.sceneId === scene.id)) {
          list.push({ sceneId: scene.id, title: scene.title, index: i + 1 });
        }
        map.set(key, list);
      }
    });
    return map;
  }, [project.scenes]);

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return project.paper.sections;
    return project.paper.sections
      .map((s) => ({
        ...s,
        paragraphs: s.paragraphs
          .map((p) => ({
            ...p,
            sentences: p.sentences.filter((sen) => sen.text.toLowerCase().includes(q)),
          }))
          .filter((p) => p.sentences.length > 0),
      }))
      .filter((s) => s.paragraphs.length > 0 || s.title.toLowerCase().includes(q));
  }, [project.paper.sections, q]);

  /* Scroll to and flash the focused source. */
  useLayoutEffect(() => {
    if (!focus) return;
    const el = findSourceElement(focus.ref, scroller.current);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const key = el.dataset.refKey ?? refKey(focus.ref);
    setFlashId(key);
    const t = setTimeout(() => setFlashId(null), 1300);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto scroll-quiet px-3 pb-24 pt-3">
        {sections.map((section) => (
          <section key={section.id} className="mb-6">
            <h3 className="label sticky top-0 z-10 -mx-3 mb-2 bg-[var(--surface-page)] px-3 py-1.5">
              {section.title}
              {section.kind !== 'other' &&
                section.kind.replace('-', ' ') !== section.title.toLowerCase() && (
                  <span className="ml-2 normal-case tracking-normal text-[var(--ink-faint)]">
                    {section.kind.replace('-', ' ')}
                  </span>
                )}
            </h3>

            {section.paragraphs.map((para) => (
              <p key={para.id} className="mb-3 leading-[1.62]">
                {para.sentences.map((sentence) => {
                  const key = refKey(sentence.ref);
                  const used = usage.get(key);
                  const isSelected = selected?.id === sentence.id;
                  const isFlashing = flashId === key;
                  const isHovered = hovered && refKey(hovered) === key;
                  return (
                    <SentenceSpan
                      key={sentence.id}
                      sentence={sentence}
                      refKeyValue={key}
                      used={used}
                      selected={isSelected}
                      flashing={isFlashing}
                      hovered={!!isHovered}
                      onSelect={() => onSelect(isSelected ? null : sentence)}
                    />
                  );
                })}
              </p>
            ))}
          </section>
        ))}

        {sections.length === 0 && (
          <p className="px-1 py-8 text-center text-xs text-[var(--ink-faint)]">
            Nothing in the paper matches “{query}”.
          </p>
        )}
      </div>

      {selected && <SelectionBar sentence={selected} onDone={() => onSelect(null)} />}
    </>
  );
}

function SentenceSpan({
  sentence,
  refKeyValue,
  used,
  selected,
  flashing,
  hovered,
  onSelect,
}: {
  sentence: Sentence;
  refKeyValue: string;
  used?: { sceneId: string; title: string; index: number }[];
  selected: boolean;
  flashing: boolean;
  hovered: boolean;
  onSelect: () => void;
}) {
  const lightScenes = useApp((s) => s.lightScenes);
  const seekScene = useApp((s) => s.seekScene);
  const hoverSource = useApp((s) => s.hoverSource);

  const background = selected
    ? 'var(--accent-quiet)'
    : flashing
      ? 'var(--hl-yellow)'
      : hovered
        ? 'var(--accent-subtle)'
        : 'transparent';

  return (
    <span
      data-ref-key={refKeyValue}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => {
        hoverSource(sentence.ref);
        if (used?.length) lightScenes(used.map((u) => u.sceneId as never));
      }}
      onMouseLeave={() => {
        hoverSource(null);
        lightScenes([]);
      }}
      onDoubleClick={() => {
        if (used?.[0]) seekScene(used[0].sceneId as never);
      }}
      className="cursor-pointer rounded-[2px] text-xs text-[var(--ink-secondary)] transition-colors duration-200 hover:text-[var(--ink-primary)]"
      style={{
        background,
        boxShadow: used?.length
          ? `inset 0 -2px 0 0 color-mix(in oklch, var(--ev-extracted) ${selected ? 90 : 55}%, transparent)`
          : undefined,
        padding: '1px 1px',
      }}
      title={used?.length ? `Used in scene ${used.map((u) => u.index).join(', ')}` : undefined}
    >
      {sentence.text}{' '}
    </span>
  );
}

/* ============================================================================
   Selection → scene
   ========================================================================== */

function SelectionBar({ sentence, onDone }: { sentence: Sentence; onDone: () => void }) {
  const project = useApp((s) => s.project)!;
  const mutate = useApp((s) => s.mutate);
  const selectedSceneId = useApp((s) => s.selectedSceneId);
  const seekScene = useApp((s) => s.seekScene);
  const showToast = useApp((s) => s.showToast);
  const stats = project.paper.statistics.filter((s) => s.sentenceId === sentence.id);

  const create = (kind: 'scene' | 'quote') => {
    const scene =
      kind === 'quote'
        ? makeQuoteScene(sentence, project.settings)
        : makeSceneFromSentence(sentence, stats, project.settings);
    const insertAfter = project.scenes.findIndex((s) => s.id === selectedSceneId);
    mutate('Make a scene', (draft) => {
      const at = insertAfter >= 0 ? insertAfter + 1 : draft.scenes.length;
      draft.scenes.splice(at, 0, scene);
    });
    seekScene(scene.id);
    showToast(`Added “${scene.title}”`);
    onDone();
  };

  const addToCurrent = () => {
    if (!selectedSceneId) return;
    mutate('Add to scene', (draft) => {
      const scene = draft.scenes.find((s) => s.id === selectedSceneId);
      if (scene) addSentenceToScene(scene, sentence);
    });
    showToast('Added to the current scene');
    onDone();
  };

  return (
    <div
      className="absolute inset-x-2 bottom-2 z-30 rounded-[var(--radius-md)] border border-[var(--rule-strong)] bg-[var(--surface-raised)] p-2.5 motion-safe:animate-[bar-in_200ms_var(--ease-out)]"
      style={{ boxShadow: 'var(--shadow-float)' }}
      role="group"
      aria-label="What to do with the selected sentence"
    >
      <p className="mb-2 line-clamp-2 text-2xs leading-[1.45] text-[var(--ink-tertiary)]">
        “{sentence.text}”
      </p>
      <div className="flex flex-wrap gap-1.5">
        <ActionButton primary onClick={() => create('scene')}>
          {stats.length ? 'Make a stat scene' : 'Make a scene'}
        </ActionButton>
        <ActionButton onClick={() => create('quote')}>Quote it</ActionButton>
        {selectedSceneId && <ActionButton onClick={addToCurrent}>Add to current</ActionButton>}
        <button
          type="button"
          onClick={onDone}
          className="ml-auto px-2 text-2xs text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-primary)]"
        >
          Cancel
        </button>
      </div>
      <style>{`@keyframes bar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-2xs font-medium transition-colors"
      style={{
        background: primary ? 'var(--accent)' : 'var(--surface-sunken)',
        color: primary ? 'var(--accent-ink)' : 'var(--ink-primary)',
      }}
    >
      {children}
    </button>
  );
}

/* ============================================================================
   Pages
   ========================================================================== */

function PagesMode({ query }: { query: string }) {
  const project = useApp((s) => s.project)!;
  const session = useApp((s) => s.session);
  const focus = useApp((s) => s.sourceFocus);
  const hovered = useApp((s) => s.hoveredSourceRef);
  const scroller = useRef<HTMLDivElement>(null);

  const marks = useMemo(() => {
    const byPage = new Map<number, SourceRef[]>();
    for (const scene of project.scenes) {
      for (const ref of scene.sourceRefs) {
        if (!ref.quads.length) continue;
        const list = byPage.get(ref.page) ?? [];
        list.push(ref);
        byPage.set(ref.page, list);
      }
    }
    return byPage;
  }, [project.scenes]);

  useEffect(() => {
    if (!focus) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${focus.ref.page}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto scroll-quiet p-3">
      {project.paper.pages.map((page) => (
        <PageView
          key={page.number}
          page={page}
          session={session}
          marks={marks.get(page.number) ?? []}
          focus={focus?.ref.page === page.number ? focus.ref : null}
          hovered={hovered?.page === page.number ? hovered : null}
          query={query}
        />
      ))}
    </div>
  );
}

/**
 * The element in the outline that a reference points at.
 *
 * A statistic's quads bound the number, not the sentence, so its key matches no
 * element of its own. The sentence that contains that text is the honest
 * target — the number really is inside it — so we fall back to matching text.
 */
export function findSourceElement(ref: SourceRef, root?: HTMLElement | null): HTMLElement | null {
  const scope: ParentNode = root ?? document;
  const exact = scope.querySelector<HTMLElement>(`[data-ref-key="${cssEscape(refKey(ref))}"]`);
  if (exact) return exact;

  const needle = ref.text.trim().slice(0, 60);
  if (needle.length < 12) return null;
  for (const el of scope.querySelectorAll<HTMLElement>('[data-ref-key]')) {
    const t = (el.textContent ?? '').trim();
    if (t.includes(needle) || needle.includes(t.slice(0, 60))) return el;
  }
  return null;
}

export function refKey(ref: SourceRef): string {
  const q = ref.quads[0];
  return `p${ref.page}:${q ? `${q.x.toFixed(3)},${q.y.toFixed(3)}` : hashText(ref.text)}`;
}

function hashText(t: string): string {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

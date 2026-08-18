import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Fragment } from 'react';
import { useApp } from '@/state/store';
import type { Aspect, Scene, StyleId } from '@/core/types';
import { composeScenes } from '@/compose/compose';
import { ScenePreview } from '@/render/ScenePreview';
import { provenancesOf } from '@/core/integrity';
import { useReader } from '@/reader/readerStore';

/**
 * The storyboard. Reordering works by pointer and by keyboard alike — the
 * keyboard sensor is not a fallback, it is the same interaction with a different
 * input, announced through a live region.
 */

export function SceneRail({
  horizontal = false,
  header = true,
}: {
  horizontal?: boolean;
  /** Off when the panel already has a heading of its own. */
  header?: boolean;
}) {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const selectedSceneId = useApp((s) => s.selectedSceneId);
  const seekScene = useApp((s) => s.seekScene);
  const hoverSource = useApp((s) => s.hoverSource);
  const lit = useApp((s) => s.litSceneIds);
  const drag = useReader((s) => s.drag);
  const carrying = !!drag?.passage && drag.live;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!project) return null;
  const scenes = project.scenes;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = scenes.findIndex((s) => s.id === active.id);
    const to = scenes.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    mutate('Reorder scenes', (draft) => {
      draft.scenes = arrayMove(draft.scenes, from, to);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-sunken)]">
      {header && (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--rule-hairline)] px-3 py-2">
          <span className="label">Storyboard</span>
          <span className="numeral text-2xs text-[var(--ink-faint)]">{scenes.length}</span>
        </div>
      )}

      {scenes.length === 0 && !carrying && <EmptyRail />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up scene ${sceneLabel(scenes, active.id)}.`,
            onDragOver: ({ active, over }) =>
              over
                ? `Scene ${sceneLabel(scenes, active.id)} is over position ${indexOf(scenes, over.id) + 1} of ${scenes.length}.`
                : '',
            onDragEnd: ({ active, over }) =>
              over
                ? `Scene ${sceneLabel(scenes, active.id)} dropped at position ${indexOf(scenes, over.id) + 1} of ${scenes.length}.`
                : 'Movement cancelled.',
            onDragCancel: () => 'Movement cancelled.',
          },
        }}
      >
        <SortableContext
          items={scenes.map((s) => s.id)}
          strategy={horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}
        >
          <div
            className={
              horizontal
                ? 'flex min-h-0 flex-1 gap-2 overflow-x-auto p-2'
                : 'min-h-0 flex-1 space-y-2 overflow-y-auto p-2'
            }
          >
            {carrying && <GapZone index={0} horizontal={horizontal} active={isGap(drag, 0)} />}
            {scenes.map((scene, i) => (
              <Fragment key={scene.id}>
                <SceneCard
                  scene={scene}
                  index={i + 1}
                  styleId={project.style}
                  aspect={project.settings.aspect}
                  selected={scene.id === selectedSceneId}
                  lit={lit.includes(scene.id)}
                  targeted={
                    !!drag?.live && drag.target.kind === 'scene' && drag.target.id === scene.id
                  }
                  horizontal={horizontal}
                  onSelect={() => seekScene(scene.id)}
                  onPoint={(on) => hoverSource(on ? (scene.sourceRefs[0] ?? null) : null)}
                />
                {carrying && (
                  <GapZone index={i + 1} horizontal={horizontal} active={isGap(drag, i + 1)} />
                )}
              </Fragment>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/**
 * An empty storyboard is the normal way to start: the paper opens as the paper,
 * and nothing is composed until you mark something. The offer to draft one is
 * here, plainly, for anyone who would rather begin from a draft than a blank —
 * but it is an offer, taken deliberately, not something that already happened.
 */
function EmptyRail() {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const seekScene = useApp((s) => s.seekScene);
  const showToast = useApp((s) => s.showToast);

  if (!project) return null;

  const draft = () => {
    const scenes = composeScenes(project.paper, {
      settings: project.settings,
      targetDurationMs: project.settings.targetDurationMs,
    });
    if (!scenes.length) {
      showToast('There was not enough structure in this paper to draft from');
      return;
    }
    mutate('Draft a storyboard', (d) => {
      d.scenes.push(...scenes);
    });
    seekScene(scenes[0].id);
    showToast(`Drafted ${scenes.length} scenes — every one traced to the paper`, {
      label: 'Undo',
      run: () => useApp.getState().undo(),
    });
  };

  return (
    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
      <p className="text-xs leading-[1.55] text-[var(--ink-secondary)]">
        Nothing here yet. Highlight something in the paper and drop a tool on it.
      </p>
      <button
        type="button"
        onClick={draft}
        className="rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-3 py-1.5 text-2xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--rule-strong)] hover:text-[var(--ink-primary)]"
      >
        Or draft one from the whole paper
      </button>
    </div>
  );
}

/** Where a carried passage would land if it were dropped between two cards. */
function GapZone({
  index,
  horizontal,
  active,
}: {
  index: number;
  horizontal: boolean;
  active: boolean;
}) {
  return (
    <div
      data-drop={`gap:${index}`}
      aria-hidden="true"
      className="shrink-0 rounded-full transition-all duration-150"
      style={{
        width: horizontal ? (active ? '1.6rem' : '0.5rem') : '100%',
        height: horizontal ? 'auto' : active ? '1.6rem' : '0.5rem',
        alignSelf: 'stretch',
        background: active ? 'var(--accent)' : 'transparent',
        outline: active ? 'none' : '1px dashed var(--rule-hairline)',
        outlineOffset: '-1px',
      }}
    />
  );
}

function isGap(drag: ReturnType<typeof useReader.getState>['drag'], index: number): boolean {
  return !!drag && drag.target.kind === 'gap' && drag.target.index === index;
}

function sceneLabel(scenes: Scene[], id: string | number): string {
  const i = scenes.findIndex((s) => s.id === id);
  return i >= 0 ? `${i + 1}, ${scenes[i].title}` : String(id);
}

function indexOf(scenes: Scene[], id: string | number): number {
  return scenes.findIndex((s) => s.id === id);
}

function SceneCard({
  scene,
  index,
  styleId,
  aspect,
  selected,
  lit,
  targeted,
  horizontal,
  onSelect,
  onPoint,
}: {
  scene: Scene;
  index: number;
  styleId: StyleId;
  aspect: Aspect;
  selected: boolean;
  lit: boolean;
  targeted: boolean;
  horizontal: boolean;
  onSelect: () => void;
  onPoint: (on: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });
  const mutate = useApp((s) => s.mutate);
  const showToast = useApp((s) => s.showToast);
  const openMotionPicker = useApp((s) => s.openMotionPicker);

  const needsReview = scene.layers.some((l) =>
    provenancesOf(l).some((p) => p.kind === 'unsupported' && !p.reviewed),
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        width: horizontal ? '11rem' : undefined,
      }}
      className="group relative shrink-0"
      data-drop={`scene:${scene.id}`}
      onMouseEnter={() => onPoint(true)}
      onMouseLeave={() => onPoint(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className="block w-full text-left"
      >
        <div
          className="overflow-hidden rounded-[var(--radius-sm)] border transition-all duration-200"
          style={{
            borderColor: targeted
              ? 'var(--accent)'
              : selected
                ? 'var(--accent)'
                : lit
                  ? 'var(--ev-extracted)'
                  : 'var(--rule-hairline)',
            boxShadow: isDragging
              ? 'var(--shadow-lift)'
              : targeted
                ? '0 0 0 2px var(--accent)'
                : selected
                  ? '0 0 0 1px var(--accent)'
                  : lit
                    ? '0 0 0 1px var(--ev-extracted)'
                    : 'none',
            transform: isDragging ? 'scale(1.02)' : 'none',
            opacity: scene.hidden ? 0.4 : 1,
          }}
        >
          <ScenePreview scene={scene} styleId={styleId} aspect={aspect} />
        </div>
        <div className="mt-1 flex items-baseline gap-1.5 px-0.5">
          <span className="numeral shrink-0 text-2xs text-[var(--ink-faint)]">
            {String(index).padStart(2, '0')}
          </span>
          <span className="min-w-0 flex-1 truncate text-2xs text-[var(--ink-secondary)]">
            {scene.title}
          </span>
          {needsReview && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: 'var(--ev-unsupported)' }}
              title="Needs review"
            />
          )}
          <span className="numeral shrink-0 text-2xs text-[var(--ink-faint)]">
            {(scene.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </button>

      {/* Animation is one click from the storyboard, at every level of the
          editor — it is the difference between a slide and a film, and it does
          not belong behind an inspector tab. */}
      <button
        type="button"
        aria-label={`Animate scene ${index}, ${scene.title}`}
        title="Animate this scene"
        onClick={(e) => {
          e.stopPropagation();
          openMotionPicker(scene.id);
        }}
        className="absolute bottom-6 right-1 flex h-6 items-center gap-1 rounded-[2px] bg-[var(--surface-raised)]/90 px-1.5 text-2xs text-[var(--ink-secondary)] opacity-0 backdrop-blur-sm transition-opacity hover:text-[var(--accent)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Spark />
        Animate
      </button>

      {/* drag handle: pointer and keyboard */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder scene ${index}, ${scene.title}`}
        className="absolute left-1 top-1 flex h-5 w-5 cursor-grab items-center justify-center rounded-[2px] bg-[var(--surface-raised)]/85 text-[var(--ink-tertiary)] opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="2" r="0.9" />
          <circle cx="7" cy="2" r="0.9" />
          <circle cx="3" cy="5" r="0.9" />
          <circle cx="7" cy="5" r="0.9" />
          <circle cx="3" cy="8" r="0.9" />
          <circle cx="7" cy="8" r="0.9" />
        </svg>
      </button>

      <button
        type="button"
        aria-label={`Delete scene ${index}`}
        onClick={() => {
          const removed = scene;
          const idx = index - 1;
          mutate('Delete scene', (draft) => {
            draft.scenes = draft.scenes.filter((s) => s.id !== scene.id);
          });
          showToast(`Deleted “${removed.title}”`, {
            label: 'Undo',
            run: () => useApp.getState().undo(),
          });
          void idx;
        }}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-[2px] bg-[var(--surface-raised)]/85 text-[var(--ink-tertiary)] opacity-0 backdrop-blur-sm transition-opacity hover:text-[var(--danger)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
          <path d="m1.5 1.5 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** The mark for motion: a four-pointed spark, drawn rather than typed. */
export function Spark({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M5 0c.35 2.6 1.4 4 4 4.4v.2C6.4 5 5.35 6.4 5 9c-.35-2.6-1.4-4-4-4.4v-.2C3.6 4 4.65 2.6 5 0Z" />
    </svg>
  );
}

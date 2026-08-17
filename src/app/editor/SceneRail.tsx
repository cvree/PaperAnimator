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
import { useApp } from '@/state/store';
import type { Aspect, Scene, StyleId } from '@/core/types';
import { ScenePreview } from '@/render/ScenePreview';
import { provenancesOf } from '@/core/integrity';

/**
 * The storyboard. Reordering works by pointer and by keyboard alike — the
 * keyboard sensor is not a fallback, it is the same interaction with a different
 * input, announced through a live region.
 */

export function SceneRail({ horizontal = false }: { horizontal?: boolean }) {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const selectedSceneId = useApp((s) => s.selectedSceneId);
  const seekScene = useApp((s) => s.seekScene);
  const lit = useApp((s) => s.litSceneIds);

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
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--rule-hairline)] px-3 py-2">
        <span className="label">Storyboard</span>
        <span className="numeral text-2xs text-[var(--ink-faint)]">
          {scenes.length}
        </span>
      </div>

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
            {scenes.map((scene, i) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                index={i + 1}
                styleId={project.style}
                aspect={project.settings.aspect}
                selected={scene.id === selectedSceneId}
                lit={lit.includes(scene.id)}
                horizontal={horizontal}
                onSelect={() => seekScene(scene.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
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
  horizontal,
  onSelect,
}: {
  scene: Scene;
  index: number;
  styleId: StyleId;
  aspect: Aspect;
  selected: boolean;
  lit: boolean;
  horizontal: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });
  const mutate = useApp((s) => s.mutate);
  const showToast = useApp((s) => s.showToast);

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
            borderColor: selected
              ? 'var(--accent)'
              : lit
                ? 'var(--ev-extracted)'
                : 'var(--rule-hairline)',
            boxShadow: isDragging
              ? 'var(--shadow-lift)'
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

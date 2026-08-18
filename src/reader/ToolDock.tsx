import { useMemo } from 'react';
import { useApp } from '@/state/store';
import { INSTRUMENTS, type Instrument, type InstrumentGroup } from './instruments';
import { useApply } from './apply';
import { useReader } from './readerStore';
import { beginToolDrag } from './useDragEngine';
import { Glyph } from './glyphs';
import { clip } from './pageText';

/**
 * The dock.
 *
 * Every tool is visible at once, grouped by what it does to the project: make a
 * new scene, add to the one you are on, or combine two passages. A tool can be
 * clicked to apply it to what is marked, or picked up and carried onto the page.
 */

const GROUPS: { id: InstrumentGroup; label: string }[] = [
  { id: 'make', label: 'Make a scene' },
  { id: 'add', label: 'Add to this scene' },
  { id: 'combine', label: 'Combine' },
];

export function ToolDock({ compact = false }: { compact?: boolean }) {
  const passage = useReader((s) => s.passage);
  const tray = useReader((s) => s.tray);
  const drag = useReader((s) => s.drag);
  const cropArmed = useReader((s) => s.cropArmed);
  const setCropArmed = useReader((s) => s.setCropArmed);
  const clearTray = useReader((s) => s.clearTray);
  const showToast = useApp((s) => s.showToast);
  const { ctx, apply } = useApply();

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: INSTRUMENTS.filter((i) => i.group === g.id) })),
    [],
  );

  if (!ctx) return null;

  const carryingPassage = !!drag?.passage && drag.live;

  const onActivate = (instrument: Instrument) => {
    // An arming tool with nothing to work on switches the reader into its mode
    // instead of refusing — that is how you get it something to work on.
    if (instrument.arms === 'crop' && instrument.blocked(passage, ctx)) {
      setCropArmed(true);
      showToast('Drag a box around the figure');
      return;
    }
    void apply(instrument, passage);
  };

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      data-coach="dock"
      className="pointer-events-auto flex max-w-full flex-wrap items-stretch justify-center gap-x-3 gap-y-1 rounded-[var(--radius-lg)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)]/95 p-1 backdrop-blur"
      style={{ boxShadow: 'var(--shadow-float)' }}
    >
      {grouped.map((group) => (
        <div key={group.id} className="flex shrink-0 items-stretch gap-0.5" aria-label={group.label}>
          {group.items.map((instrument) => (
            <Chip
              key={instrument.id}
              instrument={instrument}
              reason={instrument.blocked(passage, ctx)}
              armed={instrument.arms === 'crop' && cropArmed}
              targeted={
                carryingPassage &&
                drag?.target.kind === 'instrument' &&
                drag.target.id === instrument.id
              }
              inviting={carryingPassage}
              compact={compact}
              onActivate={() => onActivate(instrument)}
            />
          ))}
        </div>
      ))}

      {tray.length > 0 && (
        <>
          <button
            type="button"
            onClick={clearTray}
            title={tray.map((t) => clip(t.text, 60)).join('\n')}
            className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-2xs transition-colors hover:bg-[var(--surface-sunken)]"
            style={{ color: 'var(--ink-tertiary)' }}
          >
            <span
              className="flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {tray.length}
            </span>
            {!compact && <span>kept</span>}
          </button>
        </>
      )}
    </div>
  );
}

function Chip({
  instrument,
  reason,
  targeted,
  inviting,
  armed,
  compact,
  onActivate,
}: {
  instrument: Instrument;
  reason: string | null;
  targeted: boolean;
  inviting: boolean;
  armed: boolean;
  compact: boolean;
  onActivate: () => void;
}) {
  const disabled = !!reason && !inviting && !instrument.arms;

  return (
    <button
      type="button"
      data-drop={`instrument:${instrument.id}`}
      data-instrument={instrument.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        beginToolDrag(instrument.id, e);
      }}
      onClick={onActivate}
      title={`${instrument.label} — ${instrument.hint}${reason && disabled ? ` · ${reason}` : ''} (${instrument.key.toUpperCase()})`}
      aria-label={`${instrument.label}. ${instrument.hint}`}
      aria-disabled={disabled || undefined}
      className="group relative flex shrink-0 select-none items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 text-2xs transition-[background,color,transform] duration-150 active:scale-[0.97]"
      style={{
        touchAction: 'none',
        cursor: disabled ? 'default' : 'grab',
        opacity: disabled ? 0.38 : 1,
        background: targeted
          ? 'var(--accent)'
          : armed
            ? 'var(--accent-quiet)'
            : 'transparent',
        color: targeted ? 'var(--accent-ink)' : 'var(--ink-secondary)',
        // A border, not an outline: the outline belongs to the focus ring, and
        // an inline `outline: none` would silently suppress it.
        border: '1px dashed',
        borderColor: inviting && !targeted ? 'var(--rule-strong)' : 'transparent',
      }}
    >
      <span className={targeted ? '' : 'text-[var(--ink-tertiary)] group-hover:text-[var(--accent)]'}>
        <Glyph id={instrument.id} />
      </span>
      {!compact && <span className="whitespace-nowrap font-medium">{instrument.label}</span>}
      <kbd
        aria-hidden="true"
        className={`ml-0.5 rounded-[2px] px-1 text-[9px] leading-[1.4] ${compact ? 'hidden' : 'hidden xl:inline'}`}
        style={{
          background: targeted ? 'transparent' : 'var(--surface-sunken)',
          color: targeted ? 'var(--accent-ink)' : 'var(--ink-faint)',
        }}
      >
        {instrument.key.toUpperCase()}
      </kbd>
    </button>
  );
}

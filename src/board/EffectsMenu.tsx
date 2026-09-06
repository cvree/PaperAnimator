import * as Popover from '@radix-ui/react-popover';
import { useApp } from '@/state/store';
import { matchesPreset, normaliseEffects, PRESET_LIST, presetEffects } from './effects';
import type { BoardEffects, EffectPreset } from './types';

/**
 * The look of the room.
 *
 * Five named rooms across the top and seven dials underneath, in that order and
 * not the other way round: almost nobody wants to think about how much grain a
 * board has, and everybody can tell you whether they want the lights on. The
 * dials are there for the one person in ten who does, and touching one renames
 * the look to `custom` rather than pretending it is still `cinema`.
 */

const DIALS: { key: keyof BoardEffects; label: string; hint: string }[] = [
  { key: 'parallax', label: 'Depth', hint: 'Cards at different depths slide past each other.' },
  { key: 'focus', label: 'Lens', hint: 'What you are not looking at goes soft.' },
  { key: 'spotlight', label: 'Spotlight', hint: 'A light that follows the cursor.' },
  { key: 'bloom', label: 'Glow', hint: 'Ink and numbers bloom, the way a lit sign does.' },
  { key: 'grain', label: 'Grain', hint: 'Paper tooth on white, chalk dust on black.' },
  { key: 'aurora', label: 'Colour field', hint: 'A slow wash drifting behind the grid.' },
  { key: 'vignette', label: 'Vignette', hint: 'The corners fall away.' },
];

export function EffectsMenu() {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const board = project?.board;
  if (!board) return null;

  const fx = normaliseEffects(board.effects);
  const look: EffectPreset = board.look ?? 'plain';
  const on = PRESET_LIST.some((p) => p.id === look && p.id !== 'plain') || look === 'custom';

  const choose = (preset: EffectPreset) =>
    mutate('Change the look', (d) => {
      d.board.effects = presetEffects(preset, normaliseEffects(d.board.effects));
      d.board.look = preset;
    });

  const setDial = (key: keyof BoardEffects, value: number | boolean) =>
    mutate(
      'Adjust the look',
      (d) => {
        const next = { ...normaliseEffects(d.board.effects), [key]: value } as BoardEffects;
        d.board.effects = next;
        // A look you have adjusted is your look, unless you happened to land
        // exactly back on one of ours.
        const named = PRESET_LIST.find((p) => p.id !== 'custom' && matchesPreset(next, p.id));
        d.board.look = named ? named.id : 'custom';
      },
      `dial:${key}`,
    );

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="How the board looks"
          className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-2xs transition-colors"
          style={{
            borderColor: on ? 'var(--accent)' : 'var(--rule-hairline)',
            background: on ? 'var(--accent-subtle)' : 'transparent',
            color: 'var(--ink-secondary)',
          }}
        >
          Effects
          {on && (
            <span className="text-[var(--accent)]">
              {PRESET_LIST.find((p) => p.id === look)?.label ?? 'Custom'}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[80] w-[19rem] rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] p-3 shadow-[0_18px_50px_oklch(20%_0.012_85/0.18)]"
        >
          <p className="label mb-2" id="fx-room">
            The room
          </p>
          <div role="group" aria-labelledby="fx-room" className="mb-1 grid grid-cols-5 gap-1">
            {PRESET_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                aria-pressed={look === p.id}
                title={p.hint}
                className="rounded-[var(--radius-sm)] border px-1 py-1.5 text-[0.68rem] transition-colors"
                style={{
                  borderColor: look === p.id ? 'var(--accent)' : 'var(--rule-hairline)',
                  background: look === p.id ? 'var(--accent-subtle)' : 'transparent',
                  color: look === p.id ? 'var(--accent)' : 'var(--ink-secondary)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mb-3 min-h-[2.1em] text-[0.68rem] leading-[1.5] text-[var(--ink-faint)]">
            {look === 'custom'
              ? 'Yours. Move a dial back onto one of ours and it takes that name again.'
              : (PRESET_LIST.find((p) => p.id === look)?.hint ?? '')}
          </p>

          <div className="space-y-2">
            {DIALS.map((dial) => (
              <label key={dial.key} className="flex items-center gap-2" title={dial.hint}>
                <span className="w-[5.6rem] shrink-0 text-2xs text-[var(--ink-secondary)]">
                  {dial.label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={2}
                  value={Math.round((fx[dial.key] as number) * 100)}
                  onChange={(e) => setDial(dial.key, Number(e.target.value) / 100)}
                  className="fx-range"
                />
                <span className="numeral w-7 shrink-0 text-right text-2xs tabular-nums text-[var(--ink-faint)]">
                  {Math.round((fx[dial.key] as number) * 100)}
                </span>
              </label>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 border-t border-[var(--rule-hairline)] pt-3">
            <input
              type="checkbox"
              checked={fx.reveal}
              onChange={(e) => setDial('reveal', e.target.checked)}
            />
            <span className="text-2xs text-[var(--ink-secondary)]">
              Things arrive rather than appear
            </span>
          </label>
          <p className="mt-1 text-[0.68rem] leading-[1.5] text-[var(--ink-faint)]">
            Drawings draw themselves on when their slide comes up, and a card that waits for a click
            arrives instead of blinking into place. Anyone who has asked their machine for less
            motion gets none of it.
          </p>

          <Popover.Arrow className="fill-[var(--surface-raised)]" />
          <style>{`
            .fx-range{flex:1;min-width:0;height:2px;appearance:none;background:var(--rule-hairline);
              border-radius:2px;outline:none;cursor:pointer}
            .fx-range::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;
              background:var(--accent);border:none;cursor:pointer}
            .fx-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;
              background:var(--accent);border:none;cursor:pointer}
          `}</style>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

import type { ReactNode } from 'react';
import { useApp } from '@/state/store';
import { Button } from '@/ui/Button';
import { cameraFor, cardsInStop, stopAround, topZ } from './board';
import { stopForSelection } from './BoardSurface';
import { useBoardUi } from './boardStore';
import { makeStop } from './board';
import { revealFor, toneColors } from './paint';
import { newId } from '@/core/id';
import type { Project } from '@/core/types';
import {
  REVEALS,
  TONES,
  type Board,
  type Card,
  type CardId,
  type CardAction,
  type Edge,
  type Reveal,
  type StopId,
  type Surface,
  type Tone,
} from './types';

/**
 * What the selected thing is, and what it does when someone is watching.
 *
 * The interactive part of a talk lives here: a card can wait for a click, and
 * a click on a card can send the camera somewhere else. Both are one control
 * each, because a presentation whose behaviour needs a manual is a presentation
 * nobody will finish building.
 */

export function BoardInspector() {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const focusSource = useApp((s) => s.focusSource);
  const selection = useBoardUi((s) => s.selection);
  const selectedStopId = useBoardUi((s) => s.selectedStopId);
  const viewport = useBoardUi((s) => s.viewport);

  const board = project?.board;
  if (!board) return null;

  const cards = board.cards.filter((c) => selection.includes(c.id));
  const one = cards.length === 1 ? cards[0] : null;
  const stop = board.stops.find((s) => s.id === selectedStopId) ?? null;

  const editCards = (label: string, recipe: (card: Card) => void, coalesceKey?: string) =>
    mutate(
      label,
      (d) => {
        for (const card of d.board.cards) if (selection.includes(card.id)) recipe(card);
      },
      coalesceKey,
    );

  const addStop = () => {
    const rect = stopForSelection(board, selection);
    const made = makeStop(board, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    made.rect = rect;
    mutate('Add stop', (d) => {
      d.board.stops.push({ ...made, title: `Stop ${d.board.stops.length + 1}` });
    });
    useBoardUi.getState().selectStop(made.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--surface-raised)]">
      {/* ---------- the run of the talk ---------- */}
      <section className="border-b border-[var(--rule-hairline)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="label">The run</p>
          <button
            type="button"
            onClick={addStop}
            className="text-2xs font-medium text-[var(--accent)]"
          >
            {selection.length ? 'Stop around selection' : 'Add stop'}
          </button>
        </div>

        {board.stops.length === 0 ? (
          <p className="text-2xs leading-[1.5] text-[var(--ink-faint)]">
            A stop is a place the camera goes. Draw one with the slide tool, or select a few cards
            and frame them here. The order of the stops is the order of the talk.
          </p>
        ) : (
          <ol className="space-y-1">
            {board.stops.map((s, i) => (
              <li key={s.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    useBoardUi.getState().selectStop(s.id);
                    useBoardUi.getState().flyTo(cameraFor(s.rect, viewport.w, viewport.h));
                  }}
                  className="flex min-w-0 flex-1 items-baseline gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 text-left transition-colors"
                  style={{
                    borderColor: s.id === selectedStopId ? 'var(--accent)' : 'var(--rule-hairline)',
                    background: s.id === selectedStopId ? 'var(--accent-subtle)' : 'transparent',
                  }}
                >
                  <span className="numeral shrink-0 text-2xs text-[var(--ink-faint)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink-primary)]">
                    {s.title}
                  </span>
                  <span className="numeral shrink-0 text-2xs text-[var(--ink-faint)]">
                    {cardsInStop(board, s).length}
                  </span>
                </button>
                <Move
                  disabled={i === 0}
                  label="Earlier"
                  onClick={() => reorder(mutate, s.id, -1)}
                  glyph="↑"
                />
                <Move
                  disabled={i === board.stops.length - 1}
                  label="Later"
                  onClick={() => reorder(mutate, s.id, 1)}
                  glyph="↓"
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---------- the selected stop ---------- */}
      {stop && (
        <section className="space-y-3 border-b border-[var(--rule-hairline)] p-3">
          <p className="label">Stop</p>
          <Field label="Title">
            <input
              value={stop.title}
              onChange={(e) =>
                mutate(
                  'Rename stop',
                  (d) => {
                    const target = d.board.stops.find((s) => s.id === stop.id);
                    if (target) target.title = e.target.value;
                  },
                  `stop-title:${stop.id}`,
                )
              }
              className="input"
            />
          </Field>
          <Field label="Speaker notes">
            <textarea
              value={stop.notes}
              rows={3}
              placeholder="Only you see these."
              onChange={(e) =>
                mutate(
                  'Edit notes',
                  (d) => {
                    const target = d.board.stops.find((s) => s.id === stop.id);
                    if (target) target.notes = e.target.value;
                  },
                  `stop-notes:${stop.id}`,
                )
              }
              className="input resize-none"
            />
          </Field>
          <Field label="Move on by itself after">
            <select
              value={stop.autoAdvanceMs}
              onChange={(e) =>
                mutate('Change timing', (d) => {
                  const target = d.board.stops.find((s) => s.id === stop.id);
                  if (target) target.autoAdvanceMs = Number(e.target.value);
                })
              }
              className="input"
            >
              <option value={0}>Wait for me</option>
              <option value={4000}>4 seconds</option>
              <option value={8000}>8 seconds</option>
              <option value={15000}>15 seconds</option>
              <option value={30000}>30 seconds</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                mutate('Refit stop', (d) => {
                  const target = d.board.stops.find((s) => s.id === stop.id);
                  if (!target) return;
                  const inside = cardsInStop(d.board, target).map((c) => c.rect);
                  if (inside.length) target.rect = stopAround(d.board, inside);
                })
              }
            >
              Refit to contents
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                mutate('Delete stop', (d) => {
                  d.board.stops = d.board.stops.filter((s) => s.id !== stop.id);
                });
                useBoardUi.getState().selectStop(null);
              }}
            >
              Delete
            </Button>
          </div>
        </section>
      )}

      {/* ---------- the selected cards ---------- */}
      {cards.length > 0 && (
        <section className="space-y-3 p-3">
          <p className="label">
            {cards.length === 1 ? KIND_LABEL[cards[0].kind] : `${cards.length} selected`}
          </p>

          <Field label="Colour" group>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((tone) => (
                <ToneSwatch
                  key={tone}
                  tone={tone}
                  surface={board.surface}
                  active={cards.every((c) => c.tone === tone)}
                  onClick={() =>
                    editCards('Recolour', (card) => {
                      card.tone = tone;
                    })
                  }
                />
              ))}
            </div>
          </Field>

          {one?.kind === 'text' && (
            <>
              <Field label="Role">
                <select
                  value={one.role}
                  onChange={(e) =>
                    editCards('Change role', (card) => {
                      if (card.kind === 'text') card.role = e.target.value as typeof card.role;
                    })
                  }
                  className="input"
                >
                  <option value="title">Title</option>
                  <option value="heading">Heading</option>
                  <option value="body">Body</option>
                  <option value="quote">Quote</option>
                  <option value="label">Label</option>
                  <option value="mono">Mono</option>
                </select>
              </Field>
              <Field label="Align">
                <select
                  value={one.align}
                  onChange={(e) =>
                    editCards('Align', (card) => {
                      if (card.kind === 'text') card.align = e.target.value as typeof card.align;
                    })
                  }
                  className="input"
                >
                  <option value="start">Left</option>
                  <option value="center">Centre</option>
                  <option value="end">Right</option>
                </select>
              </Field>
            </>
          )}

          {one?.kind === 'image' && (
            <Field label="Fit">
              <select
                value={one.fit}
                onChange={(e) =>
                  editCards('Change fit', (card) => {
                    if (card.kind === 'image') card.fit = e.target.value as typeof card.fit;
                  })
                }
                className="input"
              >
                <option value="contain">Show all of it</option>
                <option value="cover">Fill the card</option>
              </select>
            </Field>
          )}

          {one?.kind === 'shape' && (
            <Field label="Shape">
              <select
                value={one.shape}
                onChange={(e) =>
                  editCards('Change shape', (card) => {
                    if (card.kind === 'shape') card.shape = e.target.value as typeof card.shape;
                  })
                }
                className="input"
              >
                <option value="rect">Rectangle</option>
                <option value="ellipse">Ellipse</option>
                <option value="diamond">Diamond</option>
              </select>
            </Field>
          )}

          <Field label="Arrives">
            <select
              value={one ? one.step : 0}
              onChange={(e) =>
                editCards('Change reveal', (card) => {
                  card.step = Number(e.target.value);
                })
              }
              className="input"
            >
              <option value={0}>With the stop</option>
              <option value={1}>On click 1</option>
              <option value={2}>On click 2</option>
              <option value={3}>On click 3</option>
              <option value={4}>On click 4</option>
              <option value={5}>On click 5</option>
            </select>
          </Field>

          <Field label="Arrives as">
            <select
              value={one?.reveal ?? 'auto'}
              onChange={(e) =>
                editCards('Change the arrival', (card) => {
                  card.reveal = e.target.value as Reveal;
                })
              }
              className="input capitalize"
            >
              {REVEALS.map((r) => (
                <option key={r} value={r}>
                  {r === 'auto'
                    ? `Suits the card${one ? ` — ${REVEAL_WORDS[revealFor(one)]}` : ''}`
                    : REVEAL_WORDS[r]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Clicking it">
            <select
              value={actionValue(one?.action ?? null)}
              onChange={(e) => {
                const value = e.target.value;
                editCards('Change behaviour', (card) => {
                  card.action = parseAction(value);
                });
              }}
              className="input"
            >
              <option value="none">Does nothing</option>
              <option value="zoom">Zooms in on it</option>
              {board.stops.map((s, i) => (
                <option key={s.id} value={`stop:${s.id}`}>
                  Jumps to {i + 1}. {s.title}
                </option>
              ))}
              <option value="link">Opens a web address…</option>
            </select>
          </Field>

          {one?.action?.kind === 'link' && (
            <Field label="Address">
              <input
                value={one.action.href}
                placeholder="https://"
                onChange={(e) =>
                  editCards(
                    'Change address',
                    (card) => {
                      if (card.action?.kind === 'link') card.action.href = e.target.value;
                    },
                    `href:${one.id}`,
                  )
                }
                className="input"
              />
            </Field>
          )}

          <Field label="Speaker note">
            <textarea
              value={one?.note ?? ''}
              rows={2}
              onChange={(e) =>
                editCards(
                  'Edit note',
                  (card) => {
                    card.note = e.target.value;
                  },
                  `note:${one?.id}`,
                )
              }
              className="input resize-none"
            />
          </Field>

          {one && one.source && (
            <button
              type="button"
              onClick={() => focusSource(one.source, 'layer')}
              className="numeral text-2xs text-[var(--accent)]"
            >
              From page {one.source.page} — show me →
            </button>
          )}

          {cards.length === 2 && (
            <Field label="Between the two" group>
              <div className="flex flex-wrap gap-1.5">
                <Small
                  onClick={() =>
                    mutate('Connect', (d) => {
                      const [a, b] = selection;
                      const existing = d.board.edges.find(
                        (e) =>
                          (e.from === a && e.to === b) || (e.from === b && e.to === a),
                      );
                      if (existing) {
                        d.board.edges = d.board.edges.filter((e) => e.id !== existing.id);
                        return;
                      }
                      d.board.edges.push({
                        id: newId('edge'),
                        from: a,
                        to: b,
                        label: '',
                        arrow: true,
                        dashed: false,
                      });
                    })
                  }
                >
                  {connected(board, selection) ? 'Unlink' : 'Draw an arrow'}
                </Small>
                {connected(board, selection) && (
                  <Small
                    onClick={() =>
                      mutate('Change the line', (d) => {
                        for (const e of d.board.edges) {
                          if (linksThese(e, selection)) e.dashed = !e.dashed;
                        }
                      })
                    }
                  >
                    Dashed
                  </Small>
                )}
              </div>
            </Field>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Small
              onClick={() =>
                mutate('Bring to front', (d) => {
                  let z = topZ(d.board);
                  for (const card of d.board.cards) if (selection.includes(card.id)) card.z = z++;
                })
              }
            >
              Front
            </Small>
            <Small
              onClick={() =>
                mutate('Send to back', (d) => {
                  const low = Math.min(...d.board.cards.map((c) => c.z), 0);
                  let z = low - selection.length;
                  for (const card of d.board.cards) if (selection.includes(card.id)) card.z = z++;
                })
              }
            >
              Back
            </Small>
            <Small
              onClick={() =>
                editCards('Lift', (card) => {
                  card.raised = !card.raised;
                })
              }
            >
              {one?.raised ? 'Lay flat' : 'Lift'}
            </Small>
            <Small
              onClick={() =>
                editCards('Lock', (card) => {
                  card.locked = !card.locked;
                })
              }
            >
              {cards.every((c) => c.locked) ? 'Unlock' : 'Lock'}
            </Small>
            <Small
              onClick={() => {
                mutate('Delete', (d) => {
                  d.board.cards = d.board.cards.filter((c) => !selection.includes(c.id));
                });
                useBoardUi.getState().select([]);
              }}
            >
              Delete
            </Small>
          </div>
        </section>
      )}

      {cards.length === 0 && !stop && (
        <section className="p-3">
          <p className="text-2xs leading-[1.6] text-[var(--ink-faint)]">
            Nothing selected. Drop something from the paper, type with <b>T</b>, leave a note with{' '}
            <b>N</b>, draw with <b>P</b>, and frame a slide with <b>F</b>. Scroll to pan, ⌘-scroll to
            zoom, ⌘0 to see it all.
          </p>
        </section>
      )}

      <style>{`
        .input{width:100%;height:2rem;border-radius:var(--radius-sm);border:1px solid var(--rule-hairline);
          background:var(--surface-page);padding:0 .5rem;font-size:.82rem;color:var(--ink-primary);outline:none}
        textarea.input{height:auto;padding:.4rem .5rem;line-height:1.45}
        .input:focus{border-color:var(--accent)}
      `}</style>
    </div>
  );
}

/* ============================================================================
   Pieces
   ========================================================================== */

function linksThese(edge: Edge, pair: CardId[]): boolean {
  return (
    (edge.from === pair[0] && edge.to === pair[1]) ||
    (edge.from === pair[1] && edge.to === pair[0])
  );
}

function connected(board: Board, pair: CardId[]): boolean {
  return pair.length === 2 && board.edges.some((e) => linksThese(e, pair));
}

const KIND_LABEL: Record<Card['kind'], string> = {
  text: 'Text',
  sticky: 'Note',
  image: 'Figure',
  table: 'Table',
  stat: 'Number',
  shape: 'Shape',
  ink: 'Drawing',
};

function actionValue(action: CardAction | null): string {
  if (!action) return 'none';
  if (action.kind === 'stop') return `stop:${action.stopId}`;
  if (action.kind === 'link') return 'link';
  if (action.kind === 'zoom') return 'zoom';
  return 'none';
}

function parseAction(value: string): CardAction | null {
  if (value === 'none') return null;
  if (value === 'zoom') return { kind: 'zoom' };
  if (value === 'link') return { kind: 'link', href: '' };
  if (value.startsWith('stop:')) return { kind: 'stop', stopId: value.slice(5) as StopId };
  return null;
}

function reorder(
  mutate: (label: string, recipe: (d: Project) => void) => void,
  id: StopId,
  delta: number,
): void {
  mutate('Reorder stops', (d) => {
    const stops = d.board.stops;
    const i = stops.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= stops.length) return;
    const [moved] = stops.splice(i, 1);
    stops.splice(j, 0, moved);
  });
}

/**
 * A labelled control. `group` is for the fields whose control is a row of
 * buttons rather than one input — wrapping those in a <label> would hand every
 * button the whole field's name and send a click on the caption to the first
 * one of them.
 */
function Field({
  label,
  children,
  group,
}: {
  label: string;
  children: ReactNode;
  group?: boolean;
}) {
  if (group) {
    return (
      <div role="group" aria-label={label}>
        <span className="label mb-1 block">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Small({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] px-2 py-1 text-2xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--ink-faint)] hover:text-[var(--ink-primary)]"
    >
      {children}
    </button>
  );
}

function Move({
  glyph,
  label,
  disabled,
  onClick,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-5 shrink-0 items-center justify-center rounded-[2px] text-2xs text-[var(--ink-faint)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-primary)] disabled:opacity-25"
    >
      {glyph}
    </button>
  );
}

/** What each arrival is called where somebody has to pick one. */
const REVEAL_WORDS: Record<string, string> = {
  auto: 'Suits the card',
  fade: 'Fades in',
  rise: 'Rises',
  pop: 'Pops',
  zoom: 'Focuses',
  blur: 'Sharpens',
  wipe: 'Wipes across',
  cascade: 'Word by word',
  flip: 'Tips up',
  drop: 'Drops in',
  draw: 'Draws itself',
};

function ToneSwatch({
  tone,
  surface,
  active,
  onClick,
}: {
  tone: Tone;
  surface: Surface;
  active: boolean;
  onClick: () => void;
}) {
  const c = toneColors(tone, surface);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={tone}
      className="h-6 w-6 rounded-[3px] transition-transform"
      style={{
        background: c.fill === 'transparent' ? 'var(--surface-page)' : c.fill,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--rule-hairline)'}`,
        boxShadow: active ? '0 0 0 2px var(--accent-quiet)' : 'none',
        backgroundImage:
          c.fill === 'transparent'
            ? 'linear-gradient(135deg, transparent 46%, var(--ink-faint) 46%, var(--ink-faint) 54%, transparent 54%)'
            : undefined,
      }}
    />
  );
}

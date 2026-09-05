import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '@/state/store';
import type { Figure, PaperTable, Sentence, Statistic } from '@/core/types';
import { CARD_SIZE, figureCard, placeNear, statCard, tableCard, textCard, topZ, viewportRect } from './board';
import { useBoardUi } from './boardStore';
import type { Card, WorldPoint } from './types';

/**
 * The paper, as things you can put on the board.
 *
 * Nothing here composes a talk for you. It is a shelf: the figures, the tables,
 * the numbers and the sentences the paper actually contains, each one landing
 * on the board with the page it came from still attached — so a card can always
 * answer the only question that matters about it, which is "says who?".
 */

type Tab = 'figures' | 'tables' | 'numbers' | 'text';

export function PaperDrawer() {
  const project = useApp((s) => s.project);
  const mutate = useApp((s) => s.mutate);
  const focusSource = useApp((s) => s.focusSource);
  const showToast = useApp((s) => s.showToast);
  const [tab, setTab] = useState<Tab>('figures');
  const [query, setQuery] = useState('');

  const paper = project?.paper;

  const sentences = useMemo(() => {
    if (!paper) return [];
    const all: Sentence[] = [];
    for (const section of paper.sections) {
      if (section.kind === 'references') continue;
      for (const p of section.paragraphs) all.push(...p.sentences);
    }
    return all.sort((a, b) => b.salience - a.salience).slice(0, 220);
  }, [paper]);

  if (!project || !paper) return null;

  /** Drop a card where you are looking, not where the board's origin is. */
  const dropPoint = (): WorldPoint => {
    const { camera, viewport } = useBoardUi.getState();
    const seen = viewportRect(camera, viewport.w || 1200, viewport.h || 800);
    return { x: seen.x + seen.w / 2, y: seen.y + seen.h * 0.45 };
  };

  const place = (
    make: (at: WorldPoint, z: number) => Card,
    label: string,
    size = CARD_SIZE.image,
  ) => {
    let id = '';
    mutate(`Add ${label}`, (d) => {
      const at = placeNear(d.board, dropPoint(), size);
      const card = make(at, topZ(d.board));
      id = card.id;
      d.board.cards.push(card);
    });
    if (id) useBoardUi.getState().select([id as Card['id']]);
    showToast(`${label} added to the board`);
  };

  const filter = (text: string) =>
    !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-raised)]">
      <div className="flex shrink-0 border-b border-[var(--rule-hairline)]">
        {(
          [
            ['figures', `Figures ${paper.figures.length}`],
            ['tables', `Tables ${paper.tables.length}`],
            ['numbers', `Numbers ${paper.statistics.length}`],
            ['text', 'Text'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-selected={tab === key}
            role="tab"
            className="flex-1 py-2 text-2xs transition-colors"
            style={{
              color: tab === key ? 'var(--ink-primary)' : 'var(--ink-faint)',
              boxShadow: tab === key ? 'inset 0 -2px 0 0 var(--accent)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="shrink-0 border-b border-[var(--rule-hairline)] p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the paper"
          className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-page)] px-2.5 text-xs text-[var(--ink-primary)] outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'figures' && (
          <ul className="space-y-2">
            {paper.figures.filter((f) => filter(`${f.label} ${f.caption ?? ''}`)).map((f) => (
              <FigureRow
                key={f.id}
                figure={f}
                onAdd={() => place((at, z) => figureCard(f, at, z), f.label)}
                onPeek={() => focusSource(f.ref, 'hover')}
              />
            ))}
            {paper.figures.length === 0 && <Empty>This paper has no figures we could crop.</Empty>}
          </ul>
        )}

        {tab === 'tables' && (
          <ul className="space-y-2">
            {paper.tables.filter((t) => filter(`${t.label} ${t.caption ?? ''}`)).map((t) => (
              <TableRow
                key={t.id}
                table={t}
                onAdd={() => place((at, z) => tableCard(t, at, z), t.label, CARD_SIZE.table)}
                onPeek={() => focusSource(t.ref, 'hover')}
              />
            ))}
            {paper.tables.length === 0 && <Empty>No tables were found.</Empty>}
          </ul>
        )}

        {tab === 'numbers' && (
          <ul className="space-y-1.5">
            {paper.statistics.filter((s) => filter(`${s.raw} ${s.ref.text}`)).slice(0, 200).map((s) => (
              <StatRow
                key={s.id}
                stat={s}
                onAdd={() => place((at, z) => statCard(s, at, z), s.raw, CARD_SIZE.stat)}
                onPeek={() => focusSource(s.ref, 'hover')}
              />
            ))}
            {paper.statistics.length === 0 && <Empty>No numbers were extracted.</Empty>}
          </ul>
        )}

        {tab === 'text' && (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Chip
                onClick={() =>
                  place(
                    (at, z) =>
                      textCard(
                        paper.meta.title ?? project.title,
                        'title',
                        { x: at.x - 700, y: at.y - 120, w: 1400, h: 240 },
                        z,
                      ),
                    'the title',
                  )
                }
              >
                Title
              </Chip>
              {paper.meta.authors.length > 0 && (
                <Chip
                  onClick={() =>
                    place(
                      (at, z) =>
                        textCard(
                          paper.meta.authors.map((a) => a.name).join(' · '),
                          'label',
                          { x: at.x - 500, y: at.y - 40, w: 1000, h: 80 },
                          z,
                        ),
                      'the authors',
                      { w: 1000, h: 80 },
                    )
                  }
                >
                  Authors
                </Chip>
              )}
              {paper.comprehension.question && (
                <Chip
                  onClick={() =>
                    place(
                      (at, z) =>
                        textCard(
                          paper.comprehension.question!.value,
                          'heading',
                          { x: at.x - 500, y: at.y - 130, w: 1000, h: 260 },
                          z,
                          paper.comprehension.question!.refs[0] ?? null,
                        ),
                      'the question',
                      { w: 1000, h: 260 },
                    )
                  }
                >
                  The question
                </Chip>
              )}
              {paper.comprehension.findings.slice(0, 4).map((f, i) => (
                <Chip
                  key={i}
                  onClick={() =>
                    place(
                      (at, z) =>
                        textCard(
                          f.value,
                          'heading',
                          { x: at.x - 500, y: at.y - 130, w: 1000, h: 260 },
                          z,
                          f.refs[0] ?? null,
                        ),
                      'a finding',
                      { w: 1000, h: 260 },
                    )
                  }
                >
                  Finding {i + 1}
                </Chip>
              ))}
            </div>

            <ul className="space-y-1.5">
              {sentences.filter((s) => filter(s.text)).slice(0, 120).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseEnter={() => focusSource(s.ref, 'hover')}
                    onClick={() =>
                      place(
                        (at, z) =>
                          textCard(
                            s.text,
                            s.text.length > 180 ? 'body' : 'heading',
                            { x: at.x - 500, y: at.y - 120, w: 1000, h: 240 },
                            z,
                            s.ref,
                          ),
                        'a sentence',
                        { w: 1000, h: 240 },
                      )
                    }
                    className="w-full rounded-[var(--radius-sm)] border border-transparent p-2 text-left text-xs leading-[1.5] text-[var(--ink-secondary)] transition-colors hover:border-[var(--rule-hairline)] hover:bg-[var(--surface-page)]"
                  >
                    <span className="numeral mr-1.5 text-2xs text-[var(--ink-faint)]">
                      p.{s.ref.page}
                    </span>
                    {s.text.length > 190 ? `${s.text.slice(0, 190)}…` : s.text}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function FigureRow({
  figure,
  onAdd,
  onPeek,
}: {
  figure: Figure;
  onAdd: () => void;
  onPeek: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        onMouseEnter={onPeek}
        className="w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] text-left transition-colors hover:border-[var(--accent)]"
      >
        {figure.image ? (
          <img
            src={figure.image}
            alt=""
            className="h-24 w-full bg-white object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex h-24 items-center justify-center bg-[var(--surface-sunken)] text-2xs text-[var(--ink-faint)]">
            no crop
          </div>
        )}
        <span className="block p-2">
          <span className="block text-2xs font-medium text-[var(--ink-primary)]">
            {figure.label} · <span className="numeral">p.{figure.page}</span>
          </span>
          {figure.caption && (
            <span className="mt-0.5 block truncate text-2xs text-[var(--ink-faint)]">
              {figure.caption}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function TableRow({
  table,
  onAdd,
  onPeek,
}: {
  table: PaperTable;
  onAdd: () => void;
  onPeek: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        onMouseEnter={onPeek}
        className="w-full rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] p-2 text-left transition-colors hover:border-[var(--accent)]"
      >
        <span className="block text-2xs font-medium text-[var(--ink-primary)]">
          {table.label} · <span className="numeral">p.{table.page}</span>
        </span>
        <span className="mt-0.5 block text-2xs text-[var(--ink-faint)]">
          {table.grid ? `${table.grid.cells.length} rows` : 'image only'}
          {table.caption ? ` · ${table.caption.slice(0, 60)}` : ''}
        </span>
      </button>
    </li>
  );
}

function StatRow({ stat, onAdd, onPeek }: { stat: Statistic; onAdd: () => void; onPeek: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        onMouseEnter={onPeek}
        className="flex w-full items-baseline gap-2 rounded-[var(--radius-sm)] border border-transparent p-1.5 text-left transition-colors hover:border-[var(--rule-hairline)] hover:bg-[var(--surface-page)]"
      >
        <span className="numeral shrink-0 text-xs font-medium text-[var(--ink-primary)]">
          {stat.raw}
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-[var(--ink-faint)]">
          {stat.ref.text}
        </span>
      </button>
    </li>
  );
}

function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] px-2.5 py-1 text-2xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink-primary)]"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-2xs leading-[1.5] text-[var(--ink-faint)]">{children}</p>;
}

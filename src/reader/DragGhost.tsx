import { createPortal } from 'react-dom';
import { useApp } from '@/state/store';
import { ScenePreview } from '@/render/ScenePreview';
import { INSTRUMENT_BY_ID } from './instruments';
import { useApply } from './apply';
import { useReader } from './readerStore';
import { registerGhost } from './useDragEngine';
import { Glyph } from './glyphs';
import { clip } from './pageText';

/**
 * What you are carrying, and what it would make.
 *
 * The preview is the real scene the drop would insert, drawn by the same
 * renderer the canvas and the exporter use. It cannot promise something the
 * drop would not deliver, because it *is* the drop, evaluated early.
 */

export function DragGhost() {
  const drag = useReader((s) => s.drag);
  const project = useApp((s) => s.project);
  const { preview } = useApply();

  if (!drag || !drag.live || !project) return null;

  const instrument = drag.instrumentId ? INSTRUMENT_BY_ID.get(drag.instrumentId) : null;
  const target = drag.target;
  const targetPassage = target.kind === 'passage' ? target.passage : null;
  const plan = instrument ? preview(instrument, targetPassage) : null;

  const carryingPassage = !!drag.passage;
  const overTool = target.kind === 'instrument' ? INSTRUMENT_BY_ID.get(target.id) : null;
  const passagePlan = carryingPassage && overTool ? preview(overTool, drag.passage) : null;

  const shown = plan ?? passagePlan;
  const glyphId = overTool?.id ?? instrument?.id ?? null;

  // Dropping into the storyboard is not an instrument, so it says what it does.
  const overScene =
    target.kind === 'scene' ? project.scenes.find((s) => s.id === target.id) : null;
  const title = overScene
    ? `Add to “${clip(overScene.title, 24)}”`
    : target.kind === 'gap'
      ? `Insert as scene ${target.index + 1}`
      : (overTool?.label ?? instrument?.label ?? 'Passage');

  return createPortal(
    <div
      ref={registerGhost}
      data-ghost=""
      className="pointer-events-none fixed left-0 top-0 z-[90]"
      style={{ willChange: 'transform' }}
      aria-hidden="true"
    >
      <div className="-translate-x-1/2 -translate-y-[calc(100%+16px)] motion-safe:animate-[ghost-in_140ms_var(--ease-out)]">
        <div
          className="w-[15rem] overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface-raised)]"
          style={{
            borderColor:
              shown || overScene || target.kind === 'gap' ? 'var(--accent)' : 'var(--rule-strong)',
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          {shown?.preview ? (
            <ScenePreview
              scene={shown.preview}
              styleId={project.style}
              aspect={project.settings.aspect}
              className="border-b border-[var(--rule-hairline)]"
            />
          ) : null}

          <div className="flex items-center gap-1.5 px-2 py-1.5">
            {glyphId && !overScene && target.kind !== 'gap' && (
              <span style={{ color: shown ? 'var(--accent)' : 'var(--ink-faint)' }}>
                <Glyph id={glyphId} size={13} />
              </span>
            )}
            <span className="truncate text-2xs font-medium text-[var(--ink-primary)]">
              {shown && !overScene && target.kind !== 'gap' ? shown.toast : title}
            </span>
          </div>

          {!shown && (targetPassage || drag.passage) && (
            <p className="border-t border-[var(--rule-hairline)] px-2 py-1.5 text-[10px] leading-[1.4] text-[var(--ink-tertiary)]">
              {clip((targetPassage ?? drag.passage)!.text, 90)}
            </p>
          )}

          {!shown && !targetPassage && !drag.passage && (
            <p className="border-t border-[var(--rule-hairline)] px-2 py-1.5 text-[10px] text-[var(--ink-faint)]">
              {carryingPassage ? 'Drop on a tool or the storyboard' : 'Drop on a sentence'}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Page, SourceRef } from '@/core/types';
import type { PaperSession } from '@/extract/pdf';

/**
 * A real rendered page with the source quads drawn on it. Pages beyond the eager
 * window are rasterised only when they come into view, so a 400-page paper does
 * not try to live in memory at once.
 */

export function PageView({
  page,
  session,
  marks,
  focus,
  hovered,
  query,
}: {
  page: Page;
  session: PaperSession | null;
  marks: SourceRef[];
  focus: SourceRef | null;
  hovered: SourceRef | null;
  query: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(page.raster);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || src || !session) return;
    let alive = true;
    void session.raster(page.number).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [visible, src, session, page.number]);

  const q = query.trim().toLowerCase();
  const searchHits = q
    ? page.items.filter((i) => i.text.toLowerCase().includes(q)).map((i) => i.quad)
    : [];

  return (
    <div ref={host} data-page={page.number} className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="label">Page {page.number}</span>
        {marks.length > 0 && (
          <span className="text-2xs text-[var(--ev-extracted)]">
            {marks.length} used
          </span>
        )}
      </div>
      <div
        className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-white"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {src ? (
          <img
            src={src}
            alt={`Page ${page.number}`}
            className="h-full w-full object-contain"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-[var(--surface-sunken)]" />
        )}

        {/* quads that scenes are using */}
        {marks.flatMap((ref, i) =>
          ref.quads.map((quad, j) => (
            <span
              key={`${i}-${j}`}
              className="pointer-events-none absolute"
              style={{
                left: `${quad.x * 100}%`,
                top: `${quad.y * 100}%`,
                width: `${quad.w * 100}%`,
                height: `${quad.h * 100}%`,
                background: 'color-mix(in oklch, var(--ev-extracted) 22%, transparent)',
                borderBottom: '1.5px solid var(--ev-extracted)',
              }}
            />
          )),
        )}

        {/* the quad currently being pointed at, from a claim in the canvas */}
        {hovered?.quads.map((quad, j) => (
          <span
            key={`h-${j}`}
            className="pointer-events-none absolute"
            style={{
              left: `${quad.x * 100}%`,
              top: `${quad.y * 100}%`,
              width: `${quad.w * 100}%`,
              height: `${quad.h * 100}%`,
              background: 'color-mix(in oklch, var(--accent) 26%, transparent)',
              outline: '1px solid var(--accent)',
            }}
          />
        ))}

        {/* the quad being proved right now — flashes twice, then stops asking for attention */}
        {focus?.quads.map((quad, j) => (
          <span
            key={`f-${j}`}
            className="pointer-events-none absolute motion-safe:animate-[quad-flash_1.3s_var(--ease-out)]"
            style={{
              left: `${quad.x * 100}%`,
              top: `${quad.y * 100}%`,
              width: `${quad.w * 100}%`,
              height: `${quad.h * 100}%`,
              background: 'var(--hl-yellow)',
              mixBlendMode: 'multiply',
            }}
          />
        ))}

        {searchHits.map((quad, j) => (
          <span
            key={`s-${j}`}
            className="pointer-events-none absolute"
            style={{
              left: `${quad.x * 100}%`,
              top: `${quad.y * 100}%`,
              width: `${quad.w * 100}%`,
              height: `${quad.h * 100}%`,
              background: 'color-mix(in oklch, var(--hl-sky) 60%, transparent)',
              mixBlendMode: 'multiply',
            }}
          />
        ))}

        <style>{`@keyframes quad-flash{0%{opacity:0}12%{opacity:0.9}34%{opacity:0.25}52%{opacity:0.9}100%{opacity:0.32}}`}</style>
      </div>
    </div>
  );
}

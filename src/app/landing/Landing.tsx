import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { HeroTransformation } from './HeroTransformation';
import { Dropzone } from './Dropzone';
import { HighlightDemo, DragDemo, ProveDemo } from './Demos';
import { useApp } from '@/state/store';
import { PROVENANCE_META } from '@/core/types';

gsap.registerPlugin(ScrollTrigger);

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
}

export function Landing({ onFile, onSample }: Props) {
  const reducedMotion = useApp((s) => s.reducedMotion);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current || reducedMotion) return;
    const ctx = gsap.context(() => {
      // Copy arrives with the transformation, not before it.
      gsap.from('[data-hero-line]', {
        y: 26,
        opacity: 0,
        duration: 0.9,
        stagger: 0.09,
        ease: 'power3.out',
        delay: 0.1,
      });
      gsap.from('[data-hero-tail]', {
        y: 14,
        opacity: 0,
        duration: 0.7,
        stagger: 0.07,
        ease: 'power3.out',
        delay: 0.5,
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          y: 22,
          opacity: 0,
          duration: 0.75,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 84%', once: true },
        });
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal-group]').forEach((group) => {
        gsap.from(group.querySelectorAll('[data-reveal-item]'), {
          y: 18,
          opacity: 0,
          duration: 0.65,
          stagger: 0.08,
          ease: 'power3.out',
          scrollTrigger: { trigger: group, start: 'top 82%', once: true },
        });
      });
    }, root);
    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <div ref={root} className="grain relative min-h-dvh">
      <SiteHeader />

      <main id="main">
        {/* ================= HERO ================= */}
        <section className="mx-auto w-full max-w-[88rem] px-[max(1.25rem,4vw)] pb-[clamp(2.5rem,6vw,5rem)] pt-[clamp(2.5rem,5vw,4.5rem)]">
          <div className="grid items-center gap-[clamp(2rem,4vw,4rem)] lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
            <div>
              <p data-hero-line className="label mb-4">
                Research → presentation
              </p>
              <h1 className="display-xl text-[var(--ink-primary)]">
                <span data-hero-line className="block">
                  Turn a paper into
                </span>
                <span data-hero-line className="block">
                  a presentation
                </span>
                <span data-hero-line className="block">
                  you can{' '}
                  <span className="marker marker-grow">prove</span>.
                </span>
              </h1>

              <p
                data-hero-tail
                className="mt-6 max-w-[40ch] text-base leading-[1.6] text-[var(--ink-secondary)]"
              >
                Paper Animator reads your PDF, pulls out its figures, statistics and
                findings, and builds an animated presentation where every claim traces back
                to the page it came from.
              </p>

              <div data-hero-tail className="mt-7">
                <Dropzone onFile={onFile} onSample={onSample} />
              </div>
            </div>

            <div className="relative">
              <HeroTransformation reducedMotion={reducedMotion} />
              <p className="mt-4 text-center text-2xs text-[var(--ink-faint)]">
                An illustration of the transformation — not a real paper.
              </p>
            </div>
          </div>
        </section>

        <Divider />

        {/* ================= THE IDEA ================= */}
        <section className="mx-auto w-full max-w-[86rem] px-[max(1.25rem,4vw)] py-[clamp(3.5rem,8vw,7rem)]">
          <div data-reveal className="max-w-[52rem]">
            <p className="label mb-5">The idea</p>
            <h2 className="display-md text-[var(--ink-primary)]">
              You make the presentation by touching the paper.
            </h2>
            <p className="mt-6 max-w-[54ch] text-lg leading-[1.6] text-[var(--ink-secondary)]">
              There is no blank canvas and no prompt box. You highlight a sentence and it
              becomes a scene. You drag a figure and it lands on the slide. You click a
              claim and the page it came from lights up.
            </p>
          </div>

          <div data-reveal-group className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--rule-hairline)] bg-[var(--rule-hairline)] md:grid-cols-3">
            <Interaction
              index="01"
              title="Highlight it"
              body="Select any sentence in the paper. It becomes a scene with its source already attached — you never do the bookkeeping."
              demo={<HighlightDemo />}
            />
            <Interaction
              index="02"
              title="Pull it out"
              body="Drag a figure, a table or a passage straight onto the canvas. Provenance travels with it, so nothing arrives unattributed."
              demo={<DragDemo />}
            />
            <Interaction
              index="03"
              title="Prove it"
              body="Click any claim and the source pane scrolls to the exact page and flashes the sentence. Click the source, and every scene using it lights up."
              demo={<ProveDemo />}
            />
          </div>
          <p className="mt-4 text-2xs text-[var(--ink-faint)]">
            All three are live — read the sentence aloud, drag the figure, pull the thread. The
            words and the number are illustrative; the mechanisms are the real ones.
          </p>
        </section>

        <Divider />

        {/* ================= INTEGRITY ================= */}
        <section className="mx-auto w-full max-w-[86rem] px-[max(1.25rem,4vw)] py-[clamp(3.5rem,8vw,7rem)]">
          <div className="grid items-start gap-[clamp(2.5rem,5vw,5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div data-reveal>
              <p className="label mb-5">Source integrity</p>
              <h2 className="display-md text-[var(--ink-primary)]">
                Accuracy is a feature, not a disclaimer.
              </h2>
              <p className="mt-6 max-w-[52ch] text-lg leading-[1.6] text-[var(--ink-secondary)]">
                Every piece of content on screen carries a label saying where it came from.
                Nothing is generated and quietly presented as fact — the composer selects
                sentences from your paper rather than writing new ones.
              </p>
              <p className="mt-4 max-w-[52ch] text-base leading-[1.65] text-[var(--ink-tertiary)]">
                A project-wide score tells you how much of your presentation is grounded,
                and what still needs a look, before you show it to anyone.
              </p>
            </div>

            <div data-reveal-group className="space-y-2">
              {(
                [
                  ['extracted', 'Recovery time fell by 31.4% in the treatment group.'],
                  ['paraphrase', 'Roughly a third faster recovery, on average.'],
                  ['explanation', 'That is about two days sooner than usual.'],
                  ['connective', 'And there is one more thing worth noting.'],
                  ['authored', 'My own framing for the department meeting.'],
                  ['unsupported', 'The effect is likely to hold in older adults.'],
                ] as const
              ).map(([kind, text]) => (
                <EvidenceRow key={kind} kind={kind} text={text} />
              ))}
              <p className="pt-3 text-xs text-[var(--ink-faint)]">
                The last one is amber, not red. It is unreviewed, not wrong — and it cannot
                be narrated as fact until you have looked at it.
              </p>
            </div>
          </div>
        </section>

        <Divider />

        {/* ================= EXPORTS ================= */}
        <section className="mx-auto w-full max-w-[86rem] px-[max(1.25rem,4vw)] py-[clamp(3.5rem,8vw,7rem)]">
          <div data-reveal className="max-w-[52rem]">
            <p className="label mb-5">Exports</p>
            <h2 className="display-md text-[var(--ink-primary)]">
              Real files, made in your browser.
            </h2>
            <p className="mt-6 max-w-[54ch] text-lg leading-[1.6] text-[var(--ink-secondary)]">
              Video, slides, images, captions, transcript, and an editable project file.
              Each one is produced from the same frame function that draws the preview, so
              what you export is what you watched.
            </p>
          </div>

          <div
            data-reveal-group
            className="mt-[clamp(2rem,4vw,3rem)] grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--rule-hairline)] bg-[var(--rule-hairline)] sm:grid-cols-2 lg:grid-cols-4"
          >
            {EXPORT_FORMATS.map((f) => (
              <div
                data-reveal-item
                key={f.name}
                className="bg-[var(--surface-page)] p-5 transition-colors duration-300 hover:bg-[var(--surface-raised)]"
              >
                <p className="numeral text-2xs uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                  {f.ext}
                </p>
                <p className="mt-1.5 text-base font-medium text-[var(--ink-primary)]">{f.name}</p>
                <p className="mt-1.5 text-xs leading-[1.55] text-[var(--ink-tertiary)]">{f.what}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 max-w-[62ch] text-2xs leading-[1.55] text-[var(--ink-faint)]">
            Narration is read by your browser's own speech engine, which cannot be captured into a
            video file, so the video is silent and carries captions. The captions, transcript and
            speaker notes contain every spoken line with the page it came from.
          </p>
        </section>

        <Divider />

        {/* ================= CLOSE ================= */}
        <section className="mx-auto w-full max-w-[86rem] px-[max(1.25rem,4vw)] py-[clamp(4rem,9vw,8rem)]">
          <div data-reveal className="mx-auto max-w-[44rem] text-center">
            <h2 className="display-lg text-[var(--ink-primary)]">Start with your paper.</h2>
            <p className="mx-auto mt-6 max-w-[46ch] text-lg leading-[1.6] text-[var(--ink-secondary)]">
              It is read on your own machine. Nothing is uploaded, nothing is stored, and
              nothing is used for training.
            </p>
            <div className="mt-10 flex justify-center">
              <Dropzone onFile={onFile} onSample={onSample} />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/* ============================================================================
   Chrome
   ========================================================================== */

function SiteHeader() {
  const toggleTheme = useApp((s) => s.toggleTheme);
  const theme = useApp((s) => s.theme);
  // Solid. Any translucency at all lets the display serif ghost through the
  // masthead as it scrolls under, which reads as a rendering fault rather than
  // as glass.
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--rule-hairline)] bg-[var(--surface-page)]">
      <div className="mx-auto flex h-14 w-full max-w-[86rem] items-center justify-between px-[max(1.25rem,4vw)]">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-base font-medium tracking-[-0.01em] text-[var(--ink-primary)]">
            Paper Animator
          </span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] px-2.5 text-2xs text-[var(--ink-tertiary)] transition-colors hover:border-[var(--rule-strong)] hover:text-[var(--ink-primary)]"
          aria-label={`Switch to ${theme === 'paper' ? 'the dark Press appearance' : 'the light Paper appearance'}`}
          title={theme === 'paper' ? 'Switch to Press (dark)' : 'Switch to Paper (light)'}
        >
          {/* A slug of the ground it switches to, so the control shows its
              own result rather than asking to be read. */}
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 rounded-[2px] border border-[var(--rule-strong)]"
            style={{ background: theme === 'paper' ? 'oklch(20% 0.012 85)' : 'oklch(97% 0.006 85)' }}
          />
          <span className="label" style={{ letterSpacing: '0.08em' }}>
            {theme === 'paper' ? 'Paper' : 'Press'}
          </span>
        </button>
      </div>
    </header>
  );
}

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="15" rx="1" stroke="var(--ink-primary)" strokeWidth="1.3" />
      <path d="M6 5.5h4M6 8.5h4M6 11.5h2.5" stroke="var(--ink-primary)" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
      <rect x="9" y="6.5" width="8.5" height="11" rx="1" fill="var(--surface-page)" stroke="var(--accent)" strokeWidth="1.3" />
      <path d="M11.5 11h3.5" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const EXPORT_FORMATS = [
  { ext: 'mp4', name: 'Video', what: 'The talk as you watched it, with the marker moving.' },
  { ext: 'zip', name: 'PNG slides', what: 'One image per scene, at the resolution you choose.' },
  { ext: 'pptx', name: 'PowerPoint', what: 'An editable deck. Speaker notes carry the sources.' },
  { ext: 'pdf', name: 'PDF', what: 'Searchable and readable aloud, with a source appendix.' },
  { ext: 'srt', name: 'SRT captions', what: 'For anything that takes a subtitle track.' },
  { ext: 'vtt', name: 'WebVTT', what: 'The same cues, for the web.' },
  { ext: 'txt', name: 'Transcript', what: 'Every line, timed, with the page it came from.' },
  { ext: 'paperanim', name: 'Project file', what: 'Reopen and keep editing. Your assets travel with it.' },
] as const;

function Divider() {
  return (
    <div className="mx-auto w-full max-w-[86rem] px-[max(1.25rem,4vw)]">
      <div className="h-px w-full bg-[var(--rule-hairline)]" />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--rule-hairline)]">
      <div className="mx-auto flex w-full max-w-[86rem] flex-col gap-4 px-[max(1.25rem,4vw)] py-8 text-xs text-[var(--ink-faint)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Mark size={16} />
          <span>Paper Animator</span>
        </div>
        <p className="max-w-[46ch]">
          Your paper is read in this browser tab. It is never uploaded, never stored, and
          never used for training.
        </p>
      </div>
    </footer>
  );
}

/* ============================================================================
   Interaction cards — small, honest demonstrations
   ========================================================================== */

function Interaction({
  index,
  title,
  body,
  demo,
}: {
  index: string;
  title: string;
  body: string;
  demo: React.ReactNode;
}) {
  return (
    <div
      data-reveal-item
      className="group flex flex-col bg-[var(--surface-page)] p-6 transition-colors duration-300 hover:bg-[var(--surface-raised)] sm:p-7"
    >
      <div className="mb-5 flex items-baseline gap-2.5">
        <span className="numeral text-2xs text-[var(--ink-faint)]">{index}</span>
        <h3 className="font-display text-xl tracking-[-0.012em] text-[var(--ink-primary)]">
          {title}
        </h3>
      </div>
      <div className="mb-6">{demo}</div>
      <p className="text-base leading-[1.6] text-[var(--ink-secondary)]">{body}</p>
    </div>
  );
}

function EvidenceRow({ kind, text }: { kind: keyof typeof PROVENANCE_META; text: string }) {
  const meta = PROVENANCE_META[kind];
  return (
    <div
      data-reveal-item
      className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--rule-hairline)] bg-[var(--surface-raised)] px-3.5 py-3"
    >
      <span
        aria-hidden="true"
        className="mt-[3px] shrink-0 text-[0.7rem] leading-none"
        style={{ color: `var(--ev-${meta.token})` }}
      >
        {meta.glyph}
      </span>
      <div className="min-w-0">
        <p className="text-xs leading-[1.5] text-[var(--ink-primary)]">{text}</p>
        <p className="mt-0.5 text-2xs" style={{ color: `var(--ev-${meta.token})` }}>
          {meta.label} — {meta.description}
        </p>
      </div>
    </div>
  );
}

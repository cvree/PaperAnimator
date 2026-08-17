import { useCallback, useEffect, useRef, useState } from 'react';
import { Landing } from './landing/Landing';
import { Processing, type ProcessingState } from './processing/Processing';
import { Setup } from './setup/Setup';
import { Editor } from './editor/Editor';
import { Toasts } from '@/ui/Toasts';
import { useApp } from '@/state/store';
import { extractPaper, PdfIntakeError, type Artifact, type PaperSession } from '@/extract/pdf';
import { buildSamplePaper } from './sample';

export default function App() {
  const phase = useApp((s) => s.phase);
  const setPhase = useApp((s) => s.setPhase);
  const attachSession = useApp((s) => s.attachSession);
  const reset = useApp((s) => s.reset);
  const reducedMotion = useApp((s) => s.reducedMotion);

  const [processing, setProcessing] = useState<ProcessingState>({
    stage: null,
    artifacts: [],
    error: null,
    fileName: '',
  });
  const abort = useRef<AbortController | null>(null);

  /* Keep reduced-motion live rather than read once at startup. */
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => useApp.setState({ reducedMotion: mq.matches });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const run = useCallback(
    async (file: File) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setProcessing({ stage: null, artifacts: [], error: null, fileName: file.name });
      setPhase('processing');

      const artifacts: Artifact[] = [];
      let raf = 0;
      const flush = () => {
        raf = 0;
        setProcessing((p) => ({ ...p, artifacts: [...artifacts] }));
      };

      try {
        const session: PaperSession = await extractPaper(
          file,
          {
            onStage: (stage) => setProcessing((p) => ({ ...p, stage })),
            onArtifact: (a) => {
              artifacts.push(a);
              if (!raf) raf = requestAnimationFrame(flush);
            },
          },
          controller.signal,
        );
        if (controller.signal.aborted) {
          session.destroy();
          return;
        }
        attachSession(session);
        setPhase('setup');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (err instanceof PdfIntakeError) {
          setProcessing((p) => ({
            ...p,
            error: { title: err.message, detail: err.detail, remedy: err.remedy },
          }));
        } else {
          console.error(err);
          setProcessing((p) => ({
            ...p,
            error: {
              title: 'Something went wrong while reading this paper',
              detail:
                'The file opened, but extraction stopped partway through. This usually means an unusual internal structure.',
              remedy: 'Try another PDF, or re-export this one from its original source.',
            },
          }));
        }
      }
    },
    [attachSession, setPhase],
  );

  const runSample = useCallback(async () => {
    const file = await buildSamplePaper();
    void run(file);
  }, [run]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    reset();
  }, [reset]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {phase === 'landing' && <Landing onFile={run} onSample={runSample} />}
      {phase === 'processing' && (
        <Processing state={processing} onCancel={cancel} reducedMotion={reducedMotion} />
      )}
      {phase === 'setup' && <Setup onBack={cancel} />}
      {phase === 'editor' && <Editor />}

      <Toasts />
    </>
  );
}

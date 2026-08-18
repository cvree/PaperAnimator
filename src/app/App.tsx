import { useCallback, useEffect, useRef, useState } from 'react';
import { Landing } from './landing/Landing';
import { Processing, type ProcessingState } from './processing/Processing';
import { Editor } from './editor/Editor';
import { Toasts } from '@/ui/Toasts';
import { useApp, DEFAULT_SETTINGS } from '@/state/store';
import { newId } from '@/core/id';
import type { Project } from '@/core/types';
import { extractPaper, PdfIntakeError, type Artifact, type PaperSession } from '@/extract/pdf';
import { collectDiagnostics } from '@/core/diagnostics';
import { buildSamplePaper } from './sample';

export default function App() {
  const phase = useApp((s) => s.phase);
  const setPhase = useApp((s) => s.setPhase);
  const attachSession = useApp((s) => s.attachSession);
  const setProject = useApp((s) => s.setProject);
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

        // The paper opens as the paper. Nothing is storyboarded on your behalf:
        // the storyboard starts empty and fills with what you mark, because a
        // talk assembled by a machine is a talk you then have to argue with.
        const project: Project = {
          id: newId('project'),
          version: 1,
          title: session.paper.meta.title ?? file.name.replace(/\.pdf$/i, ''),
          paper: session.paper,
          settings: DEFAULT_SETTINGS,
          scenes: [],
          style: 'broadsheet',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setProject(project);
        setPhase('editor');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (err instanceof PdfIntakeError) {
          setProcessing((p) => ({
            ...p,
            error: {
              title: err.message,
              detail: err.detail,
              remedy: err.remedy,
              diagnostics: err.diagnostics,
            },
          }));
        } else {
          console.error(err);
          // The document opened, so this is a fault in our own reading of it.
          // The report says which stage stopped and on what, so the failure is
          // reportable instead of merely regrettable.
          const diagnostics = await collectDiagnostics({
            phase: 'extracting the paper (after the document opened)',
            route: 'document already open',
            file: file.name,
            error: err,
            pdfjsVersion: 'see load route',
          });
          setProcessing((p) => ({
            ...p,
            error: {
              title: 'Something went wrong while reading this paper',
              detail:
                'The file opened, but extraction stopped partway through. This usually means an unusual internal structure.',
              remedy: 'Try another PDF, or re-export this one from its original source.',
              diagnostics,
            },
          }));
        }
      }
    },
    [attachSession, setProject, setPhase],
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
      {phase === 'editor' && <Editor />}

      <Toasts />
    </>
  );
}

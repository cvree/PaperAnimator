import { create } from 'zustand';
import { produce } from 'immer';
import type {
  Aspect,
  Audience,
  IntegrityReport,
  Layer,
  LayerId,
  Project,
  ProjectSettings,
  Scene,
  SceneId,
  SourceRef,
  StyleId,
} from '@/core/types';
import type { PaperSession } from '@/extract/pdf';
import { projectDuration, settledOffset } from '@/render/resolveFrame';
import { computeIntegrity } from '@/core/integrity';

export type Phase = 'landing' | 'processing' | 'setup' | 'editor';
export type EditorView = 'compose' | 'integrity' | 'export';
export type Disclosure = 'simple' | 'studio' | 'pro';

export interface SourceFocus {
  ref: SourceRef;
  /** What caused the focus, so the source pane can style it differently. */
  origin: 'layer' | 'scene' | 'issue' | 'hover';
  at: number;
}

interface Command {
  label: string;
  undo: () => void;
  redo: () => void;
  coalesceKey?: string;
  at: number;
}

interface AppState {
  phase: Phase;
  editorView: EditorView;
  disclosure: Disclosure;
  theme: 'paper' | 'press';

  session: PaperSession | null;
  project: Project | null;
  integrity: IntegrityReport | null;

  /* selection & focus */
  selectedSceneId: SceneId | null;
  selectedLayerIds: LayerId[];
  sourceFocus: SourceFocus | null;
  hoveredSourceRef: SourceRef | null;
  litSceneIds: SceneId[];

  /* playback */
  playing: boolean;
  timeMs: number;
  speaking: boolean;

  /* history */
  past: Command[];
  future: Command[];

  /* flags */
  reducedMotion: boolean;
  firstRevealDone: boolean;
  toast: { id: string; message: string; action?: { label: string; run: () => void } } | null;

  /* actions */
  setPhase: (p: Phase) => void;
  setEditorView: (v: EditorView) => void;
  setDisclosure: (d: Disclosure) => void;
  toggleTheme: () => void;
  attachSession: (s: PaperSession) => void;
  setProject: (p: Project) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  setStyle: (s: StyleId) => void;

  selectScene: (id: SceneId | null) => void;
  selectLayer: (id: LayerId | null, additive?: boolean) => void;
  focusSource: (ref: SourceRef | null, origin?: SourceFocus['origin']) => void;
  hoverSource: (ref: SourceRef | null) => void;
  lightScenes: (ids: SceneId[]) => void;

  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  seekScene: (id: SceneId) => void;
  setSpeaking: (b: boolean) => void;

  mutate: (label: string, recipe: (draft: Project) => void, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;

  showToast: (message: string, action?: { label: string; run: () => void }) => void;
  dismissToast: () => void;
  markRevealDone: () => void;
  reset: () => void;
}

const HISTORY_LIMIT = 50;

export const useApp = create<AppState>((set, get) => ({
  phase: 'landing',
  editorView: 'compose',
  disclosure: 'simple',
  theme: 'paper',

  session: null,
  project: null,
  integrity: null,

  selectedSceneId: null,
  selectedLayerIds: [],
  sourceFocus: null,
  hoveredSourceRef: null,
  litSceneIds: [],

  playing: false,
  timeMs: 0,
  speaking: false,

  past: [],
  future: [],

  reducedMotion:
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  firstRevealDone: false,
  toast: null,

  setPhase: (phase) => set({ phase }),
  setEditorView: (editorView) => set({ editorView }),
  setDisclosure: (disclosure) => set({ disclosure }),
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === 'paper' ? 'press' : 'paper';
      document.documentElement.dataset.theme = theme === 'press' ? 'press' : '';
      try {
        localStorage.setItem('pa:theme', theme);
      } catch {
        /* private mode */
      }
      return { theme };
    }),

  attachSession: (session) => set({ session }),

  setProject: (project) =>
    set({
      project,
      integrity: computeIntegrity(project),
      selectedSceneId: project.scenes[0]?.id ?? null,
      // Open on the first scene fully arrived, not on the blank instant before
      // anything has entered. The first thing anyone sees should be their work.
      timeMs: settledOffset(project.scenes[0]),
    }),

  updateSettings: (patch) => {
    const project = get().project;
    if (!project) return;
    get().mutate('Change settings', (d) => {
      Object.assign(d.settings, patch);
    });
  },

  setStyle: (style) => {
    get().mutate('Change style', (d) => {
      d.style = style;
    });
  },

  selectScene: (id) => {
    const { project } = get();
    if (!project || !id) {
      set({ selectedSceneId: id, selectedLayerIds: [] });
      return;
    }
    set({ selectedSceneId: id, selectedLayerIds: [] });
  },

  selectLayer: (id, additive = false) =>
    set((s) => {
      if (!id) return { selectedLayerIds: [] };
      if (additive) {
        return {
          selectedLayerIds: s.selectedLayerIds.includes(id)
            ? s.selectedLayerIds.filter((l) => l !== id)
            : [...s.selectedLayerIds, id],
        };
      }
      return { selectedLayerIds: [id] };
    }),

  focusSource: (ref, origin = 'layer') =>
    set({ sourceFocus: ref ? { ref, origin, at: performance.now() } : null }),

  hoverSource: (hoveredSourceRef) => set({ hoveredSourceRef }),

  lightScenes: (litSceneIds) => set({ litSceneIds }),

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  seek: (ms) => {
    const project = get().project;
    const total = project ? projectDuration(project) : 0;
    set({ timeMs: Math.max(0, Math.min(ms, Math.max(0, total - 1))) });
  },
  seekScene: (id) => {
    const project = get().project;
    if (!project) return;
    let t = 0;
    let target: Scene | undefined;
    for (const s of project.scenes) {
      if (s.hidden) continue;
      if (s.id === id) {
        target = s;
        break;
      }
      t += s.durationMs;
    }
    // Jumping while paused lands on the composed scene; jumping while playing
    // lands on its first frame, because the entrances are the point then.
    const offset = get().playing ? 0 : settledOffset(target);
    set({ timeMs: t + offset, selectedSceneId: id, selectedLayerIds: [] });
  },
  setSpeaking: (speaking) => set({ speaking }),

  mutate: (label, recipe, coalesceKey) => {
    const before = get().project;
    if (!before) return;
    const after = produce(before, recipe);
    if (after === before) return;

    const apply = (p: Project) => set({ project: p, integrity: computeIntegrity(p) });

    const command: Command = {
      label,
      undo: () => apply(before),
      redo: () => apply(after),
      coalesceKey,
      at: performance.now(),
    };

    set((s) => {
      const past = [...s.past];
      const last = past[past.length - 1];
      // A continuous drag collapses into one undo step, the way a person expects.
      if (last && coalesceKey && last.coalesceKey === coalesceKey && command.at - last.at < 900) {
        past[past.length - 1] = { ...last, redo: command.redo, at: command.at };
      } else {
        past.push(command);
        if (past.length > HISTORY_LIMIT) past.shift();
      }
      return { past, future: [] };
    });

    apply(after);
  },

  undo: () => {
    const { past, future } = get();
    const cmd = past[past.length - 1];
    if (!cmd) return;
    cmd.undo();
    set({ past: past.slice(0, -1), future: [...future, cmd] });
    get().showToast(`Undid “${cmd.label}”`);
  },

  redo: () => {
    const { past, future } = get();
    const cmd = future[future.length - 1];
    if (!cmd) return;
    cmd.redo();
    set({ past: [...past, cmd], future: future.slice(0, -1) });
  },

  showToast: (message, action) => {
    const id = Math.random().toString(36).slice(2);
    set({ toast: { id, message, action } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 4200);
  },
  dismissToast: () => set({ toast: null }),
  markRevealDone: () => set({ firstRevealDone: true }),

  reset: () => {
    get().session?.destroy();
    set({
      phase: 'landing',
      editorView: 'compose',
      session: null,
      project: null,
      integrity: null,
      selectedSceneId: null,
      selectedLayerIds: [],
      sourceFocus: null,
      playing: false,
      timeMs: 0,
      past: [],
      future: [],
      firstRevealDone: false,
    });
  },
}));

/* ============================================================================
   Selectors
   ========================================================================== */

export function useSelectedScene(): Scene | null {
  return useApp((s) => {
    if (!s.project || !s.selectedSceneId) return null;
    return s.project.scenes.find((sc) => sc.id === s.selectedSceneId) ?? null;
  });
}

export function useSelectedLayers(): Layer[] {
  return useApp((s) => {
    if (!s.project) return EMPTY_LAYERS;
    const scene = s.project.scenes.find((sc) => sc.id === s.selectedSceneId);
    if (!scene) return EMPTY_LAYERS;
    const picked = scene.layers.filter((l) => s.selectedLayerIds.includes(l.id));
    return picked.length ? picked : EMPTY_LAYERS;
  });
}

const EMPTY_LAYERS: Layer[] = [];

export const DEFAULT_SETTINGS: ProjectSettings = {
  aspect: '16:9',
  fps: 30,
  audience: 'informed',
  targetDurationMs: 3 * 60 * 1000,
  citationMode: 'corner',
  voiceURI: null,
  speakingRate: 1,
  captionsEnabled: true,
};

export const AUDIENCES: Audience[] = ['expert', 'informed', 'general'];
export const ASPECTS: Aspect[] = ['16:9', '1:1', '9:16'];

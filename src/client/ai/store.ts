import { create } from 'zustand';

import {
  type AiAnnotation,
  type AiAnnotationKind,
  type AiAnnotationsResponse,
  type AiPlanResponse,
  type AiPlanStatus,
  type ReviewPlan,
} from '../../types/ai';

const ALL_KINDS: AiAnnotationKind[] = ['attention', 'context', 'blast-radius'];

/**
 * Client-side AI state, deliberately kept OUT of App.tsx's useState soup and
 * entirely separate from the version-merged comment session. AI artifacts have
 * their own lifecycle (fetched from the server, refreshed on SSE events) and
 * never mix with human-authored comments.
 */
interface AiState {
  // Review plan (M1)
  status: AiPlanStatus;
  plan: ReviewPlan | null;
  message: string | undefined;
  /** True while a plan fetch is in flight, so the UI can show a spinner. */
  loading: boolean;

  // Annotations (M2)
  annotationStatus: AiPlanStatus;
  annotations: AiAnnotation[];
  /** Which annotation kinds are currently shown. */
  enabledKinds: Set<AiAnnotationKind>;

  /** Fetch the review plan from the server (kicks the prep pass if needed). */
  fetchPlan: () => Promise<void>;
  /** Fetch anchored annotations from the server (kicks the pass if needed). */
  fetchAnnotations: () => Promise<void>;
  /** Show/hide a whole annotation kind. */
  toggleKind: (kind: AiAnnotationKind) => void;
  /** Clear all AI state, e.g. when the diff/head changes. */
  reset: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
  status: 'idle',
  plan: null,
  message: undefined,
  loading: false,

  annotationStatus: 'idle',
  annotations: [],
  enabledKinds: new Set(ALL_KINDS),

  fetchPlan: async () => {
    if (get().loading) {
      return;
    }
    set({ loading: true });
    try {
      const response = await fetch('/api/ai/plan');
      if (!response.ok) {
        throw new Error(`Plan request failed: ${response.status}`);
      }
      const data = (await response.json()) as AiPlanResponse;
      set({
        status: data.status,
        plan: data.plan ?? null,
        message: data.message,
        loading: false,
      });
    } catch (error) {
      set({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to load AI review plan',
        loading: false,
      });
    }
  },

  fetchAnnotations: async () => {
    if (get().annotationStatus === 'running') {
      return;
    }
    set({ annotationStatus: 'running' });
    try {
      const response = await fetch('/api/ai/annotations');
      if (!response.ok) {
        throw new Error(`Annotations request failed: ${response.status}`);
      }
      const data = (await response.json()) as AiAnnotationsResponse;
      set({
        annotationStatus: data.status,
        annotations: data.annotations ?? [],
      });
    } catch {
      set({ annotationStatus: 'error', annotations: [] });
    }
  },

  toggleKind: (kind) =>
    set((state) => {
      const next = new Set(state.enabledKinds);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return { enabledKinds: next };
    }),

  reset: () =>
    set({
      status: 'idle',
      plan: null,
      message: undefined,
      loading: false,
      annotationStatus: 'idle',
      annotations: [],
    }),
}));

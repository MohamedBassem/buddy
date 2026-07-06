import { create } from 'zustand';

import { type AiPlanResponse, type AiPlanStatus, type ReviewPlan } from '../../types/ai';

/**
 * Client-side AI state, deliberately kept OUT of App.tsx's useState soup and
 * entirely separate from the version-merged comment session. AI artifacts have
 * their own lifecycle (fetched from the server, refreshed on SSE events) and
 * never mix with human-authored comments.
 */
interface AiState {
  status: AiPlanStatus;
  plan: ReviewPlan | null;
  message: string | undefined;
  /** True while a fetch is in flight, so the UI can show a spinner. */
  loading: boolean;

  /** Fetch the review plan from the server (kicks the prep pass if needed). */
  fetchPlan: () => Promise<void>;
  /** Clear plan state, e.g. when the diff/head changes. */
  reset: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
  status: 'idle',
  plan: null,
  message: undefined,
  loading: false,

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

  reset: () => set({ status: 'idle', plan: null, message: undefined, loading: false }),
}));

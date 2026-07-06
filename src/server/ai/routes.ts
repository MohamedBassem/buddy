import { type Express } from 'express';

import { type AiRepoContext } from '../../types/ai.js';
import { type DiffResponse } from '../../types/diff.js';
import { type WatchEvent } from '../../types/watch.js';

import { PlanService } from './plan-service.js';

export interface AiRoutesDeps {
  /** Repo/PR context, or null when buddy can't resolve a repo. */
  context: AiRepoContext | null;
  /** Current diff under review. */
  diff: DiffResponse;
  /** SSE broadcaster (the existing FileWatcher channel). */
  broadcast: (event: WatchEvent) => void;
}

/**
 * All buddy AI HTTP surface. Registered from server.ts at a single injection
 * point so the fork stays easy to rebase onto upstream difit.
 *
 * Returns the PlanService so the server can refresh its context when the diff
 * is regenerated (force-push / mode change).
 */
export function registerAiRoutes(app: Express, deps: AiRoutesDeps): { planService: PlanService } {
  const planService = new PlanService(deps.broadcast);
  planService.setContext(deps.context, deps.diff);

  // Kicks the prep pass on first call; returns cached plan when fresh. The
  // client polls this once on load and again on the `aiPlanReady` SSE event.
  app.get('/api/ai/plan', async (_req, res) => {
    try {
      const response = await planService.getPlan();
      res.json(response);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return { planService };
}

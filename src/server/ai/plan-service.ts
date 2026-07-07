import {
  type AiPlanResponse,
  type AiPlanStatus,
  type AiRepoContext,
  type ReviewPlan,
} from '../../types/ai.js';
import { type DiffResponse } from '../../types/diff.js';
import { type WatchEvent } from '../../types/watch.js';

import { runJsonAgent } from './agent.js';
import { readCachedPlan, writeCachedPlan } from './cache.js';
import { AUTH_HELP_MESSAGE, getAiConfig, isAuthError } from './config.js';
import { normalizeReviewPlan, type RawReviewPlan } from './normalize.js';
import { buildPlanPrompt, changedPaths, PLAN_SYSTEM_PROMPT } from './prompts.js';

/**
 * Owns the AI prep pass for one server session.
 *
 * The prep pass runs once per (repo, PR, head SHA): the UI renders the diff in
 * git order immediately, then re-sorts when the plan lands. Results are cached
 * on disk so reopening the same PR is instant, and pushed to the client over
 * the existing SSE channel via `aiPlanReady`.
 *
 * This state lives entirely outside difit's version-merged comment session —
 * AI artifacts never enter that protocol.
 */
export class PlanService {
  private context: AiRepoContext | null = null;
  private diff: DiffResponse | null = null;

  private status: AiPlanStatus = 'idle';
  private plan: ReviewPlan | null = null;
  private message: string | undefined;

  /** In-flight pass, so concurrent requests share one run. */
  private inFlight: Promise<AiPlanResponse> | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly broadcast: (event: WatchEvent) => void) {}

  /**
   * Point the service at the current diff. Called on startup and whenever the
   * diff is regenerated (e.g. after a force-push). A changed head SHA discards
   * any in-flight pass and prior plan so we never serve a stale one.
   */
  setContext(context: AiRepoContext | null, diff: DiffResponse): void {
    const shaChanged = this.context?.headSha !== context?.headSha;
    this.context = context;
    this.diff = diff;
    if (shaChanged) {
      this.abortController?.abort();
      this.abortController = null;
      this.inFlight = null;
      this.plan = null;
      this.status = 'idle';
      this.message = undefined;
    }
  }

  private response(): AiPlanResponse {
    return {
      status: this.status,
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.message ? { message: this.message } : {}),
    };
  }

  /**
   * Return the plan. Cached results (memory or disk) always load for free. The
   * expensive agent pass runs only when `trigger` is set (a user button click) —
   * on plain page load we peek the cache but never spend tokens unprompted.
   * Idempotent: a call while a pass is running joins that run.
   */
  async getPlan(trigger = false): Promise<AiPlanResponse> {
    const config = getAiConfig();
    if (!config.enabled) {
      this.status = 'unavailable';
      this.message = 'AI features are disabled (BUDDY_DISABLE_AI).';
      return this.response();
    }
    if (!this.context || !this.diff) {
      this.status = 'unavailable';
      this.message = 'No repository context available for AI review.';
      return this.response();
    }
    if (this.diff.isEmpty || this.diff.files.length === 0) {
      this.status = 'unavailable';
      this.message = 'No changes to plan.';
      return this.response();
    }

    if (this.status === 'ready' && this.plan) {
      return this.response();
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    // Cheap cache peek on every call — a previously prepared diff loads instantly.
    const cached = await readCachedPlan(this.context);
    if (cached) {
      this.plan = cached;
      this.status = 'ready';
      this.message = undefined;
      this.broadcast({
        type: 'aiPlanReady',
        headSha: this.context.headSha,
        timestamp: new Date().toISOString(),
      });
      return this.response();
    }

    if (!trigger) {
      // Not cached and not explicitly requested: wait for the user.
      this.status = 'idle';
      this.message = undefined;
      return this.response();
    }

    this.inFlight = this.runPrepPass(this.context, this.diff);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runPrepPass(context: AiRepoContext, diff: DiffResponse): Promise<AiPlanResponse> {
    this.status = 'running';
    this.message = undefined;
    this.abortController = new AbortController();

    try {
      const raw = await runJsonAgent<RawReviewPlan>({
        prompt: buildPlanPrompt(diff, context),
        systemPrompt: PLAN_SYSTEM_PROMPT,
        cwd: context.repoPath,
        maxTurns: 40,
        signal: this.abortController.signal,
        label: 'review plan',
      });

      const plan = normalizeReviewPlan(raw, changedPaths(diff), context.headSha);
      this.plan = plan;
      this.status = 'ready';
      await writeCachedPlan(context, plan);
      this.broadcast({
        type: 'aiPlanReady',
        headSha: context.headSha,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.status = isAuthError(error) ? 'unavailable' : 'error';
      this.message = isAuthError(error)
        ? AUTH_HELP_MESSAGE
        : `AI review plan failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      console.warn('⚠️  AI prep pass failed:', error);
    } finally {
      this.abortController = null;
    }

    return this.response();
  }
}

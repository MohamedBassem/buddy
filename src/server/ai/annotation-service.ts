import {
  type AiAnnotation,
  type AiAnnotationsResponse,
  type AiPlanStatus,
  type AiRepoContext,
} from '../../types/ai.js';
import { type DiffResponse } from '../../types/diff.js';
import { type WatchEvent } from '../../types/watch.js';

import { runJsonAgent } from './agent.js';
import {
  ANNOTATIONS_SYSTEM_PROMPT,
  buildAnnotationsPrompt,
  normalizeAnnotations,
  type RawAnnotations,
} from './annotations.js';
import { readCachedAnnotations, writeCachedAnnotations } from './cache.js';
import { AUTH_HELP_MESSAGE, getAiConfig, isAuthError } from './config.js';

/**
 * Owns the AI annotation pass for one server session — a sibling of PlanService.
 *
 * Runs once per (repo, PR, head SHA), independent of the plan pass so the two
 * stream in separately: the plan lands first (ordering the review), annotations
 * follow. Cached on disk, pushed to the client via `aiAnnotationsChanged`.
 * Annotations flag attention/context/blast-radius; they are never verdicts.
 */
export class AnnotationService {
  private context: AiRepoContext | null = null;
  private diff: DiffResponse | null = null;

  private status: AiPlanStatus = 'idle';
  private annotations: AiAnnotation[] = [];
  private message: string | undefined;

  private inFlight: Promise<AiAnnotationsResponse> | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly broadcast: (event: WatchEvent) => void) {}

  setContext(context: AiRepoContext | null, diff: DiffResponse): void {
    const shaChanged = this.context?.headSha !== context?.headSha;
    this.context = context;
    this.diff = diff;
    if (shaChanged) {
      this.abortController?.abort();
      this.abortController = null;
      this.inFlight = null;
      this.annotations = [];
      this.status = 'idle';
      this.message = undefined;
    }
  }

  private response(): AiAnnotationsResponse {
    return {
      status: this.status,
      annotations: this.annotations,
      ...(this.context ? { headSha: this.context.headSha } : {}),
      ...(this.message ? { message: this.message } : {}),
    };
  }

  /**
   * Cached annotations always load for free; the agent pass runs only when
   * `trigger` is set (an explicit user request). Mirrors PlanService.getPlan.
   */
  async getAnnotations(trigger = false): Promise<AiAnnotationsResponse> {
    const config = getAiConfig();
    if (!config.enabled) {
      this.status = 'unavailable';
      this.message = 'AI features are disabled (BUDDY_DISABLE_AI).';
      return this.response();
    }
    if (!this.context || !this.diff || this.diff.isEmpty || this.diff.files.length === 0) {
      this.status = 'unavailable';
      this.message = 'No changes to annotate.';
      return this.response();
    }

    if (this.status === 'ready') {
      return this.response();
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    const cached = await readCachedAnnotations(this.context);
    if (cached) {
      this.annotations = cached;
      this.status = 'ready';
      this.message = undefined;
      this.broadcast({
        type: 'aiAnnotationsChanged',
        headSha: this.context.headSha,
        timestamp: new Date().toISOString(),
      });
      return this.response();
    }

    if (!trigger) {
      this.status = 'idle';
      this.message = undefined;
      return this.response();
    }

    this.inFlight = this.runPass(this.context, this.diff);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runPass(
    context: AiRepoContext,
    diff: DiffResponse,
  ): Promise<AiAnnotationsResponse> {
    this.status = 'running';
    this.message = undefined;
    this.abortController = new AbortController();

    try {
      const raw = await runJsonAgent<RawAnnotations>({
        prompt: buildAnnotationsPrompt(diff, context),
        systemPrompt: ANNOTATIONS_SYSTEM_PROMPT,
        cwd: context.repoPath,
        maxTurns: 40,
        signal: this.abortController.signal,
        label: 'annotations',
      });

      this.annotations = normalizeAnnotations(raw, diff, context.headSha);
      this.status = 'ready';
      await writeCachedAnnotations(context, this.annotations);
      this.broadcast({
        type: 'aiAnnotationsChanged',
        headSha: context.headSha,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.status = isAuthError(error) ? 'unavailable' : 'error';
      this.message = isAuthError(error)
        ? AUTH_HELP_MESSAGE
        : `AI annotations failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      console.warn('⚠️  AI annotation pass failed:', error);
    } finally {
      this.abortController = null;
    }

    return this.response();
  }
}

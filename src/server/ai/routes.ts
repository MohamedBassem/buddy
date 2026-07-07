import { type Express } from 'express';

import { type AiRepoContext } from '../../types/ai.js';
import { type DiffResponse } from '../../types/diff.js';
import { type WatchEvent } from '../../types/watch.js';

import { runAgent } from './agent.js';
import { AnnotationService } from './annotation-service.js';
import { ASK_SYSTEM_PROMPT, buildAskPrompt, parseAskRequest } from './ask.js';
import { AUTH_HELP_MESSAGE, getAiConfig, isAuthError } from './config.js';
import { PlanService } from './plan-service.js';

export interface AiRoutesDeps {
  /** Repo/PR context, or null when buddy can't resolve a repo. */
  context: AiRepoContext | null;
  /** Current diff under review. */
  diff: DiffResponse;
  /** SSE broadcaster (the existing FileWatcher channel). */
  broadcast: (event: WatchEvent) => void;
}

/** Handle both AI services so the server can refresh their context together. */
export interface AiServices {
  setContext: (context: AiRepoContext | null, diff: DiffResponse) => void;
}

/** Whether the `run` query param asks to actually run the (paid) agent pass. */
function isRunRequested(run: unknown): boolean {
  return run === '1' || run === 'true';
}

/**
 * All buddy AI HTTP surface. Registered from server.ts at a single injection
 * point so the fork stays easy to rebase onto upstream difit.
 *
 * Returns a handle the server uses to refresh AI context when the diff is
 * regenerated (force-push / mode change).
 */
export function registerAiRoutes(app: Express, deps: AiRoutesDeps): AiServices {
  const planService = new PlanService(deps.broadcast);
  const annotationService = new AnnotationService(deps.broadcast);
  planService.setContext(deps.context, deps.diff);
  annotationService.setContext(deps.context, deps.diff);

  // Latest repo context, so the streaming Ask endpoint runs its agent in the
  // right working directory even after the diff/head changes.
  let currentContext: AiRepoContext | null = deps.context;

  // Returns the cached plan for free; runs the (expensive) prep pass only when
  // called with `?run=1` — a user button click. The client peeks on load and
  // refreshes on the `aiPlanReady` SSE event.
  app.get('/api/ai/plan', async (req, res) => {
    try {
      const response = await planService.getPlan(isRunRequested(req.query.run));
      res.json(response);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Anchored annotations (attention / context / blast-radius). Same lazy
  // contract as the plan: cached loads free, `?run=1` triggers the pass.
  app.get('/api/ai/annotations', async (req, res) => {
    try {
      const response = await annotationService.getAnnotations(isRunRequested(req.query.run));
      res.json(response);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        annotations: [],
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Per-hunk "Ask buddy" chat. Streams the agent's answer back as plain-text
  // chunks (the client reads them incrementally). This is Q&A only — the answer
  // never becomes a comment until the human promotes it.
  app.post('/api/ai/ask', async (req, res) => {
    const config = getAiConfig();
    if (!config.enabled) {
      res.status(503).json({ error: 'AI features are disabled (BUDDY_DISABLE_AI).' });
      return;
    }
    if (!currentContext) {
      res.status(503).json({ error: 'No repository context available for AI chat.' });
      return;
    }
    const parsed = parseAskRequest(req.body);
    if (!parsed) {
      res.status(400).json({ error: 'Invalid ask request.' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });

    // Abort the agent only if the *client* disconnects before we finish — not
    // when the (already-buffered) request body stream closes.
    const abortController = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) abortController.abort();
    });

    try {
      await runAgent({
        prompt: buildAskPrompt(parsed, currentContext),
        systemPrompt: ASK_SYSTEM_PROMPT,
        cwd: currentContext.repoPath,
        maxTurns: 20,
        signal: abortController.signal,
        onText: (text) => res.write(text),
        label: 'ask hunk',
      });
      finished = true;
      res.end();
    } catch (error) {
      finished = true;
      // The stream may already have started; append the error rather than
      // switching status codes.
      const message = isAuthError(error)
        ? AUTH_HELP_MESSAGE
        : `\n\n[buddy: ${error instanceof Error ? error.message : 'chat failed'}]`;
      if (!res.headersSent) {
        res.status(500);
      }
      res.write(message);
      res.end();
    }
  });

  return {
    setContext: (context, diff) => {
      currentContext = context;
      planService.setContext(context, diff);
      annotationService.setContext(context, diff);
    },
  };
}

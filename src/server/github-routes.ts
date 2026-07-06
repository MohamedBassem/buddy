import { type Express } from 'express';

import { type AiRepoContext } from '../types/ai.js';

import {
  parseSubmitReviewInput,
  submitPullRequestReview,
  type ReviewPrTarget,
} from './github-write.js';

export interface GitHubRoutesDeps {
  /** PR identity, present only when buddy was launched with --pr. */
  pr: AiRepoContext['pr'];
}

/**
 * GitHub write-back routes. Registered from server.ts at a single injection
 * point (fork hygiene). Only functional in --pr mode — buddy needs a PR to post
 * a review to.
 */
export function registerGitHubRoutes(app: Express, deps: GitHubRoutesDeps): void {
  // Lets the client decide whether to show the "Submit to GitHub" flow.
  app.get('/api/github/info', (_req, res) => {
    res.json({
      pr: deps.pr ? { owner: deps.pr.owner, repo: deps.pr.repo, number: deps.pr.number } : null,
    });
  });

  app.post('/api/github/review', async (req, res) => {
    if (!deps.pr) {
      res.status(400).json({
        error: 'Submitting a review requires launching buddy with --pr <url>.',
      });
      return;
    }

    const input = parseSubmitReviewInput(req.body);
    if (!input) {
      res.status(400).json({ error: 'Invalid review payload.' });
      return;
    }

    const target: ReviewPrTarget = {
      owner: deps.pr.owner,
      repo: deps.pr.repo,
      number: deps.pr.number,
    };

    try {
      const result = await submitPullRequestReview(target, input);
      res.json(result);
    } catch (error) {
      res.status(502).json({
        error: `Failed to submit review to GitHub: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      });
    }
  });
}

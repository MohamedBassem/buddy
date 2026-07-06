import { useCallback, useEffect, useState } from 'react';

import { type DiffCommentThread } from '../../types/diff';

export interface GitHubPrInfo {
  owner: string;
  repo: string;
  number: number;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface SubmitReviewResult {
  htmlUrl?: string;
  state?: string;
  commentCount: number;
  skipped: string[];
}

export type SubmitReviewFn = (input: {
  threads: DiffCommentThread[];
  event?: ReviewEvent;
  body?: string;
}) => Promise<SubmitReviewResult>;

interface UseGitHubReview {
  /** PR identity, or null when buddy wasn't launched with --pr. */
  pr: GitHubPrInfo | null;
  submit: SubmitReviewFn;
}

/**
 * Talks to buddy's GitHub write-back endpoints. The submit call posts a review
 * (pending draft unless an event is given) — the one path where local review
 * work leaves the machine, so it only ever runs on an explicit user action.
 */
export function useGitHubReview(): UseGitHubReview {
  const [pr, setPr] = useState<GitHubPrInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/github/info')
      .then((res) => (res.ok ? res.json() : { pr: null }))
      .then((data: { pr: GitHubPrInfo | null }) => {
        if (!cancelled) setPr(data.pr ?? null);
      })
      .catch(() => {
        if (!cancelled) setPr(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback<UseGitHubReview['submit']>(async (input) => {
    const response = await fetch('/api/github/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as SubmitReviewResult & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? `Review submission failed: ${response.status}`);
    }
    return data;
  }, []);

  return { pr, submit };
}

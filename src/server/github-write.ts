import { spawn } from 'child_process';

import { type DiffCommentThread } from '../types/diff.js';

/** Run `gh` with a JSON stdin payload, resolving stdout. Rejects on non-zero exit. */
function runGh(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `gh exited with code ${code ?? 'null'}`));
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * GitHub write-back: turn buddy's local comment threads into a PENDING pull
 * request review via the gh CLI (auth reuse — buddy stores no token).
 *
 * This is the inverse of the read mapping in cli/github.ts: buddy's
 * DiffCommentThread.position (side 'new'/'old' + line/range) maps to GitHub's
 * review-comment shape (side 'RIGHT'/'LEFT' + line/start_line).
 *
 * By default a review is created WITHOUT an event, i.e. as a pending draft the
 * human still submits on GitHub. The submit flow may pass an explicit event
 * (APPROVE / REQUEST_CHANGES / COMMENT) to publish directly.
 */

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface GitHubReviewComment {
  path: string;
  body: string;
  side: 'LEFT' | 'RIGHT';
  line: number;
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

export interface ReviewPrTarget {
  owner: string;
  repo: string;
  number: number;
}

export interface SubmitReviewInput {
  threads: DiffCommentThread[];
  event?: ReviewEvent;
  body?: string;
}

function combineMessages(thread: DiffCommentThread): string {
  return thread.messages
    .map((m) => m.body.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Map one comment thread to a GitHub review comment. Returns null (and a reason)
 * for threads that can't be posted (empty body, non-positive line).
 */
export function mapThreadToReviewComment(
  thread: DiffCommentThread,
): { comment: GitHubReviewComment } | { skip: string } {
  const body = combineMessages(thread);
  if (!body) {
    return { skip: `${thread.filePath}: empty comment body` };
  }
  if (!thread.filePath) {
    return { skip: 'thread is missing a file path' };
  }

  const side: 'LEFT' | 'RIGHT' = thread.position.side === 'old' ? 'LEFT' : 'RIGHT';
  const { line } = thread.position;

  if (typeof line === 'number') {
    if (!Number.isInteger(line) || line <= 0) {
      return { skip: `${thread.filePath}: invalid line ${String(line)}` };
    }
    return { comment: { path: thread.filePath, body, side, line } };
  }

  // Multi-line range.
  const start = line.start;
  const end = line.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
    return { skip: `${thread.filePath}: invalid line range` };
  }
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  if (lo === hi) {
    return { comment: { path: thread.filePath, body, side, line: hi } };
  }
  return {
    comment: { path: thread.filePath, body, side, line: hi, start_line: lo, start_side: side },
  };
}

interface ReviewPayload {
  comments: GitHubReviewComment[];
  event?: ReviewEvent;
  body?: string;
}

export interface BuiltReview {
  payload: ReviewPayload;
  skipped: string[];
}

/** Build the review payload from selected threads, collecting skip reasons. */
export function buildReviewPayload(input: SubmitReviewInput): BuiltReview {
  const comments: GitHubReviewComment[] = [];
  const skipped: string[] = [];

  for (const thread of input.threads) {
    const mapped = mapThreadToReviewComment(thread);
    if ('comment' in mapped) {
      comments.push(mapped.comment);
    } else {
      skipped.push(mapped.skip);
    }
  }

  const payload: ReviewPayload = {
    comments,
    ...(input.event ? { event: input.event } : {}),
    ...(input.body?.trim() ? { body: input.body.trim() } : {}),
  };

  return { payload, skipped };
}

export interface SubmitReviewResult {
  htmlUrl?: string;
  state?: string;
  commentCount: number;
  skipped: string[];
}

/**
 * Create the review on GitHub via `gh api`. Pending (no event) unless an event
 * is provided. Throws on gh failure (caller maps to an HTTP error).
 */
export async function submitPullRequestReview(
  pr: ReviewPrTarget,
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  const { payload, skipped } = buildReviewPayload(input);

  if (payload.comments.length === 0 && !payload.event) {
    throw new Error('Nothing to submit: no valid comments and no review event.');
  }

  const apiPath = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`;
  const stdout = await runGh(
    ['api', apiPath, '-X', 'POST', '--input', '-'],
    JSON.stringify(payload),
  );

  let parsed: { html_url?: string; state?: string } = {};
  try {
    parsed = JSON.parse(stdout) as { html_url?: string; state?: string };
  } catch {
    // gh returned non-JSON; leave fields undefined.
  }

  return {
    ...(parsed.html_url ? { htmlUrl: parsed.html_url } : {}),
    ...(parsed.state ? { state: parsed.state } : {}),
    commentCount: payload.comments.length,
    skipped,
  };
}

/** Parse and validate a POST /api/github/review body. */
export function parseSubmitReviewInput(body: unknown): SubmitReviewInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.threads)) return null;

  const event =
    b.event === 'APPROVE' || b.event === 'REQUEST_CHANGES' || b.event === 'COMMENT'
      ? b.event
      : undefined;

  // Trust the DiffCommentThread shape loosely; mapping re-validates each thread.
  const threads = b.threads.filter(
    (t): t is DiffCommentThread =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as DiffCommentThread).filePath === 'string' &&
      Array.isArray((t as DiffCommentThread).messages),
  );

  return {
    threads,
    ...(event ? { event } : {}),
    ...(typeof b.body === 'string' ? { body: b.body } : {}),
  };
}

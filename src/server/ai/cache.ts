import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { type AiRepoContext, type ReviewPlan } from '../../types/ai.js';

/**
 * Disk cache for AI prep-pass results.
 *
 * Server session state is ephemeral by design (it dies with the tab), but AI
 * results are expensive to produce and should survive restarts — reopening a
 * PR at the same head SHA must be instant. So the ReviewPlan (and, later,
 * annotations) are persisted under a per-user cache dir, keyed by
 * (repo, PR, headSha).
 */

const CACHE_DIR = join(homedir(), '.cache', 'buddy', 'ai');

/**
 * Stable cache key for a given repo + PR + head SHA. Repo path and PR identity
 * are hashed together so two checkouts of the same PR share a cache entry while
 * unrelated repos never collide.
 */
export function cacheKey(context: AiRepoContext): string {
  const prPart = context.pr
    ? `${context.pr.hostname}/${context.pr.owner}/${context.pr.repo}#${context.pr.number}`
    : context.repoPath;
  const digest = createHash('sha256')
    .update(`${prPart}\0${context.headSha}`)
    .digest('hex')
    .slice(0, 32);
  return digest;
}

function planPath(context: AiRepoContext): string {
  return join(CACHE_DIR, `plan-${cacheKey(context)}.json`);
}

/** Returns the cached ReviewPlan for this context, or null on miss/parse error. */
export async function readCachedPlan(context: AiRepoContext): Promise<ReviewPlan | null> {
  try {
    const raw = await readFile(planPath(context), 'utf8');
    const parsed = JSON.parse(raw) as ReviewPlan;
    // Guard against stale/corrupt entries that don't match the requested SHA.
    if (parsed.headSha !== context.headSha) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persists a ReviewPlan for this context. Best-effort; never throws. */
export async function writeCachedPlan(context: AiRepoContext, plan: ReviewPlan): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(planPath(context), JSON.stringify(plan, null, 2), 'utf8');
  } catch (error) {
    console.warn('⚠️  Failed to write AI plan cache:', error);
  }
}

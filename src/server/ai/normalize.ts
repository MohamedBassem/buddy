import { type ReviewChapter, type ReviewPlan, type TriageClass } from '../../types/ai.js';

/** Raw (untrusted) shape the agent is asked to emit, before normalization. */
export interface RawReviewPlan {
  summary?: unknown;
  chapters?: unknown;
  triage?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asTriageClass(value: unknown): TriageClass {
  return value === 'mechanical' ? 'mechanical' : 'substantive';
}

/**
 * Turn an agent's raw JSON into a trustworthy ReviewPlan:
 * - keep only chapter files that are actually in the diff,
 * - ensure every changed path appears exactly once (dropping duplicates,
 *   appending anything the agent missed to a final "Everything else" chapter),
 * - fill triage defaults for uncovered paths.
 *
 * This makes the client wiring safe: re-sorting `diffData.files` by the plan can
 * never drop or duplicate a file, no matter what the model returned.
 */
export function normalizeReviewPlan(
  raw: RawReviewPlan,
  changedPaths: string[],
  headSha: string,
): ReviewPlan {
  const validPaths = new Set(changedPaths);
  const seen = new Set<string>();

  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  const chapters: ReviewChapter[] = [];

  for (const rawChapter of rawChapters) {
    if (!rawChapter || typeof rawChapter !== 'object') {
      continue;
    }
    const chapter = rawChapter as { title?: unknown; summary?: unknown; files?: unknown };
    const files: string[] = [];
    const rawFiles = Array.isArray(chapter.files) ? chapter.files : [];
    for (const file of rawFiles) {
      if (typeof file === 'string' && validPaths.has(file) && !seen.has(file)) {
        seen.add(file);
        files.push(file);
      }
    }
    if (files.length === 0) {
      continue;
    }
    chapters.push({
      title: asString(chapter.title) || `Chapter ${chapters.length + 1}`,
      summary: asString(chapter.summary),
      files,
    });
  }

  // Any changed file the agent forgot goes into a trailing catch-all so nothing
  // silently disappears from the review.
  const missing = changedPaths.filter((path) => !seen.has(path));
  if (missing.length > 0) {
    chapters.push({
      title: chapters.length === 0 ? 'Changes' : 'Everything else',
      summary: '',
      files: missing,
    });
  }

  // Triage: start from the agent's map (valid paths only), default the rest.
  const rawTriage =
    raw.triage && typeof raw.triage === 'object' ? (raw.triage as Record<string, unknown>) : {};
  const triage: Record<string, TriageClass> = {};
  for (const path of changedPaths) {
    triage[path] = asTriageClass(rawTriage[path]);
  }

  return {
    headSha,
    summary: asString(raw.summary),
    chapters,
    triage,
  };
}

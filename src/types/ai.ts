/**
 * Shared AI data model (server <-> client).
 *
 * Buddy layers an AI review-preparation pass on top of difit's diff viewer.
 * Everything here is *assistive*: the AI orders, annotates, and contextualizes
 * the review; the human still reads, judges, and authors the comments.
 *
 * Every AI artifact anchored to code carries the `headSha` it was produced
 * against so that, on a PR update, artifacts can be re-anchored or marked
 * stale rather than silently drifting onto the wrong lines.
 */

/** Classification of a changed file for noise triage. */
export type TriageClass = 'substantive' | 'mechanical';

/** A single narrative grouping of files, in review order. */
export interface ReviewChapter {
  /** e.g. "1. Schema change" */
  title: string;
  /** 1-3 sentence description of what this chapter covers and why it matters. */
  summary: string;
  /** File paths, in the order they should be reviewed. */
  files: string[];
}

/**
 * The output of the prep pass: how to read this PR.
 * Cached on disk, keyed by (repo, PR, headSha).
 */
export interface ReviewPlan {
  /** Head SHA the plan was produced against. */
  headSha: string;
  /** 3-5 sentence PR walkthrough. */
  summary: string;
  /** Narrative grouping + review order. */
  chapters: ReviewChapter[];
  /** path -> classification. Files absent from this map default to 'substantive'. */
  triage: Record<string, TriageClass>;
}

/** Where an AI artifact is pinned in the diff. */
export interface AiAnchor {
  filePath: string;
  side: 'old' | 'new';
  line: number;
  /** Head SHA this anchor was computed against. */
  headSha: string;
}

/**
 * Did the agent read surrounding code / run tools ('looked'), or is this
 * inferred from the hunk alone ('inferred')? Surfaced in the UI so the human
 * knows how much to trust it — automation honesty, not a verdict.
 */
export type AiConfidence = 'looked' | 'inferred';

export type AiAnnotationKind = 'attention' | 'context' | 'blast-radius';

/** An anchored note the agent wants the reviewer to see at a specific line. */
export interface AiAnnotation {
  id: string;
  anchor: AiAnchor;
  kind: AiAnnotationKind;
  /** e.g. "changes retry semantics: was 3 attempts, now unbounded". */
  body: string;
  confidence: AiConfidence;
  /** Set when a newer head SHA has made this anchor untrustworthy. */
  stale?: boolean;
}

export interface HunkChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A per-hunk Ask-AI conversation. */
export interface HunkChat {
  id: string;
  anchor: AiAnchor;
  messages: HunkChatMessage[];
}

/**
 * PR / repo context the AI layer needs. Threaded from the CLI into the server.
 * Present only when buddy is launched against a resolvable git repo (and,
 * optionally, a GitHub PR).
 */
export interface AiRepoContext {
  /** Absolute path to the checked-out repository root. */
  repoPath: string;
  /** Resolved head SHA of the diff under review. */
  headSha: string;
  /** Present when launched via --pr. */
  pr?: {
    owner: string;
    repo: string;
    number: number;
    hostname: string;
  };
}

/** Lifecycle of the prep pass, surfaced to the client. */
export type AiPlanStatus = 'idle' | 'running' | 'ready' | 'error' | 'unavailable';

export interface AiPlanResponse {
  status: AiPlanStatus;
  plan?: ReviewPlan;
  /** Human-readable reason when status is 'error' or 'unavailable'. */
  message?: string;
}

export interface AiAnnotationsResponse {
  status: AiPlanStatus;
  annotations: AiAnnotation[];
  headSha?: string;
  /** Human-readable reason when status is 'error' or 'unavailable'. */
  message?: string;
}

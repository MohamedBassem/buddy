import { type AiRepoContext } from '../../types/ai.js';
import { type DiffFile, type DiffResponse } from '../../types/diff.js';

/**
 * Prompt construction for the AI prep pass.
 *
 * The agent is given a compact view of the diff (paths, stats, and a bounded
 * slice of each patch) plus repo tools so it can read beyond the hunk. It is
 * asked to return a strict-JSON ReviewPlan. Prompts state the honesty rules the
 * rest of buddy depends on: order as a narrative, mark mechanical noise, never
 * emit verdicts.
 */

export const PLAN_SYSTEM_PROMPT = `You are buddy's review-preparation agent. You do NOT review code or pass verdicts — you prepare a human's review of a pull request.

Your job: read the diff (and the surrounding repository, using your tools) and produce a plan that makes the human's review feel like reading a well-ordered story instead of an arbitrary list of files.

You have read-only tools: read files, grep, glob, and run git (log/blame/show) and \`gh api\`. Use them to understand intent and blast radius — do not rely on the diff alone when a file's purpose is unclear.

Rules:
- Order files as a NARRATIVE: foundational changes (schema, types, core logic) before their consumers; entry points before details.
- Group files into a small number of chapters (typically 2-6). Every changed file must appear in exactly one chapter.
- Classify each file as "mechanical" (rename-only, generated, formatting, lockfile, pure move, trivial import churn) or "substantive" (anything a reviewer must actually think about). When unsure, choose "substantive".
- The summary is a 3-5 sentence walkthrough of what this PR does and why, in plain language.
- Never include review verdicts, approvals, or "looks good / bad" judgements. You describe and organize; the human judges.

Output ONLY a JSON object matching this TypeScript type, with no prose before or after:

{
  "summary": string,              // 3-5 sentences
  "chapters": {
    "title": string,              // e.g. "1. Schema change"
    "summary": string,            // 1-3 sentences
    "files": string[]             // exact file paths from the diff, in review order
  }[],
  "triage": { [filePath: string]: "substantive" | "mechanical" }
}`;

const MAX_PATCH_CHARS_PER_FILE = 6000;
const MAX_TOTAL_PATCH_CHARS = 120_000;

function fileHeader(file: DiffFile): string {
  const rename = file.oldPath && file.oldPath !== file.path ? ` (from ${file.oldPath})` : '';
  const generated = file.isGenerated ? ' [generated]' : '';
  return `### ${file.path}${rename} — ${file.status}, +${file.additions}/-${file.deletions}${generated}`;
}

function filePatch(file: DiffFile): string {
  const lines: string[] = [];
  for (const chunk of file.chunks) {
    lines.push(chunk.header);
    for (const line of chunk.lines) {
      const marker =
        line.type === 'add' ? '+' : line.type === 'delete' || line.type === 'remove' ? '-' : ' ';
      lines.push(`${marker}${line.content}`);
    }
  }
  const text = lines.join('\n');
  return text.length > MAX_PATCH_CHARS_PER_FILE
    ? `${text.slice(0, MAX_PATCH_CHARS_PER_FILE)}\n… [patch truncated]`
    : text;
}

/** Build the user prompt for the prep pass from the diff. */
export function buildPlanPrompt(diff: DiffResponse, context: AiRepoContext | null): string {
  const parts: string[] = [];

  if (context?.pr) {
    parts.push(
      `Pull request: ${context.pr.owner}/${context.pr.repo}#${context.pr.number} on ${context.pr.hostname}.`,
    );
  }
  parts.push(`Head SHA: ${context?.headSha ?? diff.commit ?? 'unknown'}.`);
  parts.push(
    `${diff.files.length} changed file(s). Full patches follow (large patches are truncated — use your tools to read the full files when needed).`,
  );
  parts.push('');

  let total = 0;
  for (const file of diff.files) {
    parts.push(fileHeader(file));
    if (total < MAX_TOTAL_PATCH_CHARS) {
      const patch = filePatch(file);
      total += patch.length;
      parts.push('```diff');
      parts.push(patch);
      parts.push('```');
    } else {
      parts.push('[patch omitted — read the file with your tools if it needs attention]');
    }
    parts.push('');
  }

  parts.push('Produce the ReviewPlan JSON now.');
  return parts.join('\n');
}

/** The exact set of paths that must be covered by the plan's chapters. */
export function changedPaths(diff: DiffResponse): string[] {
  return diff.files.map((f) => f.path);
}

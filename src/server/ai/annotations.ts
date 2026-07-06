import {
  type AiAnnotation,
  type AiAnnotationKind,
  type AiConfidence,
  type AiRepoContext,
} from '../../types/ai.js';
import { type DiffFile, type DiffResponse, type DiffSide } from '../../types/diff.js';

/**
 * Prompt construction + normalization for the AI annotation pass.
 *
 * Annotations flag *what deserves attention and why* — never verdicts. Each is
 * anchored to a concrete diff line (file/side/line) and carries a confidence
 * mark so the reviewer knows whether the agent actually read surrounding code
 * ('looked') or is inferring from the hunk alone ('inferred'). Unanalyzed areas
 * are simply not annotated; the agent is told never to imply completeness.
 */

export const ANNOTATIONS_SYSTEM_PROMPT = `You are buddy's annotation agent. You help a human review a pull request by flagging what deserves their attention — you do NOT judge, approve, or reject anything.

You have read-only tools: read files, grep, glob, and run git (log/blame/show) and \`gh api\`. Use them to understand blast radius and intent. When you actually read surrounding code, mark confidence "looked"; when you are inferring from the hunk alone, mark "inferred". Be honest — an "inferred" note is fine, a falsely-confident one is not.

Produce a SMALL number of high-signal annotations (roughly 3-15 for a typical PR — fewer is better than noise). Each annotation:
- anchors to ONE line that exists in the diff, identified by its file path, side ("new" for added/context lines, "old" for removed lines), and the line number shown in the gutter.
- has a kind:
  - "attention": something the reviewer should look at carefully (subtle logic, edge case, a changed invariant). Describe WHAT and WHY, not a verdict.
  - "context": background that makes the change easier to understand (why it exists, how it connects elsewhere).
  - "blast-radius": a downstream effect or caller the diff doesn't show but that this change affects.
- body: one or two sentences, concrete and specific (e.g. "changes retry semantics: was 3 attempts, now unbounded"). No "consider…", no "should…", no praise or blame.

Do NOT annotate mechanical/trivial lines. Do NOT try to cover every file — silence on an area is fine and honest.

Output ONLY this JSON, no prose:

{
  "annotations": [
    {
      "filePath": string,
      "side": "old" | "new",
      "line": number,
      "kind": "attention" | "context" | "blast-radius",
      "body": string,
      "confidence": "looked" | "inferred"
    }
  ]
}`;

const MAX_PATCH_CHARS_PER_FILE = 8000;
const MAX_TOTAL_PATCH_CHARS = 140_000;

/** Render one file's patch with a line-number gutter so the agent can anchor. */
function filePatchWithLineNumbers(file: DiffFile): string {
  const lines: string[] = [];
  for (const chunk of file.chunks) {
    lines.push(`@@ ${chunk.header} @@`);
    for (const line of chunk.lines) {
      if (line.type === 'delete' || line.type === 'remove') {
        lines.push(`old:${line.oldLineNumber ?? '?'} - ${line.content}`);
      } else if (line.type === 'add') {
        lines.push(`new:${line.newLineNumber ?? '?'} + ${line.content}`);
      } else {
        lines.push(`new:${line.newLineNumber ?? '?'}   ${line.content}`);
      }
    }
  }
  const text = lines.join('\n');
  return text.length > MAX_PATCH_CHARS_PER_FILE
    ? `${text.slice(0, MAX_PATCH_CHARS_PER_FILE)}\n… [patch truncated — read the file with your tools]`
    : text;
}

/** Build the user prompt for the annotation pass. */
export function buildAnnotationsPrompt(diff: DiffResponse, context: AiRepoContext | null): string {
  const parts: string[] = [];
  if (context?.pr) {
    parts.push(
      `Pull request: ${context.pr.owner}/${context.pr.repo}#${context.pr.number} on ${context.pr.hostname}.`,
    );
  }
  parts.push(
    `${diff.files.length} changed file(s). Each patch line is prefixed with "new:N" or "old:N" — use exactly that number and side to anchor an annotation.`,
  );
  parts.push('');

  let total = 0;
  for (const file of diff.files) {
    parts.push(`### ${file.path} — ${file.status}, +${file.additions}/-${file.deletions}`);
    if (total < MAX_TOTAL_PATCH_CHARS) {
      const patch = filePatchWithLineNumbers(file);
      total += patch.length;
      parts.push(patch);
    } else {
      parts.push('[patch omitted — read the file with your tools if it needs attention]');
    }
    parts.push('');
  }

  parts.push('Produce the annotations JSON now.');
  return parts.join('\n');
}

/** Raw (untrusted) annotation shape the agent is asked to emit. */
export interface RawAnnotations {
  annotations?: unknown;
}

/** Build the set of valid "path\0side\0line" anchors that exist in the diff. */
function validAnchorSet(diff: DiffResponse): Set<string> {
  const set = new Set<string>();
  for (const file of diff.files) {
    for (const chunk of file.chunks) {
      for (const line of chunk.lines) {
        if (line.newLineNumber !== undefined) {
          set.add(`${file.path}\0new\0${line.newLineNumber}`);
        }
        if (line.oldLineNumber !== undefined) {
          set.add(`${file.path}\0old\0${line.oldLineNumber}`);
        }
      }
    }
  }
  return set;
}

function asKind(value: unknown): AiAnnotationKind | null {
  return value === 'attention' || value === 'context' || value === 'blast-radius' ? value : null;
}

function asSide(value: unknown): DiffSide | null {
  return value === 'old' || value === 'new' ? value : null;
}

function asConfidence(value: unknown): AiConfidence {
  return value === 'looked' ? 'looked' : 'inferred';
}

/**
 * Turn raw agent output into trustworthy, anchored annotations:
 * - drop anything whose (filePath, side, line) is not an actual diff line, so
 *   the client can always render it against a real row,
 * - drop duplicates and empty bodies,
 * - stamp a deterministic id and the head SHA on each.
 */
export function normalizeAnnotations(
  raw: RawAnnotations,
  diff: DiffResponse,
  headSha: string,
): AiAnnotation[] {
  const valid = validAnchorSet(diff);
  const seen = new Set<string>();
  const result: AiAnnotation[] = [];

  const list = Array.isArray(raw.annotations) ? raw.annotations : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as Record<string, unknown>;

    const filePath = typeof a.filePath === 'string' ? a.filePath : '';
    const side = asSide(a.side);
    const line = typeof a.line === 'number' && Number.isFinite(a.line) ? Math.trunc(a.line) : null;
    const kind = asKind(a.kind);
    const body = typeof a.body === 'string' ? a.body.trim() : '';

    if (!filePath || !side || line === null || !kind || !body) continue;

    const anchorKey = `${filePath}\0${side}\0${line}`;
    if (!valid.has(anchorKey)) continue; // anchor must land on a real diff line
    const dedupeKey = `${anchorKey}\0${kind}\0${body}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    result.push({
      id: `ann-${result.length}-${anchorKey.replace(/\0/g, ':')}`,
      anchor: { filePath, side, line, headSha },
      kind,
      body,
      confidence: asConfidence(a.confidence),
    });
  }

  return result;
}

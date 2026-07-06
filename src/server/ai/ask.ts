import { type AiRepoContext } from '../../types/ai.js';

/**
 * Prompt construction for per-hunk "Ask buddy" chat.
 *
 * The reviewer asks a question about a specific hunk; the agent answers using
 * the hunk, the surrounding file, and its repo tools. This is a Q&A assistant —
 * it explains, traces, and contextualizes, but it does not author review
 * comments or pass verdicts. Its answers help the human write their own.
 */

export const ASK_SYSTEM_PROMPT = `You are buddy, helping a human review a pull request. The reviewer is looking at a specific hunk and asking you a question about it.

Answer concisely and concretely. You have read-only tools (read files, grep, glob, git log/blame/show, \`gh api\`) — use them to trace callers, history, and blast radius rather than guessing. If you inspect surrounding code, say what you found; if you are unsure, say so plainly.

You are an assistant to the reviewer, not the reviewer. Do NOT issue verdicts ("looks good", "this is a bug you must fix"), approvals, or rubber-stamps. Explain what the code does and why, surface risks and connections, answer the question asked. The human decides and writes the comments.

Keep answers tight — a few sentences or a short list. Use markdown. Prefer specifics (names, line numbers, behavior) over generalities.`;

export interface AskRequest {
  filePath: string;
  side: 'old' | 'new';
  line: number;
  question: string;
  /** The hunk's text as shown to the reviewer (optional but helpful). */
  hunkContent?: string;
  /** Prior turns in this hunk conversation. */
  history?: { role: 'user' | 'assistant'; content: string }[];
}

/** Parse and validate an /api/ai/ask body. Returns null when malformed. */
export function parseAskRequest(body: unknown): AskRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const filePath = typeof b.filePath === 'string' ? b.filePath : '';
  const side = b.side === 'old' || b.side === 'new' ? b.side : null;
  const line = typeof b.line === 'number' && Number.isFinite(b.line) ? Math.trunc(b.line) : null;
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!filePath || !side || line === null || !question) return null;

  const hunkContent = typeof b.hunkContent === 'string' ? b.hunkContent : undefined;
  const history = Array.isArray(b.history)
    ? b.history
        .filter((m): m is { role: 'user' | 'assistant'; content: string } => {
          if (!m || typeof m !== 'object') return false;
          const msg = m as Record<string, unknown>;
          return (
            (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string'
          );
        })
        .slice(-12) // bound history so prompts stay small
    : undefined;

  return {
    filePath,
    side,
    line,
    question,
    ...(hunkContent ? { hunkContent } : {}),
    ...(history && history.length > 0 ? { history } : {}),
  };
}

/** Build the user prompt for a single Ask-buddy turn. */
export function buildAskPrompt(req: AskRequest, context: AiRepoContext | null): string {
  const parts: string[] = [];
  if (context?.pr) {
    parts.push(
      `Pull request: ${context.pr.owner}/${context.pr.repo}#${context.pr.number} on ${context.pr.hostname}.`,
    );
  }
  parts.push(
    `The reviewer is looking at ${req.filePath} around ${req.side}-side line ${req.line}.`,
  );

  if (req.hunkContent) {
    parts.push('\nThe hunk under discussion:\n```diff');
    parts.push(req.hunkContent.slice(0, 8000));
    parts.push('```');
  }

  if (req.history && req.history.length > 0) {
    parts.push('\nConversation so far:');
    for (const message of req.history) {
      parts.push(`${message.role === 'user' ? 'Reviewer' : 'buddy'}: ${message.content}`);
    }
  }

  parts.push(`\nReviewer's question: ${req.question}`);
  parts.push('\nAnswer now. Read the file/repo with your tools if it helps.');
  return parts.join('\n');
}

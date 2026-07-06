import { query, type Options, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';

import { getAiConfig } from './config.js';

/**
 * Minimal, concrete view of the SDK message stream — only the fields buddy
 * reads. We consume the stream through this shape (rather than the SDK's large
 * generated union) so both `tsc` and the type-aware linter can reason about the
 * accesses below without depending on the SDK's declaration internals.
 */
interface StreamTextBlock {
  type: string;
  text?: string;
}
interface StreamMessage {
  type: string;
  message?: { content: StreamTextBlock[] };
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  errors?: string[];
}

/**
 * Thin wrapper around the Claude Agent SDK's `query()`.
 *
 * The prep pass and Ask-AI chat both need an agent that can *see beyond the
 * diff*: read the checked-out repo, run `git log`/`blame`, and query `gh api`.
 * So we run with the repo as cwd and a read-only tool set (Read/Grep/Glob plus
 * Bash for git/gh), while hard-blocking mutating tools. buddy never lets the
 * agent write to the working tree.
 */

// Read-only exploration tools. Bash is included for `git log`/`blame`/`gh api`;
// mutating tools are hard-blocked below regardless of permission mode.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const BLOCKED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

export interface RunAgentParams {
  /** The task prompt. */
  prompt: string;
  /** System prompt describing the agent's role. */
  systemPrompt: string;
  /** Repository root; the agent's working directory for file/git tools. */
  cwd: string;
  /** Upper bound on agent turns. Prep pass is exploratory; chat is short. */
  maxTurns?: number;
  /** Abort signal so in-flight passes can be cancelled (e.g. head SHA changed). */
  signal?: AbortSignal;
  /** Called with each assistant text chunk as it streams in (optional). */
  onText?: (text: string) => void;
}

interface AgentResult {
  /** Final assistant text (the agent's answer / JSON payload). */
  text: string;
  costUsd: number;
}

/**
 * Run a one-shot agent task to completion and return its final text.
 * Throws on agent error (auth failures included — callers classify via
 * `isAuthError`).
 */
async function runAgent(params: RunAgentParams): Promise<AgentResult> {
  const config = getAiConfig();
  const permissionMode: PermissionMode = 'bypassPermissions';

  const options: Options = {
    cwd: params.cwd,
    model: config.model,
    systemPrompt: params.systemPrompt,
    allowedTools: READ_ONLY_TOOLS,
    disallowedTools: BLOCKED_TOOLS,
    permissionMode,
    allowDangerouslySkipPermissions: true,
    maxTurns: params.maxTurns ?? 30,
    ...(params.signal ? { abortController: toAbortController(params.signal) } : {}),
  };

  let finalText = '';
  let costUsd = 0;

  const stream = query({
    prompt: params.prompt,
    options,
  }) as unknown as AsyncIterable<StreamMessage>;
  for await (const message of stream) {
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text' && block.text) {
          params.onText?.(block.text);
        }
      }
    } else if (message.type === 'result') {
      costUsd = message.total_cost_usd ?? 0;
      if (message.subtype === 'success') {
        finalText = message.result ?? '';
      } else {
        const detail = message.errors?.join('; ') ?? message.subtype ?? 'unknown';
        throw new Error(`Agent run failed (${message.subtype ?? 'error'}): ${detail}`);
      }
    }
  }

  return { text: finalText, costUsd };
}

/**
 * Run an agent expected to return a single JSON value and parse it.
 * Tolerates the model wrapping JSON in prose or ```json fences.
 */
export async function runJsonAgent<T>(params: RunAgentParams): Promise<T> {
  const { text } = await runAgent(params);
  return extractJson<T>(text);
}

/** Pull the first well-formed JSON object/array out of an agent's text reply. */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();

  // Prefer a fenced ```json block when present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], trimmed] : [trimmed];

  for (const candidate of candidates) {
    const parsed = tryParseJson<T>(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  // Fall back to the first {...} or [...] span.
  const span = sliceJsonSpan(trimmed);
  if (span) {
    const parsed = tryParseJson<T>(span);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  throw new Error('Agent did not return parseable JSON');
}

function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    return undefined;
  }
}

function sliceJsonSpan(text: string): string | null {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) {
    return null;
  }
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function toAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller;
}

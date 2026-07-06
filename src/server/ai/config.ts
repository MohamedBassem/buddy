/**
 * AI configuration + credential handling.
 *
 * Auth strategy (mirrors buddy's "reuse existing auth, store no tokens" stance
 * for GitHub via the gh CLI): the Claude Agent SDK authenticates with, in order,
 *   1. ANTHROPIC_API_KEY from the environment, or
 *   2. an existing local Claude Code / claude.ai login (OAuth credentials the
 *      SDK picks up on its own).
 * Buddy never persists a key. We surface a helpful message only if a run fails
 * with an auth error at request time, rather than gatekeeping up front — that
 * way subscription-auth users (no env key) still work.
 */

export interface AiConfig {
  /** Whether AI features are enabled at all. */
  enabled: boolean;
  /** Model id for the prep pass; overridable via BUDDY_AI_MODEL. */
  model: string;
  /** True when an explicit API key is present in the environment. */
  hasExplicitApiKey: boolean;
}

const DEFAULT_MODEL = 'claude-opus-4-8';

export function getAiConfig(): AiConfig {
  return {
    enabled: process.env.BUDDY_DISABLE_AI !== '1' && process.env.BUDDY_DISABLE_AI !== 'true',
    model: process.env.BUDDY_AI_MODEL?.trim() || DEFAULT_MODEL,
    hasExplicitApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  };
}

/** True if the given error looks like an authentication/credentials failure. */
export function isAuthError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('api key') ||
    message.includes('oauth') ||
    message.includes('credentials') ||
    message.includes('401')
  );
}

export const AUTH_HELP_MESSAGE =
  'Buddy could not authenticate with Claude. Set ANTHROPIC_API_KEY in your environment, ' +
  'or log in with the Claude Code CLI (`claude login`), then reload.';

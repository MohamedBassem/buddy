import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPrRefs, parseGitHubPrUrl, parsePrCommentImportsResponse } from './github';

function createReviewComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'COMMENT_1',
    body: 'Imported comment',
    createdAt: '2026-03-25T09:00:00Z',
    updatedAt: '2026-03-25T09:05:00Z',
    author: { login: 'octocat' },
    ...overrides,
  };
}

function createReviewThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'THREAD_1',
    isResolved: false,
    isOutdated: false,
    subjectType: 'LINE',
    path: 'src/example.ts',
    diffSide: 'RIGHT',
    startDiffSide: null,
    line: 12,
    startLine: null,
    originalLine: 11,
    originalStartLine: null,
    comments: {
      nodes: [createReviewComment()],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CLI GitHub utils', () => {
  describe('parsePrCommentImportsResponse', () => {
    it('imports unresolved inline threads, sorts comments, and skips non-importable threads', () => {
      const response = {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  createReviewThread({
                    id: 'THREAD_UNRESOLVED',
                    diffSide: 'RIGHT',
                    line: 14,
                    comments: {
                      nodes: [
                        createReviewComment({
                          id: 'COMMENT_REPLY',
                          body: 'Second comment',
                          createdAt: '2026-03-25T09:10:00Z',
                          updatedAt: '2026-03-25T09:12:00Z',
                          author: { login: 'reviewer-2' },
                        }),
                        createReviewComment({
                          id: 'COMMENT_ROOT',
                          body: 'First comment',
                          createdAt: '2026-03-25T09:00:00Z',
                          updatedAt: '2026-03-25T09:05:00Z',
                          author: { login: 'reviewer-1' },
                        }),
                      ],
                    },
                  }),
                  createReviewThread({
                    id: 'THREAD_RESOLVED',
                    isResolved: true,
                  }),
                  createReviewThread({
                    id: 'THREAD_OUTDATED',
                    isOutdated: true,
                  }),
                  createReviewThread({
                    id: 'THREAD_FILE',
                    subjectType: 'FILE',
                  }),
                ],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: 'CURSOR_1',
                },
              },
            },
          },
        },
      };

      const result = parsePrCommentImportsResponse(response);

      expect(result).toEqual({
        commentImports: [
          {
            type: 'thread',
            id: 'COMMENT_ROOT',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 14 },
            body: 'First comment',
            author: 'reviewer-1',
            createdAt: '2026-03-25T09:00:00Z',
            updatedAt: '2026-03-25T09:05:00Z',
          },
          {
            type: 'reply',
            id: 'COMMENT_REPLY',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 14 },
            body: 'Second comment',
            author: 'reviewer-2',
            createdAt: '2026-03-25T09:10:00Z',
            updatedAt: '2026-03-25T09:12:00Z',
          },
        ],
        pageInfo: {
          hasNextPage: true,
          endCursor: 'CURSOR_1',
        },
      });
    });

    it('maps RIGHT and LEFT threads to new and old diff positions for single and multi-line comments', () => {
      const response = {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  createReviewThread({
                    id: 'THREAD_RIGHT_SINGLE',
                    diffSide: 'RIGHT',
                    line: 20,
                    startLine: 20,
                    startDiffSide: null,
                    comments: {
                      nodes: [createReviewComment({ id: 'COMMENT_RIGHT_SINGLE' })],
                    },
                  }),
                  createReviewThread({
                    id: 'THREAD_RIGHT_MULTI',
                    diffSide: 'RIGHT',
                    line: 24,
                    startLine: 21,
                    startDiffSide: 'RIGHT',
                    comments: {
                      nodes: [createReviewComment({ id: 'COMMENT_RIGHT_MULTI' })],
                    },
                  }),
                  createReviewThread({
                    id: 'THREAD_LEFT_SINGLE',
                    diffSide: 'LEFT',
                    line: null,
                    originalLine: 8,
                    originalStartLine: null,
                    startDiffSide: null,
                    comments: {
                      nodes: [createReviewComment({ id: 'COMMENT_LEFT_SINGLE' })],
                    },
                  }),
                  createReviewThread({
                    id: 'THREAD_LEFT_MULTI',
                    diffSide: 'LEFT',
                    line: null,
                    originalLine: 11,
                    originalStartLine: 7,
                    startDiffSide: 'LEFT',
                    comments: {
                      nodes: [createReviewComment({ id: 'COMMENT_LEFT_MULTI' })],
                    },
                  }),
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null,
                },
              },
            },
          },
        },
      };

      const result = parsePrCommentImportsResponse(response);

      expect(result.commentImports).toEqual([
        {
          type: 'thread',
          id: 'COMMENT_RIGHT_SINGLE',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 20 },
          body: 'Imported comment',
          author: 'octocat',
          createdAt: '2026-03-25T09:00:00Z',
          updatedAt: '2026-03-25T09:05:00Z',
        },
        {
          type: 'thread',
          id: 'COMMENT_RIGHT_MULTI',
          filePath: 'src/example.ts',
          position: { side: 'new', line: { start: 21, end: 24 } },
          body: 'Imported comment',
          author: 'octocat',
          createdAt: '2026-03-25T09:00:00Z',
          updatedAt: '2026-03-25T09:05:00Z',
        },
        {
          type: 'thread',
          id: 'COMMENT_LEFT_SINGLE',
          filePath: 'src/example.ts',
          position: { side: 'old', line: 8 },
          body: 'Imported comment',
          author: 'octocat',
          createdAt: '2026-03-25T09:00:00Z',
          updatedAt: '2026-03-25T09:05:00Z',
        },
        {
          type: 'thread',
          id: 'COMMENT_LEFT_MULTI',
          filePath: 'src/example.ts',
          position: { side: 'old', line: { start: 7, end: 11 } },
          body: 'Imported comment',
          author: 'octocat',
          createdAt: '2026-03-25T09:00:00Z',
          updatedAt: '2026-03-25T09:05:00Z',
        },
      ]);
    });

    it('warns and skips threads with invalid line mapping', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const response = {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  createReviewThread({
                    id: 'THREAD_RIGHT_MISSING_LINE',
                    diffSide: 'RIGHT',
                    line: null,
                  }),
                  createReviewThread({
                    id: 'THREAD_LEFT_MISSING_ORIGINAL',
                    diffSide: 'LEFT',
                    line: null,
                    originalLine: null,
                  }),
                  createReviewThread({
                    id: 'THREAD_RIGHT_BAD_RANGE',
                    diffSide: 'RIGHT',
                    line: 9,
                    startLine: 12,
                    startDiffSide: 'RIGHT',
                  }),
                  createReviewThread({
                    id: 'THREAD_LEFT_BAD_SIDE',
                    diffSide: 'LEFT',
                    line: null,
                    originalLine: 9,
                    originalStartLine: 7,
                    startDiffSide: 'RIGHT',
                  }),
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null,
                },
              },
            },
          },
        },
      };

      const result = parsePrCommentImportsResponse(response);

      expect(result.commentImports).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(4);
      expect(warnSpy).toHaveBeenNthCalledWith(
        1,
        'Warning: Skipping PR review thread THREAD_RIGHT_MISSING_LINE: RIGHT thread is missing line.',
      );
      expect(warnSpy).toHaveBeenNthCalledWith(
        2,
        'Warning: Skipping PR review thread THREAD_LEFT_MISSING_ORIGINAL: LEFT thread is missing originalLine.',
      );
      expect(warnSpy).toHaveBeenNthCalledWith(
        3,
        'Warning: Skipping PR review thread THREAD_RIGHT_BAD_RANGE: RIGHT thread has an invalid multi-line range.',
      );
      expect(warnSpy).toHaveBeenNthCalledWith(
        4,
        'Warning: Skipping PR review thread THREAD_LEFT_BAD_SIDE: LEFT thread has mismatched startDiffSide.',
      );
    });
  });

  describe('parseGitHubPrUrl', () => {
    it('should parse valid GitHub PR URLs', () => {
      const result = parseGitHubPrUrl('https://github.com/owner/repo/pull/123');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        pullNumber: 123,
        hostname: 'github.com',
      });
    });

    it('should parse GitHub PR URLs with additional path segments', () => {
      const result = parseGitHubPrUrl('https://github.com/owner/repo/pull/456/files');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        pullNumber: 456,
        hostname: 'github.com',
      });
    });

    it('should parse GitHub PR URLs with query parameters', () => {
      const result = parseGitHubPrUrl('https://github.com/owner/repo/pull/789?tab=files');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        pullNumber: 789,
        hostname: 'github.com',
      });
    });

    it('should handle URLs with hyphens and underscores in owner/repo names', () => {
      const result = parseGitHubPrUrl('https://github.com/owner-name/repo_name/pull/123');
      expect(result).toEqual({
        owner: 'owner-name',
        repo: 'repo_name',
        pullNumber: 123,
        hostname: 'github.com',
      });
    });

    it('should parse GitHub Enterprise PR URLs', () => {
      const result1 = parseGitHubPrUrl('https://github.enterprise.com/owner/repo/pull/123');
      expect(result1).toEqual({
        owner: 'owner',
        repo: 'repo',
        pullNumber: 123,
        hostname: 'github.enterprise.com',
      });

      const result2 = parseGitHubPrUrl('https://git.company.io/team/project/pull/456');
      expect(result2).toEqual({
        owner: 'team',
        repo: 'project',
        pullNumber: 456,
        hostname: 'git.company.io',
      });
    });

    it('should return null for invalid URLs', () => {
      expect(parseGitHubPrUrl('not-a-url')).toBe(null);
      expect(parseGitHubPrUrl('https://github.com/owner/repo/issues/123')).toBe(null);
      expect(parseGitHubPrUrl('https://github.com/owner/repo')).toBe(null);
      expect(parseGitHubPrUrl('https://github.com/owner/repo/pull/abc')).toBe(null);
    });

    it('should handle malformed URLs gracefully', () => {
      expect(parseGitHubPrUrl('')).toBe(null);
      expect(parseGitHubPrUrl('https://github.com')).toBe(null);
      expect(parseGitHubPrUrl('https://github.com/owner')).toBe(null);
      expect(parseGitHubPrUrl('https://github.com/owner/repo/pull')).toBe(null);
    });
  });

  describe('getPrRefs', () => {
    it('resolves head SHA and the merge-base as the base SHA', () => {
      const run = vi.fn((args: string[]) => {
        const endpoint = args[3] ?? '';
        if (endpoint.startsWith('repos/owner/repo/pulls/')) {
          return JSON.stringify({ base: 'baseTip', head: 'headSha' });
        }
        if (endpoint.startsWith('repos/owner/repo/compare/')) {
          return 'mergeBaseSha\n';
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      });

      const refs = getPrRefs('https://github.com/owner/repo/pull/42', run);
      expect(refs).toEqual({ baseSha: 'mergeBaseSha', headSha: 'headSha' });
      // Compare is requested against the base branch tip, not the merge-base.
      expect(run.mock.calls[1]?.[0]).toContain('repos/owner/repo/compare/baseTip...headSha');
    });

    it('falls back to the base branch tip when the compare call fails', () => {
      const run = vi.fn((args: string[]) => {
        const endpoint = args[3] ?? '';
        if (endpoint.startsWith('repos/owner/repo/pulls/')) {
          return JSON.stringify({ base: 'baseTip', head: 'headSha' });
        }
        throw new Error('compare failed');
      });

      const refs = getPrRefs('https://github.com/owner/repo/pull/42', run);
      expect(refs).toEqual({ baseSha: 'baseTip', headSha: 'headSha' });
    });

    it('passes the enterprise hostname to gh', () => {
      const run = vi.fn((args: string[]) => {
        const endpoint = args[3] ?? '';
        if (endpoint.startsWith('repos/team/project/pulls/')) {
          return JSON.stringify({ base: 'b', head: 'h' });
        }
        return 'mb';
      });

      getPrRefs('https://git.company.io/team/project/pull/9', run);
      expect(run.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining(['--hostname', 'git.company.io']),
      );
    });

    it('throws when the PR response is missing SHAs', () => {
      const run = vi.fn(() => JSON.stringify({}));
      expect(() => getPrRefs('https://github.com/owner/repo/pull/42', run)).toThrow(
        /missing base\/head SHA/,
      );
    });

    it('throws for an invalid PR URL', () => {
      const run = vi.fn();
      expect(() => getPrRefs('not-a-url', run)).toThrow(/Invalid GitHub PR URL/);
      expect(run).not.toHaveBeenCalled();
    });
  });
});

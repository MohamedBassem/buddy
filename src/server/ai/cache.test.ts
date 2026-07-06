import { describe, it, expect } from 'vitest';

import { type AiRepoContext } from '../../types/ai';

import { cacheKey } from './cache';

const base: AiRepoContext = { repoPath: '/tmp/repo', headSha: 'sha1' };

describe('cacheKey', () => {
  it('is stable for the same context', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  });

  it('changes when the head SHA changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, headSha: 'sha2' }));
  });

  it('keys PRs by identity, not local path, so two checkouts share a cache', () => {
    const pr = { owner: 'o', repo: 'r', number: 7, hostname: 'github.com' };
    const a: AiRepoContext = { repoPath: '/a', headSha: 'sha', pr };
    const b: AiRepoContext = { repoPath: '/b', headSha: 'sha', pr };
    expect(cacheKey(a)).toBe(cacheKey(b));
  });

  it('distinguishes different PRs', () => {
    const pr1 = { owner: 'o', repo: 'r', number: 7, hostname: 'github.com' };
    const pr2 = { owner: 'o', repo: 'r', number: 8, hostname: 'github.com' };
    expect(cacheKey({ ...base, pr: pr1 })).not.toBe(cacheKey({ ...base, pr: pr2 }));
  });
});

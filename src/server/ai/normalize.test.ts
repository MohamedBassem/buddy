import { describe, it, expect } from 'vitest';

import { normalizeReviewPlan } from './normalize';

describe('normalizeReviewPlan', () => {
  const changed = ['a.ts', 'b.ts', 'c.ts'];

  it('keeps only changed files and preserves plan order', () => {
    const plan = normalizeReviewPlan(
      {
        summary: 'does things',
        chapters: [
          { title: '1. core', summary: 'x', files: ['b.ts', 'a.ts', 'ghost.ts'] },
          { title: '2. rest', summary: '', files: ['c.ts'] },
        ],
        triage: { 'a.ts': 'mechanical', 'b.ts': 'substantive' },
      },
      changed,
      'sha1',
    );

    expect(plan.headSha).toBe('sha1');
    expect(plan.summary).toBe('does things');
    expect(plan.chapters.map((c) => c.files)).toEqual([['b.ts', 'a.ts'], ['c.ts']]);
    // 'ghost.ts' is not a changed file and must be dropped.
    expect(plan.chapters.flatMap((c) => c.files)).not.toContain('ghost.ts');
  });

  it('appends files the agent forgot to a trailing catch-all chapter', () => {
    const plan = normalizeReviewPlan(
      { chapters: [{ title: '1', summary: '', files: ['a.ts'] }] },
      changed,
      'sha',
    );
    const allFiles = plan.chapters.flatMap((c) => c.files);
    expect(allFiles.sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(plan.chapters.at(-1)?.title).toBe('Everything else');
  });

  it('never duplicates a file even if the agent lists it twice', () => {
    const plan = normalizeReviewPlan(
      {
        chapters: [
          { title: '1', summary: '', files: ['a.ts', 'a.ts'] },
          { title: '2', summary: '', files: ['a.ts', 'b.ts'] },
        ],
      },
      changed,
      'sha',
    );
    const allFiles = plan.chapters.flatMap((c) => c.files);
    expect(allFiles.filter((f) => f === 'a.ts')).toHaveLength(1);
  });

  it('defaults triage to substantive and only trusts known classes', () => {
    const plan = normalizeReviewPlan(
      { chapters: [], triage: { 'a.ts': 'mechanical', 'b.ts': 'garbage' } },
      changed,
      'sha',
    );
    expect(plan.triage['a.ts']).toBe('mechanical');
    expect(plan.triage['b.ts']).toBe('substantive');
    expect(plan.triage['c.ts']).toBe('substantive');
  });

  it('tolerates completely malformed input', () => {
    const plan = normalizeReviewPlan(
      { summary: 42, chapters: 'nope', triage: null },
      changed,
      'sha',
    );
    expect(plan.summary).toBe('');
    expect(plan.chapters.flatMap((c) => c.files).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

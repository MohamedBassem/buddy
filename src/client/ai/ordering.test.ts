import { describe, it, expect } from 'vitest';

import { type ReviewPlan } from '../../types/ai';
import { type DiffFile } from '../../types/diff';

import { orderFilesByPlan, sameFileOrder, chapterIndexByPath } from './ordering';

function file(path: string): DiffFile {
  return { path, status: 'modified', additions: 1, deletions: 0, chunks: [] };
}

function plan(chapters: { files: string[] }[]): ReviewPlan {
  return {
    headSha: 'sha',
    summary: '',
    chapters: chapters.map((c, i) => ({ title: `${i}`, summary: '', files: c.files })),
    triage: {},
  };
}

describe('orderFilesByPlan', () => {
  const files = [file('a.ts'), file('b.ts'), file('c.ts')];

  it('returns files unchanged when there is no plan', () => {
    expect(orderFilesByPlan(files, null)).toBe(files);
  });

  it('reorders files to match chapter order', () => {
    const ordered = orderFilesByPlan(
      files,
      plan([{ files: ['c.ts', 'a.ts'] }, { files: ['b.ts'] }]),
    );
    expect(ordered.map((f) => f.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('appends files the plan omits, preserving their original order', () => {
    const ordered = orderFilesByPlan(files, plan([{ files: ['c.ts'] }]));
    expect(ordered.map((f) => f.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('never drops or duplicates a file when the plan references unknown paths', () => {
    const ordered = orderFilesByPlan(files, plan([{ files: ['ghost.ts', 'b.ts', 'b.ts'] }]));
    expect(ordered.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(ordered).toHaveLength(3);
  });
});

describe('sameFileOrder', () => {
  it('detects equal and differing orders', () => {
    expect(sameFileOrder([file('a.ts'), file('b.ts')], [file('a.ts'), file('b.ts')])).toBe(true);
    expect(sameFileOrder([file('a.ts'), file('b.ts')], [file('b.ts'), file('a.ts')])).toBe(false);
    expect(sameFileOrder([file('a.ts')], [file('a.ts'), file('b.ts')])).toBe(false);
  });
});

describe('chapterIndexByPath', () => {
  it('maps each path to its first chapter index', () => {
    const map = chapterIndexByPath(plan([{ files: ['a.ts'] }, { files: ['b.ts', 'a.ts'] }]));
    expect(map.get('a.ts')).toBe(0);
    expect(map.get('b.ts')).toBe(1);
  });
});

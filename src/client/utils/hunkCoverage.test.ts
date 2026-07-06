import { describe, it, expect } from 'vitest';

import { type DiffChunk, type DiffFile } from '../../types/diff';

import { allHunkKeys, hunkKey } from './hunkCoverage';

function chunk(lines: DiffChunk['lines'], header = '@@ -1 +1 @@'): DiffChunk {
  return { header, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines };
}

describe('hunkKey', () => {
  it('is stable for the same changed content', () => {
    const a = chunk([{ type: 'add', content: 'const x = 1;', newLineNumber: 1 }]);
    const b = chunk(
      [{ type: 'add', content: 'const x = 1;', newLineNumber: 1 }],
      '@@ different @@',
    );
    expect(hunkKey('f.ts', a)).toBe(hunkKey('f.ts', b));
  });

  it('ignores surrounding context lines (stable across context expansion)', () => {
    const tight = chunk([{ type: 'add', content: 'changed', newLineNumber: 5 }]);
    const expanded = chunk([
      { type: 'normal', content: 'ctx above', oldLineNumber: 4, newLineNumber: 4 },
      { type: 'add', content: 'changed', newLineNumber: 5 },
      { type: 'normal', content: 'ctx below', oldLineNumber: 5, newLineNumber: 6 },
    ]);
    expect(hunkKey('f.ts', tight)).toBe(hunkKey('f.ts', expanded));
  });

  it('changes when the actual change changes (reworked hunk reverts to unreviewed)', () => {
    const before = chunk([{ type: 'add', content: 'retries = 3', newLineNumber: 1 }]);
    const after = chunk([{ type: 'add', content: 'retries = unbounded', newLineNumber: 1 }]);
    expect(hunkKey('f.ts', before)).not.toBe(hunkKey('f.ts', after));
  });

  it('differs by file path for identical content', () => {
    const c = chunk([{ type: 'add', content: 'same', newLineNumber: 1 }]);
    expect(hunkKey('a.ts', c)).not.toBe(hunkKey('b.ts', c));
  });
});

describe('allHunkKeys', () => {
  it('produces one key per chunk across files', () => {
    const files: DiffFile[] = [
      {
        path: 'a.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        chunks: [
          chunk([{ type: 'add', content: 'one', newLineNumber: 1 }]),
          chunk([{ type: 'add', content: 'two', newLineNumber: 2 }]),
        ],
      },
      {
        path: 'b.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        chunks: [chunk([{ type: 'add', content: 'three', newLineNumber: 1 }])],
      },
    ];
    expect(allHunkKeys(files)).toHaveLength(3);
    expect(new Set(allHunkKeys(files)).size).toBe(3);
  });
});

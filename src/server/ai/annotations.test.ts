import { describe, it, expect } from 'vitest';

import { type DiffResponse } from '../../types/diff';

import { normalizeAnnotations } from './annotations';

function diffWith(): DiffResponse {
  return {
    commit: 'sha',
    files: [
      {
        path: 'a.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [
          {
            header: '@@ -1,2 +1,2 @@',
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: [
              { type: 'delete', content: 'old line', oldLineNumber: 10 },
              { type: 'add', content: 'new line', newLineNumber: 10 },
              { type: 'normal', content: 'ctx', oldLineNumber: 11, newLineNumber: 11 },
            ],
          },
        ],
      },
    ],
  };
}

describe('normalizeAnnotations', () => {
  const diff = diffWith();

  it('keeps annotations anchored to real diff lines', () => {
    const out = normalizeAnnotations(
      {
        annotations: [
          {
            filePath: 'a.ts',
            side: 'new',
            line: 10,
            kind: 'attention',
            body: 'x',
            confidence: 'looked',
          },
          {
            filePath: 'a.ts',
            side: 'old',
            line: 10,
            kind: 'context',
            body: 'y',
            confidence: 'inferred',
          },
        ],
      },
      diff,
      'sha',
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.anchor).toMatchObject({
      filePath: 'a.ts',
      side: 'new',
      line: 10,
      headSha: 'sha',
    });
    expect(out[0]?.confidence).toBe('looked');
  });

  it('drops annotations whose anchor is not a real diff line', () => {
    const out = normalizeAnnotations(
      {
        annotations: [
          { filePath: 'a.ts', side: 'new', line: 999, kind: 'attention', body: 'x' },
          { filePath: 'ghost.ts', side: 'new', line: 10, kind: 'attention', body: 'x' },
        ],
      },
      diff,
      'sha',
    );
    expect(out).toHaveLength(0);
  });

  it('drops entries with invalid kind/side or empty body, and defaults confidence', () => {
    const out = normalizeAnnotations(
      {
        annotations: [
          { filePath: 'a.ts', side: 'new', line: 10, kind: 'bogus', body: 'x' },
          { filePath: 'a.ts', side: 'sideways', line: 10, kind: 'attention', body: 'x' },
          { filePath: 'a.ts', side: 'new', line: 11, kind: 'attention', body: '   ' },
          { filePath: 'a.ts', side: 'new', line: 11, kind: 'attention', body: 'ok' },
        ],
      },
      diff,
      'sha',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.body).toBe('ok');
    expect(out[0]?.confidence).toBe('inferred');
  });

  it('dedupes identical anchor+kind+body', () => {
    const one = {
      filePath: 'a.ts',
      side: 'new' as const,
      line: 10,
      kind: 'attention' as const,
      body: 'dup',
    };
    const out = normalizeAnnotations({ annotations: [one, { ...one }] }, diff, 'sha');
    expect(out).toHaveLength(1);
  });

  it('tolerates malformed input', () => {
    expect(normalizeAnnotations({ annotations: 'nope' }, diff, 'sha')).toEqual([]);
    expect(normalizeAnnotations({}, diff, 'sha')).toEqual([]);
  });
});

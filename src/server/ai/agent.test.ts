import { describe, it, expect } from 'vitest';

import { extractJson } from './agent';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a ```json fence', () => {
    const text = 'Here is the plan:\n```json\n{"a":1,"b":[2,3]}\n```\nDone.';
    expect(extractJson(text)).toEqual({ a: 1, b: [2, 3] });
  });

  it('parses JSON inside an unlabeled fence', () => {
    expect(extractJson('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('falls back to the first {...} span amid prose', () => {
    expect(extractJson('sure! {"ok":true} hope that helps')).toEqual({ ok: true });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/parseable JSON/);
  });
});

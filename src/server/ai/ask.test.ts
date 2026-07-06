import { describe, it, expect } from 'vitest';

import { parseAskRequest, buildAskPrompt } from './ask';

describe('parseAskRequest', () => {
  const valid = { filePath: 'a.ts', side: 'new', line: 12, question: 'why?' };

  it('accepts a well-formed request', () => {
    expect(parseAskRequest(valid)).toMatchObject({
      filePath: 'a.ts',
      side: 'new',
      line: 12,
      question: 'why?',
    });
  });

  it('rejects missing/invalid fields', () => {
    expect(parseAskRequest(null)).toBeNull();
    expect(parseAskRequest({ ...valid, filePath: '' })).toBeNull();
    expect(parseAskRequest({ ...valid, side: 'middle' })).toBeNull();
    expect(parseAskRequest({ ...valid, line: 'x' })).toBeNull();
    expect(parseAskRequest({ ...valid, question: '   ' })).toBeNull();
  });

  it('keeps only valid history messages and bounds their count', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }));
    const parsed = parseAskRequest({
      ...valid,
      history: [...history, { role: 'bad', content: 'x' }],
    });
    expect(parsed?.history).toBeDefined();
    expect(parsed?.history?.length).toBe(12);
    expect(parsed?.history?.every((m) => m.role === 'user')).toBe(true);
  });
});

describe('buildAskPrompt', () => {
  it('includes the hunk, history, and the question', () => {
    const prompt = buildAskPrompt(
      {
        filePath: 'a.ts',
        side: 'new',
        line: 3,
        question: 'what calls this?',
        hunkContent: '+const x = 1;',
        history: [{ role: 'user', content: 'earlier' }],
      },
      null,
    );
    expect(prompt).toContain('a.ts');
    expect(prompt).toContain('+const x = 1;');
    expect(prompt).toContain('earlier');
    expect(prompt).toContain('what calls this?');
  });
});

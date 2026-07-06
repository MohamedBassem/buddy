import { describe, it, expect } from 'vitest';

import { type DiffCommentThread } from '../types/diff';

import {
  buildReviewPayload,
  mapThreadToReviewComment,
  parseSubmitReviewInput,
} from './github-write';

function thread(overrides: Partial<DiffCommentThread> & { id: string }): DiffCommentThread {
  return {
    id: overrides.id,
    filePath: overrides.filePath ?? 'a.ts',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    position: overrides.position ?? { side: 'new', line: 10 },
    messages: overrides.messages ?? [
      { id: 'm1', body: 'hello', author: 'me', createdAt: '', updatedAt: '' },
    ],
  };
}

describe('mapThreadToReviewComment', () => {
  it('maps a new-side single line to RIGHT', () => {
    const out = mapThreadToReviewComment(thread({ id: '1', position: { side: 'new', line: 10 } }));
    expect(out).toEqual({ comment: { path: 'a.ts', body: 'hello', side: 'RIGHT', line: 10 } });
  });

  it('maps an old-side single line to LEFT', () => {
    const out = mapThreadToReviewComment(thread({ id: '1', position: { side: 'old', line: 4 } }));
    expect(out).toEqual({ comment: { path: 'a.ts', body: 'hello', side: 'LEFT', line: 4 } });
  });

  it('maps a multi-line range with start_line/start_side', () => {
    const out = mapThreadToReviewComment(
      thread({ id: '1', position: { side: 'new', line: { start: 5, end: 9 } } }),
    );
    expect(out).toEqual({
      comment: {
        path: 'a.ts',
        body: 'hello',
        side: 'RIGHT',
        line: 9,
        start_line: 5,
        start_side: 'RIGHT',
      },
    });
  });

  it('collapses a degenerate range to a single line', () => {
    const out = mapThreadToReviewComment(
      thread({ id: '1', position: { side: 'new', line: { start: 7, end: 7 } } }),
    );
    expect(out).toEqual({ comment: { path: 'a.ts', body: 'hello', side: 'RIGHT', line: 7 } });
  });

  it('joins multiple messages into one body', () => {
    const out = mapThreadToReviewComment(
      thread({
        id: '1',
        messages: [
          { id: 'm1', body: 'first', author: '', createdAt: '', updatedAt: '' },
          { id: 'm2', body: 'second', author: '', createdAt: '', updatedAt: '' },
        ],
      }),
    );
    expect('comment' in out && out.comment.body).toBe('first\n\nsecond');
  });

  it('skips empty bodies and invalid lines', () => {
    expect(
      mapThreadToReviewComment(
        thread({
          id: '1',
          messages: [{ id: 'm', body: '  ', author: '', createdAt: '', updatedAt: '' }],
        }),
      ),
    ).toHaveProperty('skip');
    expect(
      mapThreadToReviewComment(thread({ id: '1', position: { side: 'new', line: 0 } })),
    ).toHaveProperty('skip');
  });
});

describe('buildReviewPayload', () => {
  it('collects comments and skip reasons, and only sets event/body when present', () => {
    const { payload, skipped } = buildReviewPayload({
      threads: [
        thread({ id: '1', position: { side: 'new', line: 10 } }),
        thread({ id: '2', position: { side: 'new', line: -1 } }),
      ],
      event: 'COMMENT',
      body: '  summary  ',
    });
    expect(payload.comments).toHaveLength(1);
    expect(payload.event).toBe('COMMENT');
    expect(payload.body).toBe('summary');
    expect(skipped).toHaveLength(1);
  });

  it('omits event/body when not provided', () => {
    const { payload } = buildReviewPayload({ threads: [thread({ id: '1' })] });
    expect(payload.event).toBeUndefined();
    expect(payload.body).toBeUndefined();
  });
});

describe('parseSubmitReviewInput', () => {
  it('rejects non-object / missing threads', () => {
    expect(parseSubmitReviewInput(null)).toBeNull();
    expect(parseSubmitReviewInput({})).toBeNull();
  });

  it('keeps valid threads and a valid event', () => {
    const input = parseSubmitReviewInput({
      threads: [thread({ id: '1' }), { nope: true }],
      event: 'APPROVE',
      body: 'x',
    });
    expect(input?.threads).toHaveLength(1);
    expect(input?.event).toBe('APPROVE');
    expect(input?.body).toBe('x');
  });

  it('drops an invalid event', () => {
    const input = parseSubmitReviewInput({ threads: [], event: 'LGTM' });
    expect(input?.event).toBeUndefined();
  });
});

import { COMMENTS_QUERY, parseComments } from '@ctypes/comments';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('parseComments', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array for malformed JSON', () => {
    expect(parseComments('{not-json')).toEqual([]);
  });

  it('rejects stored comments with malformed mention payloads', () => {
    const result = parseComments([
      {
        id: 'comment-1',
        dateISO: '2024-01-01T00:00:00.000Z',
        content: [
          {
            type: 'mention',
            mention: {
              type: 'record',
              id: 'record-1',
              // modelId intentionally missing
            },
          },
        ],
        authorId: 'user-1',
        upvoterIds: [],
        replies: [],
      },
    ]);

    expect(result).toEqual([]);
  });

  it('canonicalizes top-level comments to always include replies', () => {
    const result = parseComments([
      {
        id: 'comment-1',
        dateISO: '2024-01-01T00:00:00.000Z',
        content: [{ type: 'text', content: 'Hello' }],
        authorId: 'user-1',
        upvoterIds: [],
      },
    ]);

    expect(result).toEqual([
      {
        id: 'comment-1',
        dateISO: '2024-01-01T00:00:00.000Z',
        content: [{ type: 'text', content: 'Hello' }],
        authorId: 'user-1',
        upvoterIds: [],
        replies: [],
      },
    ]);
  });
});

describe('COMMENTS_QUERY', () => {
  it('reads the single aggregate comments record', () => {
    expect(COMMENTS_QUERY).toContain('allProjectComments');
    expect(COMMENTS_QUERY).toContain('recordId: { eq: $recordId }');
    expect(COMMENTS_QUERY).toContain('first: 1');
    expect(COMMENTS_QUERY).not.toContain('targetRecordId');
  });
});

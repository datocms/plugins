import { describe, it, expect } from 'vitest';
import { applyMentionStateOperation, parseMentionStateContent } from '@utils/mentionState';
import type { MentionEntry, MentionStateContent, MentionStateOperation } from '@ctypes/mentionState';

const sampleEntry = (key: string): MentionEntry => ({
  key,
  commentId: 'c1',
  recordId: 'r1',
  modelId: 'm1',
  createdAt: '2024-01-01T00:00:00.000Z',
  authorId: 'u1',
  content: [],
});

describe('parseMentionStateContent', () => {
  it('returns empty state for invalid JSON', () => {
    const result = parseMentionStateContent('not-json');
    expect(result.unread).toEqual([]);
  });

  it('parses valid JSON string', () => {
    const raw = JSON.stringify({ unread: [sampleEntry('k1')], updatedAt: '2024-01-01T00:00:00.000Z' });
    const result = parseMentionStateContent(raw);
    expect(result.unread).toHaveLength(1);
    expect(result.updatedAt).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('applyMentionStateOperation', () => {
  it('adds new mentions idempotently', () => {
    const content: MentionStateContent = { unread: [sampleEntry('k1')], updatedAt: '2024-01-01T00:00:00.000Z' };
    const op: MentionStateOperation = {
      type: 'UPDATE_MENTION_STATE',
      userId: 'u2',
      additions: [sampleEntry('k1'), sampleEntry('k2')],
    };

    const result = applyMentionStateOperation(content, op);
    expect(result.content.unread).toHaveLength(2);
    expect(result.content.unread.find((entry) => entry.key === 'k2')).toBeTruthy();
    expect(result.changed).toBe(true);
  });

  it('removes mentions by key', () => {
    const content: MentionStateContent = { unread: [sampleEntry('k1'), sampleEntry('k2')], updatedAt: '2024-01-01T00:00:00.000Z' };
    const op: MentionStateOperation = {
      type: 'UPDATE_MENTION_STATE',
      userId: 'u2',
      removals: ['k1'],
    };

    const result = applyMentionStateOperation(content, op);
    expect(result.content.unread).toHaveLength(1);
    expect(result.content.unread[0].key).toBe('k2');
  });
});

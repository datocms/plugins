// @vitest-environment jsdom

import type { CommentType } from '@ctypes/comments';
import { useEntityResolver } from '@hooks/useEntityResolver';
import {
  createAssetMention,
  createMentionSegment,
  createRecordMention,
} from '../fixtures/mentions';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '../testUtils/react';

function createStoredComment(content: CommentType['content']): CommentType {
  return {
    id: 'comment-1',
    dateISO: '2024-01-01T00:00:00.000Z',
    content,
    authorId: 'user-1',
    upvoterIds: [],
    replies: [],
  };
}

describe('useEntityResolver', () => {
  it('uses seeded record and asset mention data before async lookup finishes', () => {
    const recordMention = createRecordMention({
      id: 'record-1',
      title: 'Resolved record title',
      modelId: 'model-1',
      modelApiKey: 'article',
      modelName: 'Article',
      modelEmoji: '📝',
      thumbnailUrl: 'https://cdn.datocms.com/record-thumb.jpg',
      isSingleton: false,
    });
    const assetMention = createAssetMention({
      id: 'asset-1',
      filename: 'hero.jpg',
      url: 'https://cdn.datocms.com/hero.jpg',
      thumbnailUrl: 'https://cdn.datocms.com/hero.jpg?w=300',
      mimeType: 'image/jpeg',
    });

    const storedComment = createStoredComment([
      {
        type: 'mention',
        mention: {
          type: 'record',
          id: recordMention.id,
          modelId: recordMention.modelId,
        },
      },
      { type: 'text', content: ' and ' },
      {
        type: 'mention',
        mention: { type: 'asset', id: assetMention.id },
      },
    ]);

    const { result, unmount } = renderHook(() =>
      useEntityResolver({
        client: null,
        projectUsers: [],
        projectModels: [],
        modelFields: [],
        itemTypes: {},
        mainLocale: 'en',
      }),
    );

    if (!result.current) {
      throw new Error('Hook did not render');
    }

    act(() => {
      result.current?.seedResolvedMentionsFromSegments([
        createMentionSegment(recordMention),
        createMentionSegment(assetMention),
      ]);
    });

    const [resolvedComment] = result.current.resolveComments([storedComment]);
    const [resolvedRecordSegment, , resolvedAssetSegment] =
      resolvedComment.content;

    expect(resolvedRecordSegment).toMatchObject({
      type: 'mention',
      mention: {
        type: 'record',
        id: 'record-1',
        title: 'Resolved record title',
        modelApiKey: 'article',
        modelName: 'Article',
      },
    });
    expect(resolvedAssetSegment).toMatchObject({
      type: 'mention',
      mention: {
        type: 'asset',
        id: 'asset-1',
        filename: 'hero.jpg',
        url: 'https://cdn.datocms.com/hero.jpg',
      },
    });

    unmount();
  });
});

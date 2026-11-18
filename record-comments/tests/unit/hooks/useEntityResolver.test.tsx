// @vitest-environment jsdom

import type { CommentType } from '@ctypes/comments';
import { useEntityResolver } from '@hooks/useEntityResolver';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  createAssetMention,
  createMentionSegment,
  createRecordMention,
} from '../fixtures/mentions';
import { flushPromises, renderHook } from '../testUtils/react';

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
        loadUploads: vi.fn(),
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
    expect(resolvedComment.storedContent).toBe(storedComment.content);
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

describe('useEntityResolver scale and context changes', () => {
  const makeAssetComments = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) => ({
      ...createStoredComment([
        {
          type: 'mention',
          mention: { type: 'asset', id: `asset-${offset + index}` },
        },
      ]),
      id: `comment-${offset + index}`,
    }));

  const upload = (id: string, filename: string) => ({
    id,
    type: 'upload',
    attributes: {
      filename,
      url: `https://example.com/${id}`,
      mime_type: 'image/jpeg',
    },
  });

  it('loads the assets of a batch in one call and deduplicates repeated prefetches', async () => {
    const resolvers: Array<() => void> = [];
    const loadUploads = vi.fn(
      (ids: string[]) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(ids.map((id) => upload(id, id))));
        }),
    );
    const client = {} as never;
    const { result, unmount } = renderHook(() =>
      useEntityResolver({
        client,
        loadUploads: loadUploads as never,
        projectUsers: [],
        projectModels: [],
        modelFields: [],
        itemTypes: {},
        mainLocale: 'en',
      }),
    );
    const first = makeAssetComments(40);
    const second = [...first, ...makeAssetComments(40, 40)];
    act(() => {
      result.current?.prefetchEntities(first);
      result.current?.prefetchEntities(first);
      result.current?.prefetchEntities(second);
    });
    await flushPromises();
    expect(loadUploads).toHaveBeenCalledTimes(1);
    expect(result.current?.isResolving).toBe(true);
    for (
      let step = 0;
      step < 10 && (resolvers.length > 0 || result.current?.isResolving);
      step += 1
    ) {
      const batch = resolvers.splice(0);
      // biome-ignore lint/performance/noAwaitInLoops: Advance the queued batches deterministically, one at a time.
      await act(async () => {
        for (const resolve of batch) resolve();
        await Promise.resolve();
      });
      await flushPromises();
    }
    // The second prefetch asks only for the assets that the first did not
    expect(loadUploads).toHaveBeenCalledTimes(2);
    expect(loadUploads.mock.calls[0][0]).toHaveLength(40);
    expect(loadUploads.mock.calls[1][0]).toHaveLength(40);
    expect(loadUploads.mock.calls[1][0][0]).toBe('asset-79');
    expect(result.current?.isResolving).toBe(false);
    expect(
      result.current?.resolveComments(second)[79].content[0],
    ).toMatchObject({
      mention: { id: 'asset-79', filename: 'asset-79' },
    });
    unmount();
  });

  it('discards old results and stops further requests after changing client', async () => {
    const resolvers: Array<() => void> = [];
    const loadUploads = vi.fn(
      (ids: string[]) =>
        new Promise((resolve) => {
          resolvers.push(() =>
            resolve(ids.map((id) => upload(id, `old:${id}`))),
          );
        }),
    );
    let client = {} as never;
    const { result, rerender, unmount } = renderHook(() =>
      useEntityResolver({
        client,
        loadUploads: loadUploads as never,
        projectUsers: [],
        projectModels: [],
        modelFields: [],
        itemTypes: {},
        mainLocale: 'en',
      }),
    );
    const comments = makeAssetComments(20);
    act(() => result.current?.prefetchEntities(comments));
    await flushPromises();
    client = null as never;
    rerender();
    await act(async () => {
      for (const resolve of resolvers) resolve();
      await Promise.resolve();
    });
    await flushPromises();
    expect(loadUploads).toHaveBeenCalledTimes(1);
    expect(
      result.current?.resolveComments(comments)[0].content[0],
    ).toMatchObject({
      mention: { filename: 'Asset #asset-0' },
    });
    expect(result.current?.isResolving).toBe(false);
    unmount();
  });

  it('names a record mention after its model, with no request', () => {
    const loadUploads = vi.fn();
    // Stable across renders, as the hook gets them from the plugin
    const client = {} as never;
    const itemTypes = {
      'model-1': {
        id: 'model-1',
        attributes: {
          name: '📝 Article',
          api_key: 'article',
          singleton: false,
        },
      } as never,
    };
    const { result, unmount } = renderHook(() =>
      useEntityResolver({
        client,
        loadUploads,
        projectUsers: [],
        projectModels: [],
        modelFields: [],
        itemTypes,
        mainLocale: 'en',
      }),
    );
    const comments = [
      createStoredComment([
        {
          type: 'mention',
          mention: { type: 'record', id: 'record-1', modelId: 'model-1' },
        },
      ]),
    ];
    act(() => result.current?.prefetchEntities(comments));
    expect(loadUploads).not.toHaveBeenCalled();
    expect(
      result.current?.resolveComments(comments)[0].content[0],
    ).toMatchObject({
      mention: {
        type: 'record',
        id: 'record-1',
        modelApiKey: 'article',
        modelName: '📝 Article',
        modelEmoji: '📝',
      },
    });
    unmount();
  });

  it('preserves the email display for deleted historical authors', () => {
    const comment = {
      ...createStoredComment([]),
      authorId: 'legacy-email:former%40example.com',
    };
    const { result, unmount } = renderHook(() =>
      useEntityResolver({
        client: null,
        loadUploads: vi.fn(),
        projectUsers: [],
        projectModels: [],
        modelFields: [],
        itemTypes: {},
        mainLocale: 'en',
      }),
    );
    expect(result.current?.resolveComments([comment])[0].author).toMatchObject({
      email: 'former@example.com',
      name: 'former@example.com',
    });
    unmount();
  });
});

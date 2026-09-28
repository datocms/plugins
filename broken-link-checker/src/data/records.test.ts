import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type { ContentModel } from '../types';
import { buildCmaClient, readRecords, toRecordInput } from './records';

function record(id: string) {
  return {
    id,
    type: 'item',
    attributes: { title: id },
    relationships: {
      item_type: { data: { id: 'article', type: 'item_type' } },
    },
  };
}

function mockClient(rawList = vi.fn()) {
  return { items: { rawList } } as unknown as Pick<Client, 'items'>;
}

async function collect(client: Pick<Client, 'items'>, signal?: AbortSignal) {
  const records = [];
  for await (const item of readRecords(client, 'article', signal))
    records.push(item);
  return records;
}

describe('readRecords', () => {
  it('loads bounded pages with nested current values, including invalid records', async () => {
    const first = Array.from({ length: 30 }, (_, i) => record(String(i)));
    const rawList = vi
      .fn()
      .mockResolvedValueOnce({ data: first, meta: { total_count: 32 } })
      .mockResolvedValueOnce({
        data: [record('30'), record('31')],
        meta: { total_count: 32 },
      });
    expect(await collect(mockClient(rawList))).toHaveLength(32);
    expect(rawList.mock.calls.map(([query]) => query)).toEqual(
      [0, 30].map((offset) => ({
        nested: true,
        version: 'current',
        filter: { type: 'article' },
        order_by: 'id_ASC',
        page: { offset, limit: 30 },
      })),
    );
  });

  it('stops after an empty collection', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValue({ data: [], meta: { total_count: 0 } });
    expect(await collect(mockClient(rawList))).toEqual([]);
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: [], meta: { total_count: 2 } },
    { data: [record('b')], meta: { total_count: 3 } },
    { data: [record('a')], meta: { total_count: 2 } },
  ])('rejects inconsistent pagination %# instead of reporting completion', async (second) => {
    const rawList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [record('a')],
        meta: { total_count: 2 },
      })
      .mockResolvedValueOnce(second);
    await expect(collect(mockClient(rawList))).rejects.toThrow(
      /scan again|pagination/i,
    );
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('rejects missing pagination metadata', async () => {
    const rawList = vi.fn().mockResolvedValue({ data: [record('a')] });
    await expect(collect(mockClient(rawList))).rejects.toThrow(
      'incomplete record page',
    );
  });

  it('surfaces permission/API errors unchanged', async () => {
    const error = new Error('Permission denied');
    await expect(
      collect(mockClient(vi.fn().mockRejectedValue(error))),
    ).rejects.toBe(error);
  });

  it('does not request a page when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const rawList = vi.fn();
    await expect(
      collect(mockClient(rawList), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).not.toHaveBeenCalled();
  });

  it('cancels while a page is pending and observes a late failure', async () => {
    const controller = new AbortController();
    let rejectRequest: ((error: Error) => void) | undefined;
    const rawList = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const result = collect(mockClient(rawList), controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    rejectRequest?.(new Error('Late network error'));
    await Promise.resolve();
    expect(rawList).toHaveBeenCalledTimes(1);
  });

  it('stops yielding records after cancellation', async () => {
    const controller = new AbortController();
    const rawList = vi.fn().mockResolvedValue({
      data: [record('a'), record('b')],
      meta: { total_count: 2 },
    });
    const iterator = readRecords(
      mockClient(rawList),
      'article',
      controller.signal,
    );
    expect((await iterator.next()).value?.id).toBe('a');
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).toHaveBeenCalledTimes(1);
  });
});

describe('record conversion', () => {
  const model: ContentModel = {
    id: 'article',
    name: 'Article',
    isBlock: false,
    titleFieldId: 'title-field',
    fields: [
      {
        id: 'title-field',
        apiKey: 'title',
        label: 'Title',
        type: 'string',
        localized: true,
        editor: 'single_line',
      },
    ],
  };

  it('preserves all locale and nested content while choosing the current locale title', () => {
    const attributes = {
      title: { en: 'Hello', it: 'Ciao' },
      content: [record('block')],
    };
    expect(toRecordInput({ id: 'a', attributes }, model, 'it')).toEqual({
      id: 'a',
      modelId: 'article',
      title: 'Ciao',
      values: attributes,
    });
    expect(toRecordInput({ attributes }, model, 'fr').title).toBe('Hello');
  });

  it('accepts unsaved SDK serialized values without id/meta', () => {
    expect(toRecordInput({ attributes: {} }, model)).toEqual({
      id: undefined,
      modelId: 'article',
      title: 'New Article',
      values: {},
    });
    expect(toRecordInput({ id: '123', attributes: {} }, model).title).toBe(
      'Article 123',
    );
  });

  it('does not confuse an unlocalized object value with locale data', () => {
    const unlocalized = {
      ...model,
      fields: model.fields.map((field) => ({ ...field, localized: false })),
    };
    expect(
      toRecordInput(
        { attributes: { title: { en: 'Not a title' } } },
        unlocalized,
      ).title,
    ).toBe('New Article');
  });
});

describe('buildCmaClient', () => {
  it('requires the current user token', () => {
    expect(() => buildCmaClient({ environment: 'sandbox' })).toThrow(
      'requires API access',
    );
  });

  it('uses the current user, environment and host-provided CMA endpoint', () => {
    const client = buildCmaClient({
      currentUserAccessToken: 'test-token',
      environment: 'sandbox',
      cmaBaseUrl: 'https://cma.example.test',
    });
    expect(client.config).toMatchObject({
      apiToken: 'test-token',
      environment: 'sandbox',
      baseUrl: 'https://cma.example.test',
    });
  });
});

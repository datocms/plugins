import type { Client } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createSchemaLoader } from '../data/schema';
import type { ScanSession } from '../state/session';
import type { ContentModel, ContentSchema } from '../types';
import { countRecords, createProjectProducer } from './scanProject';

const { rawList, buildCmaClient } = vi.hoisted(() => ({
  rawList: vi.fn(),
  buildCmaClient: vi.fn(),
}));
vi.mock('../data/records', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/records')>()),
  buildCmaClient,
}));

const client = { items: { rawList } } as unknown as Client;

function model(id: string): ContentModel {
  return {
    id,
    name: id,
    isBlock: false,
    fields: [
      {
        id: 'url',
        apiKey: 'url',
        label: 'URL',
        type: 'string',
        localized: true,
        editor: 'single_line',
      },
    ],
  };
}

function session() {
  return {
    addRecord: vi.fn(),
    warn: vi.fn(),
    waitForCapacity: vi.fn().mockResolvedValue(undefined),
  } as unknown as ScanSession;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('project record totals', () => {
  it('stops count batches on cancellation', async () => {
    const controller = new AbortController();
    rawList.mockImplementation(async () => {
      controller.abort();
      return { data: [], meta: { total_count: 10 } };
    });
    await expect(
      countRecords(
        client,
        Array.from({ length: 100 }, (_, index) => model(String(index))),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rawList).toHaveBeenCalledOnce();
  });

  it('rejects missing or invalid counts rather than publishing a misleading total', async () => {
    rawList.mockResolvedValue({ data: [], meta: { total_count: -1 } });
    await expect(countRecords(client, [model('article')])).rejects.toThrow(
      'no record count',
    );
  });
});

describe('project production', () => {
  function loader(models: ContentModel[]) {
    return {
      models,
      load: vi.fn(
        async (id: string): Promise<ContentSchema> =>
          new Map(
            models
              .filter((entry) => entry.id === id)
              .map((entry) => [entry.id, entry]),
          ),
      ),
    } satisfies ReturnType<typeof createSchemaLoader>;
  }

  it('continues past an unreadable model and retains all selected locales in readable models', async () => {
    buildCmaClient.mockReturnValue(client);
    const models = [model('denied'), model('article')];
    rawList.mockImplementation(async (query: { filter: { type: string } }) => {
      if (query.filter.type === 'denied') throw new Error('Permission denied');
      return {
        data: [
          {
            id: 'a',
            attributes: {
              url: { en: 'https://a.example', it: 'https://b.example' },
            },
          },
        ],
        meta: { total_count: 1 },
      };
    });
    const current = session();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    await createProjectProducer(
      { environment: 'test' },
      loader(models),
      models,
      ['en', 'it'],
    )(current, controller.signal);
    expect(current.warn).toHaveBeenCalledWith('denied: Permission denied');
    expect(current.addRecord).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(current.addRecord)
        .mock.calls[0][0].occurrences.map((entry) => entry.locale),
    ).toEqual(['en', 'it']);
    expect(current.waitForCapacity).toHaveBeenCalledOnce();
    expect(buildCmaClient).toHaveBeenCalledWith({ environment: 'test' });
    log.mockRestore();
  });

  it('reports an isolated malformed record and continues the same page', async () => {
    buildCmaClient.mockReturnValue(client);
    const models = [model('article')];
    rawList.mockResolvedValue({
      data: [
        { id: 'bad' },
        { id: 'good', attributes: { url: { en: 'https://good.example' } } },
      ],
      meta: { total_count: 2 },
    });
    const current = session();
    await createProjectProducer(
      { environment: 'test' },
      loader(models),
      models,
      ['en'],
    )(current, new AbortController().signal);
    expect(current.addRecord).toHaveBeenCalledTimes(2);
    expect(vi.mocked(current.addRecord).mock.calls[0][0].warnings[0]).toContain(
      'article bad:',
    );
    expect(
      vi.mocked(current.addRecord).mock.calls[1][0].occurrences[0].url,
    ).toBe('https://good.example');
  });

  it('yields to browser tasks while cached pages are streaming and honors cancellation', async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 13;
      return now;
    });
    buildCmaClient.mockReturnValue(client);
    const models = [model('article')];
    const controller = new AbortController();
    rawList.mockImplementation(async () => {
      setTimeout(() => controller.abort(), 0);
      return {
        data: Array.from({ length: 30 }, (_, index) => ({
          id: String(index),
          attributes: {},
        })),
        meta: { total_count: 200_000 },
      };
    });
    const current = session();
    const pending = createProjectProducer(
      { environment: 'test' },
      loader(models),
      models,
      ['en'],
    )(current, controller.signal);
    await vi.runAllTimersAsync();
    await pending;
    expect(current.addRecord).toHaveBeenCalledOnce();
    expect(rawList).toHaveBeenCalledOnce();
  });
});

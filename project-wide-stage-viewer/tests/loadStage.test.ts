import { ApiError, type Client } from '@datocms/cma-client-browser';
import { CmaRequestTimeoutError } from '../src/data/requests';
import { describe, expect, it, vi } from 'vitest';
import {
  loadStage,
  mapWithConcurrency,
  resolveLinkedTitles,
  MIN_STAGE_PAGE_SIZE,
  STAGE_PAGE_SIZE,
  workflowModels,
} from '../src/data/loadStage';
import { buildModelPresentation, buildRow } from '../src/lib/records';
import { buildField, buildItem, buildItemType } from './fixtures';

const workflow = {
  id: 'wf1',
  name: 'Editorial',
  stages: [
    { id: 'draft', name: 'Draft' },
    { id: 'review', name: 'In review' },
  ],
};

function notFound() {
  return new ApiError({
    request: { url: '/workflows/wf1', method: 'GET', headers: {} },
    response: {
      status: 404,
      statusText: 'Not Found',
      headers: {},
      body: {
        data: [{ type: 'api_error', attributes: { code: 'NOT_FOUND' } }],
      },
    },
  });
}

function fakeClient(options: {
  workflow?: unknown;
  items?: Record<string, ReturnType<typeof buildItem>[]>;
}) {
  const rawList = vi.fn(
    async (query: {
      filter: { type: string };
      page: { offset: number; limit: number };
    }) => {
      const all = options.items?.[query.filter.type] ?? [];
      const { offset, limit } = query.page;
      return {
        data: all.slice(offset, offset + limit),
        meta: { total_count: all.length },
      };
    },
  );
  const find = vi.fn(async () => {
    if (options.workflow instanceof Error) throw options.workflow;
    return options.workflow ?? workflow;
  });
  const client = {
    workflows: { find },
    items: { rawList },
  } as unknown as Client;
  return { client, rawList, find };
}

const itemTypes = {
  m1: buildItemType('m1', 'Article', { workflowId: 'wf1' }),
  m2: buildItemType('m2', 'Author', { workflowId: 'wf1' }),
  m3: buildItemType('m3', 'Page', { workflowId: 'other' }),
  b1: buildItemType('b1', 'Hero block', { workflowId: 'wf1', block: true }),
};

describe('workflowModels', () => {
  it('keeps the models (not blocks) that use the workflow, by name', () => {
    expect(workflowModels(itemTypes, 'wf1').map(({ id }) => id)).toEqual([
      'm1',
      'm2',
    ]);
  });
});

describe('loadStage', () => {
  const source = (client: Client) => ({
    client,
    itemTypes,
    locales: ['en'],
    loadItemTypeFields: async () => [buildField('f1', 'title')],
  });

  it('asks the API for each model’s records in the stage', async () => {
    const { client, rawList } = fakeClient({
      items: {
        m1: [buildItem('r1', { title: 'First' })],
        m2: [buildItem('r2', { title: 'Second' })],
      },
    });

    const data = await loadStage(
      source(client),
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(rawList).toHaveBeenCalledTimes(2);
    expect(rawList).toHaveBeenCalledWith({
      filter: { type: 'm1', fields: { _stage: { eq: 'review' } } },
      version: 'current',
      order_by: 'id_ASC',
      page: { offset: 0, limit: STAGE_PAGE_SIZE },
    });
    expect(data.rows.map(({ title }) => title)).toEqual(['First', 'Second']);
    expect(data.stageMissing).toBe(false);
    expect(data.workflow?.name).toBe('Editorial');
  });

  it('reports a deleted stage without querying records', async () => {
    const { client, rawList } = fakeClient({});

    const data = await loadStage(
      source(client),
      { workflowId: 'wf1', stageId: 'gone' },
      new AbortController().signal,
    );

    expect(data.stageMissing).toBe(true);
    expect(rawList).not.toHaveBeenCalled();
  });

  it('reports a deleted workflow', async () => {
    const { client } = fakeClient({ workflow: notFound() });

    const data = await loadStage(
      source(client),
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(data.stageMissing).toBe(true);
    expect(data.workflow).toBeNull();
  });

  it('still loads records when the workflow can’t be read', async () => {
    const { client } = fakeClient({
      workflow: new Error('Forbidden'),
      items: { m1: [buildItem('r1', { title: 'First' })] },
    });

    const data = await loadStage(
      source(client),
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(data.workflow).toBeNull();
    expect(data.rows).toHaveLength(1);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps the order and never runs more than the limit', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5 - n));
      running -= 1;
      return n * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});

describe('loading a stage page by page', () => {
  const source = (client: Client) => ({
    client,
    itemTypes: { m1: itemTypes.m1 },
    locales: ['en'],
    loadItemTypeFields: async () => [buildField('f1', 'title')],
  });
  const many = Array.from({ length: STAGE_PAGE_SIZE * 2 + 5 }, (_, index) =>
    buildItem(`r${index}`, { title: `Record ${index}` }),
  );

  it('reads every page of the stage', async () => {
    const { client, rawList } = fakeClient({ items: { m1: many } });

    const data = await loadStage(
      source(client),
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(data.rows).toHaveLength(many.length);
    expect(rawList.mock.calls.map(([query]) => query.page.offset)).toEqual([
      0,
      STAGE_PAGE_SIZE,
      STAGE_PAGE_SIZE * 2,
    ]);
  });

  it('stops requesting pages once aborted', async () => {
    const controller = new AbortController();
    const { client, rawList } = fakeClient({ items: { m1: many } });
    rawList.mockImplementationOnce(async (query) => {
      controller.abort();
      return {
        data: many.slice(0, query.page.limit),
        meta: { total_count: many.length },
      };
    });

    await loadStage(
      source(client),
      { workflowId: 'wf1', stageId: 'review' },
      controller.signal,
    );

    expect(rawList).toHaveBeenCalledTimes(1);
  });
});

describe('mapWithConcurrency after a failure', () => {
  it('starts no further tasks', async () => {
    const task = vi.fn(async (n: number) => {
      if (n === 1) throw new Error('boom');
      return n;
    });

    await expect(mapWithConcurrency([1, 2, 3, 4], 1, task)).rejects.toThrow(
      'boom',
    );
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('resolveLinkedTitles', () => {
  it('follows links to the linked record’s title, batching the reads', async () => {
    const translation = buildItemType('tr', 'Translation', {
      titleFieldId: 'f-of',
    });
    const article = buildItemType('ar', 'Article', { titleFieldId: 'f-title' });
    const linkField = buildField('f-of', 'of', { type: 'link' });
    const titleField = buildField('f-title', 'title');
    const linked = buildItem('a1', { title: 'Original article' });
    linked.relationships.item_type.data.id = 'ar';
    const rawList = vi.fn(async ({ filter }: { filter: { ids: string } }) => {
      const data = filter.ids.split(',').includes('a1') ? [linked] : [];
      return { data, meta: { total_count: data.length } };
    });
    const presentation = buildModelPresentation(translation, [linkField]);
    const rows = [
      buildRow(buildItem('t1', { of: 'a1' }), presentation, {
        locales: ['en'],
      }),
      buildRow(buildItem('t2', { of: 'gone' }), presentation, {
        locales: ['en'],
      }),
    ];

    await resolveLinkedTitles(
      {
        client: { items: { rawList } } as unknown as Client,
        itemTypes: { tr: translation, ar: article },
        locales: ['en'],
        loadItemTypeFields: async (id) =>
          id === 'ar' ? [titleField] : [linkField],
      },
      rows,
      new AbortController().signal,
    );

    expect(rows.map(({ title }) => title)).toEqual([
      'Original article',
      'Record #t2',
    ]);
    expect(rawList).toHaveBeenCalledTimes(1);
  });
});

describe('loading robustness', () => {
  const twoModels = {
    m1: buildItemType('m1', 'Article', { workflowId: 'wf1' }),
    m2: buildItemType('m2', 'Author', { workflowId: 'wf1' }),
  };
  const sourceFor = (client: Client) => ({
    client,
    itemTypes: twoModels,
    locales: ['en'],
    loadItemTypeFields: async () => [buildField('f1', 'title')],
  });

  it('stops the other models once one fails', async () => {
    const big = Array.from({ length: STAGE_PAGE_SIZE * 10 }, (_, i) =>
      buildItem(`b${i}`, { title: `B ${i}` }),
    );
    const { client, rawList } = fakeClient({ items: { m2: big } });
    rawList.mockImplementation(async (query) => {
      if (query.filter.type === 'm1') throw new Error('boom');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const { offset, limit } = query.page;
      return {
        data: big.slice(offset, offset + limit),
        meta: { total_count: big.length },
      };
    });

    await expect(
      loadStage(
        sourceFor(client),
        { workflowId: 'wf1', stageId: 'review' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('boom');
    const callsAtFailure = rawList.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(rawList.mock.calls.length).toBeLessThanOrEqual(callsAtFailure + 1);
  });

  it('drops a record returned twice across pages', async () => {
    const items = Array.from({ length: STAGE_PAGE_SIZE + 2 }, (_, i) =>
      buildItem(`r${i}`, { title: `R ${i}` }),
    );
    const { client, rawList } = fakeClient({ items: { m1: items } });
    // A record entered the stage between pages: page 2 repeats the boundary.
    rawList.mockImplementation(async (query) => {
      const { offset, limit } = query.page;
      const start = offset === 0 ? 0 : offset - 1;
      return {
        data: items.slice(start, start + limit),
        meta: { total_count: items.length + 1 },
      };
    });

    const data = await loadStage(
      { ...sourceFor(client), itemTypes: { m1: twoModels.m1 } },
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(new Set(data.rows.map(({ id }) => id)).size).toBe(data.rows.length);
    expect(data.rows).toHaveLength(items.length);
  });

  it('retries a page that times out with a smaller page', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      buildItem(`r${i}`, { title: `R ${i}` }),
    );
    const { client, rawList } = fakeClient({ items: { m1: items } });
    const original = rawList.getMockImplementation();
    if (!original) throw new Error('Missing mock');
    rawList.mockImplementation(async (query) => {
      if (query.page.limit > 50) throw new CmaRequestTimeoutError();
      return original(query);
    });

    const data = await loadStage(
      { ...sourceFor(client), itemTypes: { m1: twoModels.m1 } },
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(data.rows).toHaveLength(30);
    expect(rawList.mock.calls.map(([query]) => query.page.limit)).toEqual([
      200, 100, 50,
    ]);
  });

  it('gives up once pages can shrink no further', async () => {
    const { client, rawList } = fakeClient({ items: { m1: [] } });
    rawList.mockRejectedValue(new CmaRequestTimeoutError());

    await expect(
      loadStage(
        { ...sourceFor(client), itemTypes: { m1: twoModels.m1 } },
        { workflowId: 'wf1', stageId: 'review' },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(CmaRequestTimeoutError);
    const calls = rawList.mock.calls;
    expect(calls[calls.length - 1]?.[0].page.limit).toBe(MIN_STAGE_PAGE_SIZE);
  });
});

describe('which client each read uses', () => {
  it('sends only shrinkable stage pages to the no-retry page client', async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      buildItem(`r${i}`, { title: `R ${i}` }),
    );
    // The page client times out until pages reach the minimum size, which
    // then goes to the retrying client.
    const page = fakeClient({ items: { m1: items } });
    page.rawList.mockRejectedValue(new CmaRequestTimeoutError());
    const main = fakeClient({ items: { m1: items } });

    const data = await loadStage(
      {
        client: main.client,
        pageClient: page.client,
        itemTypes: {
          m1: buildItemType('m1', 'Article', { workflowId: 'wf1' }),
        },
        locales: ['en'],
        loadItemTypeFields: async () => [buildField('f1', 'title')],
      },
      { workflowId: 'wf1', stageId: 'review' },
      new AbortController().signal,
    );

    expect(data.rows).toHaveLength(10);
    // The workflow is read with the retrying client.
    expect(main.find).toHaveBeenCalled();
    expect(page.find).not.toHaveBeenCalled();
    expect(page.rawList.mock.calls.map(([query]) => query.page.limit)).toEqual([
      200, 100, 50,
    ]);
    expect(main.rawList.mock.calls.map(([query]) => query.page.limit)).toEqual([
      MIN_STAGE_PAGE_SIZE,
    ]);
  });
});

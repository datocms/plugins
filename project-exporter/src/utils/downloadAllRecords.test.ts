import { Buffer, Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import downloadAllRecords, {
  NESTED_RECORDS_PER_PAGE,
  PROJECT_METADATA_INPUT_BYTES,
  RECORD_PART_INPUT_BYTES,
  RECORD_PART_OUTPUT_BYTES,
  RECORDS_PER_PART,
  XLSX_CELLS_PER_PART,
} from './downloadAllRecords';
import { ResponseSizeError } from './exportRuntime';
import type { RecordExportEnvelope } from './recordExport';

type RecordRow = Record<string, unknown>;
type Model = {
  id: string;
  name: string;
  api_key: string;
  modular_block?: boolean;
};
type ListOptions = {
  nested?: boolean;
  order_by?: string;
  filter: { type: string; query?: string };
  page: { limit: number; offset?: number };
};
type PreparedPart = {
  count: number;
  bytes: number;
  cells: number;
  firstId: unknown;
  lastId: unknown;
  partition?: RecordExportEnvelope['manifest']['partition'];
};

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  downloadBlob: vi.fn<(blob: Blob, filename: string) => Promise<void>>(),
  preparedParts: [] as PreparedPart[],
  envelopes: [] as RecordExportEnvelope[],
  captureEnvelopes: false,
  outputBlob: undefined as ((part: PreparedPart) => Blob) | undefined,
  yieldToBrowser: vi.fn<() => Promise<void>>(),
}));

vi.mock('./exportRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exportRuntime')>()),
  createExportClient: mocks.createClient,
  downloadBlob: mocks.downloadBlob,
  yieldToBrowser: mocks.yieldToBrowser,
}));

// Retain only bounded summaries, never every generated record in mock call history.
vi.mock('./downloadRecordsFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./downloadRecordsFile')>()),
  prepareRecordDownload: async (data: RecordRow[] | RecordExportEnvelope) => {
    const records = Array.isArray(data) ? data : data.records;
    const part: PreparedPart = {
      count: records.length,
      bytes: records.reduce(
        (sum, record) => sum + Buffer.byteLength(JSON.stringify(record)),
        0,
      ),
      cells: records.reduce(
        (sum, record) => sum + Object.keys(record).length,
        0,
      ),
      firstId: records[0]?.id,
      lastId: records[records.length - 1]?.id,
      partition:
        Array.isArray(data) || !data.manifest.partition
          ? undefined
          : { ...data.manifest.partition },
    };
    mocks.preparedParts.push(part);
    if (mocks.captureEnvelopes && !Array.isArray(data))
      mocks.envelopes.push(data);
    return mocks.outputBlob?.(part) ?? new Blob(['prepared record part']);
  },
}));

const model = (id = 'page'): Model => ({
  id,
  name: `Model ${id}`,
  api_key: id,
});
const fixture = {
  item_type: { id: 'page' },
  title: { en: 'A record', pt: 'Um registro' },
  nested: { type: 'item', id: 'related-record' },
};

function fakeClient(
  args: {
    models?: Model[];
    counts?: Record<string, number>;
    row?: (id: string, index: number) => RecordRow;
  } = {},
) {
  const models = args.models ?? [model()];
  const counts = args.counts ?? { page: 61 };
  const list = vi.fn<(options: ListOptions) => Promise<RecordRow[]>>(
    async (options) => {
      // Keep call options for pagination assertions but release previous page results.
      list.mock.results.length = 0;
      list.mock.settledResults.length = 0;
      const count = counts[options.filter.type] ?? 0;
      const offset = options.page.offset ?? 0;
      return Array.from(
        { length: Math.max(0, Math.min(options.page.limit, count - offset)) },
        (_, index) => {
          const position = offset + index;
          const id = `${options.filter.type}-${String(position).padStart(6, '0')}`;
          return args.row?.(id, position) ?? { ...fixture, id };
        },
      );
    },
  );
  const rawList = vi.fn(async (options: ListOptions) => ({
    meta: { total_count: counts[options.filter.type] ?? 0 },
  }));
  const emptyList = () => ({
    list: vi.fn<(...args: unknown[]) => Promise<RecordRow[]>>(async () => []),
  });
  const client = {
    request: async ({ queryParams }: { queryParams: ListOptions }) => ({
      data: (await list(queryParams)).map((record) => ({
        type: 'item',
        id: record.id,
        attributes: record,
        relationships: {
          item_type: {
            data: { type: 'item_type', id: queryParams.filter.type },
          },
        },
      })),
    }),
    itemTypes: { list: vi.fn(async () => models) },
    items: { list, rawList },
    fields: emptyList(),
    fieldsets: emptyList(),
    site: {
      find: vi.fn<() => Promise<RecordRow>>(async () => ({
        id: 'project',
        locales: ['en', 'pt'],
      })),
    },
    menuItems: emptyList(),
    schemaMenuItems: emptyList(),
    itemTypeFilters: emptyList(),
    plugins: emptyList(),
    workflows: emptyList(),
    roles: emptyList(),
    webhooks: emptyList(),
    buildTriggers: emptyList(),
  };
  mocks.createClient.mockReturnValue(client);
  return client;
}

async function downloadedManifest(suffix = '.manifest.json') {
  const call = mocks.downloadBlob.mock.calls.find(([, filename]) =>
    filename.endsWith(suffix),
  );
  expect(call, `Expected a downloaded ${suffix}`).toBeDefined();
  if (!call) throw new Error(`Missing ${suffix}`);
  return JSON.parse(await call[0].text()) as {
    status: string;
    totalRecords: number;
    totalParts: number;
    exportedRecords: number;
    expectedRecords: number;
    parts: { filename: string; recordCount: number; recordOffset: number }[];
  };
}

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.clearAllMocks();
  mocks.preparedParts = [];
  mocks.envelopes = [];
  mocks.captureEnvelopes = false;
  mocks.outputBlob = undefined;
  mocks.downloadBlob.mockResolvedValue(undefined);
  mocks.yieldToBrowser.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe('downloadAllRecords pagination and bounded parts', () => {
  test('exposes the large record count throughout metadata preparation', async () => {
    const client = fakeClient({ counts: { page: 1001 } });
    const progress = vi.fn();
    client.fields.list.mockImplementation(async () => {
      expect(progress).toHaveBeenLastCalledWith(
        3,
        'Fetching export metadata for 1001 records...',
      );
      return [];
    });

    await downloadAllRecords('token', 'main', undefined, 'JSON', {}, progress);

    expect(progress).toHaveBeenCalledWith(
      3,
      'Fetching schema for 1/1 models; 1001 records...',
    );
  });

  test.each([0, 1, 30, 31, 60, 61])(
    'exports all %i records, including exact and fractional pages',
    async (count) => {
      const client = fakeClient({ counts: { page: count } });
      const progress = vi.fn();

      await downloadAllRecords('token', 'main', undefined, 'CSV', {}, progress);

      expect(
        client.items.list.mock.calls.map(([options]) => options.page.offset),
      ).toEqual(
        Array.from(
          { length: Math.floor(count / NESTED_RECORDS_PER_PAGE) + 1 },
          (_, index) => index * NESTED_RECORDS_PER_PAGE,
        ),
      );
      for (const [options] of client.items.list.mock.calls) {
        expect(options).toEqual({
          nested: true,
          filter: { type: 'page' },
          order_by: 'id_ASC',
          page: { limit: 30, offset: expect.any(Number) },
        });
      }
      expect(client.items.rawList).toHaveBeenCalledTimes(2);
      for (const [options] of client.items.rawList.mock.calls) {
        expect(options).toEqual({
          filter: { type: 'page' },
          page: { limit: 0 },
        });
      }
      expect(mocks.preparedParts.map((part) => part.count)).toEqual([count]);
      expect(progress).toHaveBeenLastCalledWith(
        100,
        expect.stringContaining(`${count} records`),
      );
    },
  );

  test('exports 200,000 records generated one API page at a time into bounded parts', async () => {
    const client = fakeClient({ counts: { page: 200_000 } });
    const percentages: number[] = [];

    await downloadAllRecords('token', 'main', undefined, 'CSV', {}, (value) =>
      percentages.push(value),
    );

    expect(client.items.list).toHaveBeenCalledTimes(Math.ceil(200_000 / 30));
    expect(client.items.rawList).toHaveBeenCalledTimes(2);
    expect(mocks.preparedParts).toHaveLength(200);
    for (let index = 0; index < mocks.preparedParts.length; index++) {
      const part = mocks.preparedParts[index];
      expect(part.count).toBe(RECORDS_PER_PART);
      expect(part.bytes).toBeLessThanOrEqual(RECORD_PART_INPUT_BYTES);
      expect(part.firstId).toBe(
        `page-${String(index * 1000).padStart(6, '0')}`,
      );
      expect(part.lastId).toBe(
        `page-${String(index * 1000 + 999).padStart(6, '0')}`,
      );
    }
    const manifest = await downloadedManifest();
    expect(manifest).toMatchObject({
      status: 'complete',
      totalRecords: 200_000,
      totalParts: 200,
    });
    expect(manifest.parts).toHaveLength(200);
    for (let index = 0; index < manifest.parts.length; index++) {
      expect(manifest.parts[index]).toMatchObject({
        recordCount: 1000,
        recordOffset: index * 1000,
      });
      expect(manifest.parts[index].filename).toContain(
        `.part-${String(index + 1).padStart(3, '0')}.`,
      );
    }
    expect(percentages[percentages.length - 1]).toBe(100);
    expect(
      percentages.slice(0, -1).every((percentage) => percentage < 100),
    ).toBe(true);
    expect(
      percentages.every(
        (percentage, index) =>
          index === 0 || percentage >= percentages[index - 1],
      ),
    ).toBe(true);
    // This checks completeness and batching, not a browser throughput deadline.
  }, 120_000);

  test('uses individual model filters for 1,600 selected model IDs with bounded count concurrency', async () => {
    const models = Array.from({ length: 1600 }, (_, index) =>
      model(`model-${index}`),
    );
    const client = fakeClient({ models, counts: {} });
    let inFlight = 0;
    let peakConcurrency = 0;
    client.items.rawList.mockImplementation(async () => {
      inFlight++;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      await Promise.resolve();
      inFlight--;
      return { meta: { total_count: 0 } };
    });

    await downloadAllRecords('token', 'sandbox', undefined, 'CSV', {
      modelIDs: models.map(({ id }) => id),
    });

    expect(client.items.list).toHaveBeenCalledTimes(1600);
    expect(client.items.rawList).toHaveBeenCalledTimes(3200);
    expect(peakConcurrency).toBeLessThanOrEqual(4);
    expect(peakConcurrency).toBeGreaterThan(1);
    for (const [options] of [
      ...client.items.rawList.mock.calls,
      ...client.items.list.mock.calls,
    ]) {
      expect(models.some(({ id }) => id === options.filter.type)).toBe(true);
      expect(options.filter.type).not.toContain(',');
    }
  });

  test('keeps text queries per model and excludes block models from text searches', async () => {
    const client = fakeClient({
      models: [model('page'), { ...model('block'), modular_block: true }],
      counts: { page: 2, block: 5 },
    });

    await downloadAllRecords('token', 'main', undefined, 'CSV', {
      textQuery: 'landing page',
    });

    expect(client.items.list).toHaveBeenCalledTimes(1);
    expect(client.items.list.mock.calls[0][0].filter).toEqual({
      type: 'page',
      query: 'landing page',
    });
    expect(mocks.preparedParts[0].count).toBe(2);
  });

  test('automatically reduces oversized nested pages and continues from the same offset', async () => {
    const client = fakeClient({ counts: { page: 20 } });
    const generatePage = client.items.list.getMockImplementation();
    if (!generatePage) throw new Error('Missing synthetic page generator');
    client.items.list.mockImplementation(async (options) => {
      if (options.page.limit > 7)
        throw new ResponseSizeError('Response exceeds 32 MiB');
      return generatePage(options);
    });

    await downloadAllRecords('token', 'main', undefined, 'CSV', {});

    expect(
      client.items.list.mock.calls.map(([options]) => options.page),
    ).toEqual([
      { limit: 30, offset: 0 },
      { limit: 15, offset: 0 },
      { limit: 7, offset: 0 },
      { limit: 7, offset: 7 },
      { limit: 7, offset: 14 },
    ]);
    expect(mocks.preparedParts.map((part) => part.count)).toEqual([20]);
    expect(client.items.rawList).toHaveBeenCalledTimes(2);
  });

  test('stops oversized response retries once a single record page still exceeds the limit', async () => {
    const client = fakeClient({ counts: { page: 1 } });
    client.items.list.mockRejectedValue(
      new ResponseSizeError('Response exceeds 32 MiB'),
    );

    await expect(
      downloadAllRecords('token', 'main', undefined, 'CSV', {}),
    ).rejects.toThrow('Response exceeds 32 MiB');

    expect(
      client.items.list.mock.calls.map(([options]) => options.page.limit),
    ).toEqual([30, 15, 7, 3, 1]);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  test('splits records by input bytes before accumulating more than 8 MiB', async () => {
    const text = 'x'.repeat(1024 * 1024);
    fakeClient({ counts: { page: 9 }, row: (id) => ({ id, text }) });

    await downloadAllRecords('token', 'main', undefined, 'CSV', {});

    expect(mocks.preparedParts.map((part) => part.count)).toEqual([7, 2]);
    expect(
      mocks.preparedParts.every(
        (part) => part.bytes <= RECORD_PART_INPUT_BYTES,
      ),
    ).toBe(true);
    expect((await downloadedManifest()).totalRecords).toBe(9);
  });

  test('bounds XLSX parts by cells as well as record count', async () => {
    const fields = Object.fromEntries(
      Array.from({ length: 5000 }, (_, index) => [`field_${index}`, index]),
    );
    fakeClient({ counts: { page: 21 }, row: (id) => ({ id, ...fields }) });

    await downloadAllRecords('token', 'main', undefined, 'XLSX', {});

    expect(mocks.preparedParts.map((part) => part.count)).toEqual([9, 9, 3]);
    expect(
      mocks.preparedParts.every((part) => part.cells <= XLSX_CELLS_PER_PART),
    ).toBe(true);
  });

  test('splits XLSX parts when heterogeneous models produce too many distinct columns', async () => {
    fakeClient({
      counts: { page: 330 },
      row: (id, index) => ({
        id,
        ...Object.fromEntries(
          Array.from({ length: 50 }, (_, field) => [
            `field_${index}_${field}`,
            field,
          ]),
        ),
      }),
    });

    await downloadAllRecords('token', 'main', undefined, 'XLSX', {});

    expect(mocks.preparedParts.map((part) => part.count)).toEqual([327, 3]);
    expect((await downloadedManifest()).totalRecords).toBe(330);
  });

  test('splits prepared output exceeding 16 MiB without dropping or reordering records', async () => {
    fakeClient({ counts: { page: 4 } });
    // Size-only blobs model output expansion without allocating a large buffer.
    mocks.outputBlob = (part) =>
      ({ size: part.count * (RECORD_PART_OUTPUT_BYTES / 2) }) as Blob;

    await downloadAllRecords('token', 'main', undefined, 'CSV', {});

    expect(mocks.preparedParts.map((part) => part.count)).toEqual([4, 2, 2]);
    const dataDownloads = mocks.downloadBlob.mock.calls.filter(([, name]) =>
      name.endsWith('.csv'),
    );
    expect(dataDownloads).toHaveLength(2);
    expect(
      dataDownloads.every(([blob]) => blob.size <= RECORD_PART_OUTPUT_BYTES),
    ).toBe(true);
    expect(
      (await downloadedManifest()).parts.map((part) => [
        part.recordOffset,
        part.recordCount,
      ]),
    ).toEqual([
      [0, 2],
      [2, 2],
    ]);
  });

  test('preserves JSON metadata, partition offsets and scheduled actions per part', async () => {
    fakeClient({
      counts: { page: 1001 },
      row: (id, index) => ({
        ...fixture,
        id,
        meta:
          index === 1000
            ? { publication_scheduled_at: '2030-01-01T00:00:00Z' }
            : {},
      }),
    });
    mocks.captureEnvelopes = true;

    await downloadAllRecords('token', 'sandbox', undefined, 'JSON', {
      modelIDs: ['page'],
    });

    expect(mocks.envelopes).toHaveLength(2);
    expect(mocks.preparedParts.map((part) => part.partition)).toEqual([
      {
        exportId: expect.any(String),
        index: 1,
        recordOffset: 0,
        isLast: false,
      },
      {
        exportId: expect.any(String),
        index: 2,
        recordOffset: 1000,
        isLast: true,
      },
    ]);
    expect(mocks.envelopes[0].manifest.sourceEnvironment).toBe('sandbox');
    expect(
      mocks.envelopes[0].projectConfiguration.scheduledPublications,
    ).toEqual([]);
    expect(
      mocks.envelopes[1].projectConfiguration.scheduledPublications,
    ).toEqual([
      expect.objectContaining({
        itemId: 'page-001000',
        scheduledAt: '2030-01-01T00:00:00Z',
      }),
    ]);
    expect(mocks.envelopes[0].referenceIndex.recordRefs).toHaveLength(1000);
    expect(mocks.envelopes[1].referenceIndex.recordRefs).toHaveLength(1);
  });
});

describe('downloadAllRecords integrity and cancellation', () => {
  test.each([
    {
      description: 'empty model selection',
      token: 'token',
      ids: [],
      message: 'Select at least one model',
    },
    {
      description: 'missing access token',
      token: '',
      ids: undefined,
      message: 'access token is required',
    },
  ])(
    'rejects $description before creating a client',
    async ({ token, ids, message }) => {
      await expect(
        downloadAllRecords(token, 'main', undefined, 'CSV', { modelIDs: ids }),
      ).rejects.toThrow(message);
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.downloadBlob).not.toHaveBeenCalled();
    },
  );

  test('rejects selected models removed from the schema', async () => {
    const client = fakeClient();
    await expect(
      downloadAllRecords('token', 'main', undefined, 'CSV', {
        modelIDs: ['missing'],
      }),
    ).rejects.toThrow('no longer exists');
    expect(client.items.list).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  test('rejects oversized schema metadata before records and drains bounded field workers', async () => {
    const client = fakeClient({
      models: Array.from({ length: 8 }, (_, index) => model(`model-${index}`)),
      counts: {},
    });
    const oversizedField = {
      id: 'field-1',
      api_key: 'title',
      field_type: 'string',
      description: 'x'.repeat(PROJECT_METADATA_INPUT_BYTES + 1024 * 1024),
    };
    let active = 0;
    let peakConcurrency = 0;
    client.fields.list.mockImplementation(async () => {
      active++;
      peakConcurrency = Math.max(peakConcurrency, active);
      await Promise.resolve();
      active--;
      return [oversizedField];
    });
    const progress = vi.fn();

    await expect(
      downloadAllRecords('token', 'main', undefined, 'JSON', {}, progress),
    ).rejects.toThrow(
      'Project schema exceeds the 8 MiB browser export metadata budget',
    );

    expect(client.fields.list).toHaveBeenCalledTimes(4);
    expect(peakConcurrency).toBe(4);
    expect(active).toBe(0);
    expect(client.items.list).not.toHaveBeenCalled();
    expect(mocks.preparedParts).toEqual([]);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(progress.mock.calls.every(([value]) => value < 100)).toBe(true);
  });

  test('rejects oversized project configuration before records or file downloads', async () => {
    const client = fakeClient();
    client.site.find.mockResolvedValue({
      id: 'project',
      locales: ['en', 'pt'],
      preferences: 'x'.repeat(PROJECT_METADATA_INPUT_BYTES + 1024 * 1024),
    });
    const progress = vi.fn();

    await expect(
      downloadAllRecords('token', 'main', undefined, 'JSON', {}, progress),
    ).rejects.toThrow(
      'Project configuration exceeds the 8 MiB browser export metadata budget',
    );

    expect(client.fields.list).toHaveBeenCalledTimes(1);
    expect(client.site.find).toHaveBeenCalledTimes(1);
    expect(client.items.list).not.toHaveBeenCalled();
    expect(mocks.preparedParts).toEqual([]);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(progress.mock.calls.every(([value]) => value < 100)).toBe(true);
  });

  test.each(['duplicate', 'missing'] as const)(
    'detects %s IDs and writes an incomplete manifest for prepared parts',
    async (kind) => {
      fakeClient({
        counts: { page: 1030 },
        row: (id, index) => ({
          ...fixture,
          id: index === 1020 ? (kind === 'duplicate' ? 'page-000000' : '') : id,
        }),
      });
      const progress = vi.fn();

      await expect(
        downloadAllRecords('token', 'main', undefined, 'CSV', {}, progress),
      ).rejects.toThrow(
        kind === 'missing'
          ? 'The API returned an invalid record response'
          : 'Duplicate or missing record ID',
      );

      expect(mocks.preparedParts.map((part) => part.count)).toEqual([1000]);
      expect(await downloadedManifest('.incomplete.json')).toMatchObject({
        status: 'incomplete',
        exportedRecords: 1000,
        expectedRecords: 1030,
      });
      expect(progress.mock.calls.every(([value]) => value < 100)).toBe(true);
    },
  );

  test('detects counts changed during export and never marks partial output complete', async () => {
    const client = fakeClient({ counts: { page: 1001 } });
    client.items.rawList
      .mockResolvedValueOnce({ meta: { total_count: 1001 } })
      .mockResolvedValueOnce({ meta: { total_count: 1002 } });
    const progress = vi.fn();

    await expect(
      downloadAllRecords('token', 'main', undefined, 'CSV', {}, progress),
    ).rejects.toThrow('changed during export');

    expect(client.items.rawList).toHaveBeenCalledTimes(2);
    expect(await downloadedManifest('.incomplete.json')).toMatchObject({
      status: 'incomplete',
      exportedRecords: 1000,
    });
    expect(progress.mock.calls.every(([value]) => value < 100)).toBe(true);
  });

  test('detects a truncated listing even when final API count stays unchanged', async () => {
    const client = fakeClient({ counts: { page: 61 } });
    client.items.list.mockResolvedValueOnce(
      Array.from({ length: 29 }, (_, index) => ({ id: `record-${index}` })),
    );

    await expect(
      downloadAllRecords('token', 'main', undefined, 'CSV', {}),
    ).rejects.toThrow('changed during export');

    expect(client.items.list).toHaveBeenCalledTimes(1);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  test('rejects a record above the input byte limit before preparing any file', async () => {
    fakeClient({
      counts: { page: 1 },
      row: (id) => ({ id, text: 'x'.repeat(RECORD_PART_INPUT_BYTES) }),
    });

    await expect(
      downloadAllRecords('token', 'main', undefined, 'CSV', {}),
    ).rejects.toThrow('8 MiB');

    expect(mocks.preparedParts).toEqual([]);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  test('rejects a single record whose serialized output cannot fit the output limit', async () => {
    fakeClient({ counts: { page: 1 } });
    mocks.outputBlob = () => ({ size: RECORD_PART_OUTPUT_BYTES + 1 }) as Blob;

    await expect(
      downloadAllRecords('token', 'main', undefined, 'CSV', {}),
    ).rejects.toThrow('per-file browser limit');

    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  test('cancels before downloads and stops all later API pages', async () => {
    const controller = new AbortController();
    const client = fakeClient({ counts: { page: 1001 } });
    client.items.list.mockImplementationOnce(async () => {
      controller.abort();
      return [{ id: 'cancelled-record' }];
    });
    const progress = vi.fn();

    await expect(
      downloadAllRecords(
        'token',
        'main',
        undefined,
        'CSV',
        {},
        progress,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(client.items.list).toHaveBeenCalledTimes(1);
    expect(client.items.rawList).toHaveBeenCalledTimes(1);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(progress.mock.calls.every(([value]) => value < 100)).toBe(true);
  });

  test('cancels after one part and emits only a cancellation manifest afterwards', async () => {
    const controller = new AbortController();
    const client = fakeClient({ counts: { page: 100_000 } });
    mocks.downloadBlob.mockImplementation(async (_blob, filename) => {
      if (filename.endsWith('.csv')) controller.abort();
    });
    const progress = vi.fn();

    await expect(
      downloadAllRecords(
        'token',
        'main',
        undefined,
        'CSV',
        {},
        progress,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(client.items.list).toHaveBeenCalledTimes(34);
    expect(client.items.rawList).toHaveBeenCalledTimes(1);
    expect(mocks.preparedParts.map((part) => part.count)).toEqual([1000]);
    expect(
      mocks.downloadBlob.mock.calls.map(([, filename]) =>
        filename.split('.').pop(),
      ),
    ).toEqual(['csv', 'json']);
    expect(await downloadedManifest('.incomplete.json')).toMatchObject({
      status: 'cancelled',
      exportedRecords: 1000,
      expectedRecords: 100_000,
    });
    expect(progress.mock.calls.every(([value]) => value < 100)).toBe(true);
  });
});

// @vitest-environment node

import {
  LAST_ASSET_EXPORT_STORAGE_KEY,
  MAX_ASSET_CHUNK_DATA_BYTES,
} from './assetExport';
import downloadAllAssets from './downloadAllAssets';
import { ResponseSizeError } from './exportRuntime';

type FixtureUpload = {
  id: string;
  filename: string;
  size?: number;
  url?: string;
  custom_data?: Record<string, unknown>;
};

const fixtures = vi.hoisted(() => ({
  count: 0,
  overrides: new Map<number, FixtureUpload>(),
  archives: [] as Map<string, string | Blob>[],
  events: [] as string[],
  downloads: [] as { blob: Blob; filename: string }[],
  generateFailureAt: -1,
  abortOnDownload: undefined as (() => void) | undefined,
  downloadAsset: vi.fn(),
  list: vi.fn(),
  rawList: vi.fn(),
  storage: new Map<string, string>(),
}));

vi.mock('./assetDownload', () => ({
  downloadAssetFile: fixtures.downloadAsset,
}));

vi.mock('./exportRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exportRuntime')>();
  return {
    ...actual,
    createExportClient: vi.fn(() => ({
      uploads: { list: fixtures.list, rawList: fixtures.rawList },
      site: { find: vi.fn(async () => ({ id: 'synthetic-project' })) },
    })),
    yieldToBrowser: vi.fn(async () => undefined),
    downloadBlob: vi.fn(async (blob: Blob, filename: string) => {
      fixtures.events.push(`archive:${filename}`);
      fixtures.downloads.push({ blob, filename });
      if (filename.endsWith('.zip')) fixtures.abortOnDownload?.();
    }),
  };
});

vi.mock('jszip', () => ({
  default: class FixtureZip {
    entries = new Map<string, string | Blob>();

    file(name: string, contents: string | Blob) {
      this.entries.set(name, contents);
      return this;
    }

    generateInternalStream() {
      const index = fixtures.archives.length;
      fixtures.archives.push(this.entries);
      const manifest = String(this.entries.get('manifest.json'));
      const listeners = new Map<string, unknown>();
      let paused = false;
      return {
        on(event: string, listener: unknown) {
          listeners.set(event, listener);
          return this;
        },
        pause() {
          paused = true;
          return this;
        },
        resume() {
          const errorHandler = listeners.get('error') as (error: Error) => void;
          if (index === fixtures.generateFailureAt) {
            errorHandler(new Error('Synthetic archive generation failure'));
            return this;
          }
          const dataHandler = listeners.get('data') as (
            data: Uint8Array,
            metadata: { percent: number },
          ) => void;
          dataHandler(new TextEncoder().encode(manifest), { percent: 100 });
          if (!paused) (listeners.get('end') as () => void)();
          return this;
        },
      };
    }
  },
}));

beforeEach(() => {
  fixtures.count = 0;
  fixtures.overrides.clear();
  fixtures.archives.length = 0;
  fixtures.events.length = 0;
  fixtures.downloads.length = 0;
  fixtures.generateFailureAt = -1;
  fixtures.abortOnDownload = undefined;
  fixtures.storage.clear();
  fixtures.downloadAsset.mockReset();
  fixtures.list.mockReset();
  fixtures.rawList.mockReset();
  fixtures.downloadAsset.mockImplementation(async (url: string) => {
    fixtures.events.push(`asset:${url}`);
    return new Blob([new Uint8Array([1])]);
  });
  const uploadAt = (index: number): FixtureUpload =>
    fixtures.overrides.get(index) ?? {
      id: `upload-${index}`,
      filename: `asset-${index}.bin`,
      size: 1,
      url: `https://www.datocms-assets.com/${index}.bin`,
      custom_data: { source: `fixture-${index}` },
    };
  fixtures.rawList.mockImplementation(async () => ({
    data: [],
    meta: { total_count: fixtures.count },
  }));
  fixtures.list.mockImplementation(
    async (query: {
      filter?: { ids?: string };
      page: { limit: number; offset: number };
    }) => {
      if (query.filter?.ids) {
        const ids = query.filter.ids.split(',');
        return ids
          .map((id) => {
            const override = Array.from(fixtures.overrides.values()).find(
              (upload) => upload.id === id,
            );
            const index = Number(id.replace('upload-', ''));
            return override ?? uploadAt(index);
          })
          .reverse()
          .slice(query.page.offset, query.page.offset + query.page.limit);
      }
      return Array.from(
        {
          length: Math.min(
            query.page.limit,
            fixtures.count - query.page.offset,
          ),
        },
        (_, index) => uploadAt(index + query.page.offset),
      );
    },
  );
  vi.stubGlobal('window', {
    localStorage: {
      setItem(key: string, value: string) {
        fixtures.storage.set(key, value);
      },
      getItem(key: string) {
        return fixtures.storage.get(key) ?? null;
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

test('10,000 assets run continuously in 100 sequential ZIPs with exact progress and references', async () => {
  fixtures.count = 10_000;
  const progress = vi.fn();
  await downloadAllAssets('synthetic-token', 'sandbox', undefined, progress);
  expect(
    fixtures.list.mock.calls.filter(([query]) => !query.filter),
  ).toHaveLength(20);
  expect(
    fixtures.list.mock.calls.filter(([query]) => query.filter),
  ).toHaveLength(100);
  expect(
    fixtures.list.mock.calls.every(([query]) => query.page.limit <= 500),
  ).toBe(true);
  expect(fixtures.downloadAsset).toHaveBeenCalledTimes(10_000);
  expect(fixtures.archives).toHaveLength(100);
  expect(fixtures.downloads).toHaveLength(100);
  expect(fixtures.archives.every((archive) => archive.size === 101)).toBe(true);
  const firstArchive = fixtures.events.findIndex((event) =>
    event.startsWith('archive:'),
  );
  const nextAsset = fixtures.events.indexOf(
    'asset:https://www.datocms-assets.com/100.bin',
  );
  expect(firstArchive).toBeLessThan(nextAsset);
  const manifest = JSON.parse(
    String(fixtures.archives[99].get('manifest.json')),
  );
  expect(manifest.chunk).toMatchObject({
    index: 100,
    totalChunks: 100,
    assetCount: 100,
  });
  expect(manifest.assets[99]).toMatchObject({
    sourceUploadId: 'upload-9999',
    zipEntryName: 'u_upload-9999__asset-9999.bin',
    downloadedSize: 1,
    metadata: { custom_data: { source: 'fixture-9999' } },
  });
  const values = progress.mock.calls.map(([value]) => value as number);
  expect(
    values.every((value, index) => index === 0 || value >= values[index - 1]),
  ).toBe(true);
  expect(progress).toHaveBeenLastCalledWith(
    100,
    'Completed asset export: 10000 assets in 100 ZIP file(s).',
  );
  const snapshot = JSON.parse(
    fixtures.storage.get(LAST_ASSET_EXPORT_STORAGE_KEY) ?? '{}',
  );
  expect(snapshot).toMatchObject({ totalAssets: 10_000, totalChunks: 100 });
  expect(snapshot.chunkFilenames).toHaveLength(100);
}, 60_000);

test('per-asset failure continues remaining downloads and produces an explicit report without a success snapshot', async () => {
  fixtures.count = 3;
  fixtures.overrides.set(1, {
    id: 'failed-upload',
    filename: 'missing.bin',
    size: 1,
  });
  const progress = vi.fn();
  await expect(
    downloadAllAssets('synthetic-token', 'sandbox', undefined, progress),
  ).rejects.toThrow('2/3 assets exported; 1 failed');
  expect(fixtures.downloadAsset).toHaveBeenCalledTimes(2);
  expect(fixtures.downloads).toHaveLength(2);
  const manifest = JSON.parse(
    String(fixtures.archives[0].get('manifest.json')),
  );
  expect(manifest.assets).toHaveLength(2);
  expect(manifest.failedAssets[0]).toMatchObject({
    sourceUploadId: 'failed-upload',
  });
  const report = JSON.parse(await fixtures.downloads[1].blob.text());
  expect(report).toMatchObject({ totalAssets: 3, successfulAssets: 2 });
  expect(report.failedAssets).toHaveLength(1);
  expect(report.chunkFilenames).toHaveLength(1);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
  expect(progress.mock.calls.some(([value]) => value === 100)).toBe(false);
});

test('a failed ZIP does not stop later ZIPs or count undelivered assets as successes', async () => {
  fixtures.count = 101;
  fixtures.generateFailureAt = 0;
  await expect(
    downloadAllAssets('synthetic-token', 'sandbox', undefined),
  ).rejects.toThrow('1/101 assets exported; 100 failed');
  expect(fixtures.downloadAsset).toHaveBeenCalledTimes(101);
  expect(fixtures.archives).toHaveLength(2);
  const report = JSON.parse(await fixtures.downloads[1].blob.text());
  expect(report.successfulAssets).toBe(1);
  expect(report.failedAssets).toHaveLength(100);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
});

test('real byte budgets shrink after each downloaded asset and huge metadata sizes are rejected before fetching', async () => {
  fixtures.count = 3;
  fixtures.overrides.set(2, {
    id: 'huge-upload',
    filename: 'huge.mov',
    size: MAX_ASSET_CHUNK_DATA_BYTES + 1,
    url: 'https://www.datocms-assets.com/huge.mov',
  });
  await expect(
    downloadAllAssets('synthetic-token', 'sandbox', undefined),
  ).rejects.toThrow('2/3 assets exported; 1 failed');
  expect(fixtures.downloadAsset).toHaveBeenCalledTimes(2);
  expect(fixtures.downloadAsset.mock.calls[0][1]).toBe(
    MAX_ASSET_CHUNK_DATA_BYTES,
  );
  expect(fixtures.downloadAsset.mock.calls[1][1]).toBe(
    MAX_ASSET_CHUNK_DATA_BYTES - 1,
  );
  const report = JSON.parse(await fixtures.downloads[2].blob.text());
  expect(report.failedAssets[0].message).toContain('byte budget');
});

test('unknown sizes each receive an independent archive budget', async () => {
  fixtures.count = 2;
  fixtures.overrides.set(0, {
    id: 'unknown-size',
    filename: 'unknown.bin',
    url: 'https://www.datocms-assets.com/unknown.bin',
  });
  await downloadAllAssets('synthetic-token', 'sandbox', undefined);
  expect(fixtures.archives).toHaveLength(2);
  expect(fixtures.downloadAsset.mock.calls.map((call) => call[1])).toEqual([
    MAX_ASSET_CHUNK_DATA_BYTES,
    MAX_ASSET_CHUNK_DATA_BYTES,
  ]);
});

test('cancel discards the current ZIP, stops later assets and never writes a snapshot', async () => {
  fixtures.count = 1000;
  const controller = new AbortController();
  fixtures.downloadAsset.mockImplementationOnce(async () => {
    controller.abort();
    return new Blob([new Uint8Array([1])]);
  });
  await expect(
    downloadAllAssets(
      'synthetic-token',
      'sandbox',
      undefined,
      undefined,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fixtures.downloadAsset).toHaveBeenCalledOnce();
  expect(fixtures.downloads).toHaveLength(0);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
});

test('a ZIP entry collision fails explicitly instead of overwriting a referenced asset', async () => {
  fixtures.count = 2;
  fixtures.overrides.set(0, {
    id: 'upload:1',
    filename: 'same.bin',
    size: 1,
    url: 'https://www.datocms-assets.com/one.bin',
  });
  fixtures.overrides.set(1, {
    id: 'upload-1',
    filename: 'same.bin',
    size: 1,
    url: 'https://www.datocms-assets.com/two.bin',
  });
  await expect(
    downloadAllAssets('synthetic-token', 'sandbox', undefined),
  ).rejects.toThrow('Duplicate ZIP entry');
  expect(fixtures.downloadAsset).not.toHaveBeenCalled();
  expect(fixtures.downloads).toHaveLength(0);
});

test('a duplicate ID across pages prevents false completion before any ZIP downloads', async () => {
  fixtures.count = 501;
  fixtures.overrides.set(500, {
    id: 'upload-0',
    filename: 'duplicate.bin',
    size: 1,
    url: 'https://www.datocms-assets.com/duplicate.bin',
  });
  await expect(
    downloadAllAssets('synthetic-token', 'sandbox', undefined),
  ).rejects.toThrow('duplicate upload ID upload-0');
  expect(fixtures.downloadAsset).not.toHaveBeenCalled();
  expect(fixtures.downloads).toHaveLength(0);
});

test('changed final count produces an incomplete report after delivering ZIPs', async () => {
  fixtures.count = 1;
  fixtures.rawList
    .mockResolvedValueOnce({ meta: { total_count: 1 } })
    .mockResolvedValueOnce({ meta: { total_count: 1 } })
    .mockResolvedValueOnce({ meta: { total_count: 2 } });
  await expect(
    downloadAllAssets('synthetic-token', 'sandbox', undefined),
  ).rejects.toThrow('Asset library changed');
  const report = JSON.parse(await fixtures.downloads[1].blob.text());
  expect(report.issues[0]).toContain('1 assets before, 2 after');
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
});

test('cancel after a delivered ZIP records completed filenames without a continuation workflow', async () => {
  fixtures.count = 101;
  const controller = new AbortController();
  const progress = (_value: number, message: string) => {
    if (message.startsWith('ZIP 2/2: downloading')) controller.abort();
  };
  await expect(
    downloadAllAssets(
      'synthetic-token',
      'sandbox',
      undefined,
      progress,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fixtures.downloads).toHaveLength(2);
  const report = JSON.parse(await fixtures.downloads[1].blob.text());
  expect(report).toMatchObject({
    status: 'cancelled',
    successfulAssets: 100,
    unexportedAssets: 1,
  });
  expect(report.chunkFilenames).toHaveLength(1);
  expect(fixtures.downloadAsset).toHaveBeenCalledTimes(100);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
});

test('oversized metadata pages shrink automatically and still cover all assets exactly once', async () => {
  fixtures.count = 3;
  const list = fixtures.list.getMockImplementation();
  if (!list) throw new Error('Expected metadata fixture');
  fixtures.list.mockImplementation((query) => {
    if (query.page.limit > 1)
      throw new ResponseSizeError('Synthetic large response');
    return list(query);
  });
  await downloadAllAssets('synthetic-token', 'sandbox', undefined);
  expect(fixtures.downloadAsset).toHaveBeenCalledTimes(3);
  const manifest = JSON.parse(
    String(fixtures.archives[0].get('manifest.json')),
  );
  expect(
    manifest.assets.map(
      (entry: { sourceUploadId: string }) => entry.sourceUploadId,
    ),
  ).toEqual(['upload-0', 'upload-1', 'upload-2']);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(true);
});

test('cancellation while a delivered ZIP object URL is being released retains the handoff in its report', async () => {
  fixtures.count = 1;
  const controller = new AbortController();
  fixtures.abortOnDownload = () => controller.abort();
  await expect(
    downloadAllAssets(
      'synthetic-token',
      'sandbox',
      undefined,
      undefined,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const report = JSON.parse(await fixtures.downloads[1].blob.text());
  expect(report).toMatchObject({
    status: 'cancelled',
    successfulAssets: 1,
    unexportedAssets: 0,
  });
  expect(report.chunkFilenames).toHaveLength(1);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
});

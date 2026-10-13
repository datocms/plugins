// @vitest-environment node

import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js';
import { MemoryWorkspace } from '../test/memoryWorkspace';
import { LAST_ASSET_EXPORT_STORAGE_KEY } from './assetExport';
import downloadAllAssets from './downloadAllAssets';

type FixtureUpload = {
  id: string;
  filename: string;
  size?: number;
  md5?: string;
  url?: string;
  default_field_metadata?: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
};

const fixtures = vi.hoisted(() => ({
  uploads: [] as FixtureUpload[],
  countAfterScan: undefined as number | undefined,
  list: vi.fn(),
  rawList: vi.fn(),
  workspace: undefined as unknown,
  storage: new Map<string, string>(),
}));

vi.mock('./exportWorkspace', () => ({
  ExportWorkspace: { open: vi.fn(async () => fixtures.workspace) },
}));

vi.mock('@datocms/cma-client-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datocms/cma-client-browser')>()),
  buildClient: vi.fn(() => ({
    uploads: { list: fixtures.list, rawList: fixtures.rawList },
    site: { find: vi.fn(async () => ({ id: 'synthetic-project' })) },
  })),
}));

vi.mock('./exportRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exportRuntime')>()),
  yieldToBrowser: vi.fn(async () => undefined),
}));

let workspace: MemoryWorkspace;
let fetchMock: ReturnType<typeof vi.fn>;

const upload = (index: number, bytes: number[]): FixtureUpload => ({
  id: `upload-${index}`,
  filename: `asset ${index}.bin`,
  size: bytes.length,
  url: `https://www.datocms-assets.com/${index}.bin`,
});

beforeEach(() => {
  workspace = new MemoryWorkspace();
  fixtures.workspace = workspace;
  fixtures.uploads = [upload(1, [0, 1, 255]), upload(2, [128, 4])];
  fixtures.countAfterScan = undefined;
  fixtures.storage.clear();
  let counts = 0;
  fixtures.rawList.mockReset().mockImplementation(async () => ({
    meta: {
      total_count:
        counts++ > 0 && fixtures.countAfterScan !== undefined
          ? fixtures.countAfterScan
          : fixtures.uploads.length,
    },
  }));
  fixtures.list
    .mockReset()
    .mockImplementation(
      async ({ page }: { page: { limit: number; offset: number } }) =>
        fixtures.uploads.slice(page.offset, page.offset + page.limit),
    );
  const bodies: Record<string, number[]> = {
    '1.bin': [0, 1, 255],
    '2.bin': [128, 4],
  };
  fetchMock = vi.fn(async (input: string) => {
    const name = new URL(input).pathname.slice(1);
    return new Response(new Uint8Array(bodies[name] ?? []));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    localStorage: {
      setItem: (key: string, value: string) => fixtures.storage.set(key, value),
      getItem: (key: string) => fixtures.storage.get(key) ?? null,
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

async function readZip(blob: Blob) {
  const entries = await new ZipReader(new BlobReader(blob)).getEntries();
  const entry = (name: string) => {
    const found = entries.find((candidate) => candidate.filename === name);
    if (!found || found.directory) throw new Error(`No entry ${name}`);
    return found;
  };
  return {
    names: entries.map((candidate) => candidate.filename),
    bytes: (name: string) => entry(name).getData(new Uint8ArrayWriter()),
    manifest: async () =>
      JSON.parse(await entry('manifest.json').getData(new TextWriter())),
  };
}

test('downloads every asset and its metadata in one zip', async () => {
  fixtures.uploads[0] = {
    ...fixtures.uploads[0],
    default_field_metadata: { en: { alt: 'Localized description' } },
    custom_data: { nested: { reference: 'upload-2' } },
  };
  const progress = vi.fn();
  await downloadAllAssets('token', 'sandbox', undefined, progress);

  expect(workspace.downloads).toHaveLength(1);
  const { name, blob } = workspace.downloads[0];
  expect(name).toMatch(/^allAssets\..+\.zip$/);
  const zip = await readZip(blob);
  expect(zip.names).toEqual([
    'u_upload-1__asset_1.bin',
    'u_upload-2__asset_2.bin',
    'manifest.json',
  ]);
  expect(await zip.bytes('u_upload-1__asset_1.bin')).toEqual(
    new Uint8Array([0, 1, 255]),
  );
  const manifest = await zip.manifest();
  expect(manifest).toMatchObject({
    manifestVersion: '3.0.0',
    sourceProjectId: 'synthetic-project',
    sourceEnvironment: 'sandbox',
    failedAssets: [],
    issues: [],
  });
  expect(manifest.assets).toHaveLength(2);
  expect(manifest.assets[0]).toMatchObject({
    sourceUploadId: 'upload-1',
    zipEntryName: 'u_upload-1__asset_1.bin',
    metadata: {
      default_field_metadata: { en: { alt: 'Localized description' } },
      custom_data: { nested: { reference: 'upload-2' } },
    },
  });
  expect(
    new URL(fetchMock.mock.calls[0][0]).searchParams.get(
      'skip-default-optimizations',
    ),
  ).toBe('true');
  expect(
    JSON.parse(fixtures.storage.get(LAST_ASSET_EXPORT_STORAGE_KEY) ?? '{}'),
  ).toMatchObject({ filename: name, totalAssets: 2 });
  expect(progress).toHaveBeenLastCalledWith(
    100,
    `Completed asset export: 2 assets in ${name}.`,
  );
});

test('lists an asset that cannot be downloaded and still delivers the others', async () => {
  fixtures.uploads[1] = { ...fixtures.uploads[1], url: undefined };

  await expect(
    downloadAllAssets('token', 'sandbox', undefined),
  ).rejects.toThrow(
    "Asset export incomplete: 1/2 assets exported; 1 failed. The zip's manifest.json lists them.",
  );
  const zip = await readZip(workspace.downloads[0].blob);
  expect(zip.names).toEqual(['u_upload-1__asset_1.bin', 'manifest.json']);
  expect((await zip.manifest()).failedAssets).toEqual([
    expect.objectContaining({
      sourceUploadId: 'upload-2',
      message: 'Asset does not have a downloadable URL',
    }),
  ]);
  expect(fixtures.storage.has(LAST_ASSET_EXPORT_STORAGE_KEY)).toBe(false);
});

test('stops without downloading when the asset list changes while it is read', async () => {
  fixtures.countAfterScan = 3;

  await expect(
    downloadAllAssets('token', 'sandbox', undefined),
  ).rejects.toThrow('Asset list changed while scanning');
  expect(workspace.downloads).toEqual([]);
  expect(workspace.clears).toBe(1);
});

test('cancelling discards the export', async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => {
    controller.abort();
    return new Response(new Uint8Array([1]));
  });

  await expect(
    downloadAllAssets(
      'token',
      'sandbox',
      undefined,
      undefined,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(workspace.downloads).toEqual([]);
  expect(workspace.clears).toBe(1);
});

test('an empty media library downloads nothing', async () => {
  fixtures.uploads = [];
  const progress = vi.fn();

  await downloadAllAssets('token', 'sandbox', undefined, progress);
  expect(progress).toHaveBeenLastCalledWith(100, 'No assets found to export.');
  expect(workspace.downloads).toEqual([]);
});

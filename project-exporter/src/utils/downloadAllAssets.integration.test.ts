import JSZip from 'jszip';
import downloadAllAssets from './downloadAllAssets';

const fixture = vi.hoisted(() => ({
  archive: undefined as Blob | undefined,
  list: vi.fn(),
}));

vi.mock('@datocms/cma-client-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datocms/cma-client-browser')>()),
  buildClient: vi.fn(() => ({
    uploads: {
      list: fixture.list,
      rawList: vi.fn(async () => ({ meta: { total_count: 2 } })),
    },
    site: { find: vi.fn(async () => ({ id: 'synthetic-project' })) },
  })),
}));

vi.mock('./exportRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exportRuntime')>();
  return {
    ...actual,
    yieldToBrowser: vi.fn(async () => undefined),
    downloadBlob: vi.fn(async (blob: Blob) => {
      fixture.archive = blob;
    }),
  };
});

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error('Unexpected FileReader result'));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function prepareSmallAssets() {
  fixture.archive = undefined;
  fixture.list.mockResolvedValue([
    {
      id: 'one',
      filename: 'one.bin',
      size: 2,
      url: 'https://www.datocms-assets.com/one.bin',
    },
    {
      id: 'two',
      filename: 'two.bin',
      size: 2,
      url: 'https://www.datocms-assets.com/two.bin',
    },
  ]);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
      .mockResolvedValueOnce(new Response(new Uint8Array([3, 4]))),
  );
}

test('real JSZip output preserves full bytes and source IDs in the import manifest', async () => {
  fixture.list.mockResolvedValue([
    {
      id: 'source-1',
      filename: 'same name.bin',
      size: 3,
      url: 'https://www.datocms-assets.com/one.bin',
      default_field_metadata: { en: { alt: 'Localized description' } },
      custom_data: { nested: { reference: 'source-2' } },
      md5: 'source-checksum',
    },
    {
      id: 'source-2',
      filename: 'same name.bin',
      size: 2,
      url: 'https://www.datocms-assets.com/two.bin',
    },
  ]);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 255])))
    .mockResolvedValueOnce(new Response(new Uint8Array([128, 4])));
  vi.stubGlobal('fetch', fetchMock);
  await downloadAllAssets('synthetic-token', 'sandbox', undefined);
  expect(fixture.archive).toBeDefined();
  if (!fixture.archive) throw new Error('Expected an archive');
  const zip = await JSZip.loadAsync(await blobBytes(fixture.archive));
  const one = zip.file('u_source-1__same_name.bin');
  const two = zip.file('u_source-2__same_name.bin');
  const manifestFile = zip.file('manifest.json');
  if (!one || !two || !manifestFile)
    throw new Error('Missing expected ZIP entries');
  expect(await one.async('uint8array')).toEqual(new Uint8Array([0, 1, 255]));
  expect(await two.async('uint8array')).toEqual(new Uint8Array([128, 4]));
  const manifest = JSON.parse(await manifestFile.async('string'));
  expect(manifest.assets[0]).toMatchObject({
    sourceUploadId: 'source-1',
    checksum: 'source-checksum',
    downloadedSize: 3,
    metadata: {
      default_field_metadata: { en: { alt: 'Localized description' } },
      custom_data: { nested: { reference: 'source-2' } },
    },
  });
  expect(manifest.chunk.downloadedBytes).toBe(5);
});

test('cancelling during real ZIP generation settles safely and emits no incomplete ZIP', async () => {
  prepareSmallAssets();
  const controller = new AbortController();
  await expect(
    downloadAllAssets(
      'synthetic-token',
      'sandbox',
      undefined,
      (_progress, message) => {
        if (message.includes('generating archive')) controller.abort();
      },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fixture.archive).toBeUndefined();
});

test('a ZIP progress callback error becomes a reported failure instead of an uncaught worker exception', async () => {
  prepareSmallAssets();
  await expect(
    downloadAllAssets(
      'synthetic-token',
      'sandbox',
      undefined,
      (_progress, message) => {
        if (message.includes('generating archive'))
          throw new Error('Synthetic progress failure');
      },
    ),
  ).rejects.toThrow('0/2 assets exported; 2 failed');
  expect(fixture.archive?.type).toBe('application/json');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  buildClient,
  type SimpleSchemaTypes,
} from '@datocms/cma-client-browser';
import {
  collectOptimizableAssets,
  type OptimizationDependencies,
  runAssetOptimization,
} from '../src/services/assetOptimizationService.ts';
import { ImageSizeLimitError } from '../src/utils/imageTransfer.ts';
import {
  type Asset,
  defaultSettings,
  getOptimizationParams,
  normalizeSettings,
} from '../src/utils/optimizationUtils.ts';

const size = 4 * 1024 * 1024;
function rawUpload(index: number) {
  return {
    id: `asset-${index}`,
    type: 'upload',
    attributes: {
      is_image: true,
      size,
      url: `https://cdn.example.test/photo-${index}.jpg?token=existing`,
      path: `/assets/photo-${index}.jpg`,
      basename: `photo-${index}`,
      width: 4096,
      height: 3072,
      md5: `original-${index}`,
      updated_at: '2026-01-01T00:00:00Z',
      format: 'jpg',
      default_field_metadata: {
        en: { alt: 'English', custom_data: { nested: { key: 'value' } } },
        pt: { alt: 'Português' },
      },
    },
  };
}

function fixtureClient(count: number, failAtOffset?: number) {
  const pages: number[] = [];
  const client = buildClient({
    apiToken: 'synthetic-token',
    baseUrl: 'https://cma.example.test',
    environment: 'synthetic',
    fetchFn: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(init?.method, 'GET');
      assert.equal(url.pathname, '/uploads');
      assert.equal(url.searchParams.get('page[limit]'), '500');
      assert.equal(url.searchParams.get('order_by'), 'id_ASC');
      assert.equal(url.searchParams.get('filter[fields][type][eq]'), 'image');
      const offset = Number(url.searchParams.get('page[offset]'));
      pages.push(offset);
      if (offset === failAtOffset)
        return new Response(JSON.stringify({ data: [] }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(
        JSON.stringify({
          data: Array.from(
            { length: Math.max(0, Math.min(500, count - offset)) },
            (_, index) => rawUpload(offset + index),
          ),
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { client, pages };
}

function testDependencies(): OptimizationDependencies {
  return {
    download: async () =>
      new Blob(['optimized image bytes'], { type: 'image/webp' }),
    filename: async (asset) => `${asset.basename}.webp`,
    replace: async (asset, blob) =>
      ({
        id: asset.id,
        type: 'upload',
        path: `/optimized/${asset.id}.webp`,
        url: `https://cdn.example.test/${asset.id}.webp`,
        size: blob.size,
      }) as SimpleSchemaTypes.Upload,
  };
}

test('a selected collection is enforced across discovery pages before any write', async () => {
  const offsets: number[] = [];
  let writes = 0;
  const client = buildClient({
    apiToken: 'synthetic-token',
    baseUrl: 'https://cma.example.test',
    fetchFn: async (input) => {
      const url = new URL(String(input));
      assert.equal(
        url.searchParams.get('filter[collection_id][eq]'),
        'selected-collection',
      );
      const offset = Number(url.searchParams.get('page[offset]'));
      offsets.push(offset);
      return new Response(
        JSON.stringify({
          data: Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({
            ...rawUpload(offset + index),
            relationships: {
              upload_collection: {
                data: {
                  id:
                    offset === 0 ? 'selected-collection' : 'another-collection',
                  type: 'upload_collection',
                },
              },
            },
          })),
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const dependencies = testDependencies();
  dependencies.replace = async () => {
    writes++;
    throw new Error('Unexpected write');
  };
  await assert.rejects(
    runAssetOptimization(
      client,
      defaultSettings,
      { collectionId: 'selected-collection' },
      dependencies,
    ),
    /outside the selected collection/,
  );
  assert.deepEqual(offsets, [0, 500]);
  assert.equal(writes, 0);
});

test('collection discovery keeps only matching images and preserves its exact scope', async () => {
  const client = buildClient({
    apiToken: 'synthetic-token',
    baseUrl: 'https://cma.example.test',
    fetchFn: async (input) => {
      const url = new URL(String(input));
      assert.equal(
        url.searchParams.get('filter[collection_id][eq]'),
        'selected-collection',
      );
      const upload = rawUpload(1);
      return new Response(
        JSON.stringify({
          data: [
            {
              ...upload,
              relationships: {
                upload_collection: {
                  data: {
                    id: 'selected-collection',
                    type: 'upload_collection',
                  },
                },
              },
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const assets = await collectOptimizableAssets(
    client,
    size,
    undefined,
    undefined,
    'selected-collection',
  );
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.id, 'asset-1');
});

test('decimal MB limits are converted to an integer CMA byte boundary', async () => {
  const requests: string[] = [];
  const client = buildClient({
    apiToken: 'synthetic-token',
    baseUrl: 'https://cma.example.test',
    fetchFn: async (input) => {
      const url = new URL(String(input));
      const boundary = url.searchParams.get('filter[fields][size][gte]');
      assert.equal(boundary, '104858');
      assert.equal(url.searchParams.get('filter[fields][type][eq]'), 'image');
      requests.push(String(input));
      return new Response(JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const assets = await collectOptimizableAssets(client, 0.1 * 1024 * 1024);
  assert.deepEqual(assets, []);
  assert.equal(requests.length, 1);
});

test('late inventory failure prevents every replacement and propagates the error', async () => {
  const { client } = fixtureClient(501, 500);
  const deps = testDependencies();
  let downloads = 0;
  deps.download = async () => {
    downloads++;
    throw new Error('unexpected download');
  };
  await assert.rejects(runAssetOptimization(client, defaultSettings, {}, deps));
  assert.equal(downloads, 0);
});

test('lean inventory excludes locale metadata and deduplicates changing pages', async () => {
  const { client } = fixtureClient(501);
  const assets = await collectOptimizableAssets(client, 0);
  assert.equal(assets.length, 501);
  assert.ok(!('default_field_metadata' in assets[0]));
  assert.equal(assets[0].md5, 'original-0');
  assert.equal(assets[0].updated_at, '2026-01-01T00:00:00Z');
  const firstPage = assets.slice(0, 500);
  let calls = 0;
  client.uploads.list = async () =>
    (++calls === 1 ? firstPage : [firstPage[0]]) as SimpleSchemaTypes.Upload[];
  const deduplicated = await collectOptimizableAssets(client, 0);
  assert.equal(deduplicated.length, 500);
});

test('preview never replaces; failures and insufficient savings keep accurate accounting', async () => {
  const { client } = fixtureClient(4);
  const deps = testDependencies();
  deps.download = async (url) => {
    const index = Number(new URL(url).pathname.match(/photo-(\d+)/)?.[1]);
    if (index === 1) throw new Error('synthetic CDN failure');
    return new Blob([new Uint8Array(index === 2 ? size : 10)]);
  };
  deps.replace = async () => {
    throw new Error('preview must never mutate');
  };
  const result = await runAssetOptimization(
    client,
    defaultSettings,
    { preview: true },
    deps,
  );
  assert.equal(result.optimized, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(
    result.totalAssets,
    result.optimized + result.failed + result.skipped,
  );
  assert.equal(result.failedAssets[0].error, 'synthetic CDN failure');
  assert.equal(result.optimizedAssets[0].originalSize, size);
});

test('cancellation stops scheduling but drains accepted replacements and retains partial results', async () => {
  const { client } = fixtureClient(10);
  const deps = testDependencies();
  const controller = new AbortController();
  let started = 0;
  let settle: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    settle = resolve;
  });
  deps.replace = async (asset, blob) => {
    started++;
    if (started === 2) controller.abort();
    await gate;
    return {
      id: asset.id,
      type: 'upload',
      path: `/new/${asset.id}`,
      url: 'https://cdn.example.test/new',
      size: blob.size,
    } as SimpleSchemaTypes.Upload;
  };
  const run = runAssetOptimization(
    client,
    defaultSettings,
    { signal: controller.signal },
    deps,
  );
  while (started < 2) {
    // biome-ignore lint/performance/noAwaitInLoops: Wait for the two synthetic in-flight tasks before releasing them.
    await nextTurn();
  }
  settle?.();
  const result = await run;
  assert.equal(started, 2);
  assert.equal(result.optimized, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.cancelled, true);
  assert.equal(result.unprocessed, 8);
});

test('cancellation during inventory does not report failed assets or mutate', async () => {
  const { client } = fixtureClient(501);
  const controller = new AbortController();
  const result = await runAssetOptimization(
    client,
    defaultSettings,
    {
      signal: controller.signal,
      onProgress: ({ phase }) => {
        if (phase === 'loading') controller.abort();
      },
    },
    testDependencies(),
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.optimized, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.totalAssets, 500);
  assert.equal(result.unprocessed, 500);
  assert.equal(result.inventoryIncomplete, true);
});

test('normalizes malformed stored settings and forces original format when requested', () => {
  const settings = normalizeSettings({
    qualityLarge: Number.NaN,
    minimumReduction: 120,
    largeAssetThreshold: 9,
    veryLargeAssetThreshold: -1,
    targetFormat: 'unsafe&extra=1',
    useDpr: 'true',
    preserveOriginalFormat: true,
  });
  assert.equal(settings.qualityLarge, defaultSettings.qualityLarge);
  assert.equal(settings.minimumReduction, 100);
  assert.equal(settings.veryLargeAssetThreshold, 9);
  assert.equal(settings.targetFormat, 'avif');
  assert.equal(settings.useDpr, true);
  const asset: Asset = {
    id: 'x',
    is_image: true,
    size: 12 * 1024 * 1024,
    path: '/photo.jpg',
    basename: 'photo',
    url: 'https://cdn.example.test/photo.jpg',
    format: 'jpg',
  };
  assert.match(getOptimizationParams(asset, settings) ?? '', /fm=jpg/);
  assert.ok(!getOptimizationParams({ ...asset, is_image: false }, settings));
});

test('streaming size rejection is a skip and zero-percent settings still require smaller output', async () => {
  const { client } = fixtureClient(2);
  const deps = testDependencies();
  deps.download = async (url) => {
    if (url.includes('photo-0'))
      throw new ImageSizeLimitError('Output exceeds memory limit');
    return new Blob([new Uint8Array(size)]);
  };
  deps.replace = async () => {
    throw new Error('No replacement may be sent');
  };
  const result = await runAssetOptimization(
    client,
    { ...defaultSettings, minimumReduction: 0 },
    {},
    deps,
  );
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.optimized, 0);
});

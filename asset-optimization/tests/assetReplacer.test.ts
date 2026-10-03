import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { buildClient } from '@datocms/cma-client-browser';
import {
  AssetChangedError,
  CmaRequestTimeoutError,
  createBoundedCmaFetch,
  replaceAssetFromBlob,
  UnconfirmedReplacementError,
} from '../src/utils/assetReplacer';
import type { Asset } from '../src/utils/optimizationUtils';

const asset: Asset = {
  id: 'existing-upload',
  is_image: true,
  size: 1000,
  url: 'https://images.invalid/old.jpg',
  path: '/project/old.jpg',
  basename: 'old',
  md5: 'original-hash',
  updated_at: '2026-01-01T00:00:00Z',
};
const blob = new Blob(['optimized bytes'], { type: 'image/avif' });
const newPath = '/project/new.avif';
const options = {
  retryDelayMs: 0,
  maxRetryDelayMs: 0,
  jobPollIntervalMs: 0,
  requestTimeoutMs: 100,
  maxRetries: 2,
};

function wireUpload(path = asset.path, size = asset.size) {
  return {
    id: asset.id,
    type: 'upload',
    attributes: {
      path,
      size,
      url: `https://images.invalid${path}`,
      basename: 'old',
      filename: 'old.jpg',
      md5: asset.md5,
      updated_at: asset.updated_at,
      is_image: true,
      tags: ['keep', 'all-tags'],
      notes: 'retain notes',
      author: 'author',
      copyright: 'owner',
      default_field_metadata: {
        alt: Object.fromEntries(
          Array.from({ length: 80 }, (_, index) => [
            `locale-${index}`,
            `alt-${index}`,
          ]),
        ),
        title: Object.fromEntries(
          Array.from({ length: 80 }, (_, index) => [
            `locale-${index}`,
            `title-${index}`,
          ]),
        ),
        custom_data: Object.fromEntries(
          Array.from({ length: 80 }, (_, index) => [
            `locale-${index}`,
            { nested: { keep: true } },
          ]),
        ),
        focal_point: { x: 0.4, y: 0.6 },
        poster_time: null,
      },
    },
    relationships: {
      creator: { data: { type: 'user', id: 'creator' } },
      upload_collection: { data: { type: 'upload_collection', id: 'folder' } },
    },
  };
}

function jsonResponse(
  payload: object,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

type Request = { method: string; url: URL; init?: RequestInit };
type Override = (
  request: Request,
  call: number,
) => Response | Promise<Response> | undefined;

function defaultCmaResponse(request: Request): Response {
  if (request.method === 'GET' && request.url.pathname.startsWith('/uploads/'))
    return jsonResponse({ data: wireUpload() });
  if (request.url.pathname === '/upload-requests')
    return jsonResponse({
      data: {
        id: newPath,
        type: 'upload_request',
        attributes: {
          url: 'https://storage.invalid/signed',
          request_headers: { 'x-signed-header': 'preserve' },
        },
      },
    });
  if (request.method === 'PUT')
    return jsonResponse({ data: { id: 'job-1', type: 'job' } }, 202);
  if (request.url.pathname === '/job-results/job-1')
    return jsonResponse({
      data: {
        id: 'job-1',
        type: 'job_result',
        attributes: {
          status: 200,
          payload: { data: wireUpload(newPath, blob.size) },
        },
      },
    });
  throw new Error(`Unexpected network request: ${request.url}`);
}

function setup(
  t: TestContext,
  overrides: { cma?: Override; storage?: Override } = {},
) {
  const calls: Request[] = [];
  let putCount = 0;
  let storageCount = 0;
  let readCount = 0;
  let jobCount = 0;
  const client = buildClient({
    apiToken: 'synthetic-token',
    autoRetry: false,
    environment: 'synthetic-sandbox',
    baseUrl: 'https://api.invalid',
    fetchFn: async (input, init) => {
      const request = {
        method: init?.method ?? 'GET',
        url: new URL(String(input)),
        init,
      };
      calls.push(request);
      const isRead =
        request.method === 'GET' &&
        request.url.pathname === `/uploads/${asset.id}`;
      const isUpdate = request.method === 'PUT';
      const call = isRead
        ? ++readCount
        : isUpdate
          ? ++putCount
          : request.url.pathname.startsWith('/job-results/')
            ? ++jobCount
            : 1;
      const override = overrides.cma?.(request, call);
      if (override !== undefined) return override;
      return defaultCmaResponse(request);
    },
  });
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = {
        method: init?.method ?? 'GET',
        url: new URL(String(input)),
        init,
      };
      assert.equal(request.url.host, 'storage.invalid');
      storageCount++;
      const override = overrides.storage?.(request, storageCount);
      return override ?? new Response(null, { status: 200 });
    },
  );
  return {
    client,
    calls,
    counts: () => ({ putCount, storageCount, readCount, jobCount }),
  };
}

test('SDK 202 job is awaited; Blob and signed headers pass unchanged; all locales/metadata retain their values', async (t) => {
  const { client, calls, counts } = setup(t, {
    cma: (request, call) =>
      request.url.pathname.startsWith('/job-results/') && call === 1
        ? jsonResponse({ data: [] }, 404)
        : undefined,
    storage: (request) => {
      assert.equal(request.init?.body, blob);
      assert.deepEqual(request.init?.headers, {
        'x-signed-header': 'preserve',
      });
      return undefined;
    },
  });
  const result = await replaceAssetFromBlob(
    asset,
    blob,
    'old.avif',
    client,
    options,
  );
  assert.equal(result.id, asset.id);
  assert.equal(result.path, newPath);
  assert.equal(result.size, blob.size);
  assert.deepEqual(
    result.default_field_metadata,
    wireUpload().attributes.default_field_metadata,
  );
  assert.deepEqual(result.tags, wireUpload().attributes.tags);
  assert.equal(result.notes, 'retain notes');
  assert.deepEqual(result.creator, { type: 'user', id: 'creator' });
  assert.deepEqual(result.upload_collection, {
    type: 'upload_collection',
    id: 'folder',
  });
  const update = calls.find((request) => request.method === 'PUT');
  assert.deepEqual(JSON.parse(String(update?.init?.body)), {
    data: { id: asset.id, type: 'upload', attributes: { path: newPath } },
  });
  const permission = calls.find(
    (request) => request.url.pathname === '/upload-requests',
  );
  assert.equal(
    JSON.parse(String(permission?.init?.body)).data.attributes.filename,
    'old.avif',
  );
  assert.deepEqual(counts(), {
    putCount: 1,
    storageCount: 1,
    readCount: 2,
    jobCount: 2,
  });
  assert.equal(client.jobResultsFetcher, undefined);
});

test('direct 429 reuses uploaded path; retries never reconvert or upload a second file', async (t) => {
  let rateLimited = 0;
  const { client, counts } = setup(t, {
    cma: (request, call) =>
      request.method === 'PUT' && call === 1
        ? jsonResponse({ data: [] }, 429, { 'x-ratelimit-reset': '0' })
        : undefined,
  });
  const result = await replaceAssetFromBlob(asset, blob, 'old.avif', client, {
    ...options,
    onRateLimit: () => {
      rateLimited++;
    },
  });
  assert.equal(result.path, newPath);
  assert.equal(rateLimited, 1);
  assert.equal(counts().storageCount, 1);
  assert.equal(counts().putCount, 2);
});

test('429 during job polling retries polling only, never the mutation', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request, call) =>
      request.url.pathname.startsWith('/job-results/') && call === 1
        ? jsonResponse({ data: [] }, 429)
        : undefined,
  });
  await replaceAssetFromBlob(asset, blob, 'old.avif', client, options);
  assert.equal(counts().putCount, 1);
  assert.equal(counts().jobCount, 2);
});

test('a completed job with HTTP 429 is a failure and does not replay its original PUT', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request) =>
      request.url.pathname.startsWith('/job-results/')
        ? jsonResponse({
            data: {
              id: 'job-1',
              type: 'job_result',
              attributes: { status: 429, payload: { data: [] } },
            },
          })
        : undefined,
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, options),
    /429/,
  );
  assert.equal(counts().putCount, 1);
});

test('storage retry resends the same Blob to the same signed path without a new permission', async (t) => {
  const { client, calls, counts } = setup(t, {
    storage: (request, call) => {
      assert.equal(request.init?.body, blob);
      return call === 1 ? new Response(null, { status: 503 }) : undefined;
    },
  });
  await replaceAssetFromBlob(asset, blob, 'old.avif', client, options);
  assert.equal(counts().storageCount, 2);
  assert.equal(
    calls.filter((request) => request.url.pathname === '/upload-requests')
      .length,
    1,
  );
});

test('concurrent file change is rejected before sending replacement, even after binary upload', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request, call) =>
      request.method === 'GET' &&
      request.url.pathname.startsWith('/uploads/') &&
      call === 2
        ? jsonResponse({ data: wireUpload('/project/changed.jpg') })
        : undefined,
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, options),
    AssetChangedError,
  );
  assert.equal(counts().putCount, 0);
});

test('a same-path edit is detected from hash/update timestamp before upload', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request) => {
      if (!request.url.pathname.startsWith('/uploads/')) return undefined;
      const edited = wireUpload();
      edited.attributes.updated_at = '2026-02-01T00:00:00Z';
      return jsonResponse({ data: edited });
    },
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, options),
    AssetChangedError,
  );
  assert.equal(counts().storageCount, 0);
});

test('lost mutation response is reconciled from read-back instead of replayed', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request, call) => {
      if (request.method === 'PUT')
        throw new TypeError('Connection dropped after saving');
      if (
        request.method === 'GET' &&
        request.url.pathname.startsWith('/uploads/') &&
        call >= 3
      )
        return jsonResponse({ data: wireUpload(newPath, blob.size) });
      return undefined;
    },
  });
  const result = await replaceAssetFromBlob(
    asset,
    blob,
    'old.avif',
    client,
    options,
  );
  assert.equal(result.path, newPath);
  assert.equal(counts().putCount, 1);
});

test('uncertain write with unchanged asset ends with a distinct error after bounded read-back', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request) => {
      if (request.method === 'PUT') throw new TypeError('Response lost');
      return undefined;
    },
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, {
      ...options,
      reconciliationAttempts: 3,
    }),
    UnconfirmedReplacementError,
  );
  assert.equal(counts().putCount, 1);
  assert.equal(counts().readCount, 5);
});

test('cancellation before mutation aborts storage; cancellation after acceptance still confirms the result', async (t) => {
  const before = new AbortController();
  const first = setup(t, {
    storage: () => {
      before.abort();
      return undefined;
    },
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', first.client, {
      ...options,
      signal: before.signal,
    }),
    { name: 'AbortError' },
  );
  assert.equal(first.counts().putCount, 0);
  t.mock.restoreAll();
  const after = new AbortController();
  const second = setup(t, {
    cma: (request) => {
      if (request.method === 'PUT') after.abort();
      return undefined;
    },
  });
  const scheduledSignals: (AbortSignal | undefined)[] = [];
  const result = await replaceAssetFromBlob(
    asset,
    blob,
    'old.avif',
    second.client,
    {
      ...options,
      signal: after.signal,
      beforeRequest: async (signal) => {
        scheduledSignals.push(signal);
      },
    },
  );
  assert.equal(result.path, newPath);
  assert.equal(second.counts().putCount, 1);
  assert.deepEqual(scheduledSignals, [
    after.signal,
    after.signal,
    after.signal,
    after.signal,
    undefined,
  ]);
});

test('job polling deadline exits automatically without replaying mutation', async (t) => {
  let clock = 0;
  t.mock.method(Date, 'now', () => ++clock);
  const { client, counts } = setup(t, {
    cma: (request) =>
      request.url.pathname.startsWith('/job-results/')
        ? jsonResponse({ data: [] }, 404)
        : undefined,
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, {
      ...options,
      jobTimeoutMs: 8,
      reconciliationAttempts: 1,
    }),
    UnconfirmedReplacementError,
  );
  assert.equal(counts().putCount, 1);
  assert.ok(counts().jobCount <= 8);
});

test('CMA deadline aborts the fetch and response body, including a stalled JSON body', async () => {
  let receivedSignal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return new Response(
      new ReadableStream({
        start() {
          /* intentionally never completes */
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  await assert.rejects(
    createBoundedCmaFetch(fetcher, 5)('https://api.invalid/uploads'),
    CmaRequestTimeoutError,
  );
  assert.equal(receivedSignal?.aborted, true);
});

test('the replacement deadline takes over an ordinary read transport deadline', async (t) => {
  const { client, counts } = setup(t, {
    cma: async (request, call) => {
      if (
        request.method === 'GET' &&
        request.url.pathname.startsWith('/uploads/') &&
        call === 1
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return jsonResponse({ data: wireUpload() });
      }
      return defaultCmaResponse(request);
    },
  });
  const readClient = buildClient({
    ...client.config,
    fetchFn: createBoundedCmaFetch(client.config.fetchFn, 1),
  });
  const result = await replaceAssetFromBlob(
    asset,
    blob,
    'old.avif',
    readClient,
    options,
  );
  assert.equal(result.path, newPath);
  assert.equal(counts().readCount, 2);
  assert.equal(counts().putCount, 1);
});

test('cancellation during a CMA read retains AbortError through the SDK', async (t) => {
  const controller = new AbortController();
  const { client, counts } = setup(t, {
    cma: (request) => {
      if (request.method !== 'GET') return undefined;
      controller.abort();
      return new Promise<Response>(() => {});
    },
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, {
      ...options,
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  assert.equal(counts().readCount, 1);
  assert.equal(counts().storageCount, 0);
  assert.equal(counts().putCount, 0);
});

test('HTTP 429 HTML from a gateway retries the rejected write using the same Blob/path', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request, call) =>
      request.method === 'PUT' && call === 1
        ? new Response('<h1>Rate limited</h1>', {
            status: 429,
            headers: { 'retry-after': '0', 'content-type': 'text/html' },
          })
        : undefined,
  });
  const result = await replaceAssetFromBlob(
    asset,
    blob,
    'old.avif',
    client,
    options,
  );
  assert.equal(result.path, newPath);
  assert.equal(counts().putCount, 2);
  assert.equal(counts().storageCount, 1);
});

test('HTTP 503 HTML during read preserves status and is retried', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request, call) =>
      request.method === 'GET' &&
      request.url.pathname.startsWith('/uploads/') &&
      call === 1
        ? new Response('Unavailable', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          })
        : undefined,
  });
  await replaceAssetFromBlob(asset, blob, 'old.avif', client, options);
  assert.equal(counts().readCount, 3);
});

test('a Retry-After above the permitted wait is refused without an early retry', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request) =>
      request.method === 'PUT'
        ? jsonResponse({ data: [] }, 429, { 'retry-after': '60' })
        : undefined,
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, options),
    /429/,
  );
  assert.equal(counts().putCount, 1);
  assert.equal(counts().storageCount, 1);
});

test('cancellation while waiting to send the write prevents the mutation', async (t) => {
  const controller = new AbortController();
  const { client, counts } = setup(t);
  let scheduled = 0;
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, {
      ...options,
      signal: controller.signal,
      beforeRequest: async () => {
        if (++scheduled === 4) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(counts().putCount, 0);
});

test('cancellation interrupts an unresolved pre-write gate without waiting for its deadline', {
  timeout: 1000,
}, async (t) => {
  const controller = new AbortController();
  const { client, counts } = setup(t);
  let scheduled = 0;
  let notifyWaiting = () => {};
  const waiting = new Promise<void>((resolve) => {
    notifyWaiting = resolve;
  });
  const replacement = replaceAssetFromBlob(asset, blob, 'old.avif', client, {
    ...options,
    signal: controller.signal,
    beforeRequest: (signal) => {
      assert.equal(signal, controller.signal);
      if (++scheduled === 4) {
        notifyWaiting();
        return new Promise<void>(() => {});
      }
      return Promise.resolve();
    },
  });
  const rejected = assert.rejects(replacement, { name: 'AbortError' });
  await waiting;
  controller.abort();
  await rejected;
  assert.equal(counts().storageCount, 1);
  assert.equal(counts().putCount, 0);
});

test('a timeout after PUT aborts transport and confirms via read-back without a second mutation', async (t) => {
  const controller = new AbortController();
  let mutationSignal: AbortSignal | null | undefined;
  const scheduledSignals: (AbortSignal | undefined)[] = [];
  const { client, counts } = setup(t, {
    cma: (request, call) => {
      if (request.method === 'PUT') {
        mutationSignal = request.init?.signal;
        controller.abort();
        return new Promise<Response>(() => {});
      }
      if (
        request.method === 'GET' &&
        request.url.pathname.startsWith('/uploads/') &&
        call >= 3
      )
        return jsonResponse({ data: wireUpload(newPath, blob.size) });
      return undefined;
    },
  });
  const result = await replaceAssetFromBlob(asset, blob, 'old.avif', client, {
    ...options,
    requestTimeoutMs: 5,
    signal: controller.signal,
    beforeRequest: async (signal) => {
      scheduledSignals.push(signal);
    },
  });
  assert.equal(result.path, newPath);
  assert.equal(mutationSignal?.aborted, true);
  assert.equal(counts().putCount, 1);
  assert.deepEqual(scheduledSignals, [
    controller.signal,
    controller.signal,
    controller.signal,
    controller.signal,
    undefined,
  ]);
});

test('persistent transient read errors stop after bounded attempts without upload or mutation', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request) =>
      request.method === 'GET' ? jsonResponse({ data: [] }, 503) : undefined,
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, options),
    /503/,
  );
  assert.equal(counts().readCount, 3);
  assert.equal(counts().storageCount, 0);
  assert.equal(counts().putCount, 0);
});

test('an unresolved raw job object is never accepted as a completed replacement', async (t) => {
  const { client, counts } = setup(t, {
    cma: (request) =>
      request.method === 'PUT'
        ? jsonResponse({ data: { type: 'job', id: 'job-1' } })
        : undefined,
  });
  await assert.rejects(
    replaceAssetFromBlob(asset, blob, 'old.avif', client, {
      ...options,
      reconciliationAttempts: 1,
    }),
    UnconfirmedReplacementError,
  );
  assert.equal(counts().putCount, 1);
});

test('a storage response with a stalled cancel cannot prevent completion', async (t) => {
  const { client } = setup(t, {
    storage: () =>
      new Response(
        new ReadableStream({
          cancel: () => new Promise<void>(() => {}),
        }),
        { status: 200 },
      ),
  });
  const result = await replaceAssetFromBlob(
    asset,
    blob,
    'old.avif',
    client,
    options,
  );
  assert.equal(result.path, newPath);
});

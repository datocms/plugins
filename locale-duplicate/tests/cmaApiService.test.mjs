import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiService,
  PartialPublicationError,
} from '../src/services/ApiService.ts';
import { CmaUncertainOutcomeError } from '../src/services/cmaClient.ts';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const clock = () => {
  let milliseconds = 0;
  return {
    now: () => milliseconds,
    wait: async (delay) => {
      milliseconds += delay;
    },
  };
};
const rawRecord = (index) => ({
  id: String(index),
  type: 'item',
  attributes: {
    title: { en: `Title ${index}`, pt: null },
    content: [
      {
        type: 'item',
        id: `block-${index}`,
        attributes: { media: { upload_id: 'asset' } },
        relationships: {
          item_type: { data: { type: 'item_type', id: 'block-model' } },
        },
      },
    ],
  },
  relationships: {
    item_type: { data: { type: 'item_type', id: 'model' } },
    creator: { data: { type: 'user', id: 'author' } },
  },
  meta: { current_version: '1' },
});

test('fetchRecords never turns a large perPage into an unbounded collection', async () => {
  const requests = [];
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async (input) => {
        requests.push(new URL(input));
        return json({ data: [rawRecord(30)], meta: { total_count: 200_000 } });
      },
    },
  );
  const result = await service.fetchRecords('model', { page: 2, perPage: 500 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('page[limit]'), '30');
  assert.equal(requests[0].searchParams.get('page[offset]'), '30');
  assert.equal(requests[0].searchParams.get('filter[type]'), 'model');
  assert.equal(requests[0].searchParams.get('order_by'), 'id_ASC');
  assert.equal(result.totalCount, 200_000);
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.data[0].title, { en: 'Title 30', pt: null });
  assert.deepEqual(result.data[0].creator, { type: 'user', id: 'author' });
  assert.equal(result.data[0].content[0].attributes.media.upload_id, 'asset');
});

test('record iterator visits 200,000 synthetic records with at most 30 per response', async () => {
  const total = 200_000;
  let calls = 0;
  let maximumPage = 0;
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        throw new Error(
          'Unexpected network request in the iterator unit fixture',
        );
      },
    },
  );
  // The scale fixture mocks the SDK boundary; transport behavior is covered
  // separately. This avoids encoding/decoding 200,000 records just for the test.
  service.client.items.rawList = async ({ page: { offset, limit } }) => {
    assert.equal(limit, 30);
    calls++;
    const data = Array.from(
      { length: Math.min(limit, total - offset) },
      (_, i) => rawRecord(offset + i),
    );
    maximumPage = Math.max(maximumPage, data.length);
    return { data, meta: { total_count: total } };
  };
  let processed = 0;
  for await (const record of service.iterateRecords('model')) {
    assert.equal(record.id, String(processed));
    processed++;
  }
  assert.equal(processed, total);
  assert.equal(calls, Math.ceil(total / 30));
  assert.equal(maximumPage, 30);
});

test('iterator is pull-based and does not fetch after caller stops', async () => {
  let calls = 0;
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        calls++;
        return json({
          data: Array.from({ length: 30 }, (_, i) => rawRecord(i)),
          meta: { total_count: 200_000 },
        });
      },
    },
  );
  for await (const record of service.iterateRecords('model')) {
    assert.equal(record.id, '0');
    break;
  }
  assert.equal(calls, 1);
});

test('invalid pagination fails without API calls', async () => {
  let calls = 0;
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      fetchFn: async () => {
        calls++;
        return json({});
      },
    },
  );
  for (const options of [
    { page: 0 },
    { page: 1.5 },
    { page: Infinity },
    { perPage: 0 },
    { perPage: NaN },
    { perPage: 3.4 },
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: Verify each invalid option without introducing concurrent side effects.
    await assert.rejects(service.fetchRecords('model', options), RangeError);
  }
  assert.equal(calls, 0);
});

test('publication consumes a stream of 200,001 references in batches of at most 200', async () => {
  let yielded = 0;
  let calls = 0;
  const sizes = new Set();
  async function* records() {
    for (let i = 0; i < 200_001; i++) {
      yielded++;
      yield { type: 'item', id: String(i) };
    }
  }
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        throw new Error(
          'Unexpected network request in the publication unit fixture',
        );
      },
    },
  );
  service.client.items.rawBulkPublish = async ({
    data: {
      relationships: {
        items: { data: batch },
      },
    },
  }) => {
    calls++;
    assert.ok(batch.length <= 200);
    assert.ok(
      yielded - (calls - 1) * 200 <= 200,
      'source must not be fully consumed before publication',
    );
    sizes.add(batch.length);
    return { data: [], meta: { successful: batch.length, failed: 0 } };
  };
  await service.publishRecords(records());
  assert.equal(calls, 1001);
  assert.deepEqual(sizes, new Set([200, 1]));
});

test('partial publication uses raw meta and stops without silently advancing', async () => {
  let calls = 0;
  let yielded = 0;
  function* records() {
    for (let i = 0; i < 1000; i++) {
      yielded++;
      yield { type: 'item', id: String(i) };
    }
  }
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        calls++;
        return json({
          data: [],
          meta: {
            successful: calls === 1 ? 200 : 195,
            failed: calls === 1 ? 0 : 5,
          },
        });
      },
    },
  );
  await assert.rejects(service.publishRecords(records()), (error) => {
    assert.ok(error instanceof PartialPublicationError);
    assert.equal(error.publishedRecords, 395);
    assert.equal(error.failedRecords, 5);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(yielded, 400);
});

test('uncertain publication stops immediately and preserves the cause', async () => {
  let calls = 0;
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        calls++;
        return json({}, 503);
      },
    },
  );
  await assert.rejects(
    service.publishRecords(
      Array.from({ length: 501 }, (_, i) => ({ type: 'item', id: String(i) })),
    ),
    (error) => {
      assert.ok(error instanceof PartialPublicationError);
      assert.equal(error.publishedRecords, 0);
      assert.equal(error.failedRecords, undefined);
      assert.ok(error.cause instanceof CmaUncertainOutcomeError);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('inconsistent publication totals are not reported as complete', async () => {
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () =>
        json({ data: [], meta: { successful: 201, failed: 0 } }),
    },
  );
  await assert.rejects(
    service.publishRecords([{ type: 'item', id: 'one' }]),
    PartialPublicationError,
  );
});

test('an unexpectedly empty page never silently completes a nonempty collection', async () => {
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        throw new Error('Unexpected network request');
      },
    },
  );
  service.client.items.rawList = async () => ({
    data: [],
    meta: { total_count: 35 },
  });
  await assert.rejects(async () => {
    for await (const _record of service.iterateRecords('model')) {
      /* consumer */
    }
  }, /before the reported total/);
});

test('a short intermediate page fails visibly instead of skipping records', async () => {
  const service = new ApiService(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        throw new Error('Unexpected network request');
      },
    },
  );
  service.client.items.rawList = async () => ({
    data: [rawRecord(0)],
    meta: { total_count: 35 },
  });
  await assert.rejects(async () => {
    for await (const _record of service.iterateRecords('model')) {
      /* consumer */
    }
  }, /short page/);
});

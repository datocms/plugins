import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiService,
  PartialPublicationError,
} from '../src/services/ApiService.ts';

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
  __itemTypeId: 'model',
  relationships: {
    item_type: { data: { type: 'item_type', id: 'model' } },
    creator: { data: { type: 'user', id: 'author' } },
  },
  meta: { current_version: '1' },
});

const createService = () =>
  new ApiService('mock-token', undefined, 'https://example.test');

test('fetchRecords never turns a large perPage into an unbounded collection', async () => {
  const queries = [];
  const service = createService();
  service.client.items.rawList = async (query) => {
    queries.push(query);
    return { data: [rawRecord(30)], meta: { total_count: 200_000 } };
  };
  const result = await service.fetchRecords('model', { page: 2, perPage: 500 });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].page, { offset: 30, limit: 30 });
  assert.deepEqual(queries[0].filter, { type: 'model' });
  assert.equal(queries[0].order_by, 'id_ASC');
  assert.equal(result.totalCount, 200_000);
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.data[0].title, { en: 'Title 30', pt: null });
  assert.deepEqual(result.data[0].creator, { type: 'user', id: 'author' });
  assert.equal(result.data[0].content[0].attributes.media.upload_id, 'asset');
});

test('iterator is pull-based and does not fetch after caller stops', async () => {
  let calls = 0;
  const service = createService();
  service.client.items.rawList = async () => {
    calls++;
    return {
      data: Array.from({ length: 30 }, (_, i) => rawRecord(i)),
      meta: { total_count: 200_000 },
    };
  };
  for await (const record of service.iterateRecords('model')) {
    assert.equal(record.id, '0');
    break;
  }
  assert.equal(calls, 1);
});

test('invalid pagination fails without API calls', async () => {
  let calls = 0;
  const service = createService();
  service.client.items.rawList = async () => {
    calls++;
    return { data: [], meta: { total_count: 0 } };
  };
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

test('partial publication uses raw meta and stops without silently advancing', async () => {
  let calls = 0;
  let yielded = 0;
  function* records() {
    for (let i = 0; i < 1000; i++) {
      yielded++;
      yield { type: 'item', id: String(i) };
    }
  }
  const service = createService();
  service.client.items.rawBulkPublish = async () => {
    calls++;
    return {
      data: [],
      meta: {
        successful: calls === 1 ? 200 : 195,
        failed: calls === 1 ? 0 : 5,
      },
    };
  };
  await assert.rejects(service.publishRecords(records()), (error) => {
    assert.ok(error instanceof PartialPublicationError);
    assert.equal(error.publishedRecords, 395);
    assert.equal(error.failedRecords, 5);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(yielded, 400);
});

test('a failed publication stops immediately and preserves the cause', async () => {
  let calls = 0;
  const failure = new Error('CMA failure');
  const service = createService();
  service.client.items.rawBulkPublish = async () => {
    calls++;
    throw failure;
  };
  await assert.rejects(
    service.publishRecords(
      Array.from({ length: 501 }, (_, i) => ({ type: 'item', id: String(i) })),
    ),
    (error) => {
      assert.ok(error instanceof PartialPublicationError);
      assert.equal(error.publishedRecords, 0);
      assert.equal(error.failedRecords, undefined);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('inconsistent publication totals are not reported as complete', async () => {
  const service = createService();
  service.client.items.rawBulkPublish = async () => ({
    data: [],
    meta: { successful: 201, failed: 0 },
  });
  await assert.rejects(
    service.publishRecords([{ type: 'item', id: 'one' }]),
    PartialPublicationError,
  );
});

test('an unexpectedly empty page never silently completes a nonempty collection', async () => {
  const service = createService();
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
  const service = createService();
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

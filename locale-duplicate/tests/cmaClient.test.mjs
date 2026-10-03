import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@datocms/cma-client-browser';
import {
  CmaUncertainOutcomeError,
  createCmaClient,
  createCmaFetch,
} from '../src/services/cmaClient.ts';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
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
const flush = async () => {
  for (let i = 0; i < 15; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: Drain successive microtasks before advancing the mock timer.
    await Promise.resolve();
  }
};
test('starts concurrent requests at least 150ms apart', async () => {
  const time = clock();
  const starts = [];
  const transport = createCmaFetch({
    ...time,
    fetchFn: async () => {
      starts.push(time.now());
      return json({});
    },
  });
  await Promise.all(
    Array.from({ length: 60 }, () => transport('https://example.test/items')),
  );
  assert.equal(starts.length, 60);
  for (let i = 1; i < starts.length; i++)
    assert.ok(starts[i] - starts[i - 1] >= 150);
});

test('GET retries 429, 5xx and network failures only four times', async () => {
  for (const failure of [
    () => json({}, 429),
    () => json({}, 503),
    () => {
      throw new TypeError('lost connection');
    },
  ]) {
    let calls = 0;
    let retries = 0;
    const transport = createCmaFetch({
      ...clock(),
      onRetry: () => {
        retries++;
      },
      fetchFn: async () => {
        calls++;
        return failure();
      },
    });
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Verify each independent failure scenario sequentially.
      await transport('https://example.test/items');
    } catch (error) {
      assert.ok(error instanceof TypeError);
    }
    assert.equal(calls, 4);
    assert.equal(retries, 3);
  }
});

test('writes never replay on 5xx or lost responses', async () => {
  for (const failure of [
    () => json({}, 503),
    () => {
      throw new TypeError('lost connection');
    },
  ]) {
    let calls = 0;
    const transport = createCmaFetch({
      ...clock(),
      fetchFn: async () => {
        calls++;
        return failure();
      },
    });
    // biome-ignore lint/performance/noAwaitInLoops: Keep failure cases deterministic.
    await assert.rejects(
      transport('https://example.test/items/record', {
        method: 'PUT',
        body: '{}',
      }),
      CmaUncertainOutcomeError,
    );
    assert.equal(calls, 1);
  }
});

test('writes retry explicit 429 and honor full Retry-After / reset headers', async () => {
  const time = clock();
  const starts = [];
  const transport = createCmaFetch({
    ...time,
    fetchFn: async () => {
      starts.push(time.now());
      return starts.length === 1
        ? json({}, 429, { 'retry-after': '120', 'x-ratelimit-reset': '121.25' })
        : json({});
    },
  });
  await transport('https://example.test/items/record', { method: 'PUT' });
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 121_250);
});

test('Retry-After HTTP dates are honored and not truncated to 60 seconds', async () => {
  const time = clock();
  const starts = [];
  const transport = createCmaFetch({
    ...time,
    fetchFn: async () => {
      starts.push(time.now());
      return starts.length === 1
        ? json({}, 429, { 'retry-after': new Date(180_000).toUTCString() })
        : json({});
    },
  });
  await transport('https://example.test/items');
  assert.ok(starts[1] - starts[0] >= 180_000);
});

test('all workers honor a shared cooldown without restarting together', async () => {
  const time = clock();
  const starts = [];
  let calls = 0;
  const transport = createCmaFetch({
    ...time,
    fetchFn: async () => {
      starts.push(time.now());
      return ++calls === 1 ? json({}, 429, { 'retry-after': '60' }) : json({});
    },
  });
  await transport('https://example.test/items');
  const before = time.now();
  await Promise.all(
    Array.from({ length: 10 }, () => transport('https://example.test/items')),
  );
  assert.ok(before >= 60_000);
  for (let i = 1; i < starts.length; i++)
    assert.ok(starts[i] - starts[i - 1] >= 150);
});

test('SDK autoRetry is disabled and accepted bulk jobs are read until known', async () => {
  const time = clock();
  const calls = [];
  let polls = 0;
  let cancelled = false;
  const client = createCmaClient(
    'mock-token',
    'sandbox',
    'https://example.test',
    {
      ...time,
      checkCancellation: () => cancelled,
      fetchFn: async (input, init) => {
        calls.push({ url: String(input), method: init.method, at: time.now() });
        if (init.method === 'POST') {
          cancelled = true;
          return json({ data: { type: 'job', id: 'job-1' } }, 202);
        }
        if (++polls === 1) return json({ errors: [] }, 404);
        return json({
          data: {
            type: 'job_result',
            id: 'job-1',
            attributes: {
              status: 200,
              payload: { data: [], meta: { successful: 2, failed: 0 } },
            },
          },
        });
      },
    },
  );
  assert.equal(client.config.autoRetry, false);
  const result = await client.items.rawBulkPublish({
    data: {
      type: 'item_bulk_publish_operation',
      relationships: {
        items: {
          data: [
            { type: 'item', id: 'a' },
            { type: 'item', id: 'b' },
          ],
        },
      },
    },
  });
  assert.deepEqual(result.meta, { successful: 2, failed: 0 });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(polls, 2);
  for (let i = 1; i < calls.length; i++)
    assert.ok(calls[i].at - calls[i - 1].at >= 150);
  await assert.rejects(client.items.update('record', { title: 'hello' }), {
    name: 'AbortError',
  });
  assert.equal(calls.length, 3);
});

test('never replays accepted bulk when polling deadline or polling error occurs', async () => {
  for (const failedPoll of [
    () => json({ errors: [] }, 404),
    () => json({ errors: [] }, 403),
    () => json({}, 503),
  ]) {
    const time = clock();
    let posts = 0;
    const client = createCmaClient(
      'mock-token',
      undefined,
      'https://example.test',
      {
        ...time,
        jobTimeoutMs: 3500,
        fetchFn: async (_, init) => {
          if (init.method === 'POST') {
            posts++;
            return json({ data: { type: 'job', id: 'job-1' } }, 202);
          }
          return failedPoll();
        },
      },
    );
    // biome-ignore lint/performance/noAwaitInLoops: Each accepted job must finish before testing the next case.
    await assert.rejects(
      client.items.bulkPublish({ items: [{ type: 'item', id: 'a' }] }),
      CmaUncertainOutcomeError,
    );
    assert.equal(posts, 1);
    assert.ok(time.now() <= 3500);
  }
});

test('write timeout aborts transfer and reports uncertainty without replay', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let signal;
  const client = createCmaClient(
    'mock-token',
    undefined,
    'https://example.test',
    {
      fetchFn: async (_, init) => {
        calls++;
        signal = init.signal;
        return new Promise(() => {});
      },
    },
  );
  const rejected = assert.rejects(
    client.items.update('record', { title: 'hello' }),
    CmaUncertainOutcomeError,
  );
  await flush();
  context.mock.timers.tick(30_000);
  await rejected;
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('response body stalls are included in write timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const transport = createCmaFetch({
    fetchFn: async () => {
      calls++;
      return new Response(new ReadableStream(), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const rejected = assert.rejects(
    transport('https://example.test/items/record', { method: 'PUT' }),
    CmaUncertainOutcomeError,
  );
  await flush();
  context.mock.timers.tick(30_000);
  await rejected;
  assert.equal(calls, 1);
});

test('permanent HTTP errors are never retried', async () => {
  let calls = 0;
  const client = createCmaClient(
    'mock-token',
    undefined,
    'https://example.test',
    {
      ...clock(),
      fetchFn: async () => {
        calls++;
        return json({ errors: [] }, 403);
      },
    },
  );
  await assert.rejects(client.items.list(), ApiError);
  assert.equal(calls, 1);
});

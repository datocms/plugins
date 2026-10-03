import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import {
  boundedJobResult,
  createClient,
  createSafeFetch,
} from '../src/utils/client.ts';

afterEach(() => vi.useRealTimers());

function harness(fetchFn, options = {}) {
  let time = Date.UTC(2026, 0, 1);
  const delays = [];
  const fetch = createSafeFetch(fetchFn, {
    now: () => time,
    random: () => 0.5,
    wait: async (delay) => {
      delays.push(delay);
      time += delay;
    },
    ...options,
  });
  return { fetch, delays, now: () => time };
}

test('the CMA client disables unsafe SDK retries and all body logging', () => {
  const client = createClient(
    'synthetic-token',
    'synthetic-environment',
    'https://example.invalid',
  );
  assert.equal(client.config.autoRetry, false);
  assert.equal(client.config.logLevel, 0);
  assert.equal(client.config.requestTimeout, 11 * 60_000);
  assert.equal(typeof client.config.fetchFn, 'function');
  assert.equal(typeof client.jobResultsFetcher, 'function');
});

test('read retries network and server failures with bounded exponential backoff', async () => {
  let attempts = 0;
  const run = harness(async () => {
    attempts++;
    if (attempts === 1) throw new TypeError('Synthetic network failure');
    return new Response('{}', { status: attempts === 2 ? 503 : 200 });
  });
  assert.equal((await run.fetch('https://example.invalid')).status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(run.delays, [1000, 2000]);
});

test('POST, PUT and DELETE never retry ambiguous network or server errors', async () => {
  await Promise.all(
    ['POST', 'PUT', 'DELETE'].map(async (method) => {
      let attempts = 0;
      const error = new TypeError('Synthetic lost response');
      const network = harness(async () => {
        attempts++;
        throw error;
      });
      await assert.rejects(
        network.fetch('https://example.invalid', { method }),
        (caught) => caught === error,
      );
      assert.equal(attempts, 1);
      assert.deepEqual(network.delays, []);
      attempts = 0;
      const server = harness(async () => {
        attempts++;
        return new Response('{}', { status: 503 });
      });
      assert.equal(
        (await server.fetch('https://example.invalid', { method })).status,
        503,
      );
      assert.equal(attempts, 1);
    }),
  );
});

test('mutations retry explicit 429 rejections and honor both cooldown headers', async () => {
  let attempts = 0;
  const bodies = [];
  const run = harness(async (_input, init) => {
    attempts++;
    bodies.push(init.body);
    return new Response(
      '{}',
      attempts === 1
        ? {
            status: 429,
            headers: { 'x-ratelimit-reset': '3', 'retry-after': '7' },
          }
        : { status: 201 },
    );
  });
  const body = JSON.stringify({ title: { en: 'Synthetic', it: 'Sintetico' } });
  assert.equal(
    (await run.fetch('https://example.invalid', { method: 'POST', body }))
      .status,
    201,
  );
  assert.equal(attempts, 2);
  assert.deepEqual(bodies, [body, body]);
  assert.deepEqual(run.delays, [7000]);
});

test('Retry-After HTTP dates and relative X-RateLimit-Reset are parsed correctly', async () => {
  let attempts = 0;
  const run = harness(
    async () =>
      new Response(
        '{}',
        ++attempts === 1
          ? {
              status: 429,
              headers: {
                'retry-after': new Date(
                  Date.UTC(2026, 0, 1) + 5000,
                ).toUTCString(),
                'x-ratelimit-reset': '3',
              },
            }
          : { status: 200 },
      ),
  );
  await run.fetch('https://example.invalid');
  assert.deepEqual(run.delays, [5000]);
});

test('exhausted retries propagate the final failure and oversized server cooldown is not shortened', async () => {
  let attempts = 0;
  const bounded = harness(
    async () => {
      attempts++;
      return new Response('{}', { status: 503 });
    },
    { maxRetries: 2 },
  );
  assert.equal((await bounded.fetch('https://example.invalid')).status, 503);
  assert.equal(attempts, 3);
  attempts = 0;
  const tooLong = harness(async () => {
    attempts++;
    return new Response('{}', {
      status: 429,
      headers: { 'retry-after': '700' },
    });
  });
  assert.equal(
    (await tooLong.fetch('https://example.invalid', { method: 'POST' })).status,
    429,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(tooLong.delays, []);
});

test('validation, permissions and stale versions are not retried', async () => {
  await Promise.all(
    [400, 401, 403, 404, 422].map(async (status) => {
      let attempts = 0;
      const run = harness(async () => {
        attempts++;
        return new Response('{}', { status });
      });
      assert.equal((await run.fetch('https://example.invalid')).status, status);
      assert.equal(attempts, 1);
      assert.deepEqual(run.delays, []);
    }),
  );
});

test('concurrent callers are paced below the shared request quota', async () => {
  const dispatches = [];
  const run = harness(async () => {
    dispatches.push(run.now());
    return new Response('{}');
  });
  await Promise.all(
    Array.from({ length: 60 }, () => run.fetch('https://example.invalid')),
  );
  assert.equal(dispatches.length, 60);
  for (let index = 1; index < dispatches.length; index++) {
    assert.ok(dispatches[index] - dispatches[index - 1] >= 75);
  }
});

test('a Request body remains reusable when a mutation is explicitly rate limited', async () => {
  const bodies = [];
  const run = harness(async (input) => {
    bodies.push(await input.text());
    return new Response('{}', { status: bodies.length === 1 ? 429 : 201 });
  });
  await run.fetch(
    new Request('https://example.invalid', {
      method: 'POST',
      body: 'synthetic-body',
    }),
  );
  assert.deepEqual(bodies, ['synthetic-body', 'synthetic-body']);
});

test('an already cancelled operation never dispatches an API request', async () => {
  let calls = 0;
  const run = harness(async () => {
    calls++;
    return new Response('{}');
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    run.fetch('https://example.invalid', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
});

test('per-attempt timeouts abort the transport and never repeat uncertain writes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let calls = 0;
  let started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  const run = harness(async (_input, init) => {
    calls++;
    started();
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Synthetic timeout', 'AbortError')),
        { once: true },
      );
    });
  });
  const operation = run.fetch('https://example.invalid', { method: 'POST' });
  const rejected = assert.rejects(operation, { name: 'TimeoutError' });
  await start;
  vi.advanceTimersByTime(60_000);
  await rejected;
  assert.equal(calls, 1);
});

test('a failed response body retries reads but never repeats a write', async () => {
  await Promise.all(
    ['GET', 'POST'].map(async (method) => {
      let calls = 0;
      const error = new TypeError('Synthetic interrupted body');
      const run = harness(async () => {
        calls++;
        if (calls > 1) return new Response('{}');
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        );
      });
      if (method === 'GET') {
        assert.equal(
          (await run.fetch('https://example.invalid', { method })).status,
          200,
        );
        assert.equal(calls, 2);
      } else {
        await assert.rejects(
          run.fetch('https://example.invalid', { method }),
          (caught) => caught === error,
        );
        assert.equal(calls, 1);
      }
    }),
  );
});

test('the timeout includes a body stalled after headers have arrived', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let calls = 0;
  let started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  const run = harness(async (_input, init) => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          started();
          init.signal.addEventListener(
            'abort',
            () => {
              controller.error(
                new DOMException('Synthetic stalled transfer', 'AbortError'),
              );
            },
            { once: true },
          );
        },
      }),
    );
  });
  const operation = run.fetch('https://example.invalid', { method: 'POST' });
  const rejected = assert.rejects(operation, { name: 'TimeoutError' });
  await start;
  vi.advanceTimersByTime(60_000);
  await rejected;
  assert.equal(calls, 1);
});

test('a rate-limit cooldown is shared with later calls even after retry exhaustion', async () => {
  const dispatches = [];
  const run = harness(
    async () => {
      dispatches.push(run.now());
      return new Response(
        '{}',
        dispatches.length === 1
          ? { status: 429, headers: { 'x-ratelimit-reset': '3' } }
          : { status: 200 },
      );
    },
    { maxRetries: 0 },
  );
  await run.fetch('https://example.invalid', { method: 'POST' });
  await run.fetch('https://example.invalid');
  assert.equal(dispatches[1] - dispatches[0], 3000);
});

test('job polling returns the exact completed result after pending 404 reads', async () => {
  let now = 0;
  const delays = [];
  const ids = [];
  const result = { status: 200, payload: { data: { id: 'created-record' } } };
  const client = {
    jobResults: {
      async find(id) {
        ids.push(id);
        if (ids.length <= 3) throw { response: { status: 404 } };
        return result;
      },
    },
  };
  const actual = await boundedJobResult(client, 'existing-job', {
    now: () => now,
    wait: async (delay) => {
      delays.push(delay);
      now += delay;
    },
  });
  assert.equal(actual, result);
  assert.deepEqual(ids, Array(4).fill('existing-job'));
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test('pending jobs stop at the configured budget with delays capped at five seconds', async () => {
  let now = 0;
  let calls = 0;
  const delays = [];
  const client = {
    jobResults: {
      async find() {
        calls++;
        throw { response: { status: 404 } };
      },
    },
  };
  await assert.rejects(
    boundedJobResult(client, 'pending-job', {
      maxDurationMs: 20_000,
      now: () => now,
      wait: async (delay) => {
        delays.push(delay);
        now += delay;
      },
    }),
    { name: 'TimeoutError' },
  );
  assert.equal(now, 20_000);
  assert.equal(calls, 6);
  assert.deepEqual(delays, [1000, 2000, 4000, 5000, 5000, 3000]);
});

test('job polling propagates permission and transport failures without retrying the job', async () => {
  await Promise.all(
    [{ response: { status: 403 } }, new TypeError('Synthetic lost read')].map(
      async (error) => {
        let calls = 0;
        const client = {
          jobResults: {
            async find() {
              calls++;
              throw error;
            },
          },
        };
        await assert.rejects(
          boundedJobResult(client, 'existing-job'),
          (caught) => caught === error,
        );
        assert.equal(calls, 1);
      },
    ),
  );
});

test('the job deadline includes an in-flight read that never resolves', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let calls = 0;
  const client = {
    jobResults: {
      find() {
        calls++;
        return new Promise(() => undefined);
      },
    },
  };
  const operation = boundedJobResult(client, 'existing-job', {
    maxDurationMs: 10_000,
  });
  const rejected = assert.rejects(operation, { name: 'TimeoutError' });
  vi.advanceTimersByTime(10_000);
  await rejected;
  assert.equal(calls, 1);
});

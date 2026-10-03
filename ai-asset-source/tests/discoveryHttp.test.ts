import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { loadProviderModelOptions } from '../src/utils/imageService/modelDiscovery';

const apiKey = 'synthetic-key';
const validPayload = { data: [{ id: 'gpt-image-1' }] };

function json(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

function stalledResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>());
}

async function flushPromises() {
  for (let index = 0; index < 40; index += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: advance the promise chain one microtask at a time without real timers.
    await Promise.resolve();
  }
}

function useClock(context: TestContext) {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
}

test('read-only discovery retries 429, 5xx and network failure with bounded backoff', async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await loadProviderModelOptions('openai', apiKey, {
    fetch: async () => {
      calls += 1;
      if (calls === 1)
        return json({ error: { message: 'Rate limited' } }, 429, {
          'Retry-After': '2',
        });
      if (calls === 2) return new Response('not JSON', { status: 503 });
      if (calls === 3) throw new TypeError('Network error');
      return json(validPayload);
    },
    wait: async (delay) => {
      waits.push(delay);
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(waits, [2000, 1000, 2000]);
  assert.equal(result.options[0].value, 'gpt-image-1');
});

test('read-only retry count is bounded and preserves provider status', async () => {
  let calls = 0;
  const waits: number[] = [];
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      fetch: async () => {
        calls += 1;
        return json({ error: { message: 'Still overloaded' } }, 503);
      },
      wait: async (delay) => {
        waits.push(delay);
      },
    }),
    { message: 'Still overloaded', status: 503 },
  );
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
});

test('authentication errors do not retry', async () => {
  let calls = 0;
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      fetch: async () => {
        calls += 1;
        return json({ error: { message: 'Invalid key' } }, 401);
      },
      wait: async () => {
        throw new Error('Must not retry');
      },
    }),
    { message: 'Invalid key', status: 401 },
  );
  assert.equal(calls, 1);
});

test('Retry-After supports an HTTP date and never retries before a long deadline', async (context) => {
  useClock(context);
  let calls = 0;
  const waits: number[] = [];
  await loadProviderModelOptions('openai', apiKey, {
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? json({}, 429, {
            'Retry-After': new Date(Date.now() + 3000).toUTCString(),
          })
        : json(validPayload);
    },
    wait: async (delay) => {
      waits.push(delay);
    },
  });
  assert.deepEqual(waits, [3000]);
  calls = 0;
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      fetch: async () => {
        calls += 1;
        return json({}, 429, { 'Retry-After': '600' });
      },
      wait: async () => {
        throw new Error('Must not retry early');
      },
    }),
    { status: 429 },
  );
  assert.equal(calls, 1);
});

test('already cancelled discovery never calls fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      signal: controller.signal,
      fetch: async () => {
        throw new Error('Must not fetch');
      },
    }),
    { name: 'AbortError' },
  );
});

test('cancellation before dispatch never calls fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = loadProviderModelOptions('openai', apiKey, {
    signal: controller.signal,
    fetch: async () => {
      calls += 1;
      return json(validPayload);
    },
  });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(calls, 0);
});

test('cancellation settles even when fetch ignores the signal', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const pending = loadProviderModelOptions('openai', apiKey, {
    signal: controller.signal,
    fetch: async (_input, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await flushPromises();
  controller.abort();
  await rejected;
  assert.equal(requestSignal?.aborted, true);
});

test('cancellation during response body or backoff prevents further requests', async () => {
  await Promise.all(
    (['body', 'backoff'] as const).map(async (phase) => {
      const controller = new AbortController();
      let calls = 0;
      const response = stalledResponse();
      const pending = loadProviderModelOptions('openai', apiKey, {
        signal: controller.signal,
        fetch: async () => {
          calls += 1;
          return phase === 'body' ? response : json({}, 429);
        },
        wait: async () => new Promise<void>(() => {}),
      });
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await flushPromises();
      controller.abort();
      await rejected;
      assert.equal(calls, 1);
    }),
  );
});

test('request timeout covers a stalled response body and bounds retries', async (context) => {
  useClock(context);
  let calls = 0;
  const signals: Array<AbortSignal | null | undefined> = [];
  const pending = loadProviderModelOptions('openai', apiKey, {
    requestTimeoutMs: 20,
    totalTimeoutMs: 200,
    fetch: async (_input, init) => {
      calls += 1;
      signals.push(init?.signal);
      return stalledResponse();
    },
    wait: async () => {},
  });
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each request must start before its mocked deadline is advanced.
    await flushPromises();
    context.mock.timers.tick(20);
  }
  await rejected;
  assert.equal(calls, 4);
  assert.equal(
    signals.every((signal) => signal?.aborted),
    true,
  );
});

test('overall deadline covers the entire catalog and retry delays', async (context) => {
  useClock(context);
  let calls = 0;
  const pending = loadProviderModelOptions('openai', apiKey, {
    requestTimeoutMs: 100,
    totalTimeoutMs: 30,
    fetch: async () => {
      calls += 1;
      return json({}, 429);
    },
  });
  const rejected = assert.rejects(pending, {
    name: 'TimeoutError',
    message: 'Model discovery timed out.',
  });
  await flushPromises();
  context.mock.timers.tick(30);
  await rejected;
  assert.equal(calls, 1);
});

test('oversized declared model responses are cancelled before reading and never retried', async () => {
  let cancelled = false;
  let calls = 0;
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      maxResponseBytes: 8,
      fetch: async () => {
        calls += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: { 'Content-Length': '9' },
          },
        );
      },
      wait: async () => {
        throw new Error('Must not retry');
      },
    }),
    /size safety limit/,
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('chunked model responses enforce byte bounds without Content-Length', async () => {
  let cancelled = false;
  let calls = 0;
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      maxResponseBytes: 8,
      fetch: async () => {
        calls += 1;
        let delivered = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              delivered += 1;
              controller.enqueue(new Uint8Array(delivered === 1 ? 8 : 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
      wait: async () => {
        throw new Error('Must not retry');
      },
    }),
    /size safety limit/,
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('tiny transport fragments and split UTF-8 sequences decode safely at the byte limit', async () => {
  const payload = { data: [{ id: 'gpt-image-1' }], padding: 'é'.repeat(300) };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const result = await loadProviderModelOptions('openai', apiKey, {
    maxResponseBytes: bytes.byteLength,
    fetch: async () => {
      let position = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (position === bytes.byteLength) {
              controller.close();
              return;
            }
            controller.enqueue(bytes.subarray(position, ++position));
          },
        }),
      );
    },
  });
  assert.equal(result.options[0].value, 'gpt-image-1');
});

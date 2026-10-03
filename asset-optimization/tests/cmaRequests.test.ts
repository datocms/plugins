import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { ApiError, TimeoutError } from '@datocms/cma-client-browser';
import {
  CmaRequestScheduler,
  retryCmaRead,
  waitForRequest,
} from '../src/utils/cmaRequests.ts';

const START = Date.UTC(2026, 9, 2, 12);
const REQUEST = {
  url: 'https://example.invalid/uploads',
  method: 'GET',
  headers: {},
};

function apiError(status: number, headers: Record<string, string> = {}) {
  return new ApiError({
    request: REQUEST,
    response: {
      status,
      statusText: 'Injected response',
      headers,
      body: { data: [] },
    },
  });
}

function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
}

async function flushMicrotasks() {
  for (let step = 0; step < 20; step += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Flush promise turns without advancing the fake clock.
    await Promise.resolve();
  }
}

async function advance(t: TestContext, ms: number) {
  t.mock.timers.tick(ms);
  await flushMicrotasks();
  // Each read first awaits a scheduler timer, including zero-duration turns.
  t.mock.timers.tick(0);
  await flushMicrotasks();
  t.mock.timers.tick(0);
  await flushMicrotasks();
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

for (const status of [429, 500, 503]) {
  test(`status ${status} is retried at most four times with finite backoff`, async (t) => {
    clock(t);
    const failure = apiError(status);
    const calledAt: number[] = [];
    const read = retryCmaRead(async () => {
      calledAt.push(Date.now() - START);
      throw failure;
    }, new CmaRequestScheduler(0));
    const rejected = assert.rejects(read, (error) => error === failure);

    await flushMicrotasks();
    await advance(t, 0);
    assert.deepEqual(calledAt, [0]);
    await advance(t, 999);
    assert.deepEqual(calledAt, [0]);
    await advance(t, 1);
    assert.deepEqual(calledAt, [0, 1000]);
    await advance(t, 2000);
    assert.deepEqual(calledAt, [0, 1000, 3000]);
    await advance(t, 4000);
    await rejected;
    assert.deepEqual(calledAt, [0, 1000, 3000, 7000]);
    await advance(t, 60_000);
    assert.equal(calledAt.length, 4);
  });
}

for (const failure of [
  apiError(403),
  apiError(404),
  new Error('Invalid read'),
]) {
  test(`permanent error ${failure.message} is never replayed`, async (t) => {
    clock(t);
    let calls = 0;
    const read = retryCmaRead(async () => {
      calls += 1;
      throw failure;
    }, new CmaRequestScheduler(0));
    const rejected = assert.rejects(read, (error) => error === failure);
    await flushMicrotasks();
    await advance(t, 0);
    await rejected;
    await advance(t, 60_000);
    assert.equal(calls, 1);
  });
}

for (const failure of [
  new TimeoutError({ request: REQUEST }),
  Object.assign(new Error('Read timed out'), {
    name: 'CmaRequestTimeoutError',
  }),
  new TypeError('Failed to fetch'),
]) {
  test(`${failure.name} retries reads after a transient transport failure`, async (t) => {
    clock(t);
    let calls = 0;
    const read = retryCmaRead(async () => {
      calls += 1;
      if (calls === 1) throw failure;
      return 'read result';
    }, new CmaRequestScheduler(0));
    await flushMicrotasks();
    await advance(t, 0);
    await advance(t, 999);
    assert.equal(calls, 1);
    await advance(t, 1);
    assert.equal(await read, 'read result');
    assert.equal(calls, 2);
  });
}

const delays: { headers: Record<string, string>; delay: number }[] = [
  { headers: { 'retry-after': '2' }, delay: 2000 },
  {
    headers: { 'retry-after': new Date(START + 3000).toUTCString() },
    delay: 3000,
  },
  { headers: { 'x-ratelimit-reset': '4' }, delay: 4000 },
  {
    headers: { 'retry-after': 'invalid', 'x-ratelimit-reset': '5' },
    delay: 5000,
  },
  { headers: { 'retry-after': '90' }, delay: 90_000 },
  { headers: { 'retry-after': '120' }, delay: 120_000 },
];

for (const { headers, delay } of delays) {
  test(`server retry hints are respected for ${JSON.stringify(headers)}`, async (t) => {
    clock(t);
    const calledAt: number[] = [];
    const read = retryCmaRead(async () => {
      calledAt.push(Date.now() - START);
      if (calledAt.length === 1) throw apiError(429, headers);
      return 'done';
    }, new CmaRequestScheduler(0));
    await flushMicrotasks();
    await advance(t, 0);
    await advance(t, delay - 1);
    assert.deepEqual(calledAt, [0]);
    await advance(t, 1);
    assert.equal(await read, 'done');
    assert.deepEqual(calledAt, [0, delay]);
  });
}

const overlongHints: Record<string, string>[] = [
  { 'retry-after': '121' },
  { 'retry-after': new Date(START + 121_000).toUTCString() },
  { 'x-ratelimit-reset': '121' },
  { 'retry-after': '1e308' },
];

for (const headers of overlongHints) {
  test(`overlong retry hint ${JSON.stringify(headers)} fails safely without an early retry`, async (t) => {
    clock(t);
    const failure = apiError(429, headers);
    let calls = 0;
    const read = retryCmaRead(async () => {
      calls += 1;
      throw failure;
    }, new CmaRequestScheduler(0));
    const rejected = assert.rejects(read, (error) => error === failure);
    await flushMicrotasks();
    await advance(t, 0);
    await rejected;
    await advance(t, 120_000);
    assert.equal(calls, 1);
  });
}

for (const header of ['0', new Date(START - 1000).toUTCString()]) {
  test(`zero or past-date Retry-After (${header}) does not add a fictitious wait`, async (t) => {
    clock(t);
    const calledAt: number[] = [];
    const read = retryCmaRead(async () => {
      calledAt.push(Date.now() - START);
      if (calledAt.length === 1) throw apiError(429, { 'retry-after': header });
      return 'done';
    }, new CmaRequestScheduler(0));
    await flushMicrotasks();
    await advance(t, 0);
    await advance(t, 0);
    assert.equal(await read, 'done');
    assert.deepEqual(calledAt, [0, 0]);
  });
}

test('queued workers share a new cooldown and retain spacing after it expires', async (t) => {
  clock(t);
  const scheduler = new CmaRequestScheduler();
  const releasedAt: number[] = [];
  const first = scheduler.beforeRequest().then(() => {
    releasedAt.push(Date.now() - START);
  });
  await flushMicrotasks();
  await advance(t, 0);
  await first;
  const queued = Array.from({ length: 3 }, () =>
    scheduler.beforeRequest().then(() => {
      releasedAt.push(Date.now() - START);
    }),
  );
  await flushMicrotasks();
  await advance(t, 50);
  scheduler.onRateLimit(950);
  await advance(t, 100);
  await advance(t, 849);
  assert.deepEqual(releasedAt, [0]);
  await advance(t, 1);
  assert.deepEqual(releasedAt, [0, 1000]);
  await advance(t, 149);
  assert.deepEqual(releasedAt, [0, 1000]);
  await advance(t, 1);
  await advance(t, 150);
  await Promise.all(queued);
  assert.deepEqual(releasedAt, [0, 1000, 1150, 1300]);
});

test('a later rate limit extends active and queued turns without shortening cooldown', async (t) => {
  clock(t);
  const scheduler = new CmaRequestScheduler();
  scheduler.onRateLimit(1000);
  let released = false;
  const pending = scheduler.beforeRequest().then(() => {
    released = true;
  });
  await flushMicrotasks();
  await advance(t, 500);
  scheduler.onRateLimit(1000);
  scheduler.onRateLimit(10);
  await advance(t, 500);
  assert.equal(released, false);
  await advance(t, 499);
  assert.equal(released, false);
  await advance(t, 1);
  await pending;
  assert.equal(Date.now() - START, 1500);
});

test('cancelling a queued worker rejects promptly without bypassing an active turn', async (t) => {
  clock(t);
  const scheduler = new CmaRequestScheduler();
  scheduler.onRateLimit(1000);
  const releasedAt: number[] = [];
  const first = scheduler.beforeRequest().then(() => {
    releasedAt.push(Date.now() - START);
  });
  const controller = new AbortController();
  const cancelled = scheduler.beforeRequest(controller.signal);
  const rejected = assert.rejects(cancelled, isAbort);
  const third = scheduler.beforeRequest().then(() => {
    releasedAt.push(Date.now() - START);
  });
  await flushMicrotasks();
  controller.abort();
  await rejected;
  await advance(t, 999);
  assert.deepEqual(releasedAt, []);
  await advance(t, 1);
  await first;
  assert.deepEqual(releasedAt, [1000]);
  await advance(t, 149);
  assert.deepEqual(releasedAt, [1000]);
  await advance(t, 1);
  await third;
  assert.deepEqual(releasedAt, [1000, 1150]);
});

test('cancelling a read during backoff prevents any later attempt', async (t) => {
  clock(t);
  const controller = new AbortController();
  let calls = 0;
  const read = retryCmaRead(
    async () => {
      calls += 1;
      throw apiError(429);
    },
    new CmaRequestScheduler(0),
    controller.signal,
  );
  const rejected = assert.rejects(read, isAbort);
  await flushMicrotasks();
  await advance(t, 0);
  assert.equal(calls, 1);
  controller.abort();
  await rejected;
  await advance(t, 10_000);
  assert.equal(calls, 1);
});

test('a read completed after cancellation is discarded', async (t) => {
  clock(t);
  const controller = new AbortController();
  let finish = (_value: string) => {};
  const operation = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const read = retryCmaRead(
    () => operation,
    new CmaRequestScheduler(0),
    controller.signal,
  );
  const rejected = assert.rejects(read, isAbort);
  await flushMicrotasks();
  await advance(t, 0);
  controller.abort();
  finish('late result');
  await rejected;
});

test('aborted waits and reads never create a new operation', async (t) => {
  clock(t);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => waitForRequest(1000, controller.signal), isAbort);
  let calls = 0;
  await assert.rejects(
    retryCmaRead(
      async () => {
        calls += 1;
      },
      new CmaRequestScheduler(),
      controller.signal,
    ),
    isAbort,
  );
  assert.equal(calls, 0);
});

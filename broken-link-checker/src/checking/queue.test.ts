import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult, PreparedUrl } from '../types';
import { checkUrl } from './client';
import { CheckQueue } from './queue';
import { prepareUrl } from './url';

function reachable(prepared: PreparedUrl): CheckResult {
  return {
    key: prepared.key,
    url: prepared.url,
    status: 'reachable',
    message: 'OK',
  };
}

function flush(remaining = 12): Promise<void> {
  return remaining === 0
    ? Promise.resolve()
    : Promise.resolve().then(() => flush(remaining - 1));
}

afterEach(() => vi.useRealTimers());

describe('CheckQueue', () => {
  it('limits concurrency to four URLs and one URL per hostname', async () => {
    const finish = new Map<string, () => void>();
    const activeHosts = new Set<string>();
    const check = vi.fn((prepared: PreparedUrl) => {
      const hostname = prepared.hostname ?? '';
      expect(activeHosts.has(hostname)).toBe(false);
      activeHosts.add(hostname);
      expect(activeHosts.size).toBeLessThanOrEqual(4);
      return new Promise<CheckResult>((resolve) => {
        finish.set(prepared.url, () => {
          activeHosts.delete(hostname);
          resolve(reachable(prepared));
        });
      });
    });
    const results: CheckResult[] = [];
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      onResult: (result) => results.push(result),
      check,
    });
    const urls = [
      'https://a.example/1',
      'https://a.example/2',
      'https://b.example/',
      'https://c.example/',
      'https://d.example/',
      'https://e.example/',
    ];
    for (const url of urls) queue.enqueue(prepareUrl(url));
    const drained = queue.drain();
    await flush();
    expect(check.mock.calls.map(([prepared]) => prepared.url)).toEqual([
      urls[0],
      urls[2],
      urls[3],
      urls[4],
    ]);
    finish.get(urls[2])?.();
    await flush();
    expect(check.mock.calls[4][0].url).toBe(urls[5]);
    finish.get(urls[0])?.();
    await flush();
    expect(check.mock.calls[5][0].url).toBe(urls[1]);
    for (const complete of finish.values()) complete();
    await drained;
    expect(
      results.filter((result) => result.status === 'checking'),
    ).toHaveLength(6);
    expect(
      results.filter((result) => result.status === 'reachable'),
    ).toHaveLength(6);
  });

  it('deduplicates normalized URLs and emits skipped/invalid inputs without checking', async () => {
    const check = vi.fn(async (prepared: PreparedUrl) => reachable(prepared));
    const onResult = vi.fn();
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      onResult,
      check,
    });
    queue.enqueue(prepareUrl('https://example.com/a#first'));
    queue.enqueue(prepareUrl('https://EXAMPLE.com:443/a#second'));
    queue.enqueue(prepareUrl('/relative'));
    queue.enqueue(prepareUrl('http://'));
    await queue.drain();
    expect(check).toHaveBeenCalledOnce();
    expect(onResult.mock.calls.map(([result]) => result.status)).toEqual([
      'checking',
      'skipped',
      'invalid',
      'reachable',
    ]);
  });

  it('settles drain and cancels pending and active work even if the adapter ignores abort', async () => {
    const controller = new AbortController();
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation(() => new Promise(() => {}));
    const results: CheckResult[] = [];
    const queue = new CheckQueue({
      signal: controller.signal,
      check,
      onResult: (result) => results.push(result),
    });
    for (let index = 0; index < 7; index += 1)
      queue.enqueue(prepareUrl(`https://example.com/${index}`));
    await flush();
    const drainOne = queue.drain();
    const drainTwo = queue.drain();
    controller.abort();
    await Promise.all([drainOne, drainTwo]);
    expect(check).toHaveBeenCalledOnce();
    expect(
      results.filter((result) => result.status === 'cancelled'),
    ).toHaveLength(7);
    queue.enqueue(prepareUrl('https://other.example/'));
    await queue.drain();
    expect(results[results.length - 1]?.status).toBe('cancelled');
  });

  it('contains adapter and callback failures so drain still settles', async () => {
    const check = vi.fn().mockRejectedValue(new Error('failed'));
    const onResult = vi.fn().mockImplementation(() => {
      throw new Error('callback failed');
    });
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      check,
      onResult,
    });
    queue.enqueue(prepareUrl('https://example.com/one'));
    queue.enqueue(prepareUrl('https://example.com/two'));
    await queue.drain();
    expect(check).toHaveBeenCalledTimes(2);
    expect(
      onResult.mock.calls.filter(([result]) => result.status === 'unverified'),
    ).toHaveLength(2);
  });

  it('can accept more work after a completed drain', async () => {
    const check = vi.fn(async (prepared: PreparedUrl) => reachable(prepared));
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      onResult: () => {},
      check,
    });
    await queue.drain();
    queue.enqueue(prepareUrl('https://example.com/one'));
    await queue.drain();
    queue.enqueue(prepareUrl('https://example.com/two'));
    await queue.drain();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('automatically releases discovery backpressure as checks complete', async () => {
    const finishes: (() => void)[] = [];
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      onResult: () => {},
      check: (prepared) =>
        new Promise((resolve) => {
          finishes.push(() => resolve(reachable(prepared)));
        }),
    });
    for (let index = 0; index < 5; index += 1)
      queue.enqueue(prepareUrl(`https://busy.example/${index}`));
    const capacity = vi.fn();
    const capacityReady = queue.waitForCapacity(2).then(capacity);
    await flush();
    expect(capacity).not.toHaveBeenCalled();
    finishes[0]();
    await flush();
    finishes[1]();
    await flush();
    expect(capacity).not.toHaveBeenCalled();
    finishes[2]();
    await capacityReady;
    expect(capacity).toHaveBeenCalledOnce();
    finishes[3]();
    await flush();
    finishes[4]();
    await queue.drain();
    await queue.waitForCapacity();
  });

  it('releases capacity waiters on cancellation and prevents late results', async () => {
    const controller = new AbortController();
    let finishActive = () => {};
    const onResult = vi.fn();
    const queue = new CheckQueue({
      signal: controller.signal,
      onResult,
      check: (prepared) =>
        new Promise((resolve) => {
          finishActive = () => resolve(reachable(prepared));
        }),
    });
    for (let index = 0; index < 5; index += 1)
      queue.enqueue(prepareUrl(`https://busy.example/${index}`));
    const capacityReady = queue.waitForCapacity(2);
    const drained = queue.drain();
    await flush();
    controller.abort();
    await Promise.all([capacityReady, drained]);
    finishActive();
    await flush();
    expect(
      onResult.mock.calls.filter(([result]) => result.status === 'cancelled'),
    ).toHaveLength(5);
    expect(
      onResult.mock.calls.filter(([result]) => result.status === 'reachable'),
    ).toHaveLength(0);
  });

  it('treats a trailing domain dot as the same host for concurrency', async () => {
    const controller = new AbortController();
    const check = vi.fn().mockImplementation(() => new Promise(() => {}));
    const queue = new CheckQueue({
      signal: controller.signal,
      onResult: () => {},
      check,
    });
    queue.enqueue(prepareUrl('https://example.com/one'));
    queue.enqueue(prepareUrl('https://example.com./two'));
    await flush();
    expect(check).toHaveBeenCalledOnce();
    controller.abort();
    await queue.drain();
  });

  it.each([
    429, 503,
  ])('honors a host cooldown after HTTP %s across queued and newly discovered URLs', async (status) => {
    vi.useFakeTimers();
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) => {
        const target = new URL(String(url)).searchParams.get('url');
        if (target?.endsWith('/first'))
          return new Response(null, {
            status,
            headers: { 'Retry-After': '60' },
          });
        return new Response(null, { status: 200 });
      });
    const results: CheckResult[] = [];
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      onResult: (result) => results.push(result),
      check: (prepared, signal, options) =>
        checkUrl(prepared, signal, { ...options, fetch: fetchRequest }),
    });
    queue.enqueue(prepareUrl('https://busy.example/first'));
    queue.enqueue(prepareUrl('https://busy.example/second'));
    queue.enqueue(prepareUrl('https://busy.example./third'));
    queue.enqueue(prepareUrl('https://other.example/available'));
    await queue.drain();
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    const limited = results.filter(
      (result) =>
        result.url.includes('busy.example') && result.status !== 'checking',
    );
    expect(limited).toHaveLength(3);
    for (const result of limited)
      expect(result.status).toBe(status === 429 ? 'blocked' : 'unverified');
    expect(limited[1]).toMatchObject({
      message: expect.stringContaining('was not requested'),
    });
    expect(limited[1].httpStatus).toBeUndefined();
    expect(results.some((result) => result.status === 'reachable')).toBe(true);

    queue.enqueue(prepareUrl('https://busy.example/fourth'));
    await queue.drain();
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    queue.enqueue(prepareUrl('https://busy.example/fifth'));
    await queue.drain();
    expect(fetchRequest).toHaveBeenCalledTimes(3);
    expect(results[results.length - 1]?.status).toBe('reachable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { status: 429, delay: 2_000 },
    { status: 503, delay: 2_000 },
    { status: 429, delay: 30_000 },
  ])('automatically waits for a $delay ms HTTP $status cooldown while other hosts keep working', async ({
    status,
    delay,
  }) => {
    vi.useFakeTimers();
    const results: CheckResult[] = [];
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation(async (prepared, _signal, options) => {
        if (prepared.url.endsWith('/first')) {
          options?.onBackoff?.({
            until: Date.now() + delay,
            httpStatus: status,
          });
          return {
            ...reachable(prepared),
            status: status === 429 ? 'blocked' : 'unverified',
          };
        }
        return reachable(prepared);
      });
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      check,
      onResult: (result) => results.push(result),
    });
    queue.enqueue(prepareUrl('https://busy.example/first'));
    queue.enqueue(prepareUrl('https://busy.example/second'));
    queue.enqueue(prepareUrl('https://other.example/available'));
    const drained = vi.fn();
    const capacity = vi.fn();
    const drainReady = queue.drain().then(drained);
    const capacityReady = queue.waitForCapacity(1).then(capacity);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    expect(
      results.some(
        (result) =>
          result.url.includes('other.example') && result.status === 'reachable',
      ),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    queue.enqueue(prepareUrl('https://busy.example/third'));
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(drained).not.toHaveBeenCalled();
    expect(capacity).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([drainReady, capacityReady]);
    expect(check).toHaveBeenCalledTimes(4);
    for (const url of [
      'https://busy.example/second',
      'https://busy.example/third',
    ])
      expect(
        results.find(
          (result) => result.url === url && result.status !== 'checking',
        )?.status,
      ).toBe('reachable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wakes delayed hosts in deadline order using one timer', async () => {
    vi.useFakeTimers();
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation(async (prepared, _signal, options) => {
        if (prepared.url.endsWith('/first')) {
          const delay = prepared.hostname === 'slow.example' ? 3_000 : 1_000;
          options?.onBackoff?.({ until: Date.now() + delay, httpStatus: 429 });
        }
        return reachable(prepared);
      });
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      check,
      onResult: () => {},
    });
    for (const hostname of ['slow.example', 'fast.example']) {
      queue.enqueue(prepareUrl(`https://${hostname}/first`));
      queue.enqueue(prepareUrl(`https://${hostname}/next`));
    }
    const drained = queue.drain();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(3);
    expect(check.mock.calls[2][0].url).toBe('https://fast.example/next');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await drained;
    expect(check.mock.calls[3][0].url).toBe('https://slow.example/next');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels delayed hosts, active checks, discovery backpressure and the cooldown timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const results: CheckResult[] = [];
    let finishActive = () => {};
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation((prepared, _signal, options) => {
        if (prepared.hostname === 'other.example')
          return new Promise((resolve) => {
            finishActive = () => resolve(reachable(prepared));
          });
        options?.onBackoff?.({ until: Date.now() + 5_000, httpStatus: 429 });
        return Promise.resolve({ ...reachable(prepared), status: 'blocked' });
      });
    const queue = new CheckQueue({
      signal: controller.signal,
      check,
      onResult: (result) => results.push(result),
    });
    for (const path of ['first', 'second', 'third'])
      queue.enqueue(prepareUrl(`https://busy.example/${path}`));
    queue.enqueue(prepareUrl('https://other.example/active'));
    const drainReady = queue.drain();
    const capacityReady = queue.waitForCapacity(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await Promise.all([drainReady, capacityReady]);
    expect(
      results.filter((result) => result.status === 'cancelled'),
    ).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
    finishActive();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(results.some((result) => result.status === 'reachable')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('orders many different cooldown deadlines without adding one timer per host', async () => {
    vi.useFakeTimers();
    const targets = Array.from({ length: 32 }, (_, index) => ({
      hostname: `host-${index}.example`,
      delay: (((index * 7) % 32) + 1) * 10,
    }));
    const deadlines = new Map(
      targets.map((target) => [target.hostname, target.delay]),
    );
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation(async (prepared, _signal, options) => {
        if (prepared.url.endsWith('/first'))
          options?.onBackoff?.({
            until: Date.now() + (deadlines.get(prepared.hostname ?? '') ?? 0),
            httpStatus: 429,
          });
        return reachable(prepared);
      });
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      check,
      onResult: () => {},
    });
    for (const target of targets) {
      queue.enqueue(prepareUrl(`https://${target.hostname}/first`));
      queue.enqueue(prepareUrl(`https://${target.hostname}/next`));
    }
    const drained = queue.drain();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(32);
    expect(vi.getTimerCount()).toBe(1);
    await vi.runAllTimersAsync();
    await drained;
    const expected = [...targets]
      .sort((left, right) => left.delay - right.delay)
      .map((target) => `https://${target.hostname}/next`);
    expect(
      check.mock.calls
        .map(([prepared]) => prepared.url)
        .filter((url) => url.endsWith('/next')),
    ).toEqual(expected);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens the global circuit only after an explicit proxy refusal and preserves active HTTP results', async () => {
    vi.useFakeTimers();
    let finishActive: (response: Response) => void = () => {};
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) => {
        const target = new URL(String(url)).searchParams.get('url');
        if (target?.includes('other.example'))
          return new Promise<Response>((resolve) => {
            finishActive = resolve;
          });
        return new Response(
          'Forbidden: Requests are only allowed from plugins-cdn.datocms.com or localhost',
          { status: 403 },
        );
      });
    const results: CheckResult[] = [];
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      check: (prepared, signal, options) =>
        checkUrl(prepared, signal, { ...options, fetch: fetchRequest }),
      onResult: (result) => results.push(result),
    });
    queue.enqueue(prepareUrl('https://refused.example/first'));
    for (let index = 0; index < 32; index += 1)
      queue.enqueue(prepareUrl(`https://refused.example/queued-${index}`));
    queue.enqueue(prepareUrl('https://other.example/active'));
    const drainDone = vi.fn();
    const drained = queue.drain().then(drainDone);
    await flush(100);
    expect(fetchRequest).toHaveBeenCalledTimes(3);
    expect(drainDone).not.toHaveBeenCalled();
    const derived = results.filter((result) => result.url.includes('/queued-'));
    expect(derived).toHaveLength(32);
    for (const result of derived) {
      expect(result).toMatchObject({
        status: 'unverified',
        reason: 'proxy-refused',
        message: expect.stringContaining('was not requested'),
      });
      expect(result.httpStatus).toBeUndefined();
      expect(result.method).toBeUndefined();
      expect(result.checkedAt).toBeUndefined();
    }
    const original = results.find(
      (result) => result.url.endsWith('/first') && result.status !== 'checking',
    );
    expect(original).toMatchObject({
      status: 'unverified',
      reason: 'proxy-refused',
      method: 'GET',
    });
    expect(original?.checkedAt).toBeDefined();
    finishActive(new Response(null, { status: 204 }));
    await drained;
    expect(
      results.find(
        (result) =>
          result.url.includes('other.example') && result.status !== 'checking',
      ),
    ).toMatchObject({ status: 'reachable', httpStatus: 204, method: 'HEAD' });
    expect(fetchRequest).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases cooled hosts after a proxy refusal, yields terminal results and safely cancels the remainder', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const results: CheckResult[] = [];
    let finishRefused = () => {};
    let finishActive = () => {};
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation((prepared, _signal, options) => {
        if (prepared.hostname === 'proxy.example')
          return new Promise((resolve) => {
            finishRefused = () =>
              resolve({
                ...reachable(prepared),
                status: 'unverified',
                reason: 'proxy-refused',
              });
          });
        if (prepared.hostname === 'other.example')
          return new Promise((resolve) => {
            finishActive = () => resolve(reachable(prepared));
          });
        options?.onBackoff?.({ until: Date.now() + 30_000, httpStatus: 429 });
        return Promise.resolve({ ...reachable(prepared), status: 'blocked' });
      });
    const queue = new CheckQueue({
      signal: controller.signal,
      check,
      onResult: (result) => results.push(result),
    });
    queue.enqueue(prepareUrl('https://cooled.example/first'));
    queue.enqueue(prepareUrl('https://proxy.example/refused'));
    queue.enqueue(prepareUrl('https://other.example/active'));
    for (let index = 0; index < 600; index += 1)
      queue.enqueue(prepareUrl(`https://cooled.example/queued-${index}`));
    const drained = queue.drain();
    const capacity = queue.waitForCapacity(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    finishRefused();
    await flush(2_000);
    const derived = results.filter((result) => result.url.includes('/queued-'));
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.length).toBeLessThan(600);
    for (const result of derived)
      expect(result).toMatchObject({
        status: 'unverified',
        reason: 'proxy-refused',
      });
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await Promise.all([drained, capacity]);
    finishActive();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(3);
    const terminal = results.filter((result) => result.status !== 'checking');
    expect(terminal).toHaveLength(603);
    expect(new Set(terminal.map((result) => result.key)).size).toBe(603);
    expect(terminal.some((result) => result.status === 'cancelled')).toBe(true);
    expect(terminal.some((result) => result.status === 'reachable')).toBe(
      false,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains a confirmed proxy circuit when the same queue is reused and keeps a new queue independent', async () => {
    const check = vi
      .fn<NonNullable<ConstructorParameters<typeof CheckQueue>[0]['check']>>()
      .mockImplementation(async (prepared) => ({
        ...reachable(prepared),
        status: 'unverified',
        reason: 'proxy-refused',
      }));
    const results: CheckResult[] = [];
    const queue = new CheckQueue({
      signal: new AbortController().signal,
      check,
      onResult: (result) => results.push(result),
    });
    queue.enqueue(prepareUrl('https://first.example/first'));
    await queue.drain();
    queue.enqueue(prepareUrl('https://other.example/later'));
    queue.enqueue(prepareUrl('/relative'));
    await queue.drain();
    expect(check).toHaveBeenCalledOnce();
    const later = results.find((result) => result.url.includes('/later'));
    expect(later).toMatchObject({
      status: 'unverified',
      reason: 'proxy-refused',
      message: expect.stringContaining('was not requested'),
    });
    expect(later?.method).toBeUndefined();
    expect(later?.checkedAt).toBeUndefined();
    expect(later?.httpStatus).toBeUndefined();
    expect(results.find((result) => result.url === '/relative')?.status).toBe(
      'skipped',
    );
    const healthyCheck = vi.fn(async (prepared: PreparedUrl) =>
      reachable(prepared),
    );
    const independent = new CheckQueue({
      signal: new AbortController().signal,
      check: healthyCheck,
      onResult: () => {},
    });
    independent.enqueue(prepareUrl('https://other.example/later'));
    await independent.drain();
    expect(healthyCheck).toHaveBeenCalledOnce();
  });
});

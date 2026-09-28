import { describe, expect, it, vi } from 'vitest';
import type { CheckResult, PreparedUrl } from '../types';
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
});

import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  downloadBlob,
  mapWithConcurrency,
  waitForExport,
} from './exportRuntime';

describe('bounded export runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Blob', NodeBlob);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('bounds concurrency, preserves order and drains active workers on failure', async () => {
    let active = 0;
    let max = 0;
    const promise = mapWithConcurrency(
      Array.from({ length: 300 }, (_, i) => i),
      4,
      async (value) => {
        active++;
        max = Math.max(max, active);
        await waitForExport(1);
        active--;
        return value * 2;
      },
    );
    await vi.runAllTimersAsync();
    expect(await promise).toEqual(Array.from({ length: 300 }, (_, i) => i * 2));
    expect(max).toBe(4);
    let started = 0;
    const failure = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
      started++;
      if (value === 0) throw new Error('failed');
      await waitForExport(1);
      return value;
    });
    const rejection = expect(failure).rejects.toThrow('failed');
    await vi.runAllTimersAsync();
    await rejection;
    expect(started).toBe(2);
  });

  test('removes download links and revokes object URLs after browser handoff', async () => {
    const create = vi.fn(() => 'blob:export');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    const promise = downloadBlob(new Blob(['file']), 'file.json');
    expect(document.querySelectorAll('a')).toHaveLength(1);
    await vi.runAllTimersAsync();
    await promise;
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoke).toHaveBeenCalledWith('blob:export');
  });
});

import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import { httpError } from '../findReplace/findReplace.fixtures';
import { publishRecord } from './publishRecord';
import { findReplaceSchema } from './replacementPlanner.fixtures';

function client(currentVersion: string | Error, publishError?: unknown) {
  const find = vi.fn(async () => {
    if (currentVersion instanceof Error) throw currentVersion;
    return { id: 'r1', meta: { current_version: currentVersion } };
  });
  const publish = vi.fn(async () => {
    if (publishError) throw publishError;
    return { id: 'r1' };
  });
  return {
    find,
    publish,
    client: { items: { find, publish } } as unknown as Client,
  };
}

const schema = findReplaceSchema();

describe('publishRecord', () => {
  it('publishes the whole record when it is still at the replacement version', async () => {
    const cma = client('v2');
    await expect(
      publishRecord({
        client: cma.client,
        schema,
        recordId: 'r1',
        expectedVersion: 'v2',
      }),
    ).resolves.toEqual({ status: 'published' });
    expect(cma.find).toHaveBeenCalledWith('r1', { version: 'current' });
    // No body: every locale, as the record was before the replacement.
    expect(cma.publish).toHaveBeenCalledWith('r1');
  });

  it('leaves a record that changed since the replacement unpublished', async () => {
    const cma = client('v3');
    await expect(
      publishRecord({
        client: cma.client,
        schema,
        recordId: 'r1',
        expectedVersion: 'v2',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'changed' });
    expect(cma.publish).not.toHaveBeenCalled();
  });

  it('reports a deleted record as skipped', async () => {
    const cma = client(httpError(404, [{ code: 'NOT_FOUND' }]));
    await expect(
      publishRecord({
        client: cma.client,
        schema,
        recordId: 'r1',
        expectedVersion: 'v2',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'deleted' });
  });

  it('classifies publish failures like write failures', async () => {
    const cases: Array<[unknown, object]> = [
      [httpError(403), { reason: 'permission', retryable: false }],
      [httpError(503), { reason: 'network', retryable: true }],
      [
        new TypeError('Failed to fetch'),
        { reason: 'network', retryable: true },
      ],
      [
        httpError(422, [{ code: 'INVALID_FIELD' }]),
        { reason: 'validation', retryable: false },
      ],
    ];
    for (const [error, expected] of cases) {
      const cma = client('v2', error);
      // biome-ignore lint/performance/noAwaitInLoops: one case at a time keeps the mocks apart.
      const outcome = await publishRecord({
        client: cma.client,
        schema,
        recordId: 'r1',
        expectedVersion: 'v2',
      });
      expect(outcome).toMatchObject({ status: 'failed', ...expected });
    }
  });
});

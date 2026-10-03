import type { ExecuteItemsDropdownActionCtx } from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkResult } from './actions/bulkChangeCreator';
import { executeItemsDropdownAction } from './main';

const mocks = vi.hoisted(() => ({ bulkChangeCreator: vi.fn() }));
vi.mock('datocms-plugin-sdk', () => ({ connect: vi.fn() }));
vi.mock('./actions/bulkChangeCreator', () => ({
  bulkChangeCreator: mocks.bulkChangeCreator,
}));
vi.mock('./entrypoints/SelectCreatorModal', () => ({ default: () => null }));
vi.mock('./entrypoints/ConfigScreen', () => ({ default: () => null }));
vi.mock('./utils/render', () => ({ render: vi.fn() }));

function context(modalResult: unknown = null) {
  const mocked = {
    currentUserAccessToken: 'test-token',
    environment: 'sandbox',
    cmaBaseUrl: 'https://example.invalid',
    openModal: vi.fn().mockResolvedValue(modalResult),
    notice: vi.fn(),
    alert: vi.fn(),
  };
  return { mocked, ctx: mocked as unknown as ExecuteItemsDropdownActionCtx };
}

function successfulResult(total: number): BulkResult {
  return {
    total,
    succeeded: total,
    failed: 0,
    uncertain: 0,
    unprocessed: 0,
    failureSamples: [],
    stopped: false,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bulkChangeCreator.mockResolvedValue(successfulResult(2));
});

describe('creator dropdown workflow', () => {
  it('keeps the small selection modal contract and updates only after submission', async () => {
    const { ctx, mocked } = context({ userId: 'user-1', userType: 'user' });
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record-1' }, { id: 'record-2' }],
      ctx,
    );
    expect(mocked.openModal).toHaveBeenCalledWith({
      id: 'select-creator',
      title: 'Change creators',
      width: 'm',
      parameters: { itemCount: 2 },
    });
    expect(mocks.bulkChangeCreator).toHaveBeenCalledWith({
      apiToken: 'test-token',
      environment: 'sandbox',
      baseUrl: 'https://example.invalid',
      itemIds: ['record-1', 'record-2'],
      userId: 'user-1',
      userType: 'user',
    });
    expect(mocked.notice).toHaveBeenCalledWith('Creator changed on 2 records.');
  });

  it('passes only IDs for 200,000 selected records and does not start a second execution outside the modal', async () => {
    const items = Array.from({ length: 200_000 }, (_, index) => ({
      id: `record-${index}`,
      attributes: { unused: 'content' },
    }));
    const { ctx, mocked } = context({
      bulkResult: successfulResult(items.length),
    });
    await executeItemsDropdownAction('bulkChangeCreator', items, ctx);
    const options = mocked.openModal.mock.calls[0][0];
    expect(options.closeDisabled).toBe(true);
    expect(Object.keys(options.parameters).sort()).toEqual([
      'itemCount',
      'itemIds',
    ]);
    expect(options.parameters.itemIds).toHaveLength(200_000);
    expect(options.parameters.itemIds[199_999]).toBe('record-199999');
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
    expect(mocked.notice).toHaveBeenCalledWith(
      'Creator changed on 200000 records.',
    );
  });

  it.each([
    { userId: 'user-1', userType: 'invalid' },
    { userId: '', userType: 'user' },
    { userId: '   ', userType: 'user' },
    { userId: 1, userType: 'user' },
    { userId: 'user-1' },
    'unexpected',
  ])('rejects an invalid modal selection without mutation: %j', async (selection) => {
    const { ctx, mocked } = context(selection);
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      ctx,
    );
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
    expect(mocked.alert).toHaveBeenCalledWith(
      'The selected creator is invalid. No records were updated.',
    );
  });

  it('blocks duplicate dropdown invocations until the first execution finishes', async () => {
    const { ctx, mocked } = context();
    let choose: (selection: unknown) => void = () => {
      throw new Error('Modal did not open');
    };
    mocked.openModal.mockReturnValue(
      new Promise((resolve) => {
        choose = resolve;
      }),
    );
    const first = executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      ctx,
    );
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      ctx,
    );
    expect(mocked.openModal).toHaveBeenCalledTimes(1);
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
    expect(mocked.notice).toHaveBeenCalledWith(
      'A creator change is already in progress.',
    );

    choose({ userId: 'owner', userType: 'account' });
    await first;
    expect(mocks.bulkChangeCreator).toHaveBeenCalledTimes(1);
    mocked.openModal.mockResolvedValue(null);
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      ctx,
    );
    expect(mocked.openModal).toHaveBeenCalledTimes(2);
  });

  it('releases the invocation guard when opening the modal fails', async () => {
    const { ctx, mocked } = context();
    mocked.openModal.mockRejectedValueOnce(new Error('Cannot open modal'));
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      ctx,
    );
    expect(mocked.alert).toHaveBeenCalledWith(
      'The creator change could not be completed. Request failed.',
    );
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      ctx,
    );
    expect(mocked.openModal).toHaveBeenCalledTimes(2);
  });

  it('reports failures, uncertain outcomes and records not processed with a bounded preview', async () => {
    const result: BulkResult = {
      total: 500,
      succeeded: 100,
      failed: 2,
      uncertain: 3,
      unprocessed: 395,
      stopped: true,
      stopReason: 'Stopped by the user.',
      failureSamples: Array.from({ length: 5 }, (_, index) => ({
        id: `record-${index}`,
        error: 'Access denied',
      })),
    };
    const { ctx, mocked } = context({ bulkResult: result });
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      Array(500).fill({ id: 'record' }),
      ctx,
    );
    expect(mocked.notice).toHaveBeenCalledWith(
      'Creator changed on 100 records.',
    );
    const alert = mocked.alert.mock.calls[0][0];
    expect(alert).toContain('Failed to update 2 records.');
    expect(alert).toContain('The outcome of 3 records could not be confirmed.');
    expect(alert).toContain('395 records were not processed.');
    expect(alert).toContain('Stopped by the user.');
    expect(alert).toContain('record-2: Access denied');
    expect(alert).not.toContain('record-3');
  });

  it('does not trust an inconsistent bulk result or use it to start another run', async () => {
    const { ctx, mocked } = context({
      bulkResult: { ...successfulResult(500), succeeded: 499 },
    });
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      Array(500).fill({ id: 'record' }),
      ctx,
    );
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
    expect(mocked.notice).not.toHaveBeenCalled();
    expect(mocked.alert).toHaveBeenCalledWith(
      expect.stringContaining('invalid result'),
    );
  });

  it('returns immediately on cancel or missing token without mutations', async () => {
    const cancelled = context(null);
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      cancelled.ctx,
    );
    expect(cancelled.mocked.alert).not.toHaveBeenCalled();
    const missing = context();
    missing.mocked.currentUserAccessToken = '';
    await executeItemsDropdownAction(
      'bulkChangeCreator',
      [{ id: 'record' }],
      missing.ctx,
    );
    expect(missing.mocked.openModal).not.toHaveBeenCalled();
    expect(missing.mocked.alert).toHaveBeenCalledWith(
      expect.stringContaining('currentUserAccessToken'),
    );
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
  });
});

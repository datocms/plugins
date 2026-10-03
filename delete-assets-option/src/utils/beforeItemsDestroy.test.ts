import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectAssets,
  deleteCollectedAssets,
  waitForRecordDeletion,
} from './assetCleanup';
import { beforeItemsDestroy } from './beforeItemsDestroy';
import { createCleanupProgress } from './cleanupProgress';

vi.mock('./assetCleanup', () => ({
  collectAssets: vi.fn(),
  deleteCollectedAssets: vi.fn(),
  waitForRecordDeletion: vi.fn(),
}));
vi.mock('./cleanupProgress', () => ({ createCleanupProgress: vi.fn() }));

function fixture() {
  const abort = new AbortController();
  const progress = {
    signal: abort.signal,
    report: vi.fn(),
    finish: vi.fn(),
    handoff: vi.fn().mockResolvedValue(undefined),
  };
  const ctx = {
    openModal: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(undefined),
    notice: vi.fn().mockResolvedValue(undefined),
    customToast: vi.fn().mockResolvedValue(null),
    currentUserAccessToken: 'synthetic-token',
    environment: 'synthetic-environment',
    cmaBaseUrl: 'https://cma.example.invalid',
  };
  const clientFactory = vi.fn().mockReturnValue({});
  vi.mocked(createCleanupProgress).mockReturnValue(progress);
  return { abort, progress, ctx, clientFactory };
}

describe('beforeItemsDestroy lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectAssets).mockResolvedValue(['asset']);
    vi.mocked(waitForRecordDeletion).mockResolvedValue(undefined);
    vi.mocked(deleteCollectedAssets).mockResolvedValue({
      deleted: 1,
      kept: 0,
      unavailable: 0,
      unconfirmed: 0,
      cancelled: false,
    });
  });

  it('preserves Keep without reading or deleting assets', async () => {
    const { ctx, clientFactory } = fixture();
    ctx.openModal.mockResolvedValue(false);
    expect(
      await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory),
    ).toBe(true);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(collectAssets).not.toHaveBeenCalled();
  });

  it('does nothing for an empty host selection', async () => {
    const { ctx, clientFactory } = fixture();
    expect(await beforeItemsDestroy([], ctx, clientFactory)).toBe(true);
    expect(ctx.openModal).not.toHaveBeenCalled();
  });

  it('reports missing API permission and keeps assets', async () => {
    const { ctx, clientFactory } = fixture();
    ctx.currentUserAccessToken = '';
    expect(
      await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory),
    ).toBe(true);
    expect(ctx.alert).toHaveBeenCalledWith(
      expect.stringContaining('assets will be kept'),
    );
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('drains collection before releasing the hook, then waits before any asset mutation', async () => {
    const { ctx, clientFactory, progress } = fixture();
    let finishCollection: ((ids: string[]) => void) | undefined;
    let finishRecords: (() => void) | undefined;
    vi.mocked(collectAssets).mockReturnValue(
      new Promise((resolve) => {
        finishCollection = resolve;
      }),
    );
    vi.mocked(waitForRecordDeletion).mockReturnValue(
      new Promise((resolve) => {
        finishRecords = resolve;
      }),
    );
    const hook = beforeItemsDestroy(
      [{ id: 'record' }, { id: 'record' }],
      ctx,
      clientFactory,
    );
    await vi.waitFor(() => expect(collectAssets).toHaveBeenCalled());
    expect(collectAssets).toHaveBeenCalledWith({}, ['record'], {
      signal: progress.signal,
      onProgress: progress.report,
    });
    expect(waitForRecordDeletion).not.toHaveBeenCalled();
    finishCollection?.(['asset']);
    expect(await hook).toBe(true);
    expect(waitForRecordDeletion).toHaveBeenCalled();
    expect(deleteCollectedAssets).not.toHaveBeenCalled();
    finishRecords?.();
    await vi.waitFor(() => expect(ctx.notice).toHaveBeenCalled());
    expect(progress.finish).toHaveBeenCalled();
  });

  it('keeps every asset when collection is incomplete', async () => {
    const { ctx, clientFactory, progress } = fixture();
    vi.mocked(collectAssets).mockRejectedValue(
      new Error('synthetic read failure'),
    );
    expect(
      await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory),
    ).toBe(true);
    expect(ctx.alert).toHaveBeenCalledWith(
      expect.stringContaining('collect all assets safely'),
    );
    expect(waitForRecordDeletion).not.toHaveBeenCalled();
    expect(deleteCollectedAssets).not.toHaveBeenCalled();
    expect(progress.finish).toHaveBeenCalled();
  });

  it('closes collection progress before handing control to native record confirmation', async () => {
    const { ctx, clientFactory, progress } = fixture();
    let closeCollectionModal: (() => void) | undefined;
    progress.handoff.mockReturnValue(
      new Promise<void>((resolve) => {
        closeCollectionModal = resolve;
      }),
    );
    const hook = beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory);
    await vi.waitFor(() => expect(progress.handoff).toHaveBeenCalled());
    expect(waitForRecordDeletion).not.toHaveBeenCalled();
    closeCollectionModal?.();
    expect(await hook).toBe(true);
    await vi.waitFor(() => expect(ctx.notice).toHaveBeenCalled());
  });

  it('skips background work when there are no assets', async () => {
    const { ctx, clientFactory, progress } = fixture();
    vi.mocked(collectAssets).mockResolvedValue([]);
    expect(
      await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory),
    ).toBe(true);
    expect(waitForRecordDeletion).not.toHaveBeenCalled();
    expect(progress.finish).toHaveBeenCalled();
  });

  it('keeps assets and reports failure when native record deletion cannot be verified', async () => {
    const { ctx, clientFactory, progress } = fixture();
    vi.mocked(waitForRecordDeletion).mockRejectedValue(
      new Error('synthetic native failure'),
    );
    expect(
      await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory),
    ).toBe(true);
    await vi.waitFor(() => expect(ctx.alert).toHaveBeenCalled());
    expect(deleteCollectedAssets).not.toHaveBeenCalled();
    expect(progress.finish).toHaveBeenCalled();
  });

  it('reports confirmed successes, shared assets and uncertainty separately', async () => {
    const { ctx, clientFactory } = fixture();
    vi.mocked(deleteCollectedAssets).mockResolvedValue({
      deleted: 2,
      kept: 3,
      unavailable: 1,
      unconfirmed: 4,
      cancelled: false,
    });
    await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory);
    await vi.waitFor(() => expect(ctx.alert).toHaveBeenCalled());
    expect(ctx.alert).toHaveBeenCalledWith(
      expect.stringContaining(
        '2 assets successfully deleted; 3 kept; 1 already unavailable; 4 unconfirmed',
      ),
    );
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('cancels cleanup during collection while preserving the host record action', async () => {
    const { abort, ctx, clientFactory, progress } = fixture();
    vi.mocked(collectAssets).mockImplementation(async () => {
      abort.abort();
      throw abort.signal.reason;
    });
    expect(
      await beforeItemsDestroy([{ id: 'record' }], ctx, clientFactory),
    ).toBe(true);
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(deleteCollectedAssets).not.toHaveBeenCalled();
    expect(progress.finish).toHaveBeenCalled();
  });
});

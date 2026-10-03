import type { OnBeforeItemsDestroyCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCleanupProgress,
  describeCleanupProgress,
  isCleanupProgress,
} from './cleanupProgress';

class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;
  failMessages = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.push(this);
  }

  postMessage(message: unknown) {
    if (this.closed || this.failMessages)
      throw new Error('Channel unavailable');
    const data: unknown = structuredClone(message);
    this.messages.push(data);
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel === this || channel.name !== this.name || channel.closed) {
        continue;
      }
      queueMicrotask(() => {
        if (!channel.closed) {
          channel.onmessage?.({ data } as MessageEvent<unknown>);
        }
      });
    }
  }

  close() {
    this.closed = true;
  }
}

function mockModal() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const openModal = vi.fn(() => promise);
  const toast = vi
    .fn<
      (
        options: Parameters<OnBeforeItemsDestroyCtx['customToast']>[0],
      ) => Promise<unknown>
    >()
    .mockResolvedValue(null);
  const customToast = <CtaValue = unknown>(
    options: Parameters<OnBeforeItemsDestroyCtx['customToast']>[0],
  ) => toast(options) as Promise<CtaValue | null>;
  return { ctx: { openModal, customToast }, toast, resolve, reject };
}

async function flushMessages() {
  for (let pass = 0; pass < 5; pass += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: drain successive channel delivery microtasks before assertions.
    await Promise.resolve();
  }
}

function connectModal() {
  const boot = FakeBroadcastChannel.channels[0];
  const modal = new FakeBroadcastChannel(boot.name);
  const received: unknown[] = [];
  modal.onmessage = (event) => received.push(event.data);
  modal.postMessage({ type: 'ready' });
  return { boot, modal, received };
}

beforeEach(() => {
  let sequence = 0;
  FakeBroadcastChannel.channels = [];
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  vi.stubGlobal('crypto', { randomUUID: () => `unique-channel-${sequence++}` });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createCleanupProgress', () => {
  it('preserves the small-selection interface and opens progress at 500 records', () => {
    const small = mockModal();
    const smallProgress = createCleanupProgress(small.ctx, 499);
    smallProgress.report({
      phase: 'collecting',
      completed: 499,
      total: 499,
      assets: 10,
    });
    smallProgress.finish();
    expect(small.ctx.openModal).not.toHaveBeenCalled();
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
    expect(smallProgress.signal.aborted).toBe(false);

    const large = mockModal();
    createCleanupProgress(large.ctx, 500);
    expect(large.ctx.openModal).toHaveBeenCalledWith({
      id: 'cleanupProgress',
      title: 'Cleaning up assets',
      width: 's',
      parameters: {
        channelId: 'delete-assets-cleanup:unique-channel-0',
        recordCount: 500,
      },
    });
  });

  it('sends the initial 0/200,000 counters when the modal becomes ready', async () => {
    const { ctx } = mockModal();
    createCleanupProgress(ctx, 200_000);
    const { received } = connectModal();
    await flushMessages();
    expect(received).toEqual([
      {
        type: 'progress',
        progress: {
          phase: 'collecting',
          completed: 0,
          total: 200_000,
          assets: 0,
        },
      },
    ]);
  });

  it('opens once when a small selection collects a large number of assets', async () => {
    const { ctx, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 200);
    progress.report({
      phase: 'collecting',
      completed: 100,
      total: 200,
      assets: 499,
    });
    expect(ctx.openModal).not.toHaveBeenCalled();
    progress.report({
      phase: 'collecting',
      completed: 200,
      total: 200,
      assets: 10_000,
    });
    progress.report({
      phase: 'collecting',
      completed: 200,
      total: 200,
      assets: 10_000,
    });
    expect(ctx.openModal).toHaveBeenCalledTimes(1);
    const { received } = connectModal();
    await flushMessages();
    expect(received).toEqual([
      {
        type: 'progress',
        progress: {
          phase: 'collecting',
          completed: 200,
          total: 200,
          assets: 10_000,
        },
      },
    ]);
    resolve(false);
    await flushMessages();
    progress.report({
      phase: 'deleting',
      completed: 100,
      total: 10_000,
      assets: 100,
    });
    expect(ctx.openModal).toHaveBeenCalledTimes(1);
    expect(progress.signal.aborted).toBe(true);
  });

  it('does not open a late progress modal after finishing or outside collection', () => {
    const { ctx } = mockModal();
    const progress = createCleanupProgress(ctx, 200);
    progress.report({
      phase: 'waiting',
      completed: 100,
      total: 200,
      assets: 500,
    });
    progress.report({
      phase: 'deleting',
      completed: 100,
      total: 10_000,
      assets: 1000,
    });
    progress.finish();
    progress.report({
      phase: 'collecting',
      completed: 200,
      total: 200,
      assets: 500,
    });
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
  });

  it('waits for modal removal before handing control back to the native confirmation', async () => {
    vi.useFakeTimers();
    const { ctx, toast, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    const { boot, received } = connectModal();
    await flushMessages();
    let handedBack = false;
    const handoff = progress.handoff().then(() => {
      handedBack = true;
    });
    await flushMessages();
    expect(received[received.length - 1]).toEqual({ type: 'handoff' });
    expect(handedBack).toBe(false);
    expect(toast).not.toHaveBeenCalled();
    expect(progress.signal.aborted).toBe(false);

    resolve('handoff');
    await handoff;
    expect(handedBack).toBe(true);
    expect(boot.closed).toBe(true);
    expect(progress.signal.aborted).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);

    progress.report({
      phase: 'waiting',
      completed: 150,
      total: 500,
      assets: 0,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(toast).toHaveBeenLastCalledWith({
      type: 'notice',
      message: expect.stringContaining(
        '350 selected records are still visible',
      ),
      cta: { label: 'Cancel asset cleanup', value: 'cancel' },
      dismissAfterTimeout: 5000,
      dismissOnPageChange: false,
    });
    progress.report({
      phase: 'deleting',
      completed: 100,
      total: 200,
      assets: 90,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          '100 of 200 assets processed. 90 assets confirmed deleted',
        ),
      }),
    );
    await progress.handoff();
    expect(ctx.openModal).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(3);
    progress.finish();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replays handoff for a late modal mount and never reopens after handoff', async () => {
    vi.useFakeTimers();
    const { ctx, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 200);
    progress.report({
      phase: 'collecting',
      completed: 200,
      total: 200,
      assets: 10_000,
    });
    const handoff = progress.handoff();
    const { received } = connectModal();
    await flushMessages();
    expect(received[received.length - 1]).toEqual({ type: 'handoff' });
    resolve('handoff');
    await handoff;
    progress.report({
      phase: 'collecting',
      completed: 200,
      total: 200,
      assets: 10_000,
    });
    progress.report({ phase: 'waiting', completed: 0, total: 200, assets: 0 });
    progress.report({
      phase: 'deleting',
      completed: 100,
      total: 10_000,
      assets: 90,
    });
    expect(ctx.openModal).toHaveBeenCalledTimes(1);
    expect(progress.signal.aborted).toBe(false);
    progress.finish();
  });

  it('keeps small selections without any progress interface after handoff', async () => {
    const { ctx, toast } = mockModal();
    const progress = createCleanupProgress(ctx, 200);
    await progress.handoff();
    progress.report({
      phase: 'collecting',
      completed: 200,
      total: 200,
      assets: 10_000,
    });
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    progress.finish();
  });

  it('still treats user cancellation during handoff as cancellation', async () => {
    const { ctx, toast, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    const handoff = progress.handoff();
    resolve(false);
    await handoff;
    expect(progress.signal.aborted).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('cancels asset cleanup from the toast and disposes refresh timers', async () => {
    vi.useFakeTimers();
    const { ctx, toast, resolve } = mockModal();
    toast.mockResolvedValueOnce('cancel');
    const progress = createCleanupProgress(ctx, 500);
    const handoff = progress.handoff();
    resolve('handoff');
    await handoff;
    await flushMessages();
    expect(progress.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('never overlaps outstanding toast promises and ignores a late cancel after finish', async () => {
    vi.useFakeTimers();
    const { ctx, toast, resolve } = mockModal();
    let resolveToast: (value: unknown) => void = () => {};
    const pendingToast = new Promise<unknown>((resolvePromise) => {
      resolveToast = resolvePromise;
    });
    toast.mockReturnValue(pendingToast);
    const progress = createCleanupProgress(ctx, 500);
    const handoff = progress.handoff();
    resolve('handoff');
    await handoff;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(toast).toHaveBeenCalledTimes(1);
    progress.finish();
    resolveToast('cancel');
    await flushMessages();
    expect(progress.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes scheduled toast updates when cleanup finishes', async () => {
    vi.useFakeTimers();
    const { ctx, toast, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    const handoff = progress.handoff();
    resolve('handoff');
    await handoff;
    await flushMessages();
    expect(vi.getTimerCount()).toBe(1);
    progress.finish();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('contains toast failures without canceling cleanup or accumulating updates', async () => {
    vi.useFakeTimers();
    const { ctx, toast, resolve } = mockModal();
    toast.mockRejectedValueOnce(new Error('Toast unavailable'));
    const progress = createCleanupProgress(ctx, 500);
    const handoff = progress.handoff();
    resolve('handoff');
    await handoff;
    await flushMessages();
    expect(progress.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    progress.finish();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps only the latest snapshot before readiness and strips extra payload data', async () => {
    const { ctx } = mockModal();
    const progress = createCleanupProgress(ctx, 200_000);
    progress.report({
      phase: 'collecting',
      completed: 100,
      total: 200_000,
      assets: 25,
    });
    const countersWithPrivateData = {
      phase: 'collecting' as const,
      completed: 200_000,
      total: 200_000,
      assets: 10_000,
      token: 'never-broadcast',
      recordIds: ['never-broadcast'],
    };
    progress.report(countersWithPrivateData);
    countersWithPrivateData.assets = 0;
    const { boot, received } = connectModal();
    await flushMessages();
    expect(received).toEqual([
      {
        type: 'progress',
        progress: {
          phase: 'collecting',
          completed: 200_000,
          total: 200_000,
          assets: 10_000,
        },
      },
    ]);
    expect(JSON.stringify(boot.messages)).not.toContain('never-broadcast');
  });

  it('delivers completion after a late mount and closes without aborting', async () => {
    const { ctx, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 200_000);
    progress.report({
      phase: 'deleting',
      completed: 10_000,
      total: 10_000,
      assets: 8_500,
    });
    progress.finish();
    progress.finish();
    expect(FakeBroadcastChannel.channels[0].closed).toBe(false);
    const { boot, received } = connectModal();
    await flushMessages();
    expect(received).toEqual([
      {
        type: 'progress',
        progress: {
          phase: 'deleting',
          completed: 10_000,
          total: 10_000,
          assets: 8_500,
        },
      },
      { type: 'done' },
    ]);
    resolve(true);
    await flushMessages();
    expect(progress.signal.aborted).toBe(false);
    expect(boot.closed).toBe(true);
    expect(boot.onmessage).toBeNull();
  });

  it('replays completion if the modal reconnects before resolve', async () => {
    const { ctx, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    const first = connectModal();
    await flushMessages();
    progress.finish();
    await flushMessages();
    first.modal.close();
    const reconnected = connectModal();
    await flushMessages();
    expect(reconnected.received[reconnected.received.length - 1]).toEqual({
      type: 'done',
    });
    resolve(true);
    await flushMessages();
    expect(reconnected.boot.closed).toBe(true);
    expect(progress.signal.aborted).toBe(false);
  });

  it('streams counters and ignores reports after completion', async () => {
    const { ctx } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    const { received } = connectModal();
    await flushMessages();
    progress.report({
      phase: 'waiting',
      completed: 200,
      total: 500,
      assets: 0,
    });
    progress.report({
      phase: 'deleting',
      completed: 100,
      total: 200,
      assets: 90,
    });
    progress.finish();
    progress.finish();
    progress.report({
      phase: 'deleting',
      completed: 200,
      total: 200,
      assets: 180,
    });
    await flushMessages();
    expect(received.slice(1)).toEqual([
      {
        type: 'progress',
        progress: { phase: 'waiting', completed: 200, total: 500, assets: 0 },
      },
      {
        type: 'progress',
        progress: { phase: 'deleting', completed: 100, total: 200, assets: 90 },
      },
      { type: 'done' },
    ]);
  });

  it('aborts pending asset cleanup on cancel and releases the channel', async () => {
    const { ctx, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 200_000);
    const { boot, modal } = connectModal();
    await flushMessages();
    modal.postMessage({ type: 'cancel' });
    await flushMessages();
    expect(progress.signal.aborted).toBe(true);
    expect(boot.closed).toBe(true);
    progress.report({
      phase: 'deleting',
      completed: 100,
      total: 10_000,
      assets: 0,
    });
    progress.finish();
    resolve(false);
    await flushMessages();
    expect(boot.messages).toHaveLength(1);
  });

  it.each([
    true,
    false,
    null,
    undefined,
  ])('aborts if a live modal resolves with %s', async (value) => {
    const { ctx, resolve } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    resolve(value);
    await flushMessages();
    expect(progress.signal.aborted).toBe(true);
    expect(FakeBroadcastChannel.channels[0].closed).toBe(true);
  });

  it('handles modal-open rejection without an unhandled rejection', async () => {
    const { ctx, reject } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    reject(new Error('Modal could not open'));
    await flushMessages();
    expect(progress.signal.aborted).toBe(true);
    expect(FakeBroadcastChannel.channels[0].closed).toBe(true);
  });

  it('handles a synchronous modal-open failure', () => {
    const ctx = {
      customToast: mockModal().ctx.customToast,
      openModal: vi.fn(() => {
        throw new Error('Unavailable');
      }),
    };
    const progress = createCleanupProgress(ctx, 500);
    expect(progress.signal.aborted).toBe(true);
    expect(FakeBroadcastChannel.channels[0].closed).toBe(true);
  });

  it('aborts safely if an established channel stops accepting messages', async () => {
    const { ctx } = mockModal();
    const progress = createCleanupProgress(ctx, 500);
    const { boot } = connectModal();
    await flushMessages();
    boot.failMessages = true;
    expect(() =>
      progress.report({
        phase: 'collecting',
        completed: 100,
        total: 500,
        assets: 10,
      }),
    ).not.toThrow();
    expect(progress.signal.aborted).toBe(true);
    expect(boot.closed).toBe(true);
  });

  it('isolates simultaneous operations with different local channel IDs', () => {
    createCleanupProgress(mockModal().ctx, 500);
    createCleanupProgress(mockModal().ctx, 500);
    expect(FakeBroadcastChannel.channels[0].name).not.toBe(
      FakeBroadcastChannel.channels[1].name,
    );
  });

  it.each([
    'BroadcastChannel',
    'crypto',
  ])('falls back without a modal when %s is unavailable', (missing) => {
    vi.stubGlobal(missing, undefined);
    const { ctx } = mockModal();
    const progress = createCleanupProgress(ctx, 200_000);
    progress.report({
      phase: 'collecting',
      completed: 200_000,
      total: 200_000,
      assets: 10_000,
    });
    progress.finish();
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(progress.signal.aborted).toBe(false);
  });

  it('falls back when channel construction is blocked', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('Blocked');
        }
      },
    );
    const { ctx } = mockModal();
    const progress = createCleanupProgress(ctx, 200_000);
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(progress.signal.aborted).toBe(false);
  });
});

describe('isCleanupProgress', () => {
  it('accepts only phases with valid, bounded counters', () => {
    expect(
      isCleanupProgress({
        phase: 'deleting',
        completed: 10_000,
        total: 10_000,
        assets: 8_500,
      }),
    ).toBe(true);
    for (const value of [
      null,
      { phase: 'deleted', completed: 0, total: 200_000, assets: 0 },
      { phase: 'waiting', completed: 501, total: 500, assets: 0 },
      { phase: 'waiting', completed: -1, total: 500, assets: 0 },
      { phase: 'waiting', completed: 0, total: Infinity, assets: 0 },
      { phase: 'collecting', completed: 0, total: 500, assets: 0.5 },
      { phase: 'collecting', completed: 0, total: 500, assets: '1' },
    ]) {
      expect(isCleanupProgress(value)).toBe(false);
    }
  });
});

describe('describeCleanupProgress', () => {
  it('uses visible records while waiting and confirmed asset deletions separately', () => {
    expect(
      describeCleanupProgress({
        phase: 'collecting',
        completed: 100,
        total: 200,
        assets: 50,
      }),
    ).toBe(
      'Collecting assets: 100 of 200 records inspected. 50 unique assets found.',
    );
    expect(
      describeCleanupProgress({
        phase: 'waiting',
        completed: 150,
        total: 200,
        assets: 0,
      }),
    ).toBe(
      '50 selected records are still visible. Asset cleanup will begin after these records are no longer visible.',
    );
    expect(
      describeCleanupProgress({
        phase: 'deleting',
        completed: 100,
        total: 200,
        assets: 90,
      }),
    ).toBe(
      'Asset cleanup: 100 of 200 assets processed. 90 assets confirmed deleted.',
    );
  });
});

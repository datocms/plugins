import type { OnBeforeItemsDestroyCtx } from 'datocms-plugin-sdk';
import type { CleanupProgress } from './assetCleanup';

const MINIMUM_RECORDS_FOR_PROGRESS = 500;
const MINIMUM_ASSETS_FOR_PROGRESS = 500;
const TOAST_INTERVAL = 5000;

type CleanupProgressController = {
  signal: AbortSignal;
  report: (progress: CleanupProgress) => void;
  handoff: () => Promise<void>;
  finish: () => void;
};

export function describeCleanupProgress(progress: CleanupProgress): string {
  const completed = progress.completed.toLocaleString();
  const total = progress.total.toLocaleString();
  const assets = progress.assets.toLocaleString();
  switch (progress.phase) {
    case 'collecting':
      return `Collecting assets: ${completed} of ${total} records inspected. ${assets} unique assets found.`;
    case 'waiting':
      return `${(progress.total - progress.completed).toLocaleString()} selected records are still visible. Asset cleanup will begin after these records are no longer visible.`;
    case 'deleting':
      return `Asset cleanup: ${completed} of ${total} assets processed. ${assets} assets confirmed deleted.`;
  }
}

export function isCleanupProgress(value: unknown): value is CleanupProgress {
  if (typeof value !== 'object' || value === null) return false;
  const progress = value as Record<string, unknown>;
  if (
    progress.phase !== 'collecting' &&
    progress.phase !== 'waiting' &&
    progress.phase !== 'deleting'
  ) {
    return false;
  }
  for (const count of [progress.completed, progress.total, progress.assets]) {
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      return false;
    }
  }
  return Number(progress.completed) <= Number(progress.total);
}

/** Keep record IDs, asset IDs and credentials out of the modal's messages. */
export function createCleanupProgress(
  ctx: Pick<OnBeforeItemsDestroyCtx, 'openModal' | 'customToast'>,
  recordCount: number,
): CleanupProgressController {
  const controller = new AbortController();
  const silent: CleanupProgressController = {
    signal: controller.signal,
    report: () => {},
    handoff: async () => {},
    finish: () => {},
  };
  if (
    !Number.isSafeInteger(recordCount) ||
    recordCount < 0 ||
    typeof BroadcastChannel === 'undefined' ||
    typeof globalThis.crypto?.randomUUID !== 'function'
  ) {
    return silent;
  }

  let channel: BroadcastChannel | null = null;
  let latest: CleanupProgress = {
    phase: 'collecting',
    completed: 0,
    total: recordCount,
    assets: 0,
  };
  let ready = false;
  let started = false;
  let finished = false;
  let closed = false;
  let handingOff = false;
  let handedOff = false;
  let modalSettled: Promise<void> | undefined;
  let handoffPromise: Promise<void> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastInFlight = false;

  const stopToast = () => {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = undefined;
  };
  controller.signal.addEventListener('abort', stopToast, { once: true });

  const showToast = () => {
    if (
      !handedOff ||
      !started ||
      finished ||
      controller.signal.aborted ||
      toastInFlight
    ) {
      return;
    }
    toastInFlight = true;
    const startedAt = Date.now();
    const toastSettled = (value: unknown) => {
      toastInFlight = false;
      if (finished || controller.signal.aborted) return;
      if (value === 'cancel') {
        controller.abort();
      } else {
        // Only one toast/promise is outstanding. Early dismissal cannot spam
        // notices; ordinary timeout dismissal refreshes the latest counters.
        toastTimer = setTimeout(
          showToast,
          Math.max(0, TOAST_INTERVAL - (Date.now() - startedAt)),
        );
      }
    };
    try {
      void ctx
        .customToast({
          type: 'notice',
          message: `${describeCleanupProgress(latest)} Canceling asset cleanup does not cancel record deletion.`,
          cta: { label: 'Cancel asset cleanup', value: 'cancel' },
          dismissAfterTimeout: TOAST_INTERVAL,
          dismissOnPageChange: false,
        })
        .then(toastSettled, () => toastSettled(null));
    } catch {
      toastSettled(null);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (channel) {
      channel.onmessage = null;
      channel.close();
    }
  };

  const post = (message: unknown) => {
    if (closed || !channel) return;
    try {
      channel.postMessage(message);
    } catch {
      if (!finished) controller.abort();
      close();
    }
  };

  const modalClosed = (value: unknown) => {
    // Resolving/closing a live modal cancels only the asset cleanup operation.
    // The automatic handoff closes it before the dashboard's native dialog.
    if (!finished && value !== 'handoff') controller.abort();
    close();
  };

  const replayReady = () => {
    ready = true;
    post({ type: 'progress', progress: latest });
    if (handingOff) post({ type: 'handoff' });
    else if (finished) post({ type: 'done' });
  };

  const startModal = () => {
    if (started || finished || closed || handingOff) return;
    started = true;
    let channelId: string;
    try {
      channelId = `delete-assets-cleanup:${globalThis.crypto.randomUUID()}`;
      channel = new BroadcastChannel(channelId);
    } catch {
      // An unavailable cross-frame channel must not prevent record deletion.
      close();
      return;
    }
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'object' || event.data === null) return;
      const message = event.data as Record<string, unknown>;
      if (message.type === 'cancel' && !finished) {
        controller.abort();
        close();
      } else if (message.type === 'ready') {
        replayReady();
      }
    };
    try {
      modalSettled = ctx
        .openModal({
          id: 'cleanupProgress',
          title: 'Cleaning up assets',
          width: 's',
          parameters: { channelId, recordCount },
        })
        .then(modalClosed, () => modalClosed(false));
    } catch {
      modalClosed(false);
    }
  };

  if (recordCount >= MINIMUM_RECORDS_FOR_PROGRESS) startModal();

  return {
    signal: controller.signal,
    report(progress) {
      if (finished || controller.signal.aborted) return;
      // Copy only the permitted counters, even if callers attach extra data.
      latest = {
        phase: progress.phase,
        completed: progress.completed,
        total: progress.total,
        assets: progress.assets,
      };
      if (handingOff) return;
      if (ready) {
        post({ type: 'progress', progress: latest });
      } else if (
        progress.phase === 'collecting' &&
        progress.assets >= MINIMUM_ASSETS_FOR_PROGRESS
      ) {
        startModal();
      }
    },
    handoff() {
      if (handoffPromise) return handoffPromise;
      handingOff = true;
      if (ready) post({ type: 'handoff' });
      handoffPromise = (async () => {
        // The before-hook must not return until its modal is fully removed:
        // otherwise it can hide the dashboard's native deletion confirmation.
        if (modalSettled) await modalSettled;
        handedOff = true;
        showToast();
      })();
      return handoffPromise;
    },
    finish() {
      if (finished) return;
      finished = true;
      stopToast();
      if (ready) post({ type: 'done' });
      // Keep the last snapshot/done available if the iframe has not mounted.
      // The modal's resolve() releases this channel through modalClosed().
    },
  };
}

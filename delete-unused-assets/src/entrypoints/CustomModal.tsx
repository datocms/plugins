import { buildClient } from '@datocms/cma-client-browser';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { useEffect, useMemo, useRef, useState } from 'react';
import AssetReview, { ASSETS_PER_PAGE } from '../components/AssetReview';
import DeletionProgressView from '../components/DeletionProgress';
import DeletionSummary, {
  deletedMessage,
  isComplete,
} from '../components/DeletionSummary';
import { CircleExclamationIcon, ImageIcon } from '../icons';
import { TEXTS } from '../texts';
import { formatters } from '../utils/format';
import {
  type DeletionProgress,
  type DeletionResult,
  type DiscoveryProgress,
  deleteUnusedAssets,
  discoverUnusedAssets,
  type UnusedAsset,
} from '../utils/unusedAssets';
import { useFrameHeight } from '../utils/useFrameHeight';

type PropTypes = {
  ctx: RenderModalCtx;
};

type Phase = 'discovering' | 'ready' | 'deleting' | 'finished' | 'error';

type ScanError = { kind: 'noToken' } | { kind: 'failed'; message: string };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function CustomModal({ ctx }: PropTypes) {
  const [unusedAssets, setUnusedAssets] = useState<UnusedAsset[]>([]);
  const [phase, setPhase] = useState<Phase>('discovering');
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress>(
    { found: 0, total: 0 },
  );
  const [deletionProgress, setDeletionProgress] =
    useState<DeletionProgress | null>(null);
  const [deletionResult, setDeletionResult] = useState<DeletionResult | null>(
    null,
  );
  const [scanError, setScanError] = useState<ScanError | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  // The scan of the current client; aborted on unmount or when the client
  // changes.
  const scanRef = useRef<AbortController | null>(null);
  // The running deletion; cleared on unmount or when the client changes.
  const deletionRef = useRef<AbortController | null>(null);
  const deletionRunRef = useRef<Promise<void> | null>(null);
  // The host's confirm is open: further clicks on Delete do nothing.
  const confirmingRef = useRef(false);
  const frameRef = useFrameHeight(ctx);

  const { currentUserAccessToken, environment, cmaBaseUrl } = ctx;
  const client = useMemo(
    () =>
      currentUserAccessToken
        ? buildClient({
            apiToken: currentUserAccessToken,
            environment,
            baseUrl: cmaBaseUrl,
          })
        : null,
    [currentUserAccessToken, environment, cmaBaseUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    scanRef.current = controller;
    setUnusedAssets([]);
    setDiscoveryProgress({ found: 0, total: 0 });
    setDeletionProgress(null);
    setDeletionResult(null);
    setScanError(null);
    setStopRequested(false);
    setPhase('discovering');

    if (!client) {
      setScanError({ kind: 'noToken' });
      setPhase('error');
    } else {
      discoverUnusedAssets(client, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setDiscoveryProgress(progress);
        },
      })
        .then((assets) => {
          if (controller.signal.aborted) return;
          setUnusedAssets(assets);
          setPhase('ready');
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setScanError({ kind: 'failed', message: errorMessage(error) });
          setPhase('error');
        });
    }

    return () => {
      controller.abort();
      deletionRef.current?.abort();
      deletionRef.current = null;
      deletionRunRef.current = null;
    };
  }, [client]);

  const close = () => {
    void ctx.resolve('').catch(() => {});
  };

  const startDeletion = (selected: UnusedAsset[]) => {
    if (!client || phase !== 'ready' || deletionRef.current) return;

    const controller = new AbortController();
    deletionRef.current = controller;
    const isCurrentRun = () => deletionRef.current === controller;
    setStopRequested(false);
    setPhase('deleting');

    deletionRunRef.current = deleteUnusedAssets(client, selected, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (isCurrentRun()) setDeletionProgress(progress);
      },
    }).then((result) => {
      if (!isCurrentRun()) return;
      setDeletionResult(result);
      setPhase('finished');
      // A finished action is a toast: the summary keeps only the numbers. A
      // run that only skipped assets (records started using them) deleted
      // nothing, so it has no toast: the summary shows the skipped count.
      if (isComplete(result) && result.deleted > 0) {
        const message = deletedMessage(result, formatters(ctx.ui.locale));
        void ctx.notice(message).catch(() => {});
      }
    });
  };

  // Asks through the host before the deletion: the selection bar's Delete is
  // not a destructive button by itself.
  const confirmAndDelete = async (selected: UnusedAsset[]) => {
    const scan = scanRef.current;
    if (!scan || confirmingRef.current || deletionRef.current) return;

    confirmingRef.current = true;
    const { assets } = formatters(ctx.ui.locale);
    const one = selected.length === 1;
    try {
      const choice = await ctx.openConfirm({
        title: `Delete ${assets(selected.length)}?`,
        content: one
          ? "It'll be permanently deleted from your project. This can't be undone."
          : "They'll be permanently deleted from your project. This can't be undone.",
        choices: [
          {
            label: `Delete ${assets(selected.length)}`,
            value: 'delete',
            intent: 'negative',
          },
        ],
        cancel: { label: 'Cancel', value: false },
      });
      // The dialog may have closed, or scanned again, in the meantime.
      if (choice === 'delete' && !scan.signal.aborted) {
        startDeletion(selected);
      }
    } catch {
      // The confirm didn't open: nothing is deleted.
    } finally {
      confirmingRef.current = false;
    }
  };

  const stopDeletion = () => {
    deletionRef.current?.abort();
    setStopRequested(true);
    return deletionRunRef.current ?? Promise.resolve();
  };

  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <div ref={frameRef}>
        {/* BlankSlate has no live region: the wrappers announce the scan
            and its errors to screen readers. */}
        {phase === 'discovering' && (
          <div role="status" aria-live="polite">
            <BlankSlate
              placement="inline"
              loading
              title="Looking for unused assets"
              caption={
                discoveryProgress.total > ASSETS_PER_PAGE
                  ? {
                      id: 'deleteUnusedAssets.discoveryCaption',
                      values: discoveryProgress,
                    }
                  : undefined
              }
            />
          </div>
        )}
        {phase === 'error' && scanError && (
          <div role="alert">
            <BlankSlate
              placement="inline"
              error
              icon={<CircleExclamationIcon />}
              {...(scanError.kind === 'noToken'
                ? {
                    title: 'No access to your API token',
                    description:
                      'This plugin needs access to your API token to find and delete unused assets. Check its permissions in the plugin settings.',
                  }
                : {
                    title: "Couldn't find unused assets",
                    description: 'Close this window and try again.',
                    code: scanError.message,
                  })}
              actions={<Button label="Close" onClick={close} />}
            />
          </div>
        )}
        {phase === 'ready' &&
          (unusedAssets.length > 0 ? (
            <AssetReview assets={unusedAssets} onDelete={confirmAndDelete} />
          ) : (
            <BlankSlate
              placement="inline"
              icon={<ImageIcon />}
              title="No unused assets"
              description="Every asset is used by at least one record, so there's nothing to delete."
            />
          ))}
        {phase === 'deleting' && deletionProgress && (
          <DeletionProgressView
            progress={deletionProgress}
            stopRequested={stopRequested}
            onStop={stopDeletion}
          />
        )}
        {phase === 'finished' && deletionResult && (
          <DeletionSummary result={deletionResult} onClose={close} />
        )}
      </div>
    </Canvas>
  );
}

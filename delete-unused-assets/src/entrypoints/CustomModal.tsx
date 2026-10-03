import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createAssetClient } from '../utils/assetClient';
import {
  type DeletionProgress,
  type DeletionResult,
  type DiscoveryProgress,
  deleteUnusedAssets,
  discoverUnusedAssets,
  type UnusedAsset,
} from '../utils/unusedAssets';
import s from './styles.module.css';

type PropTypes = {
  ctx: RenderModalCtx;
};

type Phase = 'discovering' | 'ready' | 'deleting' | 'finished' | 'error';

const ASSETS_PER_PAGE = 100;

function AssetConfirmation({
  assets,
  onCancel,
  onDelete,
}: {
  assets: UnusedAsset[];
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(assets.length / ASSETS_PER_PAGE);
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * ASSETS_PER_PAGE;
  const end = Math.min(start + ASSETS_PER_PAGE, assets.length);

  return (
    <div className={s.cancelationModal}>
      <h4>This will delete all of the following assets:</h4>
      <ul className={s.assetList}>
        {assets.slice(start, end).map((asset) => (
          <li key={asset.id}>
            <a href={asset.url} target="_blank" rel="noopener noreferrer">
              {asset.filename}
            </a>
          </li>
        ))}
      </ul>
      {pageCount > 1 && (
        <div className={s.pagination}>
          <p className={s.progressText}>
            Showing {start + 1}–{end} of {assets.length} assets. All{' '}
            {assets.length} assets will be checked for deletion.
          </p>
          <div className={s.pageButtons}>
            <Button
              className={s.button}
              buttonSize="xs"
              buttonType="muted"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <span className={s.progressText}>
              Page {currentPage + 1} of {pageCount}
            </span>
            <Button
              className={s.button}
              buttonSize="xs"
              buttonType="muted"
              disabled={currentPage === pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      <h2>Are you sure you want to proceed?</h2>
      <div className={s.buttonContainer}>
        <Button
          onClick={onCancel}
          className={`${s.button} ${s.modalButton}`}
          buttonType="muted"
        >
          Cancel
        </Button>
        <Button
          onClick={onDelete}
          className={`${s.button} ${s.modalButton}`}
          buttonType="negative"
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function DeletionCounts({ progress }: { progress: DeletionProgress }) {
  return (
    <p className={s.progressText}>
      Deleted: {progress.deleted}. Kept because they are in use:{' '}
      {progress.skipped}. Already removed: {progress.missing}. Failed:{' '}
      {progress.failed}.
    </p>
  );
}

function isComplete(result: DeletionResult) {
  return (
    !result.cancelled &&
    !result.error &&
    result.failed === 0 &&
    result.uncertain === 0 &&
    result.processed === result.total
  );
}

function completionNotice(result: DeletionResult) {
  if (result.skipped === 0 && result.missing === 0) {
    return 'Unused assets successfully deleted!';
  }

  return `Unused assets deleted: ${result.deleted}. Assets kept because they are in use: ${result.skipped}. Assets already removed: ${result.missing}.`;
}

function DeletionOutcome({ result }: { result: DeletionResult }) {
  const remaining = Math.max(
    0,
    result.total - result.processed - result.uncertain,
  );

  return (
    <>
      <h4>{result.cancelled ? 'Deletion stopped' : 'Deletion results'}</h4>
      <DeletionCounts progress={result} />
      {remaining > 0 && (
        <p className={s.progressText}>
          Not processed: {remaining} {remaining === 1 ? 'asset' : 'assets'}.
        </p>
      )}
      {result.uncertain > 0 && (
        <p role="alert">
          Could not confirm deletion of {result.uncertain}{' '}
          {result.uncertain === 1 ? 'asset' : 'assets'}. Check your asset
          library before starting another deletion.
        </p>
      )}
      {result.error && <p role="alert">{result.error}</p>}
    </>
  );
}

export default function CustomModal({ ctx }: PropTypes) {
  const [unusedAssets, setUnusedAssets] = useState<UnusedAsset[]>([]);
  const [phase, setPhase] = useState<Phase>('discovering');
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress>(
    { scanned: 0, found: 0, total: 0 },
  );
  const [deletionProgress, setDeletionProgress] =
    useState<DeletionProgress | null>(null);
  const [deletionResult, setDeletionResult] = useState<DeletionResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const mountedRef = useRef(false);
  const deletionControllerRef = useRef<AbortController | null>(null);
  const deletionInProgressRef = useRef(false);

  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) {
      return null;
    }

    return createAssetClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);
  const selectionClientRef = useRef<typeof client>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    mountedRef.current = true;
    selectionClientRef.current = null;
    setUnusedAssets([]);
    setDiscoveryProgress({ scanned: 0, found: 0, total: 0 });
    setDeletionProgress(null);
    setDeletionResult(null);
    setErrorMessage('');
    setStopRequested(false);
    setPhase('discovering');

    if (!client) {
      setErrorMessage(
        'This plugin needs access to your API token to find and delete unused assets.',
      );
      setPhase('error');
    } else {
      discoverUnusedAssets(client, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (active && !controller.signal.aborted) {
            setDiscoveryProgress(progress);
          }
        },
      })
        .then((assets) => {
          if (active && !controller.signal.aborted) {
            selectionClientRef.current = client;
            setUnusedAssets(assets);
            setPhase('ready');
          }
        })
        .catch((error: unknown) => {
          if (active && !controller.signal.aborted) {
            setErrorMessage(
              error instanceof Error
                ? error.message
                : "Couldn't find unused assets. Please close this window and try again.",
            );
            setPhase('error');
          }
        });
    }

    return () => {
      active = false;
      mountedRef.current = false;
      controller.abort();
      deletionControllerRef.current?.abort();
      deletionControllerRef.current = null;
      deletionInProgressRef.current = false;
    };
  }, [client]);

  const close = () => {
    void ctx.resolve('').catch(() => {});
  };

  const startDeletion = async () => {
    if (
      !client ||
      selectionClientRef.current !== client ||
      phase !== 'ready' ||
      deletionInProgressRef.current
    ) {
      return;
    }

    const controller = new AbortController();
    deletionControllerRef.current = controller;
    deletionInProgressRef.current = true;
    const isCurrentRun = () =>
      mountedRef.current && deletionControllerRef.current === controller;
    setDeletionProgress({
      total: unusedAssets.length,
      processed: 0,
      deleted: 0,
      skipped: 0,
      missing: 0,
      failed: 0,
    });
    setStopRequested(false);
    setPhase('deleting');

    try {
      const result = await deleteUnusedAssets(client, unusedAssets, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrentRun()) {
            setDeletionProgress(progress);
          }
        },
      });

      if (!isCurrentRun()) {
        return;
      }

      setDeletionResult(result);
      setPhase('finished');
      if (isComplete(result)) {
        void ctx.notice(completionNotice(result)).catch(() => {});
        close();
      }
    } catch {
      if (isCurrentRun()) {
        setErrorMessage(
          "Couldn't complete deletion. Counts show the last confirmed progress. Check your asset library before starting another deletion.",
        );
        setPhase('error');
      }
    } finally {
      if (isCurrentRun()) {
        deletionInProgressRef.current = false;
      }
    }
  };

  const stopDeletion = () => {
    deletionControllerRef.current?.abort();
    setStopRequested(true);
  };

  return (
    <Canvas ctx={ctx}>
      {phase === 'discovering' && (
        <>
          <div className={s.loadingSpinner}>
            <Spinner size={48} placement="centered" />
          </div>
          {discoveryProgress.total > ASSETS_PER_PAGE && (
            <p className={s.progressText} role="status">
              {(discoveryProgress.attempt ?? 1) > 1 && (
                <>
                  Asset library changed; checking again (attempt{' '}
                  {discoveryProgress.attempt} of 3)…{' '}
                </>
              )}
              Checking {discoveryProgress.scanned} of {discoveryProgress.total}{' '}
              assets… {discoveryProgress.found} unused assets found.
            </p>
          )}
        </>
      )}
      {phase === 'ready' &&
        (unusedAssets.length ? (
          <AssetConfirmation
            assets={unusedAssets}
            onCancel={close}
            onDelete={() => void startDeletion()}
          />
        ) : (
          <h4>There are no unused assets in your library</h4>
        ))}
      {phase === 'deleting' && deletionProgress && (
        <div className={s.operationStatus}>
          <div className={s.loadingSpinner}>
            <Spinner size={48} placement="centered" />
          </div>
          {deletionProgress.total > ASSETS_PER_PAGE && (
            <>
              <div role="status" aria-live="polite">
                <p>
                  {stopRequested
                    ? 'Stopping after the current batch finishes…'
                    : 'Deleting unused assets…'}
                </p>
                <p className={s.progressText}>
                  {deletionProgress.processed} of {deletionProgress.total}{' '}
                  assets processed.
                </p>
                <DeletionCounts progress={deletionProgress} />
              </div>
              <Button
                className={s.button}
                buttonType="muted"
                disabled={stopRequested}
                onClick={stopDeletion}
              >
                {stopRequested ? 'Stopping…' : 'Stop'}
              </Button>
            </>
          )}
        </div>
      )}
      {(phase === 'error' || phase === 'finished') && (
        <div className={s.operationStatus}>
          {phase === 'error' && (
            <>
              <p role="alert">{errorMessage}</p>
              {deletionProgress && (
                <DeletionCounts progress={deletionProgress} />
              )}
            </>
          )}
          {phase === 'finished' && deletionResult && (
            <DeletionOutcome result={deletionResult} />
          )}
          <Button className={s.button} buttonType="muted" onClick={close}>
            Close
          </Button>
        </div>
      )}
    </Canvas>
  );
}

import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import ListArea from 'datocms-react-ui/ListArea';
import Main from 'datocms-react-ui/Main';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import AssetReview, { ASSETS_PER_PAGE } from '../components/AssetReview';
import DeletionProgressView from '../components/DeletionProgress';
import DeletionSummary, {
  deletedMessage,
  isComplete,
} from '../components/DeletionSummary';
import PagePane from '../components/PagePane';
import { CircleAlertIcon, ImageIcon } from '../icons';
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
import s from './styles.module.css';

type Props = {
  ctx: RenderPageCtx;
};

/** The page of the tool: a pane with the scan, the list, then the deletion */
export default function UnusedAssetsPage({ ctx }: Props) {
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

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      <Main className={s.page}>
        {client ? (
          // Another environment starts over: what one scan found doesn't
          // apply to the other.
          <UnusedAssets key={environment} ctx={ctx} client={client} />
        ) : (
          <PagePane>
            <PageColumn>
              <Page.Group
                title="API access"
                tone="warning"
                status={<Pill tone="warning">Not allowed</Pill>}
              >
                <Callout tone="warning">
                  To find and delete unused assets, grant this plugin permission
                  to make API calls on behalf of the logged-in user.
                </Callout>
              </Page.Group>
            </PageColumn>
          </PagePane>
        )}
      </Main>
    </Canvas>
  );
}

/** The column of content of the page, under its title bar */
function PageColumn({ children }: { children: ReactNode }) {
  return (
    <Page>
      <Page.Content>{children}</Page.Content>
    </Page>
  );
}

type Phase =
  | 'idle'
  | 'discovering'
  | 'ready'
  | 'deleting'
  | 'finished'
  | 'error';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function UnusedAssets({ ctx, client }: Props & { client: Client }) {
  const [unusedAssets, setUnusedAssets] = useState<UnusedAsset[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress>(
    { found: 0, total: 0 },
  );
  const [deletionProgress, setDeletionProgress] =
    useState<DeletionProgress | null>(null);
  const [deletionResult, setDeletionResult] = useState<DeletionResult | null>(
    null,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  // The current scan; aborted by the next scan and on unmount.
  const scanRef = useRef<AbortController | null>(null);
  // The running deletion; aborted on unmount.
  const deletionRef = useRef<AbortController | null>(null);
  const deletionRunRef = useRef<Promise<void> | null>(null);
  // The host's confirm is open: further clicks on Delete do nothing.
  const confirmingRef = useRef(false);

  // Leaving the screen stops the scan, and the deletion after its current
  // batch.
  useEffect(
    () => () => {
      scanRef.current?.abort();
      deletionRef.current?.abort();
      deletionRef.current = null;
      deletionRunRef.current = null;
    },
    [],
  );

  const scan = () => {
    if (deletionRef.current) return;
    scanRef.current?.abort();
    const controller = new AbortController();
    scanRef.current = controller;
    setUnusedAssets([]);
    setDiscoveryProgress({ found: 0, total: 0 });
    setDeletionProgress(null);
    setDeletionResult(null);
    setScanError(null);
    setStopRequested(false);
    setPhase('discovering');

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
        setScanError(errorMessage(error));
        setPhase('error');
      });
  };

  const startDeletion = (selected: UnusedAsset[]) => {
    if (phase !== 'ready' || deletionRef.current) return;

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
      deletionRef.current = null;
      deletionRunRef.current = null;
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
    const scanned = scanRef.current;
    if (!scanned || confirmingRef.current || deletionRef.current) return;

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
      // The screen may have closed in the meantime.
      if (choice === 'delete' && !scanned.signal.aborted) {
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

  switch (phase) {
    case 'idle':
      return (
        <PagePane>
          <ListArea>
            <BlankSlate
              placement="area"
              icon={<ImageIcon />}
              title="Find the assets that no record uses"
              description="The scan lists them, so you can review them and delete the ones you don't need."
              actions={
                <Button
                  tone="primary"
                  label="Scan for unused assets"
                  onClick={scan}
                />
              }
            />
          </ListArea>
        </PagePane>
      );
    case 'discovering':
      // BlankSlate has no live region: the wrapper announces the scan.
      return (
        <PagePane>
          <ListArea>
            <div role="status" aria-live="polite">
              <BlankSlate
                placement="area"
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
          </ListArea>
        </PagePane>
      );
    case 'error':
      return (
        <PagePane>
          <ListArea>
            <div role="alert">
              <BlankSlate
                placement="area"
                error
                icon={<CircleAlertIcon />}
                title="Couldn't find unused assets"
                code={scanError ?? undefined}
                description="Check your connection, then try again."
                actions={<Button label="Try again" onClick={scan} />}
              />
            </div>
          </ListArea>
        </PagePane>
      );
    case 'ready':
      return unusedAssets.length > 0 ? (
        <AssetReview assets={unusedAssets} onDelete={confirmAndDelete} />
      ) : (
        <PagePane>
          <ListArea>
            <BlankSlate
              placement="area"
              icon={<ImageIcon />}
              title="No unused assets"
              description="Every asset is used by at least one record, so there's nothing to delete."
              actions={<Button label="Scan again" onClick={scan} />}
            />
          </ListArea>
        </PagePane>
      );
    case 'deleting':
      return (
        <PagePane>
          <PageColumn>
            {deletionProgress && (
              <DeletionProgressView
                progress={deletionProgress}
                stopRequested={stopRequested}
                onStop={stopDeletion}
              />
            )}
          </PageColumn>
        </PagePane>
      );
    case 'finished':
      return (
        <PagePane>
          <PageColumn>
            {deletionResult && (
              <DeletionSummary result={deletionResult} onScanAgain={scan} />
            )}
          </PageColumn>
        </PagePane>
      );
  }
}

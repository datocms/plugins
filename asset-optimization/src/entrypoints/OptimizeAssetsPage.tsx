import { buildClient } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Main from 'datocms-react-ui/Main';
import { Page } from 'datocms-react-ui/Page';
import Pane from 'datocms-react-ui/Pane';
import Pill from 'datocms-react-ui/Pill';
import SelectInput from 'datocms-react-ui/SelectInput';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import ActivityLog, {
  type LogEntry,
} from '../components/asset-optimization/ActivityLog';
import AssetList, {
  type AssetCategory,
} from '../components/asset-optimization/AssetList';
import PageToolbar, {
  type PagePhase,
} from '../components/asset-optimization/PageToolbar';
import ProgressIndicator from '../components/asset-optimization/ProgressIndicator';
import { ACTIVITY_LOG_LIMIT } from '../components/asset-optimization/presentation';
import ResultsStats from '../components/asset-optimization/ResultsStats';
import SettingsForm from '../components/asset-optimization/SettingsForm';
import {
  type OptimizationProgress,
  runAssetOptimization,
} from '../services/assetOptimizationService';
import { formatFileSize } from '../utils/formatters';
import {
  type AssetOptimizerResult,
  defaultSettings,
  normalizeSettings,
  type OptimizationSettings,
} from '../utils/optimizationUtils';
import s from './OptimizeAssetsPage.module.css';

type Props = { ctx: RenderPageCtx };

type CollectionOption = { value: string; label: string };

// The option of the whole environment. Collection IDs are numeric, thus it
// never matches one. The page keeps '' for it.
const ALL_ASSETS = 'all';

function readSettings(savedSettings: unknown): OptimizationSettings {
  try {
    return normalizeSettings(
      typeof savedSettings === 'string' ? JSON.parse(savedSettings) : undefined,
    );
  } catch {
    return normalizeSettings(undefined);
  }
}

/** The first group of the page when the plugin can't use the API token */
function AccessGroup() {
  return (
    <Page.Group
      title="API access"
      tone="warning"
      status={<Pill tone="warning">Not allowed</Pill>}
    >
      <Callout tone="warning">
        Ask an admin to let this plugin use your API token, which it needs to
        find and replace images.
      </Callout>
    </Page.Group>
  );
}

type ScopeGroupProps = {
  collections: CollectionOption[];
  collectionId: string;
  loading: boolean;
  failed: boolean;
  onChange: (collectionId: string) => void;
};

/** The images that a run handles: all of them, or one asset collection */
function ScopeGroup({
  collections,
  collectionId,
  loading,
  failed,
  onChange,
}: ScopeGroupProps) {
  const options = useMemo(
    () => [{ value: ALL_ASSETS, label: 'All assets' }, ...collections],
    [collections],
  );

  return (
    <Page.Group title="Scope">
      <FieldWrapper
        label="Asset collection"
        hint="Only images in this collection are processed, not its subcollections."
        error={
          failed
            ? "Couldn't load the asset collections. Reload the page to pick one."
            : undefined
        }
      >
        <SelectInput
          value={collectionId || ALL_ASSETS}
          options={options}
          loading={loading}
          clearable={false}
          onChange={(value: string | null) =>
            onChange(!value || value === ALL_ASSETS ? '' : value)
          }
        />
      </FieldWrapper>
    </Page.Group>
  );
}

const OptimizeAssetsPage = ({ ctx }: Props) => {
  const savedSettings = ctx.plugin.attributes.parameters.optimization_settings;
  const [settings, setSettings] = useState(() => readSettings(savedSettings));
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [collectionError, setCollectionError] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(() =>
    Boolean(ctx.currentUserAccessToken),
  );
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<OptimizationProgress>({
    phase: 'loading',
    current: 0,
    total: 0,
  });
  const [result, setResult] = useState<AssetOptimizerResult | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [droppedLogCount, setDroppedLogCount] = useState(0);
  const [openCategories, setOpenCategories] = useState<AssetCategory[]>([]);
  const controller = useRef<AbortController | null>(null);
  const runLocked = useRef(false);
  const mounted = useRef(true);
  const logBuffer = useRef<LogEntry[]>([]);
  const logCount = useRef(0);

  useEffect(() => {
    if (!ctx.currentUserAccessToken) {
      setCollectionsLoading(false);
      return;
    }
    let active = true;
    setCollectionsLoading(true);
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
      requestTimeout: 30_000,
    });
    void client.uploadCollections
      .list()
      .then((items) => {
        if (active) {
          setCollectionError(false);
          setCollections(
            items.map((item) => ({ value: item.id, label: item.label })),
          );
          setCollectionsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setCollectionError(true);
          setCollectionsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  useEffect(() => {
    if (!runLocked.current) setSettings(readSettings(savedSettings));
  }, [savedSettings]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isProcessing) {
        event.preventDefault();
        event.returnValue = 'Asset processing is still in progress.';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProcessing]);

  const flushLogs = () => {
    if (!mounted.current) return;
    setLogEntries([...logBuffer.current]);
    setDroppedLogCount(logCount.current - logBuffer.current.length);
  };

  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => {
      if (!mounted.current) return;
      setLogEntries([...logBuffer.current]);
      setDroppedLogCount(logCount.current - logBuffer.current.length);
    }, 200);
    return () => clearInterval(interval);
  }, [isProcessing]);

  const appendLog = (entry: LogEntry) => {
    logCount.current++;
    logBuffer.current.unshift({ ...entry, id: logCount.current });
    if (logBuffer.current.length > ACTIVITY_LOG_LIMIT) logBuffer.current.pop();
  };

  const addLog = (message: string) =>
    appendLog({ text: `[${new Date().toISOString()}] ${message}` });

  const addSizeComparisonLog = (
    assetPath: string,
    originalSize: number,
    optimizedSize: number,
  ) =>
    appendLog({
      text: `[${new Date().toISOString()}] Successfully optimized asset: ${assetPath}`,
      originalSize,
      optimizedSize,
      savingsPercentage: Math.round(
        ((originalSize - optimizedSize) / originalSize) * 100,
      ),
    });

  const resetState = () => {
    setIsPreviewing(false);
    setIsCancelling(false);
    setResult(null);
    setOpenCategories([]);
    setLogEntries([]);
    setDroppedLogCount(0);
    logBuffer.current = [];
    logCount.current = 0;
    setProgress({ phase: 'loading', current: 0, total: 0 });
  };

  const collectionLabel = () =>
    collections.find((item) => item.value === collectionId)?.label ??
    collectionId;

  const confirmOptimization = async () => {
    const scope = collectionId
      ? `in the collection “${collectionLabel()}”`
      : `in the whole “${ctx.environment}” environment`;
    const confirmation = await ctx.openConfirm({
      title: 'Replace images?',
      content: `This replaces the matching images ${scope} with optimized versions. The originals can't be recovered.`,
      choices: [
        {
          label: 'Continue',
          value: 'confirm',
          intent: 'positive',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    if (confirmation !== 'confirm') return false;
    const finalConfirmation = await ctx.openConfirm({
      title: 'Replace the originals for good?',
      content:
        "The originals are deleted and can't be recovered, and wrong settings can lower the quality of your images. Try the settings in a sandbox environment first, then promote it once you're happy with the results.",
      choices: [
        {
          label: 'Replace images',
          value: 'confirm',
          intent: 'negative',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    return finalConfirmation === 'confirm';
  };

  // The toasts are not awaited: the promise of customToast settles only when
  // the toast closes, and the run ends only after this function.
  const reportResults = (completed: AssetOptimizerResult, preview: boolean) => {
    setResult(completed);
    addLog(
      `Processed ${completed.optimized + completed.skipped + completed.failed} of ${completed.totalAssets}. Optimized: ${completed.optimized}, Skipped: ${completed.skipped}, Failed: ${completed.failed}.`,
    );
    const savedBytes = completed.optimizedAssets.reduce(
      (sum, asset) => sum + asset.originalSize - asset.optimizedSize,
      0,
    );
    if (savedBytes > 0)
      addLog(`Total size savings: ${formatFileSize(savedBytes)}`);
    if (completed.cancelled || completed.stoppedReason) {
      addLog(
        completed.stoppedReason ??
          'Operation cancelled. Accepted replacements were allowed to finish.',
      );
      void ctx.customToast({
        type: 'warning',
        message: preview
          ? 'Preview stopped. The results show what was checked.'
          : 'Optimization stopped. The results show what was done.',
        dismissAfterTimeout: true,
      });
    } else if (completed.failed > 0) {
      void ctx.customToast({
        type: 'warning',
        message:
          'Finished with failed images. Check the list of failed images.',
        dismissAfterTimeout: true,
      });
    } else {
      void ctx.notice(
        preview
          ? 'Preview finished. No image was changed.'
          : 'Optimization finished.',
      );
    }
  };

  const executeRun = async (preview: boolean, apiToken: string) => {
    resetState();
    setIsPreviewing(preview);
    setIsProcessing(true);
    const abortController = new AbortController();
    controller.current = abortController;
    const client = buildClient({
      apiToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
      requestTimeout: 30_000,
    });
    addLog(`Starting asset optimization ${preview ? 'preview' : 'process'}...`);
    addLog(
      collectionId
        ? `Scope: collection "${collectionLabel()}" in environment ${ctx.environment}.`
        : `Scope: all matching assets in environment ${ctx.environment}.`,
    );
    const completed = await runAssetOptimization(client, settings, {
      preview,
      collectionId: collectionId || undefined,
      signal: abortController.signal,
      addLog,
      addSizeComparisonLog,
      onProgress: (next) => {
        if (mounted.current) setProgress(next);
      },
    });
    if (!mounted.current) return;
    reportResults(completed, preview);
  };

  const reportError = async (error: unknown) => {
    if (!mounted.current) return;
    const message = error instanceof Error ? error.message : String(error);
    addLog(`Error during asset processing: ${message}`);
    await ctx.alert(`Couldn't finish the run: ${message}`);
  };

  const finishRun = () => {
    controller.current = null;
    runLocked.current = false;
    if (!mounted.current) return;
    flushLogs();
    setIsProcessing(false);
    setIsCancelling(false);
  };

  const startRun = async (preview: boolean) => {
    // The ref closes the double-click gap before React renders or confirms resolve.
    if (runLocked.current) return;
    runLocked.current = true;
    try {
      if (!ctx.currentUserAccessToken)
        throw new Error(
          'Access token not available. Check the plugin permissions.',
        );
      if (!preview && !(await confirmOptimization())) return;
      if (!mounted.current) return;
      await executeRun(preview, ctx.currentUserAccessToken);
    } catch (error) {
      await reportError(error);
    } finally {
      finishRun();
    }
  };

  const cancel = () => {
    setIsCancelling(true);
    controller.current?.abort();
  };

  const restoreDefaults = () => {
    setSettings({ ...defaultSettings });
    void ctx.notice('Default settings restored.');
  };

  const toggleCategory = (category: AssetCategory) =>
    setOpenCategories((open) =>
      open.includes(category)
        ? open.filter((item) => item !== category)
        : [...open, category],
    );

  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const hasAccessToken = Boolean(ctx.currentUserAccessToken);
  const phase: PagePhase = isProcessing
    ? 'running'
    : result
      ? 'results'
      : 'settings';

  let body: ReactNode;
  if (phase === 'running') {
    body = (
      <ProgressIndicator
        current={progress.current}
        total={progress.total}
        isLoading={progress.phase === 'loading'}
        currentAsset={progress.asset}
        isPreview={isPreviewing}
        isCancelling={isCancelling}
      />
    );
  } else if (result) {
    body = (
      <>
        <ResultsStats
          result={result}
          largeAssetThreshold={settings.largeAssetThreshold}
          isPreview={isPreviewing}
        />
        <AssetList
          result={result}
          isPreview={isPreviewing}
          openCategories={openCategories}
          onToggleCategory={toggleCategory}
          environmentPrefix={environmentPrefix}
        />
      </>
    );
  } else {
    body = (
      <>
        {!hasAccessToken && <AccessGroup />}
        <ScopeGroup
          collections={collections}
          collectionId={collectionId}
          loading={collectionsLoading}
          failed={collectionError}
          onChange={setCollectionId}
        />
        <SettingsForm
          settings={settings}
          onSettingsChange={setSettings}
          ctx={ctx}
        />
      </>
    );
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <Main className={s.page}>
        <Pane
          ariaLabel="Asset optimization"
          header={
            <PageToolbar
              phase={phase}
              isPreview={isPreviewing}
              isCancelling={isCancelling}
              hasAccessToken={hasAccessToken}
              onRestoreDefaults={restoreDefaults}
              onPreview={() => startRun(true)}
              onStart={() => startRun(false)}
              onCancel={cancel}
              onBackToSettings={resetState}
            />
          }
        >
          <Page variant="large">
            <Page.Content>
              {body}
              <ActivityLog log={logEntries} droppedLogCount={droppedLogCount} />
            </Page.Content>
          </Page>
        </Pane>
      </Main>
    </Canvas>
  );
};

export default function OptimizeAssetsPageInEnvironment({ ctx }: Props) {
  return (
    <OptimizeAssetsPage
      key={`${ctx.site.id}:${ctx.environment}:${ctx.cmaBaseUrl}`}
      ctx={ctx}
    />
  );
}

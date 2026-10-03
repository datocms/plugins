import { buildClient } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { useEffect, useRef, useState } from 'react';
import ActivityLog, {
  type LogEntry,
} from '../components/asset-optimization/ActivityLog';
import AssetList from '../components/asset-optimization/AssetList';
import ProgressIndicator from '../components/asset-optimization/ProgressIndicator';
import { ACTIVITY_LOG_LIMIT } from '../components/asset-optimization/presentation';
import ResultsStats from '../components/asset-optimization/ResultsStats';
import SettingsForm from '../components/asset-optimization/SettingsForm';
import {
  type OptimizationProgress,
  runAssetOptimization,
} from '../services/assetOptimizationService';
import { createBoundedCmaFetch } from '../utils/assetReplacer';
import { formatFileSize } from '../utils/formatters';
import {
  type AssetOptimizerResult,
  normalizeSettings,
  type OptimizationSettings,
} from '../utils/optimizationUtils';
import s from './styles.module.css';

type Props = { ctx: RenderPageCtx };

function readSettings(savedSettings: unknown): OptimizationSettings {
  try {
    return normalizeSettings(
      typeof savedSettings === 'string' ? JSON.parse(savedSettings) : undefined,
    );
  } catch {
    return normalizeSettings(undefined);
  }
}

const OptimizeAssetsPage = ({ ctx }: Props) => {
  const savedSettings = ctx.plugin.attributes.parameters.optimization_settings;
  const [settings, setSettings] = useState(() => readSettings(savedSettings));
  const [collections, setCollections] = useState<
    { value: string; label: string }[]
  >([]);
  const [collectionId, setCollectionId] = useState('');
  const [collectionError, setCollectionError] = useState(false);
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
  const [selectedCategory, setSelectedCategory] = useState<
    'optimized' | 'skipped' | 'failed' | null
  >(null);
  const controller = useRef<AbortController | null>(null);
  const runLocked = useRef(false);
  const mounted = useRef(true);
  const logBuffer = useRef<LogEntry[]>([]);
  const logCount = useRef(0);

  useEffect(() => {
    if (!ctx.currentUserAccessToken) return;
    let active = true;
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
      requestTimeout: 30_000,
      fetchFn: createBoundedCmaFetch(),
    });
    void client.uploadCollections
      .list()
      .then((items) => {
        if (active) {
          setCollectionError(false);
          setCollections(
            items.map((item) => ({ value: item.id, label: item.label })),
          );
        }
      })
      .catch(() => {
        if (active) setCollectionError(true);
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
    setSelectedCategory(null);
    setLogEntries([]);
    setDroppedLogCount(0);
    logBuffer.current = [];
    logCount.current = 0;
    setProgress({ phase: 'loading', current: 0, total: 0 });
  };

  const confirmOptimization = async () => {
    const confirmation = await ctx.openConfirm({
      title: 'Confirm Asset Optimization',
      content: `WARNING: This is a destructive action that will permanently replace matching assets ${collectionId ? `in the collection "${collections.find((item) => item.value === collectionId)?.label ?? collectionId}"` : 'in the entire environment'}. This action is non-reversible and original assets cannot be recovered once replaced. Are you sure you want to proceed?`,
      choices: [
        {
          label: 'Proceed to Final Confirmation',
          value: 'confirm',
          intent: 'positive',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    if (confirmation !== 'confirm') return false;
    const finalConfirmation = await ctx.openConfirm({
      title: 'Final Confirmation Required',
      content:
        'ARE YOU ABSOLUTELY SURE? This will immediately replace your original assets with optimized versions. Your original assets will be PERMANENTLY DELETED and CANNOT be recovered. This may affect the visual quality of your images if not configured correctly.\n\nWe STRONGLY RECOMMEND testing this first in a sandbox environment, so you can fine-tune the thresholds and optimization settings to your liking, make sure everything works with your project, and then promote the sandbox environment once you are satisfied with the results.',
      choices: [
        {
          label: 'Yes, Replace My Assets',
          value: 'confirm',
          intent: 'positive',
        },
      ],
      cancel: { label: 'No, Cancel Operation', value: false },
    });
    return finalConfirmation === 'confirm';
  };

  const reportResults = async (
    completed: AssetOptimizerResult,
    preview: boolean,
  ) => {
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
      await ctx.notice('Asset processing stopped. Review the partial results.');
    } else {
      await ctx.notice(
        completed.failed > 0
          ? 'Asset processing completed with failures. Review the failed assets.'
          : `Asset optimization ${preview ? 'preview' : 'process'} completed!`,
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
      autoRetry: false,
      requestTimeout: 30_000,
      fetchFn: createBoundedCmaFetch(),
    });
    addLog(`Starting asset optimization ${preview ? 'preview' : 'process'}...`);
    addLog(
      collectionId
        ? `Scope: collection "${collections.find((item) => item.value === collectionId)?.label ?? collectionId}" in environment ${ctx.environment}.`
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
    await reportResults(completed, preview);
  };

  const reportError = async (error: unknown) => {
    if (!mounted.current) return;
    const message = error instanceof Error ? error.message : String(error);
    addLog(`Error during asset processing: ${message}`);
    await ctx.alert(`Error during asset processing: ${message}`);
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

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={s.container}>
        <h1 className={s.title}>Asset Optimization</h1>
        {!isProcessing && !result && (
          <div className={s.settingsContainer}>
            <SelectField
              id="assetCollection"
              name="assetCollection"
              label="Asset collection"
              hint="Only matching images in this collection will be processed. Subcollections are excluded."
              value={[{ value: '', label: 'All assets' }, ...collections].find(
                (item) => item.value === collectionId,
              )}
              selectInputProps={{
                options: [{ value: '', label: 'All assets' }, ...collections],
              }}
              onChange={(value) => {
                if (value && !Array.isArray(value) && 'value' in value)
                  setCollectionId(value.value);
              }}
            />
            {collectionError && (
              <p role="status">
                Couldn't load asset collections. Reload to choose a collection.
              </p>
            )}
            <SettingsForm
              settings={settings}
              onSettingsChange={setSettings}
              onStartOptimization={() => startRun(false)}
              onPreviewOptimization={() => startRun(true)}
              ctx={ctx}
            />
          </div>
        )}
        <ProgressIndicator
          current={progress.current}
          total={progress.total}
          isVisible={isProcessing}
          isLoading={progress.phase === 'loading'}
          currentAsset={progress.asset}
          isPreview={isPreviewing}
          assetSizeCategory={
            settings.veryLargeAssetThreshold > 0
              ? 'large and very large'
              : 'large'
          }
        />
        {isProcessing && (
          <Button
            buttonType="negative"
            buttonSize="s"
            disabled={isCancelling}
            onClick={() => {
              setIsCancelling(true);
              controller.current?.abort();
            }}
          >
            {isCancelling
              ? 'Cancelling — finishing accepted replacements…'
              : 'Cancel'}
          </Button>
        )}
        {result && (
          <>
            <ResultsStats
              result={result}
              setSelectedCategory={setSelectedCategory}
              resetState={resetState}
              largeAssetThreshold={settings.largeAssetThreshold}
              isPreview={isPreviewing}
            />
            {selectedCategory && (
              <AssetList
                assets={
                  selectedCategory === 'optimized'
                    ? result.optimizedAssets
                    : selectedCategory === 'skipped'
                      ? result.skippedAssets
                      : result.failedAssets
                }
                category={selectedCategory}
                onClose={() => setSelectedCategory(null)}
                ctx={ctx}
              />
            )}
          </>
        )}
        <ActivityLog log={logEntries} droppedLogCount={droppedLogCount} />
      </div>
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

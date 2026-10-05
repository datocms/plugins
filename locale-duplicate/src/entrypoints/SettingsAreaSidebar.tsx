import { buildClient } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfigurationForm } from '../components/ConfigurationForm/ConfigurationForm';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  type ProgressUpdate,
  ProgressView,
} from '../components/ProgressView/ProgressView';
import { SummaryView } from '../components/SummaryView/SummaryView';
import { useDuplicationStats } from '../hooks/useDuplicationStats';
import type { DuplicationStats } from '../services/duplicationTypes';
import { LocaleDuplicationService } from '../services/LocaleDuplicationService';
import { getErrorMessage, type ModelOption } from '../types';
import { getLocaleLabel } from '../utils/localeHelpers';
import { ProgressLog } from '../utils/progressLog';

function completionNotice(stats: DuplicationStats): string {
  if (stats.cancelled) return 'Duplication process was aborted';
  const failed =
    stats.failedRecords + stats.failedPublications + stats.modelFailures;
  return failed > 0
    ? 'Locale duplication completed with errors. See the summary for confirmed results.'
    : 'Locale content duplicated successfully';
}

export default function SettingsAreaSidebar({ ctx }: { ctx: RenderPageCtx }) {
  const currentSiteLocales = ctx.site.attributes.locales;
  const [sourceLocale, setSourceLocale] = useState(currentSiteLocales[0] ?? '');
  const [targetLocale, setTargetLocale] = useState(
    currentSiteLocales[1] ?? currentSiteLocales[0] ?? '',
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [isAborting, setIsAborting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const {
    stats: duplicationStats,
    updateStats,
    reset: resetStats,
  } = useDuplicationStats();
  const abortProcessRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logRef = useRef(new ProgressLog());
  const pendingStatsRef = useRef<DuplicationStats | undefined>(undefined);
  const progressRef = useRef(0);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  const [useDraftRecords, setUseDraftRecords] = useState(true);
  const [publishAfterDuplication, setPublishAfterDuplication] = useState(false);
  const noticeRef = useRef(ctx.notice);
  noticeRef.current = ctx.notice;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortProcessRef.current = true;
      clearTimeout(timerRef.current);
    };
  }, []);

  const { currentUserAccessToken, environment, cmaBaseUrl } = ctx;
  useEffect(() => {
    let active = true;
    if (!currentUserAccessToken) {
      noticeRef.current(
        'CMA access is unavailable. Enable the currentUserAccessToken permission.',
      );
      return;
    }
    buildClient({
      apiToken: currentUserAccessToken,
      environment,
      baseUrl: cmaBaseUrl,
    })
      .itemTypes.list()
      .then((models) => {
        if (!active) return;
        const options = models
          .filter((model) => !model.modular_block)
          .map((model) => ({ label: model.name, value: model.id }));
        setAvailableModels(options);
        setSelectedModels(options);
      })
      .catch((error) => {
        if (active)
          noticeRef.current(`Error fetching models: ${getErrorMessage(error)}`);
      });
    return () => {
      active = false;
    };
  }, [currentUserAccessToken, environment, cmaBaseUrl]);

  const flushProgress = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (!mountedRef.current) return;
    setProgressUpdates(logRef.current.entries());
    setProgressPercentage(progressRef.current);
    if (pendingStatsRef.current) updateStats(pendingStatsRef.current);
  }, [updateStats]);

  const handleProgress = useCallback(
    (update: ProgressUpdate) => {
      logRef.current.add(update);
      if (update.stats) pendingStatsRef.current = update.stats;
      if (update.progress !== undefined) progressRef.current = update.progress;
      if (!timerRef.current && mountedRef.current)
        timerRef.current = setTimeout(flushProgress, 150);
    },
    [flushProgress],
  );

  const handleAbortProcess = useCallback(() => {
    ctx
      .openConfirm({
        title: 'Abort Process',
        content:
          'Are you sure you want to abort the duplication process? This will stop the operation but changes already made will remain.',
        choices: [
          { label: 'Yes, abort process', value: 'abort', intent: 'negative' },
        ],
        cancel: { label: 'No, continue', value: false },
      })
      .then((result) => {
        if (result !== 'abort' || !runningRef.current || !mountedRef.current)
          return;
        setIsAborting(true);
        abortProcessRef.current = true;
        handleProgress({
          message:
            'Aborting process... Please wait while current operations finish.',
          type: 'info',
          timestamp: Date.now(),
        });
      });
  }, [ctx, handleProgress]);

  const runDuplication = useCallback(async () => {
    if (runningRef.current || !mountedRef.current) return;
    runningRef.current = true;
    abortProcessRef.current = false;
    logRef.current = new ProgressLog();
    pendingStatsRef.current = undefined;
    progressRef.current = 0;
    setIsProcessing(true);
    setProgressUpdates([]);
    setProgressPercentage(0);
    setShowSummary(false);
    resetStats();
    try {
      const service = new LocaleDuplicationService(
        ctx.currentUserAccessToken ?? '',
        ctx.environment,
        ctx.cmaBaseUrl,
      );
      const result = await service.duplicateContent(
        {
          sourceLocale,
          targetLocale,
          selectedModelIds: selectedModels.map((model) => model.value),
          abortSignal: abortProcessRef,
          useDraftRecords,
          publishAfterDuplication,
        },
        handleProgress,
      );
      pendingStatsRef.current = result.stats;
      if (mountedRef.current) {
        ctx.notice(completionNotice(result.stats));
      }
    } catch (error) {
      handleProgress({
        message: `Error duplicating locale content: ${getErrorMessage(error)}`,
        type: 'error',
        timestamp: Date.now(),
      });
      if (mountedRef.current)
        ctx.notice(
          `Error duplicating locale content: ${getErrorMessage(error)}`,
        );
    } finally {
      flushProgress();
      runningRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
        setIsAborting(false);
        setShowSummary(true);
      }
    }
  }, [
    ctx,
    sourceLocale,
    targetLocale,
    selectedModels,
    useDraftRecords,
    publishAfterDuplication,
    handleProgress,
    flushProgress,
    resetStats,
  ]);

  const handleSubmit = useCallback(async () => {
    if (
      sourceLocale === targetLocale ||
      !selectedModels.length ||
      !currentSiteLocales.includes(sourceLocale) ||
      !currentSiteLocales.includes(targetLocale)
    ) {
      ctx.notice(
        'Choose two different available locales and at least one model',
      );
      return;
    }
    const first = await ctx.openConfirm({
      title: 'Duplicate locale content',
      content: 'Are you sure you want to duplicate the locale content?',
      choices: [{ label: 'Duplicate', value: 'duplicate', intent: 'positive' }],
      cancel: { label: 'Cancel', value: false },
    });
    if (first !== 'duplicate') return;
    const overwrite = await ctx.openConfirm({
      title: 'Confirm locale overwrite',
      content: `This will overwrite the content of the target locale (${getLocaleLabel(targetLocale)}) with the content of the source locale (${getLocaleLabel(sourceLocale)}).`,
      choices: [
        {
          label: `Overwrite everything in the ${getLocaleLabel(targetLocale)} locale`,
          value: 'overwrite',
          intent: 'negative',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    if (overwrite === 'overwrite') await runDuplication();
  }, [
    ctx,
    sourceLocale,
    targetLocale,
    currentSiteLocales,
    selectedModels.length,
    runDuplication,
  ]);

  const handleReset = useCallback(() => {
    setShowSummary(false);
    setProgressUpdates([]);
    logRef.current = new ProgressLog();
    resetStats();
  }, [resetStats]);

  return (
    <ErrorBoundary ctx={ctx}>
      <Canvas ctx={ctx}>
        {!isProcessing && !showSummary && (
          <ConfigurationForm
            sourceLocale={sourceLocale}
            targetLocale={targetLocale}
            currentSiteLocales={currentSiteLocales}
            selectedModels={selectedModels}
            allModels={availableModels}
            useDraftRecords={useDraftRecords}
            publishAfterDuplication={publishAfterDuplication}
            getLocaleLabel={getLocaleLabel}
            onSourceLocaleChange={setSourceLocale}
            onTargetLocaleChange={setTargetLocale}
            onModelsChange={setSelectedModels}
            onUseDraftRecordsChange={setUseDraftRecords}
            onPublishAfterDuplicationChange={setPublishAfterDuplication}
            onSubmit={handleSubmit}
          />
        )}
        {isProcessing && (
          <ProgressView
            ctx={ctx}
            progressUpdates={progressUpdates}
            progressPercentage={progressPercentage}
            operationCount={logRef.current.total}
            isAborting={isAborting}
            sourceLocale={sourceLocale}
            targetLocale={targetLocale}
            getLocaleLabel={getLocaleLabel}
            onAbort={handleAbortProcess}
          />
        )}
        {showSummary && (
          <SummaryView
            duplicationStats={duplicationStats}
            progressUpdates={progressUpdates}
            errorUpdates={logRef.current.errors}
            errorCount={logRef.current.totalErrors}
            operationCount={logRef.current.total}
            onReturn={handleReset}
          />
        )}
      </Canvas>
    </ErrorBoundary>
  );
}

import { buildClient } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ConfigurationForm,
  type ModelsState,
} from '../components/ConfigurationForm/ConfigurationForm';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  type ProgressUpdate,
  ProgressView,
} from '../components/ProgressView/ProgressView';
import { pageTitle } from '../components/pageTitle';
import { SummaryView } from '../components/SummaryView/SummaryView';
import { useDuplicationStats } from '../hooks/useDuplicationStats';
import { CircleExclamationIcon } from '../icons';
import type { DuplicationStats } from '../services/duplicationTypes';
import { LocaleDuplicationService } from '../services/LocaleDuplicationService';
import { getErrorMessage, type ModelOption } from '../types';
import { formatters } from '../utils/format';
import { getLocaleLabel } from '../utils/localeHelpers';
import { ProgressLog } from '../utils/progressLog';
import s from './SettingsAreaSidebar.module.css';

function completionNotice(ctx: RenderPageCtx, stats: DuplicationStats) {
  if (stats.cancelled) {
    return ctx.customToast({
      type: 'warning',
      message: 'Duplication stopped.',
      dismissAfterTimeout: true,
    });
  }
  const failed =
    stats.failedRecords + stats.failedPublications + stats.modelFailures;
  return failed > 0
    ? ctx.alert(
        'Duplication finished with errors. See the summary for the details.',
      )
    : ctx.notice('Locale content duplicated.');
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
  const [modelsState, setModelsState] = useState<ModelsState>('loading');
  const [modelsError, setModelsError] = useState('');
  const [useDraftRecords, setUseDraftRecords] = useState(true);
  const [publishAfterDuplication, setPublishAfterDuplication] = useState(false);
  const format = formatters(ctx.ui.locale);

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
    if (!currentUserAccessToken) return;
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
        setModelsState('loaded');
      })
      .catch((error) => {
        if (!active) return;
        console.error('Error fetching models:', error);
        setModelsError(getErrorMessage(error));
        setModelsState('failed');
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
        title: 'Stop the duplication?',
        content: 'Records that are already updated keep the new content.',
        choices: [{ label: 'Stop', value: 'abort', intent: 'negative' }],
        cancel: { label: 'Keep going', value: false },
      })
      .then((result) => {
        if (result !== 'abort' || !runningRef.current || !mountedRef.current)
          return;
        setIsAborting(true);
        abortProcessRef.current = true;
        handleProgress({
          message: 'Stopping. The operations in progress finish first.',
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
        completionNotice(ctx, result.stats);
      }
    } catch (error) {
      const message = `Couldn't duplicate the locale content: ${getErrorMessage(error)}`;
      handleProgress({ message, type: 'error', timestamp: Date.now() });
      if (mountedRef.current) ctx.alert(message);
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
      ctx.alert('Pick two different locales and at least one model.');
      return;
    }
    const source = getLocaleLabel(sourceLocale);
    const target = getLocaleLabel(targetLocale);
    const first = await ctx.openConfirm({
      title: 'Duplicate locale content?',
      content: `Copies the ${source} content to ${target} in the records of ${format.models(selectedModels.length)}.`,
      choices: [{ label: 'Duplicate', value: 'duplicate', intent: 'positive' }],
      cancel: { label: 'Cancel', value: false },
    });
    if (first !== 'duplicate') return;
    const overwrite = await ctx.openConfirm({
      title: `Overwrite ${target}?`,
      content: `The current ${target} content is replaced with the ${source} content. This can't be undone.`,
      choices: [
        {
          label: `Overwrite ${target}`,
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
    format,
    runDuplication,
  ]);

  const handleReset = useCallback(() => {
    setShowSummary(false);
    setProgressUpdates([]);
    logRef.current = new ProgressLog();
    resetStats();
  }, [resetStats]);

  let phase: ReactNode;
  if (!currentUserAccessToken) {
    phase = (
      <Pane header={<Pane.Header>{pageTitle}</Pane.Header>}>
        <BlankSlate
          placement="area"
          error
          icon={<CircleExclamationIcon />}
          title="No access to your API token"
          description="Mass duplication needs the plugin's access to your API token. Check the plugin's permissions."
        />
      </Pane>
    );
  } else if (isProcessing) {
    phase = (
      <ProgressView
        progressUpdates={progressUpdates}
        progressPercentage={progressPercentage}
        operationCount={logRef.current.total}
        isAborting={isAborting}
        sourceLocale={sourceLocale}
        targetLocale={targetLocale}
        format={format}
        getLocaleLabel={getLocaleLabel}
        onAbort={handleAbortProcess}
      />
    );
  } else if (showSummary) {
    phase = (
      <SummaryView
        duplicationStats={duplicationStats}
        progressUpdates={progressUpdates}
        errorUpdates={logRef.current.errors}
        errorCount={logRef.current.totalErrors}
        operationCount={logRef.current.total}
        format={format}
        onReturn={handleReset}
      />
    );
  } else {
    phase = (
      <ConfigurationForm
        sourceLocale={sourceLocale}
        targetLocale={targetLocale}
        currentSiteLocales={currentSiteLocales}
        selectedModels={selectedModels}
        allModels={availableModels}
        modelsState={modelsState}
        modelsError={modelsError}
        useDraftRecords={useDraftRecords}
        publishAfterDuplication={publishAfterDuplication}
        format={format}
        getLocaleLabel={getLocaleLabel}
        onSourceLocaleChange={setSourceLocale}
        onTargetLocaleChange={setTargetLocale}
        onModelsChange={setSelectedModels}
        onUseDraftRecordsChange={setUseDraftRecords}
        onPublishAfterDuplicationChange={setPublishAfterDuplication}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <ErrorBoundary>
        <Main className={s.layout}>{phase}</Main>
      </ErrorBoundary>
    </Canvas>
  );
}

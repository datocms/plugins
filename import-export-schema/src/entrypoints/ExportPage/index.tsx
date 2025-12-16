import type { SchemaTypes } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useState } from 'react';
import { ProgressOverlay } from '@/components/ProgressOverlay';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useSchemaExportTask } from '@/shared/hooks/useSchemaExportTask';
import { useLongTask } from '@/shared/tasks/useLongTask';
import { debugLog } from '@/utils/debug';
import Inner from './Inner';

type Props = {
  ctx: RenderPageCtx;
  initialItemTypeId: string;
};

type PreparingPhase = 'scan' | 'build';

type PrepareProgressUpdate = {
  done: number;
  total: number;
  label: string;
  phase?: PreparingPhase;
};

const INITIAL_PREPARING_PERCENT = 0.1;
const PREPARING_HEARTBEAT_CAP = 0.88;
const PREPARING_HEARTBEAT_INCREMENT = 0.015;
const PREPARING_HEARTBEAT_INTERVAL_MS = 250;

const PREPARING_PHASE_CONFIG: Record<
  PreparingPhase,
  {
    range: { min: number; max: number };
    cap: number;
  }
> = {
  scan: { range: { min: 0.05, max: 0.85 }, cap: PREPARING_HEARTBEAT_CAP },
  build: { range: { min: 0.85, max: 1 }, cap: 1 },
};

// Clamp helper keeps derived percentages inside their designated bounds.
function clamp(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Map a phase-specific progress update into the smoothed overlay percentage.
 */
function mapPreparingProgressPercent(
  phase: PreparingPhase,
  done: number | undefined,
  total: number | undefined,
  previous: number,
) {
  if (typeof done !== 'number' || typeof total !== 'number' || total <= 0) {
    return previous;
  }

  const config = PREPARING_PHASE_CONFIG[phase];
  const safeDone = clamp(done, 0, total);
  const normalized = clamp(safeDone / total, 0, 1);
  const { range, cap } = config;
  const mapped = range.min + normalized * (range.max - range.min);

  return Math.max(previous, clamp(mapped, range.min, cap));
}

/**
 * Export entry loaded from the DatoCMS sidebar when a single model kicks off the flow.
 * Fetches schema resources, shows progress overlays, and renders the main graph view.
 */
export default function ExportPage({ ctx, initialItemTypeId }: Props) {
  const schema = useProjectSchema(ctx);

  const [initialItemType, setInitialItemType] = useState<
    SchemaTypes.ItemType | undefined
  >();
  const [suppressPreparingOverlay, setSuppressPreparingOverlay] =
    useState(false);
  const [preparingPhase, setPreparingPhase] = useState<PreparingPhase>('scan');
  const preparingTask = useLongTask();
  const { task: exportTask, runExport } = useSchemaExportTask({
    schema,
    ctx,
  });

  const preparingProgress = preparingTask.state.progress;
  const exportProgress = exportTask.state.progress;

  const preparingHasTotals =
    typeof preparingProgress.total === 'number' && preparingProgress.total > 0;
  const isPreparingRunning = preparingTask.state.status === 'running';
  const shouldShowPreparingOverlay =
    isPreparingRunning && !suppressPreparingOverlay;
  // Smoothed visual progress percentage for the preparing overlay.
  // We map the initial scanning phase to 0–25%, then determinate build to 25–100%.
  const [preparingPercent, setPreparingPercent] = useState(
    INITIAL_PREPARING_PERCENT,
  );

  // Heartbeat fallback: gently move during scan if no numeric totals arrive
  useEffect(() => {
    const heartbeatActive =
      shouldShowPreparingOverlay &&
      preparingPhase === 'scan' &&
      !preparingHasTotals;
    if (!heartbeatActive) {
      return;
    }

    const id = window.setInterval(() => {
      setPreparingPercent((prev) =>
        Math.min(PREPARING_HEARTBEAT_CAP, prev + PREPARING_HEARTBEAT_INCREMENT),
      );
    }, PREPARING_HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [preparingPhase, preparingHasTotals, shouldShowPreparingOverlay]);

  // Preload installed plugin IDs once to avoid network calls during selection
  const [installedPluginIds, setInstalledPluginIds] = useState<
    Set<string> | undefined
  >();
  // Pre-fetch plugin IDs so dependency expansion can quickly filter installed extensions.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const plugins = await schema.getAllPlugins();
        if (active) setInstalledPluginIds(new Set(plugins.map((p) => p.id)));
      } catch (_) {
        // ignore; selection will just skip plugin dependencies when unknown
      }
    })();
    return () => {
      active = false;
    };
  }, [schema]);

  const [lastPreparedForId, setLastPreparedForId] = useState<
    string | undefined
  >(undefined);
  // Kick off the initial graph build the first time we enter for a content model.
  useEffect(() => {
    let active = true;

    async function ensureInitialItemType() {
      try {
        const itemType = await schema.getItemTypeById(initialItemTypeId);
        if (!active) return;

        setInitialItemType(itemType);

        if (lastPreparedForId === initialItemTypeId) {
          return;
        }

        debugLog('ExportPage preparing start', { initialItemTypeId });
        preparingTask.controller.start({ label: 'Preparing export…' });
        setPreparingPhase('scan');
        setPreparingPercent(INITIAL_PREPARING_PERCENT);
        setLastPreparedForId(initialItemTypeId);
      } catch (error) {
        if (active) {
          debugLog('ExportPage failed to load initial item type', error);
        }
      }
    }

    ensureInitialItemType();

    return () => {
      active = false;
    };
  }, [schema, initialItemTypeId, lastPreparedForId, preparingTask.controller]);

  const handlePrepareProgress = useCallback(
    (progress: PrepareProgressUpdate) => {
      if (preparingTask.state.status !== 'running') {
        preparingTask.controller.start(progress);
      } else {
        preparingTask.controller.setProgress(progress);
      }

      const phase = progress.phase ?? 'scan';
      setPreparingPhase(phase);
      setPreparingPercent((prev) =>
        mapPreparingProgressPercent(phase, progress.done, progress.total, prev),
      );
    },
    [preparingTask.controller, preparingTask.state.status],
  );

  const handleGraphPrepared = useCallback(() => {
    debugLog('ExportPage graph prepared');
    setPreparingPercent(1);
    preparingTask.controller.complete({ label: 'Graph prepared' });
    setSuppressPreparingOverlay(false);
    setPreparingPhase('build');
  }, [preparingTask.controller]);

  const handleExport = useCallback(
    (itemTypeIds: string[], pluginIds: string[]) =>
      runExport({
        rootItemTypeId: initialItemTypeId,
        itemTypeIds,
        pluginIds,
      }),
    [initialItemTypeId, runExport],
  );

  // Hide the preparing overlay while dependency batches recompute to avoid flicker.
  const handleSelectingDependenciesChange = useCallback((busy: boolean) => {
    if (busy) {
      setSuppressPreparingOverlay(true);
    }
  }, []);

  if (!initialItemType) {
    return (
      <div className="page">
        <div className="page__content">
          <Spinner size={60} placement="centered" />
        </div>
      </div>
    );
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <ReactFlowProvider>
        <Inner
          key={initialItemTypeId}
          initialItemTypes={[initialItemType]}
          schema={schema}
          onExport={handleExport}
          onPrepareProgress={handlePrepareProgress}
          onGraphPrepared={handleGraphPrepared}
          installedPluginIds={installedPluginIds}
          onSelectingDependenciesChange={handleSelectingDependenciesChange}
        />
      </ReactFlowProvider>
      {shouldShowPreparingOverlay && (
        <ProgressOverlay
          title="Preparing export"
          subtitle="Sit tight, we’re setting up your models, blocks, and plugins…"
          ariaLabel="Preparing export"
          progress={{
            label: preparingProgress.label ?? 'Preparing export…',
            done: preparingProgress.done,
            total: preparingProgress.total,
            percentOverride: preparingPercent,
          }}
          stallCurrent={preparingProgress.done}
        />
      )}
      {exportTask.state.status === 'running' && (
        <ProgressOverlay
          title="Exporting selection"
          subtitle="Sit tight, we’re gathering models, blocks, and plugins…"
          ariaLabel="Export in progress"
          progress={{
            label: exportProgress.label ?? 'Preparing export…',
            done: exportProgress.done,
            total: exportProgress.total,
          }}
          stallCurrent={exportProgress.done}
          cancel={{
            label: 'Cancel export',
            intent: exportTask.state.cancelRequested ? 'muted' : 'negative',
            disabled: exportTask.state.cancelRequested,
            onCancel: () => exportTask.controller.requestCancel(),
          }}
        />
      )}
    </Canvas>
  );
}

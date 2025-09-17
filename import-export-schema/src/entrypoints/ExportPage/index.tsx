import type { SchemaTypes } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useState } from 'react';
import { ProgressOverlay } from '@/components/ProgressOverlay';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useLongTask } from '@/shared/tasks/useLongTask';
import { downloadJSON } from '@/utils/downloadJson';
import buildExportDoc from './buildExportDoc';
import Inner from './Inner';

type Props = {
  ctx: RenderPageCtx;
  initialItemTypeId: string;
};

export default function ExportPage({ ctx, initialItemTypeId }: Props) {
  const schema = useProjectSchema(ctx);

  const [initialItemType, setInitialItemType] = useState<
    SchemaTypes.ItemType | undefined
  >();
  const [suppressPreparingOverlay, setSuppressPreparingOverlay] =
    useState(false);
  const [preparingPhase, setPreparingPhase] = useState<'scan' | 'build'>('scan');
  const preparingTask = useLongTask();
  const exportTask = useLongTask();

  const preparingProgress = preparingTask.state.progress;
  const exportProgress = exportTask.state.progress;

  const preparingHasTotals =
    typeof preparingProgress.total === 'number' &&
    preparingProgress.total > 0;
  // Smoothed visual progress percentage for the preparing overlay.
  // We map the initial scanning phase to 0–25%, then determinate build to 25–100%.
  const [preparingPercent, setPreparingPercent] = useState(0.1);

  // Heartbeat fallback: gently move during scan if no numeric totals arrive
  useEffect(() => {
    if (preparingTask.state.status !== 'running' || suppressPreparingOverlay) {
      return;
    }
    if (preparingPhase !== 'scan') return;
    const id = window.setInterval(() => {
      if (!preparingHasTotals) {
        setPreparingPercent((prev) => Math.min(0.88, prev + 0.015));
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [
    preparingTask.state.status,
    preparingPhase,
    preparingHasTotals,
    suppressPreparingOverlay,
  ]);

  // Removed adminDomain lookup; we no longer show a post-export overview

  // Preload installed plugin IDs once to avoid network calls during selection
  const [installedPluginIds, setInstalledPluginIds] = useState<
    Set<string> | undefined
  >();
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
  useEffect(() => {
    async function run() {
      const itemType = await schema.getItemTypeById(initialItemTypeId);
      setInitialItemType(itemType);
      if (lastPreparedForId !== initialItemTypeId) {
        try {
          if (
            typeof window !== 'undefined' &&
            window.localStorage?.getItem('schemaDebug') === '1'
          ) {
            console.log(
              `[ExportPage] preparingBusy -> true (init); initialItemTypeId=${initialItemTypeId}`,
            );
          }
        } catch {}
        preparingTask.controller.start({
          label: 'Preparing export…',
        });
        setPreparingPhase('scan');
        setPreparingPercent(0.1);
        setLastPreparedForId(initialItemTypeId);
      }
    }

    run();
  }, [schema, initialItemTypeId, lastPreparedForId, preparingTask]);

  async function handleExport(itemTypeIds: string[], pluginIds: string[]) {
    try {
      // Initialize progress bar
      const total = pluginIds.length + itemTypeIds.length * 2;
      exportTask.controller.start({
        done: 0,
        total,
        label: 'Preparing export…',
      });
      let done = 0;

      const exportDoc = await buildExportDoc(
        schema,
        initialItemTypeId,
        itemTypeIds,
        pluginIds,
        {
          onProgress: (label: string) => {
            done += 1;
            exportTask.controller.setProgress({ done, total, label });
          },
          shouldCancel: () => exportTask.controller.isCancelRequested(),
        },
      );

      if (exportTask.controller.isCancelRequested()) {
        throw new Error('Export cancelled');
      }

      downloadJSON(exportDoc, { fileName: 'export.json', prettify: true });
      exportTask.controller.complete({
        done: total,
        total,
        label: 'Export completed',
      });
      ctx.notice('Export completed successfully.');
    } catch (e) {
      console.error('Export failed', e);
      if (e instanceof Error && e.message === 'Export cancelled') {
        exportTask.controller.complete({ label: 'Export cancelled' });
        ctx.notice('Export canceled');
      } else {
        exportTask.controller.fail(e);
        ctx.alert('Could not complete the export. Please try again.');
      }
    } finally {
      exportTask.controller.reset();
    }
  }

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
            onPrepareProgress={(p) => {
              if (preparingTask.state.status !== 'running') {
                preparingTask.controller.start(p);
              } else {
                preparingTask.controller.setProgress(p);
              }
              setPreparingPhase(p.phase ?? 'scan');
              const phase = p.phase ?? 'scan';
              const hasTotals = (p.total ?? 0) > 0;
              if (phase === 'scan') {
                if (hasTotals) {
                  const raw = Math.max(0, Math.min(1, p.done / p.total));
                  // Map scan to [0.05, 0.85]; keep monotonic
                  const mapped = 0.05 + raw * 0.8;
                  setPreparingPercent((prev) =>
                    Math.max(prev, Math.min(0.88, mapped)),
                  );
                }
                // else: heartbeat drives percent
              } else {
                if (hasTotals) {
                  const raw = Math.max(0, Math.min(1, p.done / p.total));
                  // Map build to [0.85, 1.00]; keep monotonic
                  const mapped = 0.85 + raw * 0.15;
                  setPreparingPercent((prev) =>
                    Math.max(prev, Math.min(1, mapped)),
                  );
                }
              }
            }}
            onGraphPrepared={() => {
              try {
                if (
                  typeof window !== 'undefined' &&
                  window.localStorage?.getItem('schemaDebug') === '1'
                ) {
                  console.log(
                    '[ExportPage] onGraphPrepared -> preparingBusy false',
                  );
                }
              } catch {}
              setPreparingPercent(1);
              preparingTask.controller.complete({
                label: 'Graph prepared',
              });
              setSuppressPreparingOverlay(false);
              setPreparingPhase('build');
            }}
            installedPluginIds={installedPluginIds}
            onSelectingDependenciesChange={(busy) => {
              // Hide overlay during dependency expansion; release when graph is prepared
              if (busy) {
                setSuppressPreparingOverlay(true);
              }
            }}
          />
      </ReactFlowProvider>
      {preparingTask.state.status === 'running' && !suppressPreparingOverlay && (
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

import type { SchemaTypes } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import ProgressStallNotice from '@/components/ProgressStallNotice';
import { createCmaClient } from '@/utils/createCmaClient';
import { downloadJSON } from '@/utils/downloadJson';
import { ProjectSchema } from '@/utils/ProjectSchema';
import buildExportDoc from './buildExportDoc';
import Inner from './Inner';

type Props = {
  ctx: RenderPageCtx;
  initialItemTypeId: string;
};

export default function ExportPage({ ctx, initialItemTypeId }: Props) {
  const client = useMemo(
    () => createCmaClient(ctx),
    [ctx.currentUserAccessToken, ctx.environment],
  );

  const [initialItemType, setInitialItemType] = useState<
    SchemaTypes.ItemType | undefined
  >();
  const [preparingBusy, setPreparingBusy] = useState(true);
  const [suppressPreparingOverlay, setSuppressPreparingOverlay] =
    useState(false);
  const [preparingProgress, setPreparingProgress] = useState<
    | { done: number; total: number; label: string; phase?: 'scan' | 'build' }
    | undefined
  >(undefined);
  // Smoothed visual progress percentage for the preparing overlay.
  // We map the initial scanning phase to 0–25%, then determinate build to 25–100%.
  const [preparingPercent, setPreparingPercent] = useState(0.1);

  // Heartbeat fallback: gently move during scan if no numeric totals arrive
  useEffect(() => {
    if (!preparingBusy || suppressPreparingOverlay) return;
    const phase = preparingProgress?.phase ?? 'scan';
    if (phase !== 'scan') return;
    const id = window.setInterval(() => {
      // Only drift if totals are not provided
      if (!preparingProgress || (preparingProgress.total ?? 0) === 0) {
        setPreparingPercent((prev) => Math.min(0.88, prev + 0.015));
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [preparingBusy, suppressPreparingOverlay, preparingProgress]);

  const schema = useMemo(() => new ProjectSchema(client), [client]);

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
        setPreparingBusy(true);
        setPreparingProgress(undefined);
        setPreparingPercent(0.1);
        setLastPreparedForId(initialItemTypeId);
      }
    }

    run();
  }, [schema, initialItemTypeId, lastPreparedForId]);

  // Progress overlay state for selection export
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<
    | {
        done: number;
        total: number;
        label: string;
      }
    | undefined
  >();
  const [exportCancelled, setExportCancelled] = useState(false);
  const exportCancelRef = useRef(false);

  async function handleExport(itemTypeIds: string[], pluginIds: string[]) {
    try {
      setExportBusy(true);
      setExportProgress(undefined);
      setExportCancelled(false);
      exportCancelRef.current = false;

      // Initialize progress bar
      const total = pluginIds.length + itemTypeIds.length * 2;
      setExportProgress({ done: 0, total, label: 'Preparing export…' });
      let done = 0;

      const exportDoc = await buildExportDoc(
        schema,
        initialItemTypeId,
        itemTypeIds,
        pluginIds,
        {
          onProgress: (label: string) => {
            done += 1;
            setExportProgress({ done, total, label });
          },
          shouldCancel: () => exportCancelRef.current,
        },
      );

      if (exportCancelRef.current) {
        throw new Error('Export cancelled');
      }

      downloadJSON(exportDoc, { fileName: 'export.json', prettify: true });
      ctx.notice('Export completed successfully.');
    } catch (e) {
      console.error('Export failed', e);
      if (e instanceof Error && e.message === 'Export cancelled') {
        ctx.notice('Export canceled');
      } else {
        ctx.alert('Could not complete the export. Please try again.');
      }
    } finally {
      setExportBusy(false);
      setExportProgress(undefined);
      setExportCancelled(false);
      exportCancelRef.current = false;
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
              setPreparingProgress(p);
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
              setPreparingBusy(false);
              setSuppressPreparingOverlay(false);
            }}
            installedPluginIds={installedPluginIds}
            onSelectingDependenciesChange={(busy) => {
              // Hide overlay during dependency expansion; release when graph is prepared
              if (busy) {
                setSuppressPreparingOverlay(true);
                setPreparingBusy(false);
              }
            }}
          />
      </ReactFlowProvider>
      {preparingBusy && !suppressPreparingOverlay && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(250,252,255,0.96), rgba(245,247,255,0.96))',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 16,
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Preparing export"
        >
          <div className="export-overlay__card">
            <div className="export-overlay__title">Preparing export</div>
            <div className="export-overlay__subtitle">
              Sit tight, we’re setting up your models, blocks, and plugins…
            </div>

            <div
              className="export-overlay__bar"
              role="progressbar"
              aria-label="Preparing"
              aria-valuemin={0}
              aria-valuemax={
                preparingProgress && (preparingProgress.total ?? 0) > 0
                  ? preparingProgress.total
                  : undefined
              }
              aria-valuenow={
                preparingProgress && (preparingProgress.total ?? 0) > 0
                  ? preparingProgress.done
                  : undefined
              }
            >
              <div
                className="export-overlay__bar__fill"
                style={{ width: `${Math.round(preparingPercent * 100)}%` }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {preparingProgress
                  ? preparingProgress.label
                  : 'Preparing export…'}
              </div>
              <div>
                {preparingProgress && (preparingProgress.total ?? 0) > 0
                  ? `${preparingProgress.done} / ${preparingProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={preparingProgress?.done} />
          </div>
        </div>
      )}
      {exportBusy && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(250,252,255,0.96), rgba(245,247,255,0.96))',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 16,
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Export in progress"
        >
          <div className="export-overlay__card">
            <div className="export-overlay__title">Exporting selection</div>
            <div className="export-overlay__subtitle">
              Sit tight, we’re gathering models, blocks, and plugins…
            </div>

            <div
              className="export-overlay__bar"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={exportProgress?.total}
              aria-valuenow={exportProgress?.done}
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: exportProgress
                    ? `${(exportProgress.done / exportProgress.total) * 100}%`
                    : '10%',
                }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {exportProgress ? exportProgress.label : 'Preparing export…'}
              </div>
              <div>
                {exportProgress
                  ? `${exportProgress.done} / ${exportProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={exportProgress?.done} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <Button
                buttonSize="s"
                buttonType={exportCancelled ? 'muted' : 'negative'}
                disabled={exportCancelled}
                onClick={() => {
                  setExportCancelled(true);
                  exportCancelRef.current = true;
                  // Keep overlay visible to show cancellation progress
                }}
              >
                Cancel export
              </Button>
            </div>
          </div>
        </div>
      )}
    </Canvas>
  );
}

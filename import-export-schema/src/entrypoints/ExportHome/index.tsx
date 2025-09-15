import type { SchemaTypes } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GroupBase } from 'react-select';
import ProgressStallNotice from '@/components/ProgressStallNotice';
import { createCmaClient } from '@/utils/createCmaClient';
import { downloadJSON } from '@/utils/downloadJson';
import { ProjectSchema } from '@/utils/ProjectSchema';
import buildExportDoc from '../ExportPage/buildExportDoc';
import ExportInner from '../ExportPage/Inner';

type Props = {
  ctx: RenderPageCtx;
};

export default function ExportHome({ ctx }: Props) {
  const exportInitialSelectId = useId();
  const client = useMemo(
    () => createCmaClient(ctx),
    [ctx.currentUserAccessToken, ctx.environment],
  );

  const projectSchema = useMemo(() => new ProjectSchema(client), [client]);

  // adminDomain and post-export overview removed; we download and toast only

  const [allItemTypes, setAllItemTypes] = useState<
    SchemaTypes.ItemType[] | undefined
  >(undefined);
  useEffect(() => {
    async function load() {
      const types = await projectSchema.getAllItemTypes();
      setAllItemTypes(types);
    }
    load();
  }, [projectSchema]);

  const [exportInitialItemTypeIds, setExportInitialItemTypeIds] = useState<
    string[]
  >([]);
  const [exportInitialItemTypes, setExportInitialItemTypes] = useState<
    SchemaTypes.ItemType[]
  >([]);
  useEffect(() => {
    async function resolveInitial() {
      if (!exportInitialItemTypeIds.length) {
        setExportInitialItemTypes([]);
        return;
      }
      const list: SchemaTypes.ItemType[] = [];
      for (const id of exportInitialItemTypeIds) {
        list.push(await projectSchema.getItemTypeById(id));
      }
      setExportInitialItemTypes(list);
    }
    resolveInitial();
    // using join to keep deps simple
  }, [exportInitialItemTypeIds.join('-'), projectSchema]);

  const [exportStarted, setExportStarted] = useState(false);

  const [exportAllBusy, setExportAllBusy] = useState(false);
  const [exportAllProgress, setExportAllProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);
  const [exportAllCancelled, setExportAllCancelled] = useState(false);
  const exportAllCancelRef = useRef(false);

  const [exportPreparingBusy, setExportPreparingBusy] = useState(false);
  const [exportPreparingProgress, setExportPreparingProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);
  // Smoothed percent for preparing overlay to avoid jitter and changing max
  const [exportPreparingPercent, setExportPreparingPercent] = useState(0.1);

  const [exportSelectionBusy, setExportSelectionBusy] = useState(false);
  const [exportSelectionProgress, setExportSelectionProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);
  const [exportSelectionCancelled, setExportSelectionCancelled] =
    useState(false);
  const exportSelectionCancelRef = useRef(false);

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          <div className="page__content">
            <div className="blank-slate">
              {!exportStarted ? (
                <div className="blank-slate__body">
                  <div className="blank-slate__body__title">
                    Start a new export
                  </div>
                  <div className="blank-slate__body__content">
                    <p>
                      Select one or more models/blocks to start selecting what
                      to export.
                    </p>
                    <div className="export-selector">
                      <div className="export-selector__field">
                        <SelectField<
                          { label: string; value: string },
                          true,
                          GroupBase<{ label: string; value: string }>
                        >
                          id={exportInitialSelectId}
                          name="export-initial-model"
                          label="Starting models/blocks"
                          selectInputProps={{
                            isMulti: true,
                            isClearable: true,
                            isDisabled: !allItemTypes,
                            options:
                              allItemTypes?.map((it) => ({
                                value: it.id,
                                label: `${it.attributes.name}${it.attributes.modular_block ? ' (Block)' : ''}`,
                              })) ?? [],
                            placeholder: 'Choose models/blocks…',
                          }}
                          value={
                            allItemTypes
                              ? allItemTypes
                                  .map((it) => ({
                                    value: it.id,
                                    label: `${it.attributes.name}${it.attributes.modular_block ? ' (Block)' : ''}`,
                                  }))
                                  .filter((opt) =>
                                    exportInitialItemTypeIds.includes(
                                      opt.value,
                                    ),
                                  )
                              : []
                          }
                          onChange={(options) =>
                            setExportInitialItemTypeIds(
                              Array.isArray(options)
                                ? options.map((o) => o.value)
                                : [],
                            )
                          }
                        />
                      </div>
                      <div className="export-selector__actions">
                        <Button
                          buttonSize="s"
                          onClick={() => {
                            if (!allItemTypes) return;
                            setExportInitialItemTypeIds(
                              allItemTypes
                                .filter((it) => !it.attributes.modular_block)
                                .map((it) => it.id),
                            );
                          }}
                        >
                          Select all models
                        </Button>
                        <Button
                          buttonSize="s"
                          onClick={() => {
                            if (!allItemTypes) return;
                            setExportInitialItemTypeIds(
                              allItemTypes
                                .filter((it) => it.attributes.modular_block)
                                .map((it) => it.id),
                            );
                          }}
                        >
                          Select all blocks
                        </Button>
                      </div>
                      <div className="export-selector__cta">
                        <Button
                          buttonType="primary"
                          disabled={exportInitialItemTypeIds.length === 0}
                          onClick={() => {
                            setExportPreparingBusy(true);
                            setExportPreparingProgress(undefined);
                            setExportPreparingPercent(0.1);
                            setExportStarted(true);
                          }}
                        >
                          Start export
                        </Button>
                      </div>
                      <div className="export-selector__cta">
                        <Button
                          buttonSize="s"
                          buttonType="muted"
                          fullWidth
                          disabled={exportAllBusy}
                          onClick={async () => {
                            try {
                              const confirmation = await ctx.openConfirm({
                                title: 'Export entire current schema?',
                                content:
                                  'This will export all models, block models, and plugins in the current environment as a single JSON file.',
                                choices: [
                                  {
                                    label: 'Export everything',
                                    value: 'export',
                                    intent: 'positive',
                                  },
                                ],
                                cancel: { label: 'Cancel', value: false },
                              });
                              if (confirmation !== 'export') {
                                return;
                              }

                              setExportAllBusy(true);
                              setExportAllProgress(undefined);
                              setExportAllCancelled(false);
                              exportAllCancelRef.current = false;
                              // One-click export current schema: all item types + plugins
                              const allTypes =
                                await projectSchema.getAllItemTypes();
                              const allPlugins =
                                await projectSchema.getAllPlugins();
                              if (!allTypes.length) {
                                ctx.alert(
                                  'No item types found in this environment.',
                                );
                                return;
                              }
                              // Prefer a non-block model as root when present
                              const preferredRoot =
                                allTypes.find(
                                  (t) => !t.attributes.modular_block,
                                ) || allTypes[0];
                              // Initialize progress bar now that we know counts
                              const total =
                                allPlugins.length + allTypes.length * 2;
                              setExportAllProgress({
                                done: 0,
                                total,
                                label: 'Preparing export…',
                              });
                              let done = 0;
                              const exportDoc = await buildExportDoc(
                                projectSchema,
                                preferredRoot.id,
                                allTypes.map((t) => t.id),
                                allPlugins.map((p) => p.id),
                                {
                                  onProgress: (label: string) => {
                                    done += 1;
                                    setExportAllProgress({
                                      done,
                                      total,
                                      label,
                                    });
                                  },
                                  shouldCancel: () =>
                                    exportAllCancelRef.current,
                                },
                              );
                              // If user cancelled while we were working, skip finishing actions
                              if (exportAllCancelRef.current) {
                                throw new Error('Export cancelled');
                              }
                              downloadJSON(exportDoc, {
                                fileName: 'export.json',
                                prettify: true,
                              });
                              ctx.notice('Export completed successfully.');
                            } catch (e) {
                              console.error('Export-all failed', e);
                              if (
                                e instanceof Error &&
                                e.message === 'Export cancelled'
                              ) {
                                ctx.notice('Export canceled');
                              } else {
                                ctx.alert(
                                  'Could not export the current schema. Please try again.',
                                );
                              }
                            } finally {
                              setExportAllBusy(false);
                              setExportAllProgress(undefined);
                              setExportAllCancelled(false);
                              exportAllCancelRef.current = false;
                            }
                          }}
                        >
                          Export entire current schema
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <ExportInner
                  initialItemTypes={exportInitialItemTypes}
                  schema={projectSchema}
                  onGraphPrepared={() => setExportPreparingBusy(false)}
                  onPrepareProgress={(p) => {
                    // ensure overlay shows determinate progress
                    setExportPreparingBusy(true);
                    setExportPreparingProgress(p);
                    const hasFixedTotal = (p.total ?? 0) > 0;
                    const raw = hasFixedTotal ? p.done / p.total : 0;
                    if (!hasFixedTotal) {
                      // Indeterminate scanning: gently advance up to 25%
                      setExportPreparingPercent((prev) =>
                        Math.min(0.25, Math.max(prev, prev + 0.02)),
                      );
                    } else {
                      // Determinate build: map to [0.25, 1]
                      const mapped = 0.25 + raw * 0.75;
                      setExportPreparingPercent((prev) =>
                        Math.max(prev, Math.min(1, mapped)),
                      );
                    }
                  }}
                  onClose={() => {
                    // Return to selection screen with current picks preserved
                    setExportStarted(false);
                  }}
                  onExport={async (itemTypeIds, pluginIds) => {
                    try {
                      setExportSelectionBusy(true);
                      setExportSelectionProgress(undefined);
                      setExportSelectionCancelled(false);
                      exportSelectionCancelRef.current = false;

                      const total = pluginIds.length + itemTypeIds.length * 2;
                      setExportSelectionProgress({
                        done: 0,
                        total,
                        label: 'Preparing export…',
                      });
                      let done = 0;

                      const exportDoc = await buildExportDoc(
                        projectSchema,
                        exportInitialItemTypeIds[0],
                        itemTypeIds,
                        pluginIds,
                        {
                          onProgress: (label: string) => {
                            done += 1;
                            setExportSelectionProgress({ done, total, label });
                          },
                          shouldCancel: () => exportSelectionCancelRef.current,
                        },
                      );

                      if (exportSelectionCancelRef.current) {
                        throw new Error('Export cancelled');
                      }

                      downloadJSON(exportDoc, {
                        fileName: 'export.json',
                        prettify: true,
                      });
                      ctx.notice('Export completed successfully.');
                    } catch (e) {
                      console.error('Selection export failed', e);
                      if (
                        e instanceof Error &&
                        e.message === 'Export cancelled'
                      ) {
                        ctx.notice('Export canceled');
                      } else {
                        ctx.alert(
                          'Could not complete the export. Please try again.',
                        );
                      }
                    } finally {
                      setExportSelectionBusy(false);
                      setExportSelectionProgress(undefined);
                      setExportSelectionCancelled(false);
                      exportSelectionCancelRef.current = false;
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </ReactFlowProvider>

      {/* Blocking overlay while exporting all */}
      {exportAllBusy && (
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
            <div className="export-overlay__title">Exporting entire schema</div>
            <div className="export-overlay__subtitle">
              Sit tight, we’re gathering models, blocks, and plugins…
            </div>

            <div
              className="export-overlay__bar"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={exportAllProgress?.total}
              aria-valuenow={exportAllProgress?.done}
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: exportAllProgress
                    ? `${(exportAllProgress.done / exportAllProgress.total) * 100}%`
                    : '10%',
                }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {exportAllProgress
                  ? exportAllProgress.label
                  : 'Loading project schema…'}
              </div>
              <div>
                {exportAllProgress
                  ? `${exportAllProgress.done} / ${exportAllProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={exportAllProgress?.done} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <Button
                buttonSize="s"
                buttonType={exportAllCancelled ? 'muted' : 'negative'}
                disabled={exportAllCancelled}
                onClick={() => {
                  setExportAllCancelled(true);
                  exportAllCancelRef.current = true;
                  setExportAllBusy(false); // Hide overlay immediately for faster UX
                }}
              >
                Cancel export
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay while preparing the Export selection view */}
      {exportPreparingBusy && (
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
                exportPreparingProgress &&
                (exportPreparingProgress.total ?? 0) > 0
                  ? exportPreparingProgress.total
                  : undefined
              }
              aria-valuenow={
                exportPreparingProgress &&
                (exportPreparingProgress.total ?? 0) > 0
                  ? exportPreparingProgress.done
                  : undefined
              }
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: `${Math.round(exportPreparingPercent * 100)}%`,
                }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {exportPreparingProgress
                  ? exportPreparingProgress.label
                  : 'Preparing export…'}
              </div>
              <div>
                {exportPreparingProgress &&
                (exportPreparingProgress.total ?? 0) > 0
                  ? `${exportPreparingProgress.done} / ${exportPreparingProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={exportPreparingProgress?.done} />
          </div>
        </div>
      )}

      {/* Overlay during selection export */}
      {exportSelectionBusy && (
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
              aria-valuemax={exportSelectionProgress?.total}
              aria-valuenow={exportSelectionProgress?.done}
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: exportSelectionProgress
                    ? `${(exportSelectionProgress.done / exportSelectionProgress.total) * 100}%`
                    : '10%',
                }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {exportSelectionProgress
                  ? exportSelectionProgress.label
                  : 'Preparing export…'}
              </div>
              <div>
                {exportSelectionProgress
                  ? `${exportSelectionProgress.done} / ${exportSelectionProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={exportSelectionProgress?.done} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <Button
                buttonSize="s"
                buttonType={exportSelectionCancelled ? 'muted' : 'negative'}
                disabled={exportSelectionCancelled}
                onClick={() => {
                  setExportSelectionCancelled(true);
                  exportSelectionCancelRef.current = true;
                  setExportSelectionBusy(false); // hide overlay immediately
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

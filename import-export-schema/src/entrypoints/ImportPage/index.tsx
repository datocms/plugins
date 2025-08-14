import type { SchemaTypes } from '@datocms/cma-client';
// Removed unused icons
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  SelectField,
  Spinner,
  TextField,
} from 'datocms-react-ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GroupBase } from 'react-select';
import ProgressStallNotice from '@/components/ProgressStallNotice';
import { createCmaClient } from '@/utils/createCmaClient';
import { downloadJSON } from '@/utils/downloadJson';
import { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import buildExportDoc from '../ExportPage/buildExportDoc';
import { ExportSchema } from '../ExportPage/ExportSchema';
import ExportInner from '../ExportPage/Inner';
import PostExportSummary from '../ExportPage/PostExportSummary';
import type { ImportDoc } from './buildImportDoc';
import { buildImportDoc } from './buildImportDoc';
import buildConflicts, {
  type Conflicts,
} from './ConflictsManager/buildConflicts';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';
import FileDropZone from './FileDropZone';
import { Inner } from './Inner';
import importSchema, {
  type ImportProgress,
  type ImportResult,
} from './importSchema';
import PostImportSummary from './PostImportSummary';
import ResolutionsForm, { type Resolutions } from './ResolutionsForm';

type Props = {
  ctx: RenderPageCtx;
  initialMode?: 'import' | 'export';
  hideModeToggle?: boolean;
};

export function ImportPage({
  ctx,
  initialMode = 'import',
  hideModeToggle = false,
}: Props) {
  const exportInitialSelectId = useId();
  const confirmTextId = useId();
  const params = new URLSearchParams(ctx.location.search);
  const recipeUrl = params.get('recipe_url');
  const recipeTitle = params.get('recipe_title');
  const [loadingRecipeByUrl, setLoadingRecipeByUrl] = useState(false);

  useEffect(() => {
    async function run() {
      if (!recipeUrl) {
        return;
      }

      try {
        setLoadingRecipeByUrl(true);
        const uri = new URL(recipeUrl);

        const response = await fetch(recipeUrl);
        const body = await response.json();

        const schema = new ExportSchema(body as ExportDoc);
        const fallbackName = uri.pathname.split('/').pop() || 'Imported schema';
        setExportSchema([recipeTitle || fallbackName, schema]);
      } finally {
        setLoadingRecipeByUrl(false);
      }
    }

    run();
  }, [recipeUrl]);

  const [exportSchema, setExportSchema] = useState<
    [string, ExportSchema] | undefined
  >();

  // Local tab to switch between importing a file and exporting from selection
  const [mode, setMode] = useState<'import' | 'export'>(initialMode);

  const [importProgress, setImportProgress] = useState<
    ImportProgress | undefined
  >(undefined);
  const [importCancelled, setImportCancelled] = useState(false);
  const importCancelRef = useRef(false);

  const [postImportSummary, setPostImportSummary] = useState<
    | {
        importDoc: ImportDoc;
        exportSchema: ExportSchema;
        idByApiKey?: Record<string, string>;
        pluginIdByName?: Record<string, string>;
        fieldIdByExportId?: Record<string, string>;
      }
    | undefined
  >(undefined);

  async function handleDrop(filename: string, doc: ExportDoc) {
    try {
      const schema = new ExportSchema(doc);
      setExportSchema([filename, schema]);
    } catch (e) {
      console.error(e);
      ctx.alert(e instanceof Error ? e.message : 'Invalid export file!');
    }
  }

  const client = useMemo(
    () => createCmaClient(ctx),
    [ctx.currentUserAccessToken, ctx.environment],
  );

  const projectSchema = useMemo(() => new ProjectSchema(client), [client]);

  const [adminDomain, setAdminDomain] = useState<string | undefined>();
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const site = await client.site.find();
        const domain = site.internal_domain || site.domain || undefined;
        if (active) setAdminDomain(domain);
        console.log('[ImportPage] resolved admin domain:', domain, site);
      } catch {
        // ignore; links will simply not be shown
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  // State used only in Export tab: choose initial model/block for graph
  const [exportInitialItemTypeIds, setExportInitialItemTypeIds] = useState<
    string[]
  >([]);
  const [exportInitialItemTypes, setExportInitialItemTypes] = useState<
    SchemaTypes.ItemType[]
  >([]);
  const [exportStarted, setExportStarted] = useState(false);
  const [postExportDoc, setPostExportDoc] = useState<ExportDoc | undefined>(
    undefined,
  );
  const [exportAllBusy, setExportAllBusy] = useState(false);
  const [exportAllProgress, setExportAllProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);
  const [exportAllCancelled, setExportAllCancelled] = useState(false);
  const exportAllCancelRef = useRef(false);
  // Show overlay while Export selection view prepares its graph
  const [exportPreparingBusy, setExportPreparingBusy] = useState(false);
  const [exportPreparingProgress, setExportPreparingProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);
  // Selection export overlay state (when exporting from Start export flow)
  const [exportSelectionBusy, setExportSelectionBusy] = useState(false);
  const [exportSelectionProgress, setExportSelectionProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);
  const [exportSelectionCancelled, setExportSelectionCancelled] =
    useState(false);
  const exportSelectionCancelRef = useRef(false);
  const [allItemTypes, setAllItemTypes] = useState<
    SchemaTypes.ItemType[] | undefined
  >(undefined);

  useEffect(() => {
    async function load() {
      if (mode !== 'export') return;
      const types = await projectSchema.getAllItemTypes();
      setAllItemTypes(types);
    }
    load();
  }, [mode, projectSchema]);

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
  }, [exportInitialItemTypeIds.join('-'), projectSchema]);

  const [conflicts, setConflicts] = useState<Conflicts | undefined>();
  const [conflictsBusy, setConflictsBusy] = useState(false);
  const [conflictsProgress, setConflictsProgress] = useState<
    { done: number; total: number; label: string } | undefined
  >(undefined);

  // Typed confirmation gate state
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmExpected, setConfirmExpected] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pendingResolutions, setPendingResolutions] = useState<
    Resolutions | undefined
  >(undefined);

  useEffect(() => {
    async function run() {
      if (!exportSchema) {
        return;
      }
      try {
        setConflictsBusy(true);
        setConflictsProgress({ done: 0, total: 1, label: 'Preparing import…' });
        const c = await buildConflicts(exportSchema[1], projectSchema, (p) =>
          setConflictsProgress(p),
        );
        setConflicts(c);
      } finally {
        setConflictsBusy(false);
      }
    }

    run();
  }, [exportSchema, projectSchema]);

  // Listen for bottom Cancel action from ConflictsManager
  useEffect(() => {
    const onRequestCancel = async () => {
      if (!exportSchema) return;
      const result = await ctx.openConfirm({
        title: 'Cancel the import?',
        content: `Do you really want to cancel the import process of "${exportSchema[0]}"?`,
        choices: [
          {
            label: 'Yes, cancel the import',
            value: 'yes',
            intent: 'negative',
          },
        ],
        cancel: {
          label: 'Nevermind',
          value: false,
          intent: 'positive',
        },
      });

      if (result === 'yes') {
        setExportSchema(undefined);
      }
    };

    window.addEventListener(
      'import:request-cancel',
      onRequestCancel as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'import:request-cancel',
        onRequestCancel as unknown as EventListener,
      );
    };
  }, [exportSchema, ctx]);

  async function handleImport(resolutions: Resolutions) {
    if (!exportSchema || !conflicts) {
      throw new Error('Invariant');
    }

    try {
      setImportCancelled(false);
      importCancelRef.current = false;
      // If any rename operations are selected, require typed confirmation
      const renameCount = Object.values(resolutions.itemTypes).filter(
        (r) => r && 'strategy' in r && r.strategy === 'rename',
      ).length;

      if (renameCount > 0) {
        setPendingResolutions(resolutions);
        setConfirmExpected(`RENAME ${renameCount}`);
        setConfirmText('');
        setConfirmVisible(true);
        return;
      }

      setImportProgress({ finished: 0, total: 1 });

      const importDoc = await buildImportDoc(
        exportSchema[1],
        conflicts,
        resolutions,
      );

      const importResult: ImportResult = await importSchema(
        importDoc,
        client,
        (p) => {
          if (!importCancelRef.current) setImportProgress(p);
        },
        {
          shouldCancel: () => importCancelRef.current,
        },
      );

      ctx.notice('Import completed successfully!');
      // Refresh models list to build API key -> ID map for linking
      let idByApiKey: Record<string, string> | undefined;
      let pluginIdByName: Record<string, string> | undefined;
      try {
        const itemTypes = await client.itemTypes.list();
        idByApiKey = Object.fromEntries(
          itemTypes.map((it) => [it.api_key, it.id]),
        );
        const plugins = await client.plugins.list();
        pluginIdByName = Object.fromEntries(
          plugins.map((pl) => [pl.name, pl.id]),
        );
      } catch {
        // ignore: links will still render without IDs
      }

      setPostImportSummary({
        importDoc,
        exportSchema: exportSchema[1],
        idByApiKey,
        pluginIdByName,
        fieldIdByExportId: importResult.fieldIdByExportId,
      });
      setImportProgress(undefined);
      setExportSchema(undefined);
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.message === 'Import cancelled') {
        ctx.notice('Import canceled');
      } else {
        ctx.alert('Import could not be completed successfully.');
      }
      setImportProgress(undefined);
    }
  }

  async function proceedAfterConfirm() {
    if (!pendingResolutions || !exportSchema || !conflicts) return;

    try {
      setConfirmVisible(false);
      setImportCancelled(false);
      importCancelRef.current = false;
      setImportProgress({ finished: 0, total: 1 });

      const importDoc = await buildImportDoc(
        exportSchema[1],
        conflicts,
        pendingResolutions,
      );

      const importResult: ImportResult = await importSchema(
        importDoc,
        client,
        (p) => {
          if (!importCancelRef.current) setImportProgress(p);
        },
        {
          shouldCancel: () => importCancelRef.current,
        },
      );

      ctx.notice('Import completed successfully!');
      // Refresh models list to build API key -> ID map for linking
      let idByApiKey: Record<string, string> | undefined;
      let pluginIdByName: Record<string, string> | undefined;
      try {
        const itemTypes = await client.itemTypes.list();
        idByApiKey = Object.fromEntries(
          itemTypes.map((it) => [it.api_key, it.id]),
        );
        const plugins = await client.plugins.list();
        pluginIdByName = Object.fromEntries(
          plugins.map((pl) => [pl.name, pl.id]),
        );
      } catch {}

      setPostImportSummary({
        importDoc,
        exportSchema: exportSchema[1],
        idByApiKey,
        pluginIdByName,
        fieldIdByExportId: importResult.fieldIdByExportId,
      });
      setImportProgress(undefined);
      setExportSchema(undefined);
      setPendingResolutions(undefined);
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.message === 'Import cancelled') {
        ctx.notice('Import canceled');
      } else {
        ctx.alert('Import could not be completed successfully.');
      }
      setImportProgress(undefined);
    }
  }

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          {exportSchema
            ? null
            : !hideModeToggle && (
                <div
                  style={{
                    padding: '8px var(--spacing-l)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }} />
                  <div
                    className="mode-toggle"
                    role="tablist"
                    aria-label="Import or Export toggle"
                    data-mode={mode}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'import'}
                      className={`mode-toggle__button ${mode === 'import' ? 'is-active' : ''}`}
                      onClick={() => setMode('import')}
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'export'}
                      className={`mode-toggle__button ${mode === 'export' ? 'is-active' : ''}`}
                      onClick={() => setMode('export')}
                    >
                      Export
                    </button>
                  </div>
                  <div style={{ flex: 1 }} />
                </div>
              )}
          <div className="page__content">
            {mode === 'import' ? (
              postImportSummary ? (
                <PostImportSummary
                  exportSchema={postImportSummary.exportSchema}
                  importDoc={postImportSummary.importDoc}
                  adminDomain={adminDomain}
                  idByApiKey={postImportSummary.idByApiKey}
                  pluginIdByName={postImportSummary.pluginIdByName}
                  fieldIdByExportId={postImportSummary.fieldIdByExportId}
                  onClose={() => {
                    setPostImportSummary(undefined);
                    ctx.navigateTo(
                      `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import`,
                    );
                  }}
                />
              ) : (
                <FileDropZone onJsonDrop={handleDrop}>
                  {(button) =>
                    exportSchema ? (
                      conflicts ? (
                        <ConflictsContext.Provider value={conflicts}>
                          <ResolutionsForm
                            schema={projectSchema}
                            onSubmit={handleImport}
                          >
                            <Inner
                              exportSchema={exportSchema[1]}
                              schema={projectSchema}
                              ctx={ctx}
                            />
                          </ResolutionsForm>
                        </ConflictsContext.Provider>
                      ) : (
                        <Spinner placement="centered" size={60} />
                      )
                    ) : loadingRecipeByUrl ? (
                      <Spinner placement="centered" size={60} />
                    ) : (
                      <div className="blank-slate">
                        <div className="blank-slate__body">
                          <div className="blank-slate__body__title">
                            Upload your schema export file
                          </div>

                          <div className="blank-slate__body__content">
                            <p>
                              Drag and drop your exported JSON file here, or
                              click the button to select one from your computer.
                            </p>
                            {button}
                          </div>
                        </div>
                        <div className="blank-slate__body__outside">
                          {hideModeToggle
                            ? '💡 Need to bulk export your schema? Go to the Export page under Schema.'
                            : '💡 Need to bulk export your schema? Switch to the Export tab above.'}
                        </div>
                      </div>
                    )
                  }
                </FileDropZone>
              )
            ) : (
              <div className="blank-slate">
                {postExportDoc ? (
                  <PostExportSummary
                    exportDoc={postExportDoc}
                    adminDomain={adminDomain}
                    onDownload={() =>
                      downloadJSON(postExportDoc, {
                        fileName: 'export.json',
                        prettify: true,
                      })
                    }
                    onClose={() => {
                      setPostExportDoc(undefined);
                      setMode('import');
                      setExportStarted(false);
                      setExportInitialItemTypeIds([]);
                      setExportInitialItemTypes([]);
                    }}
                  />
                ) : !exportStarted ? (
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
                                setPostExportDoc(exportDoc);
                                ctx.notice('Export completed with success!');
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
                              setExportSelectionProgress({
                                done,
                                total,
                                label,
                              });
                            },
                            shouldCancel: () =>
                              exportSelectionCancelRef.current,
                          },
                        );

                        if (exportSelectionCancelRef.current) {
                          throw new Error('Export cancelled');
                        }

                        downloadJSON(exportDoc, {
                          fileName: 'export.json',
                          prettify: true,
                        });
                        setPostExportDoc(exportDoc);
                        ctx.notice('Export completed with success!');
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
                {/* Fallback note removed per UX request */}
              </div>
            )}
          </div>
        </div>
      </ReactFlowProvider>

      {importProgress && (
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
          aria-label="Import in progress"
        >
          <div className="export-overlay__card">
            <div className="export-overlay__title">Import in progress</div>
            <div className="export-overlay__subtitle">
              {importCancelled
                ? 'Cancelling import…'
                : 'Sit tight, we’re applying models, fields, and plugins…'}
            </div>

            <div
              className="export-overlay__bar"
              role="progressbar"
              aria-label="Import progress"
              aria-valuemin={0}
              aria-valuemax={importProgress.total}
              aria-valuenow={importProgress.finished}
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: `${(importProgress.finished / importProgress.total) * 100}%`,
                }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {importCancelled
                  ? 'Stopping at next safe point…'
                  : importProgress.label || ''}
              </div>
              <div>
                {importProgress.finished} / {importProgress.total}
              </div>
            </div>
            <ProgressStallNotice current={importProgress.finished} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <Button
                buttonSize="s"
                buttonType={importCancelled ? 'muted' : 'negative'}
                disabled={importCancelled}
                onClick={async () => {
                  if (!exportSchema) return;
                  const result = await ctx.openConfirm({
                    title: 'Cancel import in progress?',
                    content:
                      'Stopping now can leave partial changes in your project. Some models or blocks may be created without relationships, some fields or fieldsets may already exist, and plugin installations or editor settings may be incomplete. You can run the import again to finish or manually clean up. Are you sure you want to cancel?',
                    choices: [
                      {
                        label: 'Yes, cancel the import',
                        value: 'yes',
                        intent: 'negative',
                      },
                    ],
                    cancel: {
                      label: 'Nevermind',
                      value: false,
                      intent: 'positive',
                    },
                  });

                  if (result === 'yes') {
                    setImportCancelled(true);
                    importCancelRef.current = true;
                  }
                }}
              >
                Cancel import
              </Button>
            </div>
          </div>
        </div>
      )}
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
                  // Keep overlay visible to show cancellation progress
                }}
              >
                Cancel export
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay while preparing import conflicts after selecting a file */}
      {conflictsBusy && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(250,252,255,0.96), rgba(245,247,255,0.96))',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 16,
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Preparing import"
        >
          <div className="export-overlay__card">
            <div className="export-overlay__title">Preparing import</div>
            <div className="export-overlay__subtitle">
              Sit tight, we’re scanning your export against the project…
            </div>

            <div
              className="export-overlay__bar"
              role="progressbar"
              aria-label="Preparing import"
              aria-valuemin={0}
              aria-valuemax={conflictsProgress?.total}
              aria-valuenow={conflictsProgress?.done}
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: conflictsProgress
                    ? `${(conflictsProgress.done / conflictsProgress.total) * 100}%`
                    : '10%',
                }}
              />
            </div>
            <div className="export-overlay__meta">
              <div>
                {conflictsProgress
                  ? conflictsProgress.label
                  : 'Preparing import…'}
              </div>
              <div>
                {conflictsProgress
                  ? `${conflictsProgress.done} / ${conflictsProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={conflictsProgress?.done} />
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
              aria-valuemax={exportPreparingProgress?.total}
              aria-valuenow={exportPreparingProgress?.done}
            >
              <div
                className="export-overlay__bar__fill"
                style={{
                  width: exportPreparingProgress
                    ? `${(exportPreparingProgress.done / exportPreparingProgress.total) * 100}%`
                    : '10%',
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
                {exportPreparingProgress
                  ? `${exportPreparingProgress.done} / ${exportPreparingProgress.total}`
                  : ''}
              </div>
            </div>
            <ProgressStallNotice current={exportPreparingProgress?.done} />
          </div>
        </div>
      )}

      {/* Blocking overlay while exporting selection via Start export */}
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
                  // Keep overlay visible to show cancellation progress
                }}
              >
                Cancel export
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Typed confirmation modal for renames */}
      {confirmVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm rename operations"
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 8,
              maxWidth: 560,
              width: '100%',
              padding: 20,
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Confirm rename operations
            </div>
            <div style={{ color: '#444', marginBottom: 16 }}>
              You chose to import items with renamed models/blocks. To confirm,
              type
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {' '}
                {confirmExpected}
              </span>{' '}
              below.
            </div>
            <div style={{ marginBottom: 16 }}>
              <TextField
                id={confirmTextId}
                name="confirm-typed-text"
                label="Type to confirm"
                placeholder={confirmExpected}
                value={confirmText}
                onChange={(val: string) => setConfirmText(val)}
                textInputProps={{
                  autoFocus: true,
                  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter' && confirmText === confirmExpected) {
                      e.preventDefault();
                      void proceedAfterConfirm();
                    }
                  },
                }}
              />
            </div>
            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <Button
                buttonSize="s"
                onClick={() => {
                  setConfirmVisible(false);
                  setPendingResolutions(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                buttonSize="s"
                buttonType="primary"
                disabled={confirmText !== confirmExpected}
                onClick={proceedAfterConfirm}
              >
                I understand, proceed
              </Button>
            </div>
          </div>
        </div>
      )}
    </Canvas>
  );
}

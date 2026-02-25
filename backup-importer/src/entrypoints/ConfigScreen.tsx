import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useCallback, useMemo, useState } from 'react';
import { executeImportFromEnvelope } from '../importer/executor';
import { runPreflightImport } from '../importer/engine';
import { downloadImportReport } from '../importer/report';
import { validateRecordExportEnvelope } from '../importer/validation';
import type {
  EnvelopeValidationResult,
  ImportExecutionProgress,
  ImportExecutionReport,
  PreflightReport,
} from '../importer/types';
import AssetZipDropZone from './components/AssetZipDropZone';
import JsonDropZone from './components/JsonDropZone';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

function renderMessages(messages: string[], tone: 'error' | 'warning') {
  if (!messages.length) {
    return null;
  }

  return (
    <ul className={tone === 'error' ? s.errorList : s.warningList}>
      {messages.slice(0, 20).map((message, index) => (
        <li key={`${tone}-${index}-${message}`}>{message}</li>
      ))}
    </ul>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  const [loadedFilename, setLoadedFilename] = useState<string | null>(null);
  const [rawEnvelope, setRawEnvelope] = useState<unknown>(null);
  const [validation, setValidation] = useState<EnvelopeValidationResult | null>(
    null,
  );
  const [strictMode, setStrictMode] = useState(true);
  const [skipAssets, setSkipAssets] = useState(false);
  const [skipSchemaImport, setSkipSchemaImport] = useState(false);
  const [skipSiteSettingsImport, setSkipSiteSettingsImport] = useState(false);
  const [skipPluginImport, setSkipPluginImport] = useState(false);
  const [skipWorkflowImport, setSkipWorkflowImport] = useState(false);
  const [skipRoleImport, setSkipRoleImport] = useState(false);
  const [skipModelFilterImport, setSkipModelFilterImport] = useState(false);
  const [skipMenuItemImport, setSkipMenuItemImport] = useState(false);
  const [skipSchemaMenuItemImport, setSkipSchemaMenuItemImport] = useState(false);
  const [skipScheduledActionsImport, setSkipScheduledActionsImport] = useState(false);
  const [skipWebhookImport, setSkipWebhookImport] = useState(false);
  const [skipBuildTriggerImport, setSkipBuildTriggerImport] = useState(false);
  const [addOnlyDifferences, setAddOnlyDifferences] = useState(true);
  const [debugLogging, setDebugLogging] = useState(false);
  const [publishAfterImport, setPublishAfterImport] = useState(true);
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState(true);
  const [downloadReportAfterRun, setDownloadReportAfterRun] = useState(false);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [runningImport, setRunningImport] = useState(false);
  const [assetZipFiles, setAssetZipFiles] = useState<File[]>([]);
  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(
    null,
  );
  const [executionProgress, setExecutionProgress] =
    useState<ImportExecutionProgress | null>(null);
  const [executionReport, setExecutionReport] =
    useState<ImportExecutionReport | null>(null);

  const hasEnvelope = Boolean(validation?.envelope);

  const handleReadError = useCallback(
    (message: string) => {
      ctx.alert(message);
    },
    [ctx],
  );

  const handleZipFilesSelected = useCallback(
    (files: File[]) => {
      setAssetZipFiles(files);
      if (files.length > 0) {
        ctx.notice(`Loaded ${files.length} asset ZIP file(s).`);
      }
    },
    [ctx],
  );

  const handleJsonFileSelected = useCallback(
    (file: File, parsed: unknown) => {
      setLoadedFilename(file.name);
      setRawEnvelope(parsed);

      const nextValidation = validateRecordExportEnvelope(parsed);
      setValidation(nextValidation);
      setPreflightReport(null);
      setExecutionProgress(null);
      setExecutionReport(null);
      setAssetZipFiles([]);

      if (nextValidation.errors.length > 0) {
        ctx.alert(
          `Loaded '${file.name}' but found ${nextValidation.errors.length} validation error(s).`,
        );
      } else {
        ctx.notice(`Loaded '${file.name}' successfully.`);
      }
    },
    [ctx],
  );

  const handleRunPreflight = useCallback(async () => {
    if (!rawEnvelope) {
      ctx.alert('Select an export JSON file first.');
      return;
    }

    setRunningPreflight(true);

    try {
      const report = runPreflightImport(rawEnvelope, {
        strictMode,
        skipAssetFields: skipAssets,
      });

      setPreflightReport(report);

      if (report.ok) {
        ctx.notice('Preflight completed without blocking errors.');
      } else {
        ctx.alert('Preflight completed with blocking errors.');
      }
    } finally {
      setRunningPreflight(false);
    }
  }, [ctx, rawEnvelope, skipAssets, strictMode]);

  const handleExecuteImport = useCallback(async () => {
    if (!rawEnvelope) {
      ctx.alert('Select an export JSON file first.');
      return;
    }

    const apiToken = ctx.currentUserAccessToken;
    if (!apiToken) {
      ctx.alert('Current user API token is not available.');
      return;
    }

    const environment =
      (ctx as { environment?: string }).environment ?? 'main';

    setRunningImport(true);
    setExecutionProgress(null);
    setExecutionReport(null);

    try {
      const report = await executeImportFromEnvelope({
        envelopeRaw: rawEnvelope,
        apiToken,
        environment,
        assetZipFiles,
        options: {
          strictMode,
          skipAssets,
          skipSchemaImport,
          skipSiteSettingsImport,
          skipPluginImport,
          skipWorkflowImport,
          skipRoleImport,
          skipModelFilterImport,
          skipMenuItemImport,
          skipSchemaMenuItemImport,
          skipScheduledActionsImport,
          skipWebhookImport,
          skipBuildTriggerImport,
          addOnlyDifferences,
          debugLogging,
          publishAfterImport,
          resumeFromCheckpoint,
          downloadReportAfterRun,
        },
        onProgress: (progress) => {
          setExecutionProgress(progress);
        },
      });

      setExecutionReport(report);

      if (report.ok) {
        ctx.notice('Import execution completed successfully.');
      } else {
        ctx.alert('Import execution completed with errors.');
      }
    } catch (error) {
      ctx.alert(
        `Import execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setRunningImport(false);
    }
  }, [
    assetZipFiles,
    addOnlyDifferences,
    ctx,
    debugLogging,
    skipPluginImport,
    skipSchemaImport,
    skipSiteSettingsImport,
    skipWorkflowImport,
    skipRoleImport,
    skipModelFilterImport,
    skipMenuItemImport,
    skipSchemaMenuItemImport,
    skipScheduledActionsImport,
    skipWebhookImport,
    skipBuildTriggerImport,
    downloadReportAfterRun,
    publishAfterImport,
    rawEnvelope,
    resumeFromCheckpoint,
    skipAssets,
    strictMode,
  ]);

  const summary = useMemo(() => {
    if (!validation) {
      return null;
    }

    return {
      records: validation.stats.recordCount,
      itemTypes: validation.stats.itemTypeCount,
      fields: validation.stats.fieldCount,
      recordRefs: validation.stats.referenceCounts.recordRefs,
      uploadRefs: validation.stats.referenceCounts.uploadRefs,
      structuredTextRefs: validation.stats.referenceCounts.structuredTextRefs,
      blockRefs: validation.stats.referenceCounts.blockRefs,
    };
  }, [validation]);

  return (
    <Canvas ctx={ctx}>
      <div className={s.wrapper}>
        <h2 className={s.title}>Backup Importer</h2>
        <p className={s.subtitle}>
          Upload the JSON exported by Project Exporter and run preflight checks before actual import execution.
        </p>

        <JsonDropZone
          disabled={runningPreflight}
          onJsonFileSelected={handleJsonFileSelected}
          onReadError={handleReadError}
        />

        <AssetZipDropZone
          disabled={runningPreflight || runningImport || !hasEnvelope || skipAssets}
          onFilesSelected={handleZipFilesSelected}
          onReadError={handleReadError}
        />

        {loadedFilename && (
          <div className={s.card}>
            <div className={s.cardTitle}>Loaded file</div>
            <div>{loadedFilename}</div>
            <div className={s.mutedText}>
              Asset ZIP files: {assetZipFiles.length}
            </div>
          </div>
        )}

        {summary && (
          <div className={s.card}>
            <div className={s.cardTitle}>Envelope summary</div>
            <div className={s.grid}>
              <div>Records: {summary.records}</div>
              <div>Item types: {summary.itemTypes}</div>
              <div>Fields: {summary.fields}</div>
              <div>Record refs: {summary.recordRefs}</div>
              <div>Upload refs: {summary.uploadRefs}</div>
              <div>Structured text refs: {summary.structuredTextRefs}</div>
              <div>Block refs: {summary.blockRefs}</div>
            </div>
          </div>
        )}

        {validation && (
          <div className={s.card}>
            <div className={s.cardTitle}>Validation output</div>
            {renderMessages(validation.errors, 'error')}
            {renderMessages(validation.warnings, 'warning')}
            {!validation.errors.length && !validation.warnings.length && (
              <p className={s.successText}>No validation messages.</p>
            )}
          </div>
        )}

        <div className={s.controls}>
          <label className={s.checkboxLabel} htmlFor="strict-mode">
            <input
              id="strict-mode"
              type="checkbox"
              checked={strictMode}
              onChange={(event) => setStrictMode(event.target.checked)}
            />
            Strict mode (block on unresolved references)
          </label>

          <label className={s.checkboxLabel} htmlFor="publish-after-import">
            <input
              id="publish-after-import"
              type="checkbox"
              checked={publishAfterImport}
              onChange={(event) => setPublishAfterImport(event.target.checked)}
            />
            Publish records after import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-assets">
            <input
              id="skip-assets"
              type="checkbox"
              checked={skipAssets}
              onChange={(event) => {
                const checked = event.target.checked;
                setSkipAssets(checked);
                if (checked) {
                  setAssetZipFiles([]);
                }
              }}
            />
            Skip assets (do not import files and blank file/gallery fields)
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-schema-import">
            <input
              id="skip-schema-import"
              type="checkbox"
              checked={skipSchemaImport}
              onChange={(event) => setSkipSchemaImport(event.target.checked)}
            />
            Skip schema import phases (use existing target schema mappings only)
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-site-settings-import">
            <input
              id="skip-site-settings-import"
              type="checkbox"
              checked={skipSiteSettingsImport}
              onChange={(event) => setSkipSiteSettingsImport(event.target.checked)}
            />
            Skip site settings import phase
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-plugin-import">
            <input
              id="skip-plugin-import"
              type="checkbox"
              checked={skipPluginImport}
              onChange={(event) => setSkipPluginImport(event.target.checked)}
            />
            Skip plugin import phase
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-workflow-import">
            <input
              id="skip-workflow-import"
              type="checkbox"
              checked={skipWorkflowImport}
              onChange={(event) => setSkipWorkflowImport(event.target.checked)}
            />
            Skip workflow import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-role-import">
            <input
              id="skip-role-import"
              type="checkbox"
              checked={skipRoleImport}
              onChange={(event) => setSkipRoleImport(event.target.checked)}
            />
            Skip role import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-model-filter-import">
            <input
              id="skip-model-filter-import"
              type="checkbox"
              checked={skipModelFilterImport}
              onChange={(event) => setSkipModelFilterImport(event.target.checked)}
            />
            Skip model filter import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-menu-item-import">
            <input
              id="skip-menu-item-import"
              type="checkbox"
              checked={skipMenuItemImport}
              onChange={(event) => setSkipMenuItemImport(event.target.checked)}
            />
            Skip menu item import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-schema-menu-item-import">
            <input
              id="skip-schema-menu-item-import"
              type="checkbox"
              checked={skipSchemaMenuItemImport}
              onChange={(event) => setSkipSchemaMenuItemImport(event.target.checked)}
            />
            Skip schema menu item import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-scheduled-actions-import">
            <input
              id="skip-scheduled-actions-import"
              type="checkbox"
              checked={skipScheduledActionsImport}
              onChange={(event) => setSkipScheduledActionsImport(event.target.checked)}
            />
            Skip scheduled actions replay
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-webhook-import">
            <input
              id="skip-webhook-import"
              type="checkbox"
              checked={skipWebhookImport}
              onChange={(event) => setSkipWebhookImport(event.target.checked)}
            />
            Skip webhook import
          </label>

          <label className={s.checkboxLabel} htmlFor="skip-build-trigger-import">
            <input
              id="skip-build-trigger-import"
              type="checkbox"
              checked={skipBuildTriggerImport}
              onChange={(event) => setSkipBuildTriggerImport(event.target.checked)}
            />
            Skip build trigger import
          </label>

          <label className={s.checkboxLabel} htmlFor="add-only-differences">
            <input
              id="add-only-differences"
              type="checkbox"
              checked={addOnlyDifferences}
              onChange={(event) => setAddOnlyDifferences(event.target.checked)}
            />
            Add only differences (skip resources that already exist)
          </label>

          <label className={s.checkboxLabel} htmlFor="debug-logging">
            <input
              id="debug-logging"
              type="checkbox"
              checked={debugLogging}
              onChange={(event) => setDebugLogging(event.target.checked)}
            />
            Enable debug logging in browser console
          </label>

          <label className={s.checkboxLabel} htmlFor="resume-checkpoint">
            <input
              id="resume-checkpoint"
              type="checkbox"
              checked={resumeFromCheckpoint}
              onChange={(event) => setResumeFromCheckpoint(event.target.checked)}
            />
            Resume from checkpoint if available
          </label>

          <label className={s.checkboxLabel} htmlFor="download-report">
            <input
              id="download-report"
              type="checkbox"
              checked={downloadReportAfterRun}
              onChange={(event) => setDownloadReportAfterRun(event.target.checked)}
            />
            Auto-download report (JSON + CSV) after run
          </label>

          <Button
            buttonType="primary"
            buttonSize="l"
            disabled={!hasEnvelope || runningPreflight || runningImport}
            onClick={handleRunPreflight}
            fullWidth
          >
            {runningPreflight ? 'Running preflight...' : 'Run preflight simulation'}
          </Button>

          <Button
            buttonType="primary"
            buttonSize="l"
            disabled={!hasEnvelope || runningPreflight || runningImport}
            onClick={handleExecuteImport}
            fullWidth
          >
            {runningImport ? 'Running import...' : 'Run import (beta)'}
          </Button>
        </div>

        {preflightReport && (
          <div className={s.card}>
            <div className={s.cardTitle}>Preflight report</div>
            <div className={s.grid}>
              <div>Status: {preflightReport.ok ? 'OK' : 'FAILED'}</div>
              <div>Strict mode: {preflightReport.strictMode ? 'ON' : 'OFF'}</div>
              <div>Bootstrap jobs: {preflightReport.bootstrapJobs.length}</div>
              <div>Patch jobs: {preflightReport.patchJobs.length}</div>
              <div>
                Unresolved records: {preflightReport.unresolvedSummary.records}
              </div>
              <div>
                Unresolved uploads: {preflightReport.unresolvedSummary.uploads}
              </div>
              <div>Unresolved blocks: {preflightReport.unresolvedSummary.blocks}</div>
            </div>

            {renderMessages(preflightReport.errors, 'error')}
            {renderMessages(preflightReport.warnings, 'warning')}
          </div>
        )}

        {executionProgress && (
          <div className={s.card}>
            <div className={s.cardTitle}>Execution progress</div>
            <div className={s.grid}>
              <div>Phase: {executionProgress.phase}</div>
              <div>
                Progress: {executionProgress.finished}/{executionProgress.total}
              </div>
            </div>
            <p>{executionProgress.message}</p>
          </div>
        )}

        {executionReport && (
          <div className={s.card}>
            <div className={s.cardTitle}>Execution report</div>
            <div className={s.grid}>
              <div>Status: {executionReport.ok ? 'OK' : 'FAILED'}</div>
              <div>Created records: {executionReport.createdCount}</div>
              <div>Updated records: {executionReport.updatedCount}</div>
              <div>Published records: {executionReport.publishedCount}</div>
              <div>Tree updates: {executionReport.treeUpdatedCount}</div>
              <div>Skipped patches: {executionReport.skippedPatchCount}</div>
              <div>Create failures: {executionReport.createFailures.length}</div>
              <div>Update failures: {executionReport.updateFailures.length}</div>
              <div>Publish failures: {executionReport.publishFailures.length}</div>
              <div>Tree failures: {executionReport.treeFailures.length}</div>
              <div>Warnings: {executionReport.warnings.length}</div>
              <div>
                Add-only mode: {executionReport.addOnlyDifferencesEnabled ? 'ON' : 'OFF'}
              </div>
              <div>
                Validation window:{' '}
                {executionReport.validationWindowEnabled ? 'ON' : 'OFF'}
              </div>
              <div>
                Validation fields in scope: {executionReport.validationFieldsInScope}
              </div>
              <div>
                Validation fields suspended: {executionReport.validationFieldsSuspended}
              </div>
              <div>
                Validation fields restored: {executionReport.validationFieldsRestored}
              </div>
              <div>
                Validation suspend failures: {executionReport.validationSuspendFailures}
              </div>
              <div>
                Validation restore failures: {executionReport.validationRestoreFailures}
              </div>
              <div>Existing record matches: {executionReport.existingRecordMatches}</div>
              <div>Skipped existing records: {executionReport.skippedExistingRecords}</div>
            </div>

            {executionReport.assetImport && (
              <div className={s.grid}>
                <div>
                  Imported assets: {executionReport.assetImport.importedAssets}
                </div>
                <div>
                  Skipped assets: {executionReport.assetImport.skippedAssets}
                </div>
                <div>
                  Asset failures: {executionReport.assetImport.failures.length}
                </div>
              </div>
            )}

            <Button
              buttonSize="s"
              onClick={() => downloadImportReport(executionReport)}
            >
              Download report now
            </Button>

            {renderMessages(executionReport.errors, 'error')}
            {renderMessages(executionReport.warnings, 'warning')}
          </div>
        )}
      </div>
    </Canvas>
  );
}

import { buildClient } from '@datocms/cma-client-browser';
import styles from '@styles/configscreen.module.css';
import {
  type NormalizedComment,
  migrateCommentsToUuid,
  normalizeCommentIfValid,
} from '@utils/migrations';
import { buildPluginParams, parsePluginParams } from '@utils/pluginParams';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  Section,
  Spinner,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMENTS_MODEL_API_KEY } from '@/constants';
import { logDebug, logWarn, setDebugLoggingEnabled } from '@/utils/errorLogger';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

function buildScanNoticeMessage(
  foundCount: number,
  failedCount: number,
): string {
  if (failedCount > 0) {
    return `Scan completed with ${failedCount} inspection error(s). Review the details below before migrating.`;
  }
  if (foundCount === 0) {
    return 'No legacy comment_log fields found. Nothing to migrate!';
  }
  return `Found ${foundCount} model(s) with comment_log fields.`;
}

function parseCommentLog(
  commentLog: unknown,
  recordId: string,
): unknown[] | null {
  if (!commentLog) return null;

  if (typeof commentLog === 'string') {
    try {
      const parsed = JSON.parse(commentLog);
      if (!Array.isArray(parsed)) return null;
      return parsed;
    } catch (parseError) {
      logWarn('Skipping record with invalid JSON comment_log', {
        recordId,
        error: parseError,
      });
      return null;
    }
  }

  if (Array.isArray(commentLog)) {
    return commentLog;
  }

  return null;
}

type MigrationRecord = { id: string; comment_log: unknown };

function normalizeCommentsFromArray(
  commentsArray: unknown[],
  record: MigrationRecord,
  modelInfo: ModelWithCommentLog,
  results: MigrationResults,
): NormalizedComment[] {
  const normalizedComments = commentsArray.flatMap((comment) => {
    const normalizedComment = normalizeCommentIfValid(comment);
    return normalizedComment ? [normalizedComment] : [];
  });

  const skippedInvalidComments =
    commentsArray.length - normalizedComments.length;
  if (skippedInvalidComments > 0) {
    const allSkipped = skippedInvalidComments === commentsArray.length;
    results.warnings.push({
      recordId: record.id,
      modelName: modelInfo.modelName,
      message: allSkipped
        ? 'All legacy comments were malformed and were skipped.'
        : `${skippedInvalidComments} malformed legacy comment(s) were skipped during migration.`,
    });
  }

  return normalizedComments;
}

async function createOrSkipCommentRecord(
  client: ReturnType<typeof buildClient>,
  record: MigrationRecord,
  modelInfo: ModelWithCommentLog,
  commentsModelId: string,
  migratedComments: unknown[],
  results: MigrationResults,
): Promise<void> {
  const existing = await client.items.list({
    filter: {
      type: COMMENTS_MODEL_API_KEY,
      fields: {
        model_id: { eq: modelInfo.modelId },
        record_id: { eq: record.id },
      },
    },
  });

  if (existing.length > 0) {
    results.skipped++;
    return;
  }

  try {
    await client.items.create({
      item_type: { type: 'item_type', id: commentsModelId },
      model_id: modelInfo.modelId,
      record_id: record.id,
      content: JSON.stringify(migratedComments),
    });
    results.success++;
  } catch (err) {
    results.failed++;
    results.errors.push(
      `Record ${record.id} in ${modelInfo.modelName}: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`,
    );
  }
}

async function fetchAllRecordsForModel(
  client: ReturnType<typeof buildClient>,
  modelApiKey: string,
): Promise<Array<{ id: string; comment_log: unknown }>> {
  const allRecords: Array<{ id: string; comment_log: unknown }> = [];

  const iterator = client.items.listPagedIterator({
    filter: { type: modelApiKey },
  });

  const collectRecords = async (): Promise<void> => {
    const next = await iterator.next();
    if (next.done) return;
    allRecords.push({
      id: next.value.id,
      comment_log: next.value.comment_log,
    });
    return collectRecords();
  };

  await collectRecords();
  return allRecords;
}

type MigrationStatus =
  | 'idle'
  | 'scanning'
  | 'migrating'
  | 'completed'
  | 'error';

type ModelWithCommentLog = {
  modelId: string;
  modelName: string;
  modelApiKey: string;
  fieldId: string;
};

type MigrationProgress = {
  currentModel: string;
  currentRecord: number;
  totalRecords: number;
  processedModels: number;
  totalModels: number;
};

type MigrationResults = {
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
  warnings: MigrationWarning[];
};

type ScanProgress = {
  phase: 'scanning-fields';
  currentModel?: string;
  scannedModels: number;
  totalModels: number;
  foundCount: number;
};

type MigrationWarning = {
  recordId: string;
  modelName: string;
  message: string;
};

const ConfigScreen = ({ ctx }: PropTypes) => {
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const initialSettings = {
    cdaToken: pluginParams.cdaToken,
    debugLoggingEnabled: pluginParams.debugLoggingEnabled,
    realTimeEnabled: pluginParams.realTimeUpdatesEnabled,
  };
  const [cdaToken, setCdaToken] = useState(initialSettings.cdaToken);
  const [debugLoggingEnabled, setDebugLoggingEnabledState] = useState(
    initialSettings.debugLoggingEnabled,
  );
  const [realTimeEnabled, setRealTimeEnabled] = useState(
    initialSettings.realTimeEnabled,
  );
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [migrationCompleted, setMigrationCompleted] = useState(
    pluginParams.migrationCompleted,
  );

  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>(
    pluginParams.migrationCompleted ? 'completed' : 'idle',
  );
  const [modelsWithComments, setModelsWithComments] = useState<
    ModelWithCommentLog[]
  >([]);
  const [migrationProgress, setMigrationProgress] =
    useState<MigrationProgress | null>(null);
  const [migrationResults, setMigrationResults] =
    useState<MigrationResults | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanErrors, setScanErrors] = useState<string[]>([]);
  const isMountedRef = useRef(false);
  const hasMigrationUiState =
    migrationStatus === 'scanning' ||
    migrationStatus === 'migrating' ||
    migrationStatus === 'error' ||
    migrationResults !== null ||
    modelsWithComments.length > 0 ||
    scanErrors.length > 0 ||
    showCleanupConfirm;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasMigrationUiState) {
      setIsAdvancedSettingsOpen(true);
    }
  }, [hasMigrationUiState]);

  useEffect(() => {
    setDebugLoggingEnabled(debugLoggingEnabled);
  }, [debugLoggingEnabled]);

  const trimmedCdaToken = cdaToken.trim();

  const hasChanges =
    savedSettings.cdaToken !== trimmedCdaToken ||
    savedSettings.debugLoggingEnabled !== debugLoggingEnabled ||
    savedSettings.realTimeEnabled !== realTimeEnabled;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      logDebug('Saving plugin settings', {
        debugLoggingEnabled,
        hasCdaToken: !!trimmedCdaToken,
        migrationCompleted,
        realTimeEnabled,
      });
      await ctx.updatePluginParameters(
        buildPluginParams({
          cdaToken: trimmedCdaToken,
          commentsModelIdsByEnvironment:
            pluginParams.commentsModelIdsByEnvironment,
          debugLoggingEnabled,
          realTimeUpdatesEnabled: realTimeEnabled,
          migrationCompleted,
        }),
      );
      if (!isMountedRef.current) return;
      setSavedSettings({
        cdaToken: trimmedCdaToken,
        debugLoggingEnabled,
        realTimeEnabled,
      });
      setCdaToken(trimmedCdaToken);
      logDebug('Plugin settings saved', {
        debugLoggingEnabled,
        hasCdaToken: !!trimmedCdaToken,
        migrationCompleted,
        realTimeEnabled,
      });
      ctx.notice('Settings saved successfully!');
    } catch (error) {
      if (!isMountedRef.current) return;
      ctx.alert(
        `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  const getClient = useCallback(() => {
    if (!ctx.currentUserAccessToken) return null;
    return buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
    });
  }, [ctx.currentUserAccessToken, ctx.environment]);

  const scanSingleModel = useCallback(
    async (
      model: NonNullable<(typeof ctx.itemTypes)[string]>,
      foundModels: ModelWithCommentLog[],
      _failedModels: string[],
      scannedCount: number,
      totalModels: number,
    ): Promise<{
      found: ModelWithCommentLog | null;
      failed: string | null;
    }> => {
      setScanProgress({
        phase: 'scanning-fields',
        currentModel: model.attributes.name,
        scannedModels: scannedCount,
        totalModels,
        foundCount: foundModels.length,
      });

      try {
        const fields = await ctx.loadItemTypeFields(model.id);
        const commentLogField = fields.find(
          (f) => f.attributes.api_key === 'comment_log',
        );

        if (commentLogField) {
          return {
            found: {
              modelId: model.id,
              modelName: model.attributes.name,
              modelApiKey: model.attributes.api_key,
              fieldId: commentLogField.id,
            },
            failed: null,
          };
        }

        return { found: null, failed: null };
      } catch (fieldLoadError) {
        logWarn(`Failed to load fields for model ${model.attributes.name}`, {
          modelId: model.id,
          error: fieldLoadError,
        });
        return {
          found: null,
          failed: `${model.attributes.name} (${model.attributes.api_key}) could not be inspected`,
        };
      }
    },
    [ctx],
  );

  const handleScan = useCallback(async () => {
    const nonCommentModels = Object.values(ctx.itemTypes).filter(
      (model): model is NonNullable<typeof model> =>
        model !== undefined &&
        model.attributes.api_key !== COMMENTS_MODEL_API_KEY,
    );

    logDebug('Scanning models for legacy comments', {
      totalModels: nonCommentModels.length,
    });

    setMigrationStatus('scanning');
    setMigrationError(null);
    setModelsWithComments([]);
    setScanErrors([]);
    setScanProgress({
      phase: 'scanning-fields',
      scannedModels: 0,
      totalModels: nonCommentModels.length,
      foundCount: 0,
    });

    try {
      const allModels = Object.values(ctx.itemTypes).filter(
        (model): model is NonNullable<typeof model> => model !== undefined,
      );
      const foundModels: ModelWithCommentLog[] = [];
      const failedModels: string[] = [];
      const modelsToScan = allModels.filter(
        (m) => m.attributes.api_key !== COMMENTS_MODEL_API_KEY,
      );

      let scannedCount = 0;

      const scanNextModel = async (index: number): Promise<void> => {
        if (index >= modelsToScan.length) return;
        if (!isMountedRef.current) return;

        const model = modelsToScan[index];
        const { found, failed } = await scanSingleModel(
          model,
          foundModels,
          failedModels,
          scannedCount,
          modelsToScan.length,
        );

        if (found) foundModels.push(found);
        if (failed) failedModels.push(failed);

        scannedCount++;
        if (!isMountedRef.current) return;

        setScanProgress({
          phase: 'scanning-fields',
          currentModel: model.attributes.name,
          scannedModels: scannedCount,
          totalModels: modelsToScan.length,
          foundCount: foundModels.length,
        });

        return scanNextModel(index + 1);
      };

      await scanNextModel(0);

      if (!isMountedRef.current) return;
      setModelsWithComments(foundModels);
      setScanErrors(failedModels);
      setScanProgress(null);
      logDebug('Legacy comment scan completed', {
        foundModels: foundModels.length,
        inspectionErrors: failedModels.length,
      });

      setMigrationStatus('idle');
      await ctx.notice(
        buildScanNoticeMessage(foundModels.length, failedModels.length),
      );
    } catch (error) {
      if (!isMountedRef.current) return;
      logDebug('Legacy comment scan failed', {
        message:
          error instanceof Error ? error.message : 'Unknown error during scan',
      });
      setMigrationStatus('error');
      setScanProgress(null);
      setMigrationError(
        error instanceof Error ? error.message : 'Unknown error during scan',
      );
    }
  }, [ctx, scanSingleModel]);

  const migrateRecord = useCallback(
    async (
      client: ReturnType<typeof getClient>,
      record: MigrationRecord,
      modelInfo: ModelWithCommentLog,
      commentsModelId: string,
      results: MigrationResults,
    ): Promise<void> => {
      if (!client) return;

      const commentsArray = parseCommentLog(record.comment_log, record.id);
      if (!commentsArray || commentsArray.length === 0) return;

      const normalizedComments = normalizeCommentsFromArray(
        commentsArray,
        record,
        modelInfo,
        results,
      );

      if (normalizedComments.length === 0) {
        results.failed++;
        results.errors.push(
          `Record ${record.id} in ${modelInfo.modelName}: all legacy comments were malformed`,
        );
        return;
      }

      const { comments: migratedComments } =
        migrateCommentsToUuid(normalizedComments);

      await createOrSkipCommentRecord(
        client,
        record,
        modelInfo,
        commentsModelId,
        migratedComments,
        results,
      );
    },
    [],
  );

  const migrateModelRecords = useCallback(
    async (
      client: NonNullable<ReturnType<typeof getClient>>,
      modelInfo: ModelWithCommentLog,
      commentsModelId: string,
      processedModels: number,
      results: MigrationResults,
    ): Promise<void> => {
      if (!isMountedRef.current) return;

      setMigrationProgress({
        currentModel: modelInfo.modelName,
        currentRecord: 0,
        totalRecords: 0,
        processedModels,
        totalModels: modelsWithComments.length,
      });

      const allRecords = await fetchAllRecordsForModel(
        client,
        modelInfo.modelApiKey,
      );
      const totalRecords = allRecords.length;

      const processRecordAt = async (index: number): Promise<void> => {
        if (index >= allRecords.length) return;
        if (!isMountedRef.current) return;

        const record = allRecords[index];
        setMigrationProgress({
          currentModel: modelInfo.modelName,
          currentRecord: index + 1,
          totalRecords,
          processedModels,
          totalModels: modelsWithComments.length,
        });

        await migrateRecord(
          client,
          record,
          modelInfo,
          commentsModelId,
          results,
        );

        if ((index + 1) % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return processRecordAt(index + 1);
      };

      await processRecordAt(0);
    },
    [migrateRecord, modelsWithComments.length],
  );

  const finalizeMigrationSuccess = useCallback(async (): Promise<void> => {
    if (!isMountedRef.current) return;
    setMigrationCompleted(true);
    setSavedSettings({
      cdaToken: trimmedCdaToken,
      debugLoggingEnabled,
      realTimeEnabled,
    });
    setCdaToken(trimmedCdaToken);
    await ctx.updatePluginParameters(
      buildPluginParams({
        cdaToken: trimmedCdaToken,
        commentsModelIdsByEnvironment:
          pluginParams.commentsModelIdsByEnvironment,
        debugLoggingEnabled,
        realTimeUpdatesEnabled: realTimeEnabled,
        migrationCompleted: true,
      }),
    );
    await ctx.notice('Migration completed successfully!');
  }, [
    ctx,
    debugLoggingEnabled,
    pluginParams.commentsModelIdsByEnvironment,
    realTimeEnabled,
    trimmedCdaToken,
  ]);

  const runMigration = useCallback(
    async (
      client: NonNullable<ReturnType<typeof getClient>>,
      results: MigrationResults,
    ): Promise<void> => {
      const commentsModel = Object.values(ctx.itemTypes).find(
        (model) => model?.attributes.api_key === COMMENTS_MODEL_API_KEY,
      );

      if (!commentsModel) {
        throw new Error(
          'project_comment model not found. Please reload the plugin to create it.',
        );
      }

      const migrateModelAt = async (index: number): Promise<void> => {
        if (index >= modelsWithComments.length) return;
        if (!isMountedRef.current) return;

        const modelInfo = modelsWithComments[index];
        await migrateModelRecords(
          client,
          modelInfo,
          commentsModel.id,
          index,
          results,
        );

        return migrateModelAt(index + 1);
      };

      await migrateModelAt(0);
    },
    [ctx, migrateModelRecords, modelsWithComments],
  );

  const handleMigrate = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert(
        'Unable to access API. Please ensure you have proper permissions.',
      );
      return;
    }

    if (modelsWithComments.length === 0) {
      ctx.alert('No models to migrate. Please scan first.');
      return;
    }

    setMigrationStatus('migrating');
    setMigrationError(null);
    setMigrationResults(null);

    const results: MigrationResults = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      warnings: [],
    };

    try {
      logDebug('Starting legacy comment migration', {
        modelsToMigrate: modelsWithComments.length,
      });

      await runMigration(client, results);

      if (!isMountedRef.current) return;
      setMigrationResults(results);
      setMigrationProgress(null);
      logDebug('Legacy comment migration completed', {
        failed: results.failed,
        skipped: results.skipped,
        success: results.success,
        warnings: results.warnings.length,
      });

      setMigrationStatus('completed');

      if (results.failed === 0) {
        await finalizeMigrationSuccess();
      } else {
        await ctx.notice(
          `Migration completed with ${results.failed} error(s). Check details below.`,
        );
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error during migration';
      logDebug('Legacy comment migration failed', { message: errorMessage });
      setMigrationStatus('error');
      setMigrationError(errorMessage);
      setMigrationProgress(null);
    }
  }, [
    ctx,
    finalizeMigrationSuccess,
    getClient,
    modelsWithComments.length,
    runMigration,
  ]);

  const destroyFieldsSequentially = useCallback(
    async (
      client: NonNullable<ReturnType<typeof getClient>>,
      fieldIds: string[],
      index: number,
    ): Promise<void> => {
      if (index >= fieldIds.length) return;
      if (!isMountedRef.current) return;
      await client.fields.destroy(fieldIds[index]);
      return destroyFieldsSequentially(client, fieldIds, index + 1);
    },
    [],
  );

  const runCleanupOperation = useCallback(
    async (
      client: NonNullable<ReturnType<typeof getClient>>,
      fieldIds: string[],
    ): Promise<void> => {
      logDebug('Deleting legacy comment_log fields', {
        fieldsToDelete: fieldIds.length,
      });

      await destroyFieldsSequentially(client, fieldIds, 0);

      if (!isMountedRef.current) return;
      setModelsWithComments([]);
      logDebug('Legacy comment_log field cleanup completed');
      await ctx.notice(
        'Old comment_log fields have been deleted successfully!',
      );
    },
    [ctx, destroyFieldsSequentially],
  );

  const handleCleanup = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert(
        'Unable to access API. Please ensure you have proper permissions.',
      );
      return;
    }

    setIsCleaningUp(true);
    setShowCleanupConfirm(false);

    const fieldIds = modelsWithComments.map((m) => m.fieldId);

    try {
      await runCleanupOperation(client, fieldIds);
    } catch (error) {
      if (!isMountedRef.current) return;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logDebug('Legacy comment_log field cleanup failed', {
        message: errorMessage,
      });
      ctx.alert(`Error deleting fields: ${errorMessage}`);
    } finally {
      if (isMountedRef.current) {
        setIsCleaningUp(false);
      }
    }
  }, [ctx, getClient, modelsWithComments, runCleanupOperation]);

  const renderScanProgress = () => {
    if (migrationStatus !== 'scanning' || !scanProgress) return null;
    const scanPercentage =
      scanProgress.totalModels > 0
        ? (scanProgress.scannedModels / scanProgress.totalModels) * 100
        : 0;

    return (
      <div className={styles.scanProgressContainer}>
        <div className={styles.scanProgressHeader}>
          <span className={styles.scanPhaseLabel}>
            Checking model fields...
          </span>
          <span className={styles.scanProgressCount}>
            {scanProgress.scannedModels} / {scanProgress.totalModels}
          </span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${scanPercentage}%` }}
          />
        </div>
        <div className={styles.scanDetails}>
          {scanProgress.currentModel && (
            <span className={styles.scanCurrentModel}>
              Checking: <strong>{scanProgress.currentModel}</strong>
            </span>
          )}
          <span className={styles.scanFoundCounter}>
            {scanProgress.foundCount} legacy field
            {scanProgress.foundCount !== 1 ? 's' : ''} found
          </span>
        </div>
      </div>
    );
  };

  const renderMigrationProgress = () => {
    if (migrationStatus !== 'migrating' || !migrationProgress) return null;
    const migrationPercentage =
      migrationProgress.totalRecords > 0
        ? (migrationProgress.currentRecord / migrationProgress.totalRecords) *
          100
        : 0;

    return (
      <div className={styles.progressContainer}>
        <div className={styles.progressHeader}>
          <span>
            Migrating: {migrationProgress.currentModel} (
            {migrationProgress.processedModels + 1}/
            {migrationProgress.totalModels} models)
          </span>
          <span>
            Record {migrationProgress.currentRecord}/
            {migrationProgress.totalRecords}
          </span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${migrationPercentage}%` }}
          />
        </div>
      </div>
    );
  };

  const renderMigrationResults = () => {
    if (!migrationResults) return null;

    return (
      <div className={styles.resultsContainer}>
        <h3 className={styles.migrationSubtitle}>Migration Results</h3>
        <div className={styles.resultsGrid}>
          <div className={styles.resultItem}>
            <span className={styles.resultNumber}>
              {migrationResults.success}
            </span>
            <span className={styles.resultLabel}>Migrated</span>
          </div>
          <div className={styles.resultItem}>
            <span className={styles.resultNumber}>
              {migrationResults.skipped}
            </span>
            <span className={styles.resultLabel}>
              Skipped (already migrated)
            </span>
          </div>
          <div className={styles.resultItem}>
            <span className={styles.resultNumber}>
              {migrationResults.failed}
            </span>
            <span className={styles.resultLabel}>Failed</span>
          </div>
        </div>

        {migrationResults.errors.length > 0 && (
          <div className={styles.errorList}>
            <h4>Errors:</h4>
            <ul>
              {migrationResults.errors.slice(0, 10).map((err) => (
                <li key={err}>{err}</li>
              ))}
              {migrationResults.errors.length > 10 && (
                <li>
                  ...and {migrationResults.errors.length - 10} more errors
                </li>
              )}
            </ul>
          </div>
        )}

        {migrationResults.warnings.length > 0 && (
          <div className={styles.errorList}>
            <h4>Warnings:</h4>
            <ul>
              {migrationResults.warnings.slice(0, 10).map((warning) => (
                <li
                  key={`${warning.modelName}-${warning.recordId}-${warning.message}`}
                >
                  {warning.modelName} / {warning.recordId}: {warning.message}
                </li>
              ))}
              {migrationResults.warnings.length > 10 && (
                <li>
                  ...and {migrationResults.warnings.length - 10} more warnings
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderCleanupSection = () => {
    if (migrationStatus !== 'completed' || modelsWithComments.length === 0) {
      return null;
    }

    return (
      <div className={styles.cleanupSection}>
        <h3 className={styles.migrationSubtitle}>Cleanup Old Fields</h3>
        <p className={styles.description}>
          After verifying the migration was successful, you can optionally
          delete the old <code className={styles.code}>comment_log</code> fields
          from your models.
        </p>
        <div className={styles.dangerBox}>
          <div className={styles.dangerIcon}>⚠️</div>
          <div>
            <strong>Warning:</strong> This action is irreversible. Only proceed
            if you have verified that all comments were migrated successfully.
          </div>
        </div>
        {!showCleanupConfirm ? (
          <div className={styles.migrationActions}>
            <Button
              buttonType="negative"
              onClick={() => setShowCleanupConfirm(true)}
              disabled={isCleaningUp}
            >
              Delete Old comment_log Fields
            </Button>
          </div>
        ) : (
          <div className={styles.confirmDialog}>
            <p>
              Are you sure you want to delete {modelsWithComments.length}{' '}
              comment_log field(s)?
            </p>
            <div className={styles.confirmActions}>
              <Button
                buttonType="negative"
                onClick={handleCleanup}
                disabled={isCleaningUp}
              >
                {isCleaningUp ? (
                  <>
                    <Spinner size={16} /> Deleting...
                  </>
                ) : (
                  'Yes, Delete Fields'
                )}
              </Button>
              <Button
                buttonType="muted"
                onClick={() => setShowCleanupConfirm(false)}
                disabled={isCleaningUp}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMigrationSection = () => {
    return (
      <div>
        <h3 className={styles.migrationSubtitle}>
          Migration from Legacy System
        </h3>
        <p className={styles.description}>
          If you were using an older version of this plugin that stored comments
          in a <code className={styles.code}>comment_log</code> field on each
          model, you can migrate those comments to the new centralized system.
        </p>

        {migrationStatus === 'idle' && modelsWithComments.length > 0 && (
          <div className={styles.warningBox}>
            <div className={styles.warningIcon}>!</div>
            <div>
              <strong>Important:</strong> Please ensure no one is editing
              comments during the migration process to avoid data loss.
            </div>
          </div>
        )}

        {migrationStatus !== 'completed' && (
          <div className={styles.migrationActions}>
            <Button
              buttonType="muted"
              onClick={handleScan}
              disabled={
                migrationStatus === 'scanning' ||
                migrationStatus === 'migrating'
              }
            >
              {migrationStatus === 'scanning' ? (
                <>
                  <Spinner size={16} /> Scanning...
                </>
              ) : (
                'Scan for Legacy Comments'
              )}
            </Button>
          </div>
        )}

        {renderScanProgress()}

        {scanErrors.length > 0 && (
          <div className={styles.errorList}>
            <h4>Models not inspected</h4>
            <ul>
              {scanErrors.map((scanError) => (
                <li key={scanError}>{scanError}</li>
              ))}
            </ul>
          </div>
        )}

        {modelsWithComments.length > 0 && migrationStatus !== 'migrating' && (
          <div className={styles.migrationModels}>
            <h3 className={styles.migrationSubtitle}>
              Found {modelsWithComments.length} model(s) with comment_log field:
            </h3>
            <ul className={styles.modelList}>
              {modelsWithComments.map((m) => (
                <li key={m.modelId} className={styles.modelItem}>
                  <span className={styles.modelName}>{m.modelName}</span>
                  <span className={styles.modelApiKey}>({m.modelApiKey})</span>
                </li>
              ))}
            </ul>
            {migrationStatus !== 'completed' && (
              <div className={styles.migrationActions}>
                <Button buttonType="primary" onClick={handleMigrate}>
                  Start Migration
                </Button>
              </div>
            )}
          </div>
        )}

        {renderMigrationProgress()}

        {migrationStatus === 'error' && migrationError && (
          <div className={styles.errorBox}>
            <div className={styles.errorIcon}>✕</div>
            <div>
              <strong>Error:</strong> {migrationError}
            </div>
          </div>
        )}

        {renderMigrationResults()}
        {renderCleanupSection()}

        {migrationStatus === 'completed' && modelsWithComments.length === 0 && (
          <div className={styles.successBox}>
            <div className={styles.successIcon}>✓</div>
            <div>
              <strong>Migration complete!</strong> All comments have been
              migrated to the new system and old fields have been cleaned up.
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Canvas ctx={ctx}>
      <div className={styles.container}>
        <p className={styles.intro}>
          This plugin adds a <strong>sidebar panel</strong> to every record for
          threaded discussions. Use rich mentions to reference users, fields,
          records, assets, and models directly in your comments with slash
          commands (type / to see all options).
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Configuration</h2>
          <p className={styles.description}>
            Configure how record comments synchronize across users. Real-time
            updates are recommended for the best collaborative experience.
          </p>

          <div className={styles.formField}>
            <SwitchField
              id="realtime-toggle"
              name="realtime-toggle"
              label="Enable Real-Time Updates (Recommended)"
              hint="When enabled, comments update instantly across all users. Requires a Content Delivery API token."
              value={realTimeEnabled}
              onChange={(newValue) => setRealTimeEnabled(newValue)}
            />
          </div>

          {realTimeEnabled && (
            <div className={styles.formField}>
              <TextField
                id="cda-token"
                name="cda-token"
                label="Content Delivery API Token"
                hint="You can find this in Project Settings → API Tokens. Use a token with read access."
                value={cdaToken}
                onChange={(newValue) => setCdaToken(newValue)}
                textInputProps={{ monospaced: true }}
              />
            </div>
          )}

          <div className={styles.advancedSettings}>
            <Section
              title="Advanced settings"
              collapsible={{
                isOpen: isAdvancedSettingsOpen,
                onToggle: () => setIsAdvancedSettingsOpen((isOpen) => !isOpen),
              }}
            >
              <div className={styles.advancedSettingsContent}>
                <div className={styles.formField}>
                  <SwitchField
                    id="debug-logging-toggle"
                    name="debug-logging-toggle"
                    label="Enable Debug logging"
                    hint="When enabled, the plugin writes detailed browser-console diagnostics for troubleshooting."
                    value={debugLoggingEnabled}
                    onChange={(newValue) =>
                      setDebugLoggingEnabledState(newValue)
                    }
                  />
                </div>

                <div className={styles.nestedSection}>
                  {renderMigrationSection()}
                </div>
              </div>
            </Section>
          </div>

          <div className={styles.buttonRow}>
            <Button
              buttonType="primary"
              onClick={handleSave}
              disabled={
                isSaving || !hasChanges || (realTimeEnabled && !trimmedCdaToken)
              }
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </div>
    </Canvas>
  );
};

export default ConfigScreen;

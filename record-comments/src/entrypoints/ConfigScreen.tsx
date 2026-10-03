import styles from '@styles/configscreen.module.css';
import {
  buildLegacyUserIdsByEmail,
  emptyMigrationResults,
  type MigrationProgress,
  type MigrationResults,
  type LegacyModel as ModelWithCommentLog,
  retryMigrationRead,
  runLegacyMigration,
} from '@utils/legacyMigration';
import { hasUnrestrictedModelReadPermission } from '@utils/permissions';
import { buildPluginParams, parsePluginParams } from '@utils/pluginParams';
import {
  currentUserToUserInfo,
  ownerToUserInfo,
  transformUsersToUserInfo,
} from '@utils/userTransformers';
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
import { createApiClient } from '@/utils/cmaClient';
import { logDebug, logWarn, setDebugLoggingEnabled } from '@/utils/errorLogger';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

function cleanupErrorMessage(error: unknown) {
  return `Error deleting fields: ${error instanceof Error ? error.message : 'Unknown error'}`;
}

function assertMigrationReadPermissions(
  ctx: RenderConfigScreenCtx,
  models: ModelWithCommentLog[],
  commentsModelId: string,
) {
  if (ctx.currentUser.id === ctx.owner.id) return;
  const modelIds = [...models.map((model) => model.modelId), commentsModelId];
  for (const modelId of modelIds) {
    if (!hasUnrestrictedModelReadPermission(ctx, modelId))
      throw new Error(
        'Migration and cleanup require unrestricted read access to every source and comments model. Restricted permissions can hide legacy comments.',
      );
  }
}

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

type MigrationStatus =
  | 'idle'
  | 'scanning'
  | 'migrating'
  | 'completed'
  | 'error';

type ScanProgress = {
  phase: 'scanning-fields';
  currentModel?: string;
  scannedModels: number;
  totalModels: number;
  foundCount: number;
};

async function deleteVerifiedLegacyField(
  client: NonNullable<ReturnType<typeof createApiClient>>,
  model: ModelWithCommentLog,
  signal: AbortSignal,
) {
  await retryMigrationRead(async () => {
    const fields = await client.fields.list(model.modelId);
    const field = fields.find((candidate) => candidate.id === model.fieldId);
    // A lost DELETE response can leave the field already removed. The full
    // source/destination verification happened before this helper was called.
    if (!field) return;
    if (
      field.api_key !== 'comment_log' ||
      field.localized !== (model.localized ?? false)
    ) {
      throw new Error(
        `Legacy field changed in ${model.modelName}; cleanup stopped.`,
      );
    }
    if (signal.aborted) throw new Error('Cleanup stopped.');
    try {
      await client.fields.destroy(model.fieldId);
    } catch (error) {
      const remaining = await retryMigrationRead(
        () => client.fields.list(model.modelId),
        signal,
      );
      if (remaining.some((candidate) => candidate.id === model.fieldId))
        throw error;
    }
  }, signal);
}

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

  const [migrationStatus, setMigrationStatus] =
    useState<MigrationStatus>('idle');
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
  const operationController = useRef<AbortController | null>(null);
  const operationScope = `${ctx.site?.id ?? ''}:${ctx.environment}`;
  const previousOperationScope = useRef(operationScope);
  const isCurrentScope = useCallback(
    () =>
      isMountedRef.current && previousOperationScope.current === operationScope,
    [operationScope],
  );
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
      operationController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (previousOperationScope.current === operationScope) return;
    previousOperationScope.current = operationScope;
    operationController.current?.abort();
    setMigrationCompleted(false);
    setMigrationStatus('idle');
    setModelsWithComments([]);
    setMigrationResults(null);
    setMigrationProgress(null);
    setMigrationError(null);
    setScanProgress(null);
    setScanErrors([]);
    setIsCleaningUp(false);
    setShowCleanupConfirm(false);
  }, [operationScope]);

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
      if (!isCurrentScope()) return;
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
      if (!isCurrentScope()) return;
      ctx.alert(
        `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      if (isCurrentScope()) {
        setIsSaving(false);
      }
    }
  };

  const getClient = useCallback(() => {
    return createApiClient(
      ctx.currentUserAccessToken,
      ctx.environment,
      ctx.cmaBaseUrl,
      { autoRetry: false, requestTimeout: 30000 },
    );
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

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
        const fields = await retryMigrationRead(
          () => ctx.loadItemTypeFields(model.id),
          operationController.current?.signal ?? new AbortController().signal,
        );
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
              localized: commentLogField.attributes.localized,
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

  const inspectModels = useCallback(
    async (
      modelsToScan: Array<NonNullable<(typeof ctx.itemTypes)[string]>>,
    ) => {
      const foundModels: ModelWithCommentLog[] = [];
      const failedModels: string[] = [];
      let scannedCount = 0;
      for (const model of modelsToScan) {
        if (!isCurrentScope()) return { foundModels, failedModels };
        // biome-ignore lint/performance/noAwaitInLoops: Bound schema reads while scanning many models.
        const result = await scanSingleModel(
          model,
          foundModels,
          failedModels,
          scannedCount,
          modelsToScan.length,
        );
        if (result.found) foundModels.push(result.found);
        if (result.failed) failedModels.push(result.failed);
        scannedCount++;
        if (!isCurrentScope()) return { foundModels, failedModels };
        setScanProgress({
          phase: 'scanning-fields',
          currentModel: model.attributes.name,
          scannedModels: scannedCount,
          totalModels: modelsToScan.length,
          foundCount: foundModels.length,
        });
      }
      return { foundModels, failedModels };
    },
    [scanSingleModel, isCurrentScope],
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

    operationController.current?.abort();
    operationController.current = new AbortController();
    setMigrationCompleted(false);
    setMigrationResults(null);
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
      const { foundModels, failedModels } =
        await inspectModels(nonCommentModels);

      if (!isCurrentScope()) return;
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
      if (!isCurrentScope()) return;
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
  }, [ctx, inspectModels, isCurrentScope]);

  const finalizeMigrationSuccess = useCallback(async (): Promise<void> => {
    if (!isCurrentScope()) return;
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
    if (!isCurrentScope()) return;
    setSavedSettings({
      cdaToken: trimmedCdaToken,
      debugLoggingEnabled,
      realTimeEnabled,
    });
    setCdaToken(trimmedCdaToken);
    setMigrationCompleted(true);
    await ctx.notice('Migration completed successfully!');
  }, [
    ctx,
    isCurrentScope,
    debugLoggingEnabled,
    pluginParams.commentsModelIdsByEnvironment,
    realTimeEnabled,
    trimmedCdaToken,
  ]);

  const runMigration = useCallback(
    async (
      client: NonNullable<ReturnType<typeof getClient>>,
      results: MigrationResults,
      verifyOnly = false,
      onModelVerified?: (model: ModelWithCommentLog) => Promise<void>,
    ): Promise<void> => {
      const commentsModel = Object.values(ctx.itemTypes).find(
        (model) => model?.attributes.api_key === COMMENTS_MODEL_API_KEY,
      );
      if (!commentsModel)
        throw new Error(
          'project_comment model not found. Please reload the plugin to create it.',
        );
      assertMigrationReadPermissions(ctx, modelsWithComments, commentsModel.id);
      const controller = new AbortController();
      operationController.current?.abort();
      operationController.current = controller;
      const [regularUsers, ssoUsers] = await Promise.all([
        retryMigrationRead(() => ctx.loadUsers(), controller.signal),
        retryMigrationRead(() => ctx.loadSsoUsers(), controller.signal),
      ]);
      const users = [
        currentUserToUserInfo(ctx.currentUser),
        ownerToUserInfo(ctx.owner),
        ...transformUsersToUserInfo(regularUsers, ssoUsers),
      ];
      const userIdsByEmail = buildLegacyUserIdsByEmail(users);
      await runLegacyMigration(
        {
          client,
          commentsModelId: commentsModel.id,
          models: modelsWithComments,
          userIdsByEmail,
          signal: controller.signal,
          verifyOnly,
          onModelVerified,
          onProgress: (progress) => {
            if (isCurrentScope()) setMigrationProgress(progress);
          },
        },
        results,
      );
    },
    [ctx, modelsWithComments, isCurrentScope],
  );

  const completeMigration = useCallback(
    async (results: MigrationResults) => {
      if (!isCurrentScope()) return;
      setMigrationResults(results);
      setMigrationProgress(null);
      logDebug('Legacy comment migration completed', {
        failed: results.failed,
        skipped: results.skipped,
        success: results.success,
      });

      setMigrationStatus(results.failed === 0 ? 'completed' : 'error');

      if (results.failed === 0) {
        await finalizeMigrationSuccess();
      } else {
        await ctx.notice(
          `Migration completed with ${results.failed} error(s). Check details below.`,
        );
      }
    },
    [ctx, finalizeMigrationSuccess, isCurrentScope],
  );

  const handleMigrate = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert(
        'Unable to access API. Please ensure you have proper permissions.',
      );
      return;
    }

    if (scanErrors.length > 0) {
      ctx.alert(
        'Some models could not be inspected. Run the scan successfully before migrating.',
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

    const results = emptyMigrationResults();

    try {
      logDebug('Starting legacy comment migration', {
        modelsToMigrate: modelsWithComments.length,
      });

      await runMigration(client, results);

      await completeMigration(results);
    } catch (error) {
      if (!isCurrentScope()) return;
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error during migration';
      logDebug('Legacy comment migration failed', { message: errorMessage });
      setMigrationResults(results);
      setMigrationCompleted(false);
      setMigrationStatus('error');
      setMigrationError(errorMessage);
      setMigrationProgress(null);
    }
  }, [
    ctx,
    completeMigration,
    isCurrentScope,
    getClient,
    modelsWithComments.length,
    scanErrors.length,
    runMigration,
  ]);

  const verifyAndCleanModels = useCallback(
    async (
      client: NonNullable<ReturnType<typeof getClient>>,
      verified: MigrationResults,
      removed: Set<string>,
    ) => {
      // Re-read every source and destination immediately before removing each model field.
      await runMigration(client, verified, true, async (model) => {
        const signal =
          operationController.current?.signal ?? new AbortController().signal;
        await deleteVerifiedLegacyField(client, model, signal);
        removed.add(model.fieldId);
      });
      if (verified.failed > 0)
        throw new Error(
          `${verified.failed} record(s) failed verification. Their legacy fields were preserved. ${verified.errors.join(' ')}`,
        );
    },
    [runMigration],
  );

  const canCleanup =
    migrationCompleted &&
    migrationResults?.failed === 0 &&
    scanErrors.length === 0;
  const finishCleanup = useCallback(
    (removed: Set<string>) => {
      if (!isCurrentScope()) return;
      setModelsWithComments((models) =>
        models.filter((model) => !removed.has(model.fieldId)),
      );
      setMigrationProgress(null);
      setIsCleaningUp(false);
    },
    [isCurrentScope],
  );
  const handleCleanup = useCallback(async () => {
    const client = getClient();
    if (!client) {
      await ctx.alert(
        'Unable to access API. Please ensure you have proper permissions.',
      );
      return;
    }
    if (!canCleanup) {
      await ctx.alert(
        'Cleanup requires a complete successful migration and scan.',
      );
      return;
    }
    setIsCleaningUp(true);
    setShowCleanupConfirm(false);
    const verified = emptyMigrationResults();
    const removed = new Set<string>();
    try {
      await verifyAndCleanModels(client, verified, removed);
      if (!isCurrentScope()) return;
      await ctx.notice(
        'Old comment_log fields have been deleted successfully!',
      );
    } catch (error) {
      if (isCurrentScope()) await ctx.alert(cleanupErrorMessage(error));
    } finally {
      finishCleanup(removed);
    }
  }, [
    ctx,
    getClient,
    canCleanup,
    verifyAndCleanModels,
    finishCleanup,
    isCurrentScope,
  ]);

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
    if (
      (migrationStatus !== 'migrating' && !isCleaningUp) ||
      !migrationProgress
    )
      return null;
    const migrationPercentage =
      migrationProgress.totalRecords > 0
        ? (migrationProgress.currentRecord / migrationProgress.totalRecords) *
          100
        : 0;

    return (
      <div className={styles.progressContainer}>
        <div className={styles.progressHeader}>
          <span>
            {isCleaningUp ? 'Verifying' : 'Migrating'}:{' '}
            {migrationProgress.currentModel} (
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
              {migrationResults.failed > 10 && (
                <li>...and {migrationResults.failed - 10} more errors</li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderCleanupSection = () => {
    if (
      migrationStatus !== 'completed' ||
      !migrationCompleted ||
      migrationResults?.failed !== 0 ||
      modelsWithComments.length === 0
    ) {
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

        {(migrationStatus !== 'completed' ||
          modelsWithComments.length === 0) && (
          <div className={styles.migrationActions}>
            <Button
              buttonType="muted"
              onClick={handleScan}
              disabled={
                migrationStatus === 'scanning' ||
                migrationStatus === 'migrating' ||
                isCleaningUp
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
                <Button
                  buttonType="primary"
                  onClick={handleMigrate}
                  disabled={scanErrors.length > 0 || isCleaningUp}
                >
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
              fullWidth
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

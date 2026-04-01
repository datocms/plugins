import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import {
  Button,
  Canvas,
  Section,
  Spinner,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { useState, useCallback, useEffect, useRef } from 'react';
import styles from '@styles/configscreen.module.css';
import { COMMENTS_MODEL_API_KEY } from '@/constants';
import { buildPluginParams, parsePluginParams } from '@utils/pluginParams';
import {
  logDebug,
  logWarn,
  setDebugLoggingEnabled,
} from '@/utils/errorLogger';
import {
  migrateCommentsToUuid,
  normalizeCommentIfValid,
} from '@utils/migrations';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type MigrationStatus = 'idle' | 'scanning' | 'migrating' | 'completed' | 'error';

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
    initialSettings.debugLoggingEnabled
  );
  const [realTimeEnabled, setRealTimeEnabled] = useState(initialSettings.realTimeEnabled);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [migrationCompleted, setMigrationCompleted] = useState(
    pluginParams.migrationCompleted
  );

  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>(
    pluginParams.migrationCompleted ? 'completed' : 'idle'
  );
  const [modelsWithComments, setModelsWithComments] = useState<ModelWithCommentLog[]>([]);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationResults, setMigrationResults] = useState<MigrationResults | null>(null);
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
          commentsModelIdsByEnvironment: pluginParams.commentsModelIdsByEnvironment,
          debugLoggingEnabled,
          realTimeUpdatesEnabled: realTimeEnabled,
          migrationCompleted,
        })
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
        `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  const getClient = useCallback(() => {
    if (!ctx.currentUserAccessToken) return null;
    return buildClient({ apiToken: ctx.currentUserAccessToken });
  }, [ctx.currentUserAccessToken]);

  const handleScan = useCallback(async () => {
    logDebug('Scanning models for legacy comments', {
      totalModels: Object.values(ctx.itemTypes).filter(
        (model): model is NonNullable<typeof model> =>
          model !== undefined &&
          model.attributes.api_key !== COMMENTS_MODEL_API_KEY
      ).length,
    });
    setMigrationStatus('scanning');
    setMigrationError(null);
    setModelsWithComments([]);
    setScanErrors([]);
    setScanProgress({
      phase: 'scanning-fields',
      scannedModels: 0,
      totalModels: Object.values(ctx.itemTypes).filter(
        (model): model is NonNullable<typeof model> =>
          model !== undefined &&
          model.attributes.api_key !== COMMENTS_MODEL_API_KEY
      ).length,
      foundCount: 0,
    });

    try {
      const models = Object.values(ctx.itemTypes).filter(
        (model): model is NonNullable<typeof model> => model !== undefined
      );
      const foundModels: ModelWithCommentLog[] = [];
      const failedModels: string[] = [];
      const modelsToScan = models.filter((m) => m.attributes.api_key !== COMMENTS_MODEL_API_KEY);

      let scannedCount = 0;

      for (const model of modelsToScan) {
        if (!isMountedRef.current) return;

        setScanProgress({
          phase: 'scanning-fields',
          currentModel: model.attributes.name,
          scannedModels: scannedCount,
          totalModels: modelsToScan.length,
          foundCount: foundModels.length,
        });

        try {
          const fields = await ctx.loadItemTypeFields(model.id);
          const commentLogField = fields.find((f) => f.attributes.api_key === 'comment_log');

          if (commentLogField) {
            foundModels.push({
              modelId: model.id,
              modelName: model.attributes.name,
              modelApiKey: model.attributes.api_key,
              fieldId: commentLogField.id,
            });
          }
        } catch (fieldLoadError) {
          failedModels.push(
            `${model.attributes.name} (${model.attributes.api_key}) could not be inspected`
          );
          logWarn(`Failed to load fields for model ${model.attributes.name}`, { modelId: model.id, error: fieldLoadError });
        }

        scannedCount++;
        if (!isMountedRef.current) return;
        setScanProgress({
          phase: 'scanning-fields',
          currentModel: model.attributes.name,
          scannedModels: scannedCount,
          totalModels: modelsToScan.length,
          foundCount: foundModels.length,
        });
      }

      if (!isMountedRef.current) return;
      setModelsWithComments(foundModels);
      setScanErrors(failedModels);
      setScanProgress(null);
      logDebug('Legacy comment scan completed', {
        foundModels: foundModels.length,
        inspectionErrors: failedModels.length,
      });

      if (failedModels.length > 0) {
        setMigrationStatus('idle');
        await ctx.notice(
          `Scan completed with ${failedModels.length} inspection error(s). Review the details below before migrating.`
        );
      } else if (foundModels.length === 0) {
        setMigrationStatus('idle');
        await ctx.notice('No legacy comment_log fields found. Nothing to migrate!');
      } else {
        setMigrationStatus('idle');
        await ctx.notice(`Found ${foundModels.length} model(s) with comment_log fields.`);
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      logDebug('Legacy comment scan failed', {
        message: error instanceof Error ? error.message : 'Unknown error during scan',
      });
      setMigrationStatus('error');
      setScanProgress(null);
      setMigrationError(error instanceof Error ? error.message : 'Unknown error during scan');
    }
  }, [ctx]);

  const handleMigrate = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert('Unable to access API. Please ensure you have proper permissions.');
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
      const commentsModel = Object.values(ctx.itemTypes).find(
        (model) => model?.attributes.api_key === COMMENTS_MODEL_API_KEY
      );

      if (!commentsModel) {
        throw new Error(
          'project_comment model not found. Please reload the plugin to create it.'
        );
      }

      let processedModels = 0;

      for (const modelInfo of modelsWithComments) {
        if (!isMountedRef.current) return;

        setMigrationProgress({
          currentModel: modelInfo.modelName,
          currentRecord: 0,
          totalRecords: 0,
          processedModels,
          totalModels: modelsWithComments.length,
        });

        const allRecords: Array<{ id: string; comment_log: unknown }> = [];

        for await (const record of client.items.listPagedIterator({
          filter: { type: modelInfo.modelApiKey },
        })) {
          allRecords.push({
            id: record.id,
            comment_log: record.comment_log,
          });
        }

        let currentRecord = 0;
        const totalRecords = allRecords.length;

        for (const record of allRecords) {
          if (!isMountedRef.current) return;

          currentRecord++;
          setMigrationProgress({
            currentModel: modelInfo.modelName,
            currentRecord,
            totalRecords,
            processedModels,
            totalModels: modelsWithComments.length,
          });

          const commentLog = record.comment_log;
          if (!commentLog) continue;

          let commentsArray: unknown[];
          if (typeof commentLog === 'string') {
            try {
              const parsed = JSON.parse(commentLog);
              if (!Array.isArray(parsed)) continue;
              commentsArray = parsed;
            } catch (parseError) {
              logWarn('Skipping record with invalid JSON comment_log', { recordId: record.id, error: parseError });
              continue;
            }
          } else if (Array.isArray(commentLog)) {
            commentsArray = commentLog;
          } else {
            continue;
          }

          if (commentsArray.length === 0) continue;

          const normalizedComments = commentsArray.flatMap((comment) => {
            const normalizedComment = normalizeCommentIfValid(comment);
            if (!normalizedComment) {
              return [];
            }

            return [normalizedComment];
          });

          const skippedInvalidComments = commentsArray.length - normalizedComments.length;
          if (skippedInvalidComments > 0) {
            results.warnings.push({
              recordId: record.id,
              modelName: modelInfo.modelName,
              message:
                skippedInvalidComments === commentsArray.length
                  ? 'All legacy comments were malformed and were skipped.'
                  : `${skippedInvalidComments} malformed legacy comment(s) were skipped during migration.`,
            });
          }

          if (normalizedComments.length === 0) {
            results.failed++;
            results.errors.push(
              `Record ${record.id} in ${modelInfo.modelName}: all legacy comments were malformed`
            );
            continue;
          }

          const { comments: migratedComments } = migrateCommentsToUuid(normalizedComments);

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
            continue;
          }

          try {
            await client.items.create({
              item_type: { type: 'item_type', id: commentsModel.id },
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
              }`
            );
          }

          if (currentRecord % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        processedModels++;
      }

      if (!isMountedRef.current) return;
      setMigrationResults(results);
      setMigrationProgress(null);
      logDebug('Legacy comment migration completed', {
        failed: results.failed,
        skipped: results.skipped,
        success: results.success,
        warnings: results.warnings.length,
      });

      if (results.failed === 0) {
        setMigrationStatus('completed');
        await ctx.updatePluginParameters(
          buildPluginParams({
            cdaToken: trimmedCdaToken,
            commentsModelIdsByEnvironment: pluginParams.commentsModelIdsByEnvironment,
            debugLoggingEnabled,
            realTimeUpdatesEnabled: realTimeEnabled,
            migrationCompleted: true,
          })
        );
        if (!isMountedRef.current) return;
        setMigrationCompleted(true);
        setSavedSettings({
          cdaToken: trimmedCdaToken,
          debugLoggingEnabled,
          realTimeEnabled,
        });
        setCdaToken(trimmedCdaToken);
        await ctx.notice('Migration completed successfully!');
      } else {
        setMigrationStatus('completed');
        await ctx.notice(
          `Migration completed with ${results.failed} error(s). Check details below.`
        );
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      logDebug('Legacy comment migration failed', {
        message: error instanceof Error ? error.message : 'Unknown error during migration',
      });
      setMigrationStatus('error');
      setMigrationError(error instanceof Error ? error.message : 'Unknown error during migration');
      setMigrationProgress(null);
    }
  }, [
    ctx, 
    debugLoggingEnabled, 
    getClient, 
    modelsWithComments, 
    realTimeEnabled, 
    trimmedCdaToken, pluginParams.commentsModelIdsByEnvironment
  ]);

  const handleCleanup = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert('Unable to access API. Please ensure you have proper permissions.');
      return;
    }

    setIsCleaningUp(true);
    setShowCleanupConfirm(false);

    try {
      logDebug('Deleting legacy comment_log fields', {
        fieldsToDelete: modelsWithComments.length,
      });
      for (const modelInfo of modelsWithComments) {
        if (!isMountedRef.current) return;
        await client.fields.destroy(modelInfo.fieldId);
      }

      if (!isMountedRef.current) return;
      setModelsWithComments([]);
      logDebug('Legacy comment_log field cleanup completed');
      await ctx.notice('Old comment_log fields have been deleted successfully!');
    } catch (error) {
      if (!isMountedRef.current) return;
      logDebug('Legacy comment_log field cleanup failed', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      ctx.alert(
        `Error deleting fields: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      if (isMountedRef.current) {
        setIsCleaningUp(false);
      }
    }
  }, [ctx, getClient, modelsWithComments]);

  const renderMigrationSection = () => {
    return (
      <div>
        <h3 className={styles.migrationSubtitle}>Migration from Legacy System</h3>
        <p className={styles.description}>
          If you were using an older version of this plugin that stored comments in a{' '}
          <code className={styles.code}>comment_log</code> field on each model, you can
          migrate those comments to the new centralized system.
        </p>

        {/* Warning about concurrent modifications */}
        {migrationStatus === 'idle' && modelsWithComments.length > 0 && (
          <div className={styles.warningBox}>
            <div className={styles.warningIcon}>!</div>
            <div>
              <strong>Important:</strong> Please ensure no one is editing comments during
              the migration process to avoid data loss.
            </div>
          </div>
        )}

        {/* Scan button and results */}
        {migrationStatus !== 'completed' && (
          <div className={styles.migrationActions}>
            <Button
              buttonType="muted"
              onClick={handleScan}
              disabled={migrationStatus === 'scanning' || migrationStatus === 'migrating'}
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

        {/* Scan progress indicator */}
        {migrationStatus === 'scanning' && scanProgress && (
          <div className={styles.scanProgressContainer}>
            <div className={styles.scanProgressHeader}>
              <span className={styles.scanPhaseLabel}>Checking model fields...</span>
              <span className={styles.scanProgressCount}>
                {scanProgress.scannedModels} / {scanProgress.totalModels}
              </span>
            </div>
            
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${
                      scanProgress.totalModels > 0
                        ? (scanProgress.scannedModels / scanProgress.totalModels) * 100
                        : 0
                    }%`,
                  }}
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
        )}

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

        {/* Models found */}
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

        {/* Progress indicator */}
        {migrationStatus === 'migrating' && migrationProgress && (
          <div className={styles.progressContainer}>
            <div className={styles.progressHeader}>
              <span>
                Migrating: {migrationProgress.currentModel} (
                {migrationProgress.processedModels + 1}/{migrationProgress.totalModels} models)
              </span>
              <span>
                Record {migrationProgress.currentRecord}/{migrationProgress.totalRecords}
              </span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${
                    migrationProgress.totalRecords > 0
                      ? (migrationProgress.currentRecord / migrationProgress.totalRecords) *
                        100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Error display */}
        {migrationStatus === 'error' && migrationError && (
          <div className={styles.errorBox}>
            <div className={styles.errorIcon}>✕</div>
            <div>
              <strong>Error:</strong> {migrationError}
            </div>
          </div>
        )}

        {/* Results */}
        {migrationResults && (
          <div className={styles.resultsContainer}>
            <h3 className={styles.migrationSubtitle}>Migration Results</h3>
            <div className={styles.resultsGrid}>
              <div className={styles.resultItem}>
                <span className={styles.resultNumber}>{migrationResults.success}</span>
                <span className={styles.resultLabel}>Migrated</span>
              </div>
              <div className={styles.resultItem}>
                <span className={styles.resultNumber}>{migrationResults.skipped}</span>
                <span className={styles.resultLabel}>Skipped (already migrated)</span>
              </div>
              <div className={styles.resultItem}>
                <span className={styles.resultNumber}>{migrationResults.failed}</span>
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
                    <li>...and {migrationResults.errors.length - 10} more errors</li>
                  )}
                </ul>
              </div>
            )}

            {migrationResults.warnings.length > 0 && (
              <div className={styles.errorList}>
                <h4>Warnings:</h4>
                <ul>
                  {migrationResults.warnings.slice(0, 10).map((warning) => (
                    <li key={`${warning.modelName}-${warning.recordId}-${warning.message}`}>
                      {warning.modelName} / {warning.recordId}: {warning.message}
                    </li>
                  ))}
                  {migrationResults.warnings.length > 10 && (
                    <li>...and {migrationResults.warnings.length - 10} more warnings</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Cleanup section */}
        {migrationStatus === 'completed' && modelsWithComments.length > 0 && (
          <div className={styles.cleanupSection}>
            <h3 className={styles.migrationSubtitle}>Cleanup Old Fields</h3>
            <p className={styles.description}>
              After verifying the migration was successful, you can optionally delete the
              old <code className={styles.code}>comment_log</code> fields from your models.
            </p>

            <div className={styles.dangerBox}>
              <div className={styles.dangerIcon}>⚠️</div>
              <div>
                <strong>Warning:</strong> This action is irreversible. Only proceed if you
                have verified that all comments were migrated successfully.
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
                  Are you sure you want to delete {modelsWithComments.length} comment_log
                  field(s)?
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
        )}

        {/* Completed state with no models */}
        {migrationStatus === 'completed' && modelsWithComments.length === 0 && (
          <div className={styles.successBox}>
            <div className={styles.successIcon}>✓</div>
            <div>
              <strong>Migration complete!</strong> All comments have been migrated to the
              new system and old fields have been cleaned up.
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
          This plugin adds a <strong>sidebar panel</strong> to every record for threaded
          discussions. Use rich mentions to reference users, fields, records, assets, and
          models directly in your comments with slash commands (type / to see all options).
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Configuration</h2>
          <p className={styles.description}>
            Configure how record comments synchronize across users. Real-time updates are
            recommended for the best collaborative experience.
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
                    onChange={(newValue) => setDebugLoggingEnabledState(newValue)}
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
              disabled={isSaving || !hasChanges || (realTimeEnabled && !trimmedCdaToken)}
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

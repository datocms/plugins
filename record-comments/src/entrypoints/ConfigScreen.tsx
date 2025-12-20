import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { Button, Canvas, TextField, Spinner } from 'datocms-react-ui';
import { useState, useCallback } from 'react';
import styles from './styles/configscreen.module.css';
import { COMMENTS_MODEL_API_KEY } from '../constants';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type PluginParameters = {
  cdaToken?: string;
  migrationCompleted?: boolean;
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
};

type ScanProgress = {
  phase: 'fetching-models' | 'scanning-fields';
  currentModel?: string;
  scannedModels: number;
  totalModels: number;
  foundCount: number;
};

const ConfigScreen = ({ ctx }: PropTypes) => {
  const pluginParams = ctx.plugin.attributes.parameters as PluginParameters;
  const [cdaToken, setCdaToken] = useState(pluginParams.cdaToken ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Migration state
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>(
    pluginParams.migrationCompleted ? 'completed' : 'idle'
  );
  const [modelsWithComments, setModelsWithComments] = useState<ModelWithCommentLog[]>([]);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationResults, setMigrationResults] = useState<MigrationResults | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    await ctx.updatePluginParameters({ ...pluginParams, cdaToken });
    await ctx.notice('Settings saved successfully!');
    setIsSaving(false);
  };

  // Build CMA client
  const getClient = useCallback(() => {
    if (!ctx.currentUserAccessToken) return null;
    return buildClient({ apiToken: ctx.currentUserAccessToken });
  }, [ctx.currentUserAccessToken]);

  // Scan for models with comment_log field
  const handleScan = useCallback(async () => {
    setMigrationStatus('scanning');
    setMigrationError(null);
    setModelsWithComments([]);
    setScanProgress({
      phase: 'fetching-models',
      scannedModels: 0,
      totalModels: 0,
      foundCount: 0,
    });

    try {
      // Use ctx.itemTypes instead of API call (already available, no network request needed)
      const models = Object.values(ctx.itemTypes).filter(
        (model): model is NonNullable<typeof model> => model !== undefined
      );
      const foundModels: ModelWithCommentLog[] = [];

      // Filter out the project_comment model upfront
      const modelsToScan = models.filter((m) => m.attributes.api_key !== COMMENTS_MODEL_API_KEY);

      setScanProgress({
        phase: 'scanning-fields',
        scannedModels: 0,
        totalModels: modelsToScan.length,
        foundCount: 0,
      });

      let scannedCount = 0;

      for (const model of modelsToScan) {
        setScanProgress({
          phase: 'scanning-fields',
          currentModel: model.attributes.name,
          scannedModels: scannedCount,
          totalModels: modelsToScan.length,
          foundCount: foundModels.length,
        });

        // Use ctx.loadItemTypeFields instead of client.fields.list (SDK method with caching)
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

        scannedCount++;

        // Update progress after scanning each model
        setScanProgress({
          phase: 'scanning-fields',
          currentModel: model.attributes.name,
          scannedModels: scannedCount,
          totalModels: modelsToScan.length,
          foundCount: foundModels.length,
        });
      }

      setModelsWithComments(foundModels);
      setScanProgress(null);

      if (foundModels.length === 0) {
        setMigrationStatus('idle');
        await ctx.notice('No legacy comment_log fields found. Nothing to migrate!');
      } else {
        setMigrationStatus('idle');
        await ctx.notice(`Found ${foundModels.length} model(s) with comment_log fields.`);
      }
    } catch (error) {
      setMigrationStatus('error');
      setScanProgress(null);
      setMigrationError(error instanceof Error ? error.message : 'Unknown error during scan');
    }
  }, [ctx]);

  // Run migration
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
    };

    try {
      // Find the project_comment model from ctx.itemTypes (already available, no API call needed)
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
        setMigrationProgress({
          currentModel: modelInfo.modelName,
          currentRecord: 0,
          totalRecords: 0,
          processedModels,
          totalModels: modelsWithComments.length,
        });

        // Get all records for this model with pagination
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
          currentRecord++;
          setMigrationProgress({
            currentModel: modelInfo.modelName,
            currentRecord,
            totalRecords,
            processedModels,
            totalModels: modelsWithComments.length,
          });

          const commentLog = record.comment_log;

          // Skip empty comment_log
          if (!commentLog) continue;

          // Parse if string, validate if array
          let commentsArray: unknown[];
          if (typeof commentLog === 'string') {
            try {
              const parsed = JSON.parse(commentLog);
              if (!Array.isArray(parsed)) continue;
              commentsArray = parsed;
            } catch {
              continue; // Skip invalid JSON
            }
          } else if (Array.isArray(commentLog)) {
            commentsArray = commentLog;
          } else {
            continue; // Skip invalid format
          }

          // Skip empty arrays
          if (commentsArray.length === 0) continue;

          // Check if already migrated
          const existing = await client.items.list({
            filter: {
              type: COMMENTS_MODEL_API_KEY,
              fields: {
                record_id: { eq: record.id },
              },
            },
          });

          if (existing.length > 0) {
            results.skipped++;
            continue;
          }

          // Create new project_comment record
          try {
            await client.items.create({
              item_type: { type: 'item_type', id: commentsModel.id },
              model_id: modelInfo.modelId,
              record_id: record.id,
              content: JSON.stringify(commentsArray),
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

          // Small delay to avoid rate limits
          if (currentRecord % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        processedModels++;
      }

      setMigrationResults(results);
      setMigrationProgress(null);

      if (results.failed === 0) {
        setMigrationStatus('completed');
        await ctx.updatePluginParameters({ ...pluginParams, migrationCompleted: true });
        await ctx.notice('Migration completed successfully!');
      } else {
        setMigrationStatus('completed');
        await ctx.notice(
          `Migration completed with ${results.failed} error(s). Check details below.`
        );
      }
    } catch (error) {
      setMigrationStatus('error');
      setMigrationError(error instanceof Error ? error.message : 'Unknown error during migration');
      setMigrationProgress(null);
    }
  }, [ctx, getClient, modelsWithComments, pluginParams]);

  // Cleanup old fields
  const handleCleanup = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert('Unable to access API. Please ensure you have proper permissions.');
      return;
    }

    setIsCleaningUp(true);
    setShowCleanupConfirm(false);

    try {
      for (const modelInfo of modelsWithComments) {
        await client.fields.destroy(modelInfo.fieldId);
      }

      setModelsWithComments([]);
      await ctx.notice('Old comment_log fields have been deleted successfully!');
    } catch (error) {
      ctx.alert(
        `Error deleting fields: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsCleaningUp(false);
    }
  }, [ctx, getClient, modelsWithComments]);

  const renderMigrationSection = () => {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Migration from Legacy System</h2>
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
              <span className={styles.scanPhaseLabel}>
                {scanProgress.phase === 'fetching-models'
                  ? 'Loading models list...'
                  : 'Checking model fields...'}
              </span>
              {scanProgress.phase === 'scanning-fields' && (
                <span className={styles.scanProgressCount}>
                  {scanProgress.scannedModels} / {scanProgress.totalModels}
                </span>
              )}
            </div>
            {scanProgress.phase === 'scanning-fields' && (
              <>
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
                    {scanProgress.foundCount} legacy field{scanProgress.foundCount !== 1 ? 's' : ''} found
                  </span>
                </div>
              </>
            )}
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
                Migrating: {migrationProgress.currentModel} ({migrationProgress.processedModels + 1}
                /{migrationProgress.totalModels} models)
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
                      ? (migrationProgress.currentRecord / migrationProgress.totalRecords) * 100
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
          </div>
        )}

        {/* Cleanup section */}
        {migrationStatus === 'completed' && modelsWithComments.length > 0 && (
          <div className={styles.cleanupSection}>
            <h3 className={styles.migrationSubtitle}>Cleanup Old Fields</h3>
            <p className={styles.description}>
              After verifying the migration was successful, you can optionally delete the old{' '}
              <code className={styles.code}>comment_log</code> fields from your models.
            </p>

            <div className={styles.dangerBox}>
              <div className={styles.dangerIcon}>⚠️</div>
              <div>
                <strong>Warning:</strong> This action is irreversible. Only proceed if you have
                verified that all comments were migrated successfully.
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
                  Are you sure you want to delete {modelsWithComments.length} comment_log field(s)?
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
              <strong>Migration complete!</strong> All comments have been migrated to the new
              system and old fields have been cleaned up.
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
          This plugin adds a Comments sidebar panel to every record, allowing your team to
          discuss and collaborate directly on content. Simply open any record and expand the
          Comments panel in the right sidebar to start adding comments, replies, and reactions.
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Configuration</h2>
          <p className={styles.description}>
            To enable realtime updates for comments, you need to provide a{' '}
            <strong>Content Delivery API (CDA)</strong> token. This allows the plugin to
            subscribe to changes and show updates instantly.
          </p>

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

          <div className={styles.buttonRow}>
            <Button
              buttonType="primary"
              onClick={handleSave}
              disabled={isSaving || !cdaToken}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>

        {/* Migration Section */}
        {renderMigrationSection()}
      </div>
    </Canvas>
  );
};

export default ConfigScreen;

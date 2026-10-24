import {
  buildLegacyUserIdsByEmail,
  emptyMigrationResults,
  type MigrationProgress,
  type MigrationResults,
  type LegacyModel as ModelWithCommentLog,
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
import ApiKey from 'datocms-react-ui/ApiKey';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InfoList from 'datocms-react-ui/InfoList';
import { Page } from 'datocms-react-ui/Page';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import SettingsList from 'datocms-react-ui/SettingsList';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { COMMENTS_MODEL_API_KEY } from '@/constants';
import { countMessage } from '@/texts';
import { createApiClient } from '@/utils/cmaClient';
import { logDebug, logWarn, setDebugLoggingEnabled } from '@/utils/errorLogger';
import { formatCount, formatNumber } from '@/utils/format';
import styles from './ConfigScreen.module.css';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

const NO_API_ACCESS_MESSAGE =
  'The plugin has no access to the Content Management API. Check its permissions, then reload the page.';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function cleanupErrorMessage(error: unknown) {
  return `The fields weren't deleted: ${errorMessage(error)}`;
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
        'The migration needs read access to every record of the models with legacy comments and of the comments model. Restricted access can hide legacy comments.',
      );
  }
}

function buildScanMessage(
  foundCount: number,
  failedCount: number,
  locale: string,
): string {
  if (failedCount > 0) {
    return `The scan couldn't inspect ${formatCount(failedCount, 'model', 'models', locale)}. Check the list before migrating.`;
  }
  if (foundCount === 0) {
    return 'No model has a comment_log field, so there is nothing to migrate.';
  }
  return `Found ${formatCount(foundCount, 'model', 'models', locale)} with a comment_log field.`;
}

type MigrationStatus =
  | 'idle'
  | 'scanning'
  | 'migrating'
  | 'completed'
  | 'error';

/** A model that the scan could not inspect */
type ScanFailure = {
  modelId: string;
  modelName: string;
  modelApiKey: string;
};

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
  const fields = await client.fields.list(model.modelId);
  const field = fields.find((candidate) => candidate.id === model.fieldId);
  if (!field) return;
  if (
    field.api_key !== 'comment_log' ||
    field.localized !== (model.localized ?? false)
  ) {
    throw new Error(
      `The legacy field of ${model.modelName} changed, so the cleanup stopped.`,
    );
  }
  if (signal.aborted) throw new Error('The cleanup stopped.');
  await client.fields.destroy(model.fieldId);
}

function fraction(done: number, total: number) {
  return total > 0 ? done / total : 0;
}

function ScanProgressView({
  progress,
  locale,
}: {
  progress: ScanProgress;
  locale: string;
}) {
  const caption = [
    progress.currentModel ? `Checking ${progress.currentModel}` : 'Checking',
    `${formatNumber(progress.scannedModels, locale)} of ${formatCount(progress.totalModels, 'model', 'models', locale)}`,
    formatCount(
      progress.foundCount,
      'legacy field found',
      'legacy fields found',
      locale,
    ),
  ].join(' · ');

  return (
    <div className={styles.progress}>
      <ProgressBar
        value={fraction(progress.scannedModels, progress.totalModels)}
        ariaLabel="Checking model fields"
      />
      <p className={styles.caption}>{caption}</p>
    </div>
  );
}

function MigrationProgressView({
  progress,
  verifying,
  locale,
}: {
  progress: MigrationProgress;
  verifying: boolean;
  locale: string;
}) {
  const caption = [
    progress.currentModel,
    `model ${formatNumber(progress.processedModels + 1, locale)} of ${formatNumber(progress.totalModels, locale)}`,
    `record ${formatNumber(progress.currentRecord, locale)} of ${formatNumber(progress.totalRecords, locale)}`,
  ].join(' · ');

  return (
    <div className={styles.progress}>
      <ProgressBar
        value={fraction(progress.currentRecord, progress.totalRecords)}
        ariaLabel={verifying ? 'Verifying comments' : 'Migrating comments'}
      />
      <p className={styles.caption}>{caption}</p>
    </div>
  );
}

/**
 * The models that the scan could not inspect: the callout tells the problem
 * in one sentence, and the list follows it as content of the group.
 */
function ScanErrors({ scanErrors }: { scanErrors: ScanFailure[] }) {
  return (
    <>
      <Callout
        tone="danger"
        title={countMessage(
          'recordComments.modelsNotInspected',
          scanErrors.length,
        )}
      >
        Scan again before migrating.
      </Callout>
      <ul className={styles.models}>
        {scanErrors.map((failure) => (
          <li key={failure.modelId}>
            {failure.modelName} <ApiKey>{failure.modelApiKey}</ApiKey>
          </li>
        ))}
      </ul>
    </>
  );
}

function FoundModels({
  models,
  locale,
}: {
  models: ModelWithCommentLog[];
  locale: string;
}) {
  return (
    <>
      <p className={styles.lead}>
        {formatCount(models.length, 'model', 'models', locale)} with a{' '}
        <ApiKey>comment_log</ApiKey> field
      </p>
      <ul className={styles.models}>
        {models.map((model) => (
          <li key={model.modelId}>
            {model.modelName} <ApiKey>{model.modelApiKey}</ApiKey>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The migration lists only its first errors */
const MAX_LISTED_ERRORS = 10;

function MigrationResultsView({
  results,
  locale,
}: {
  results: MigrationResults;
  locale: string;
}) {
  return (
    <>
      <InfoList className={styles.block}>
        <InfoList.Row title="Migrated">
          {formatNumber(results.success, locale)}
        </InfoList.Row>
        <InfoList.Row title="Already migrated">
          {formatNumber(results.skipped, locale)}
        </InfoList.Row>
        <InfoList.Row title="Failed">
          {formatNumber(results.failed, locale)}
        </InfoList.Row>
      </InfoList>
      {results.errors.length > 0 && (
        <>
          <Callout
            tone="danger"
            title={countMessage('recordComments.recordsFailed', results.failed)}
          >
            {results.failed > MAX_LISTED_ERRORS
              ? `The first ${formatNumber(MAX_LISTED_ERRORS, locale)} errors are listed below.`
              : 'The errors are listed below.'}
          </Callout>
          <ul className={styles.list}>
            {results.errors.slice(0, MAX_LISTED_ERRORS).map((err) => (
              <li key={err}>{err}</li>
            ))}
            {results.failed > MAX_LISTED_ERRORS && (
              <li>
                …and {formatNumber(results.failed - MAX_LISTED_ERRORS, locale)}{' '}
                more
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );
}

function getSaveDisabledReason(
  hasChanges: boolean,
  realTimeEnabled: boolean,
  trimmedCdaToken: string,
): string | null {
  if (!hasChanges) return 'There are no changes to save.';
  if (realTimeEnabled && !trimmedCdaToken)
    return 'Enter a Content Delivery API token, or turn off real-time updates.';
  return null;
}

/**
 * The error of the token field: it shows when the missing token is what keeps
 * the changes from being saved (thus not before the user changes anything).
 */
function getCdaTokenError(
  hasChanges: boolean,
  realTimeEnabled: boolean,
  trimmedCdaToken: string,
): string | undefined {
  return hasChanges && realTimeEnabled && !trimmedCdaToken
    ? 'Enter a Content Delivery API token'
    : undefined;
}

type SyncGroupProps = {
  realTimeEnabled: boolean;
  onRealTimeEnabledChange: (value: boolean) => void;
  cdaToken: string;
  onCdaTokenChange: (value: string) => void;
  debugLoggingEnabled: boolean;
  onDebugLoggingEnabledChange: (value: boolean) => void;
  isSaving: boolean;
  saveDisabledReason: string | null;
  /** The error of the token, while it keeps the changes from being saved */
  cdaTokenError: string | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function SyncGroup({
  realTimeEnabled,
  onRealTimeEnabledChange,
  cdaToken,
  onCdaTokenChange,
  debugLoggingEnabled,
  onDebugLoggingEnabledChange,
  isSaving,
  saveDisabledReason,
  cdaTokenError,
  onSubmit,
}: SyncGroupProps) {
  return (
    <form onSubmit={onSubmit}>
      <Page.Group
        title="Sync"
        footer={
          <Button
            submit
            tone="primary"
            label="Save"
            busy={isSaving}
            disabled={
              saveDisabledReason ? { reason: saveDisabledReason } : false
            }
          />
        }
      >
        <FieldWrapper hint="Comments from other people show up without reloading the record. Needs a Content Delivery API token.">
          <SwitchInput
            label="Real-time updates"
            value={realTimeEnabled}
            onChange={(newValue) => onRealTimeEnabledChange(newValue === true)}
          />
        </FieldWrapper>
        {realTimeEnabled && (
          <FieldWrapper
            label="Content Delivery API token"
            required
            hint="Create a token with read access in Project settings, API tokens."
            error={cdaTokenError}
          >
            <StringInput
              code
              value={cdaToken}
              onChange={(newValue) => onCdaTokenChange(newValue ?? '')}
            />
          </FieldWrapper>
        )}
        <FieldWrapper hint="Writes detailed sync diagnostics to the browser console, for troubleshooting.">
          <SwitchInput
            label="Debug logging"
            value={debugLoggingEnabled}
            onChange={(newValue) =>
              onDebugLoggingEnabledChange(newValue === true)
            }
          />
        </FieldWrapper>
      </Page.Group>
    </form>
  );
}

type LegacyState = {
  migrationStatus: MigrationStatus;
  modelsWithComments: ModelWithCommentLog[];
  scanProgress: ScanProgress | null;
  scanErrors: ScanFailure[];
  migrationProgress: MigrationProgress | null;
  migrationError: string | null;
  migrationResults: MigrationResults | null;
  isCleaningUp: boolean;
};

const WAIT_FOR_TASK = { reason: 'Wait until the current task ends.' };

function getMigrateDisabled(state: LegacyState) {
  if (state.scanErrors.length > 0)
    return { reason: "Some models weren't inspected. Scan again first." };
  if (state.isCleaningUp) return WAIT_FOR_TASK;
  return false;
}

/**
 * The two steps of the migration, as rows of settings under what they found:
 * each one tells what it does, with its action always at the right
 */
function LegacyTasks({
  state,
  showScan,
  showMigrate,
  onScan,
  onMigrate,
}: {
  state: LegacyState;
  showScan: boolean;
  showMigrate: boolean;
  onScan: () => Promise<void>;
  onMigrate: () => Promise<void>;
}) {
  if (!showScan && !showMigrate) return null;

  const hasScanned =
    state.modelsWithComments.length > 0 ||
    state.scanErrors.length > 0 ||
    state.migrationResults !== null;
  const otherTaskRunning =
    state.migrationStatus === 'migrating' || state.isCleaningUp;

  return (
    <SettingsList>
      {showScan && (
        <SettingsList.Row
          title="Find legacy comments"
          description={
            <>
              Looks for the <ApiKey>comment_log</ApiKey> field that older
              versions of the plugin added to the models.
            </>
          }
          action={
            <Button
              tone="ghost"
              label={hasScanned ? 'Scan again' : 'Scan for legacy comments'}
              busy={state.migrationStatus === 'scanning'}
              disabled={otherTaskRunning ? WAIT_FOR_TASK : false}
              onClick={onScan}
            />
          }
        />
      )}
      {showMigrate && (
        <SettingsList.Row
          title="Move legacy comments"
          description={
            <>
              Moves the comments of the <ApiKey>comment_log</ApiKey> fields to
              the new storage.
            </>
          }
          action={
            <Button
              tone="ghost"
              label="Migrate comments"
              busy={state.migrationStatus === 'migrating'}
              disabled={getMigrateDisabled(state)}
              onClick={onMigrate}
            />
          }
        />
      )}
    </SettingsList>
  );
}

function LegacyBody({
  state,
  locale,
  tasks,
}: {
  state: LegacyState;
  locale: string;
  /** The rows of the scan and the migration */
  tasks: ReactNode;
}) {
  const {
    migrationStatus,
    modelsWithComments,
    scanProgress,
    scanErrors,
    migrationProgress,
    migrationError,
    migrationResults,
    isCleaningUp,
  } = state;
  const hasModels = modelsWithComments.length > 0;
  const showMigrationProgress = migrationStatus === 'migrating' || isCleaningUp;
  // A failed scan leaves no results: only a migration has them
  const errorTitle = migrationResults
    ? 'The migration stopped'
    : 'The scan stopped';

  return (
    <>
      {migrationStatus === 'scanning' && scanProgress && (
        <ScanProgressView progress={scanProgress} locale={locale} />
      )}
      {scanErrors.length > 0 && <ScanErrors scanErrors={scanErrors} />}
      {hasModels && migrationStatus !== 'migrating' && (
        <FoundModels models={modelsWithComments} locale={locale} />
      )}
      {hasModels && migrationStatus === 'idle' && (
        <Callout tone="warning">
          Ask your team not to edit comments while the migration runs, or some
          changes can be lost.
        </Callout>
      )}
      {showMigrationProgress && migrationProgress && (
        <MigrationProgressView
          progress={migrationProgress}
          verifying={isCleaningUp}
          locale={locale}
        />
      )}
      {migrationStatus === 'error' && migrationError && (
        <Callout tone="danger" title={errorTitle}>
          {migrationError}
        </Callout>
      )}
      {migrationResults && (
        <MigrationResultsView results={migrationResults} locale={locale} />
      )}
      {migrationStatus === 'completed' && !hasModels && (
        <Callout tone="success">
          All legacy comments are migrated, and the old fields are deleted.
        </Callout>
      )}
      {/* What the scan and the migration found, then the actions */}
      {tasks}
    </>
  );
}

function LegacyGroup({
  state,
  locale,
  open,
  onOpenChange,
  onScan,
  onMigrate,
}: {
  state: LegacyState;
  locale: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: () => Promise<void>;
  onMigrate: () => Promise<void>;
}) {
  const { migrationStatus, modelsWithComments, isCleaningUp } = state;
  const isTaskRunning =
    migrationStatus === 'scanning' ||
    migrationStatus === 'migrating' ||
    isCleaningUp;
  const showScan =
    migrationStatus !== 'completed' || modelsWithComments.length === 0;
  const showMigrate =
    modelsWithComments.length > 0 && migrationStatus !== 'completed';

  return (
    <Page.Group
      title="Legacy comments"
      // A task in progress keeps the group open
      collapse={{
        open,
        onToggle: isTaskRunning ? undefined : () => onOpenChange(!open),
      }}
    >
      <LegacyBody
        state={state}
        locale={locale}
        tasks={
          <LegacyTasks
            state={state}
            showScan={showScan}
            showMigrate={showMigrate}
            onScan={onScan}
            onMigrate={onMigrate}
          />
        }
      />
    </Page.Group>
  );
}

function DangerZoneGroup({
  modelCount,
  isCleaningUp,
  onDelete,
}: {
  modelCount: number;
  isCleaningUp: boolean;
  onDelete: () => Promise<void>;
}) {
  return (
    <Page.Group title="Danger zone" tone="danger">
      <SettingsList>
        <SettingsList.Row
          title="Delete the legacy fields"
          description={countMessage(
            'recordComments.deleteLegacyFieldsDescription',
            modelCount,
          )}
          action={
            <Button
              tone="ghost-alert"
              label="Delete fields"
              busy={isCleaningUp}
              onClick={onDelete}
            />
          }
        />
      </SettingsList>
    </Page.Group>
  );
}

const ConfigScreen = ({ ctx }: PropTypes) => {
  const locale = ctx.ui.locale;
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
  const [isLegacyOpen, setIsLegacyOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanErrors, setScanErrors] = useState<ScanFailure[]>([]);
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
    scanErrors.length > 0;

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
  }, [operationScope]);

  useEffect(() => {
    if (hasMigrationUiState) {
      setIsLegacyOpen(true);
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
      ctx.notice('Settings saved');
    } catch (error) {
      if (!isCurrentScope()) return;
      ctx.alert(`The settings weren't saved: ${errorMessage(error)}`);
    } finally {
      if (isCurrentScope()) {
        setIsSaving(false);
      }
    }
  };

  const saveDisabledReason = getSaveDisabledReason(
    hasChanges,
    realTimeEnabled,
    trimmedCdaToken,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Enter in the token field submits the form too
    if (isSaving || saveDisabledReason) return;
    void handleSave();
  };

  const getClient = useCallback(() => {
    return createApiClient(
      ctx.currentUserAccessToken,
      ctx.environment,
      ctx.cmaBaseUrl,
    );
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  const scanSingleModel = useCallback(
    async (
      model: NonNullable<(typeof ctx.itemTypes)[string]>,
      foundModels: ModelWithCommentLog[],
      _failedModels: ScanFailure[],
      scannedCount: number,
      totalModels: number,
    ): Promise<{
      found: ModelWithCommentLog | null;
      failed: ScanFailure | null;
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
          failed: {
            modelId: model.id,
            modelName: model.attributes.name,
            modelApiKey: model.attributes.api_key,
          },
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
      const failedModels: ScanFailure[] = [];
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
      const scanMessage = buildScanMessage(
        foundModels.length,
        failedModels.length,
        ctx.ui.locale,
      );
      // Models that weren't inspected are a warning, not a success. Nothing
      // waits for the toast: its promise gives the button picked in it.
      if (failedModels.length > 0) {
        void ctx.customToast({
          type: 'warning',
          message: scanMessage,
          dismissOnPageChange: true,
        });
      } else {
        await ctx.notice(scanMessage);
      }
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
    await ctx.notice('Comments migrated');
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
          "The project_comment model doesn't exist. Reload the page to create it.",
        );
      assertMigrationReadPermissions(ctx, modelsWithComments, commentsModel.id);
      const controller = new AbortController();
      operationController.current?.abort();
      operationController.current = controller;
      const [regularUsers, ssoUsers] = await Promise.all([
        ctx.loadUsers(),
        ctx.loadSsoUsers(),
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
        // Records that failed are an error, not a success
        await ctx.alert(
          `The migration ended with ${formatCount(results.failed, 'error', 'errors', ctx.ui.locale)}. Check the details in the settings.`,
        );
      }
    },
    [ctx, finalizeMigrationSuccess, isCurrentScope],
  );

  const handleMigrate = useCallback(async () => {
    const client = getClient();
    if (!client) {
      ctx.alert(NO_API_ACCESS_MESSAGE);
      return;
    }

    if (scanErrors.length > 0) {
      ctx.alert("Some models weren't inspected. Scan again before migrating.");
      return;
    }

    if (modelsWithComments.length === 0) {
      ctx.alert(
        'There are no models to migrate. Scan for legacy comments first.',
      );
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
          `${formatCount(verified.failed, 'record', 'records', ctx.ui.locale)} failed verification, so the legacy fields were kept. ${verified.errors.join(' ')}`,
        );
    },
    [runMigration, ctx.ui.locale],
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
      await ctx.alert(NO_API_ACCESS_MESSAGE);
      return;
    }
    if (!canCleanup) {
      await ctx.alert(
        'Delete the legacy fields only after a complete scan and migration.',
      );
      return;
    }
    setIsCleaningUp(true);
    // The cleanup starts in the Danger zone, but its progress shows in the
    // legacy group, which can't be opened while the task runs
    setIsLegacyOpen(true);
    const verified = emptyMigrationResults();
    const removed = new Set<string>();
    try {
      await verifyAndCleanModels(client, verified, removed);
      if (!isCurrentScope()) return;
      await ctx.notice('Legacy fields deleted');
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

  const confirmCleanup = async () => {
    const count = modelsWithComments.length;
    const confirmed = await ctx.openConfirm({
      title: `Delete ${formatCount(count, 'legacy field', 'legacy fields', locale)}?`,
      content: `The comment_log field is deleted from ${formatCount(count, 'model', 'models', locale)}. This cannot be undone.`,
      choices: [{ label: 'Delete fields', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });
    // The site or the environment can change while the question is open
    if (confirmed !== true || !isCurrentScope()) return;
    await handleCleanup();
  };

  const showCleanup =
    migrationStatus === 'completed' &&
    migrationCompleted &&
    migrationResults?.failed === 0 &&
    modelsWithComments.length > 0;

  return (
    <Page>
      <Page.Content>
        <SyncGroup
          realTimeEnabled={realTimeEnabled}
          onRealTimeEnabledChange={setRealTimeEnabled}
          cdaToken={cdaToken}
          onCdaTokenChange={setCdaToken}
          debugLoggingEnabled={debugLoggingEnabled}
          onDebugLoggingEnabledChange={setDebugLoggingEnabledState}
          isSaving={isSaving}
          saveDisabledReason={saveDisabledReason}
          cdaTokenError={getCdaTokenError(
            hasChanges,
            realTimeEnabled,
            trimmedCdaToken,
          )}
          onSubmit={handleSubmit}
        />
        <LegacyGroup
          state={{
            migrationStatus,
            modelsWithComments,
            scanProgress,
            scanErrors,
            migrationProgress,
            migrationError,
            migrationResults,
            isCleaningUp,
          }}
          locale={locale}
          open={isLegacyOpen}
          onOpenChange={setIsLegacyOpen}
          onScan={handleScan}
          onMigrate={handleMigrate}
        />
        {showCleanup && (
          <DangerZoneGroup
            modelCount={modelsWithComments.length}
            isCleaningUp={isCleaningUp}
            onDelete={confirmCleanup}
          />
        )}
      </Page.Content>
    </Page>
  );
};

export default ConfigScreen;

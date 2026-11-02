import {
  buildLegacyUserIdsByEmail,
  CommentStorageError,
  emptyMigrationResults,
  type MigrationError,
  type MigrationProgress,
  type MigrationResults,
  type LegacyModel as ModelWithCommentLog,
  runLegacyMigration,
} from '@utils/legacyMigration';
import {
  buildModelSchemaPath,
  buildRecordEditPath,
} from '@utils/navigationHelpers';
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
import Link from 'datocms-react-ui/Link';
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
        'Moving the comments needs read access to every record of the models with legacy comments and of the comments model. Restricted access can hide legacy comments.',
      );
  }
}

/** Names in a sentence: "Author", "Author and Page", "Author, Page and Blog" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
  const models = formatCount(progress.totalModels, 'model', 'models', locale);
  // One line that tells the task: the bar has the same name
  const caption = progress.currentModel
    ? `Checking ${progress.currentModel} (${formatNumber(progress.scannedModels, locale)} of ${models})`
    : `Checking ${models}`;

  return (
    <div className={styles.progress}>
      <ProgressBar
        value={fraction(progress.scannedModels, progress.totalModels)}
        ariaLabel={caption}
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
  // The check before the fields are deleted reads the records too: the line
  // says that it only checks them
  const task = verifying
    ? `Checking the moved comments of ${progress.currentModel}`
    : `Moving the comments of ${progress.currentModel}`;
  const caption = `${task}: ${formatNumber(progress.currentRecord, locale)} of ${formatCount(progress.totalRecords, 'record', 'records', locale)}`;

  return (
    <div className={styles.progress}>
      <ProgressBar
        value={fraction(progress.currentRecord, progress.totalRecords)}
        ariaLabel={caption}
      />
      <p className={styles.caption}>{caption}</p>
    </div>
  );
}

/** The models that the scan could not inspect, named in the callout */
function ScanErrors({ scanErrors }: { scanErrors: ScanFailure[] }) {
  return (
    <Callout tone="danger">
      {joinNames(scanErrors.map((failure) => failure.modelName))} couldn't be
      checked: click Find again before moving the comments.
    </Callout>
  );
}

/** The models that have legacy comments, in a sentence */
function nameModels(models: ModelWithCommentLog[]): string {
  return joinNames(models.map((model) => model.modelName));
}

/** The migration lists only its first errors */
const MAX_LISTED_ERRORS = 10;

/** Something ran: a migration that stopped before any record has no results */
function hasMigrationRun(results: MigrationResults): boolean {
  return results.success + results.skipped + results.failed > 0;
}

/**
 * A record that failed, as a link to it, and why: some reasons never clear
 * on a retry, thus the admin reads what to fix in the record
 */
function MigrationErrorItem({
  error,
  ctx,
}: {
  error: MigrationError;
  ctx: RenderConfigScreenCtx;
}) {
  return (
    <li>
      <Link to={buildRecordEditPath(ctx, error.modelId, error.recordId)}>
        {error.modelName} record {error.recordId}
      </Link>
      <p className={styles.caption}>{error.message}</p>
    </li>
  );
}

function MigrationResultsView({
  results,
  locale,
  ctx,
}: {
  results: MigrationResults;
  locale: string;
  ctx: RenderConfigScreenCtx;
}) {
  return (
    <>
      {/* The kit sets no margin on the list: the box gives it the space of
          the other blocks of the group. A count of 0 is no news: only the
          records moved always show. */}
      <div className={styles.block}>
        <InfoList>
          <InfoList.Row title="Records moved">
            {formatNumber(results.success, locale)}
          </InfoList.Row>
          {results.skipped > 0 && (
            <InfoList.Row title="Records already moved">
              {formatNumber(results.skipped, locale)}
            </InfoList.Row>
          )}
          {results.failed > 0 && (
            <InfoList.Row title="Records not moved">
              {formatNumber(results.failed, locale)}
            </InfoList.Row>
          )}
        </InfoList>
      </div>
      {/* The toast and the row of the records not moved tell what happened:
          the line says only the next step, and the list names the records
          and why each one failed */}
      {results.errors.length > 0 && (
        <p className={styles.lead}>
          Open these records to check their old comments, then click Move
          comments again:
        </p>
      )}
      {results.errors.length > 0 && (
        <ul className={styles.list} aria-label="Records not moved">
          {results.errors.slice(0, MAX_LISTED_ERRORS).map((error) => (
            <MigrationErrorItem key={error.recordId} error={error} ctx={ctx} />
          ))}
          {results.failed > MAX_LISTED_ERRORS && (
            <li>
              …and {formatNumber(results.failed - MAX_LISTED_ERRORS, locale)}{' '}
              more
            </li>
          )}
        </ul>
      )}
    </>
  );
}

/**
 * Why the scan or the migration stopped. A field of the comments model that
 * changed is named, with a link to the model.
 */
function StopReason({
  error,
  ctx,
}: {
  error: StopError;
  ctx: RenderConfigScreenCtx;
}) {
  const commentsModel = Object.values(ctx.itemTypes).find(
    (model) => model?.attributes.api_key === COMMENTS_MODEL_API_KEY,
  );
  if (!error.storage || !commentsModel) return error.message;

  return (
    <>
      The <ApiKey>{error.storage.fieldApiKey}</ApiKey> field of the{' '}
      <Link to={buildModelSchemaPath(ctx, commentsModel.id, false)}>
        {commentsModel.attributes.name}
      </Link>{' '}
      model {error.storage.requirement}. Change it back, then move the comments
      again.
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
 * The error of the token field: real-time updates need a token, also right
 * after the install, when nothing is changed yet
 */
function getCdaTokenError(
  realTimeEnabled: boolean,
  trimmedCdaToken: string,
): string | undefined {
  return realTimeEnabled && !trimmedCdaToken
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
        <FieldWrapper hint="Comments from other people show up without reloading the record.">
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
            hint={
              <>
                Create a token with read access in{' '}
                <Link to="/project_settings/access_tokens">API tokens</Link>.
              </>
            }
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

/** Why the scan or the migration stopped */
type StopError = {
  message: string;
  /** A field of the comments model that the storage needs changed */
  storage?: CommentStorageError;
};

type LegacyState = {
  migrationStatus: MigrationStatus;
  modelsWithComments: ModelWithCommentLog[];
  scanProgress: ScanProgress | null;
  scanErrors: ScanFailure[];
  /** A scan ended (it can find nothing) */
  hasScanned: boolean;
  migrationProgress: MigrationProgress | null;
  migrationError: StopError | null;
  migrationResults: MigrationResults | null;
  isCleaningUp: boolean;
};

function toMigrationStopError(error: unknown): StopError {
  return {
    message:
      error instanceof Error ? error.message : 'Unknown error during migration',
    storage: error instanceof CommentStorageError ? error : undefined,
  };
}

const WAIT_FOR_TASK = { reason: 'Wait until the current task ends.' };

function getMigrateDisabled(state: LegacyState) {
  if (state.scanErrors.length > 0)
    return {
      reason: "Some models couldn't be checked. Click Find again first.",
    };
  if (state.isCleaningUp) return WAIT_FOR_TASK;
  return false;
}

/**
 * The two steps of the migration, as rows of settings: each one tells what it
 * does, with its action always at the right. The row of the scan shows what
 * it found as its value.
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
    state.hasScanned ||
    state.modelsWithComments.length > 0 ||
    state.scanErrors.length > 0 ||
    state.migrationResults !== null;
  // After a scan that found nothing, the row keeps its answer
  const foundNothing =
    state.hasScanned &&
    state.migrationStatus === 'idle' &&
    state.modelsWithComments.length === 0 &&
    state.scanErrors.length === 0 &&
    state.migrationResults === null;
  let scanValue: string | undefined;
  if (foundNothing) scanValue = 'None found';
  else if (state.modelsWithComments.length > 0)
    scanValue = `Found in ${nameModels(state.modelsWithComments)}`;
  const otherTaskRunning =
    state.migrationStatus === 'migrating' || state.isCleaningUp;

  return (
    <SettingsList>
      {showScan && (
        <SettingsList.Row
          title="Find legacy comments"
          description="Looks for comments saved by older versions of the plugin."
          value={scanValue}
          action={
            <Button
              tone="ghost"
              label={hasScanned ? 'Find again' : 'Find'}
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
          description="Moves the old comments into the comments sidebar of their records."
          action={
            <Button
              tone="ghost"
              label="Move comments"
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
  ctx,
  tasks,
}: {
  state: LegacyState;
  locale: string;
  ctx: RenderConfigScreenCtx;
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
    ? 'Moving the comments stopped'
    : 'Finding the comments stopped';

  return (
    <>
      {migrationStatus === 'scanning' && scanProgress && (
        <ScanProgressView progress={scanProgress} locale={locale} />
      )}
      {scanErrors.length > 0 && <ScanErrors scanErrors={scanErrors} />}
      {/* While the migration can start, and while it runs */}
      {hasModels &&
        (migrationStatus === 'idle' || migrationStatus === 'migrating') &&
        !getMigrateDisabled(state) && (
          <Callout tone="warning">
            Ask your team not to edit comments while they're being moved, or
            some changes could be lost.
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
          <StopReason error={migrationError} ctx={ctx} />
        </Callout>
      )}
      {migrationResults && hasMigrationRun(migrationResults) && (
        <MigrationResultsView
          results={migrationResults}
          locale={locale}
          ctx={ctx}
        />
      )}
      {/* What the migration did, then the actions */}
      {tasks}
    </>
  );
}

function LegacyGroup({
  state,
  locale,
  ctx,
  open,
  onOpenChange,
  onScan,
  onMigrate,
}: {
  state: LegacyState;
  locale: string;
  ctx: RenderConfigScreenCtx;
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
        ctx={ctx}
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
              // The question comes first: the button is busy only once the
              // fields are being deleted, not while the user decides
              onClick={() => {
                void onDelete();
              }}
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
  const [migrationError, setMigrationError] = useState<StopError | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
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
    setHasScanned(false);
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
      ctx.alert(`The settings weren't saved. ${errorMessage(error)}`);
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

      // What the scan found shows in the group: the models, the models it
      // couldn't check, or "None found" in its row. No toast repeats it.
      setHasScanned(true);
      setMigrationStatus('idle');
    } catch (error) {
      if (!isCurrentScope()) return;
      logDebug('Legacy comment scan failed', {
        message:
          error instanceof Error ? error.message : 'Unknown error during scan',
      });
      setMigrationStatus('error');
      setScanProgress(null);
      setMigrationError({
        message:
          error instanceof Error ? error.message : 'Unknown error during scan',
      });
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
    await ctx.notice('Comments moved');
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
        errors: results.errors,
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
          `The comments of ${formatCount(results.failed, 'record', 'records', ctx.ui.locale)} weren't moved.`,
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
      ctx.alert("Some models couldn't be checked. Click Find again first.");
      return;
    }

    if (modelsWithComments.length === 0) {
      ctx.alert('There are no comments to move. Find legacy comments first.');
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
      const stopError = toMigrationStopError(error);
      logDebug('Legacy comment migration failed', {
        errors: results.errors,
        message: stopError.message,
      });
      setMigrationResults(results);
      setMigrationCompleted(false);
      setMigrationStatus('error');
      setMigrationError(stopError);
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
      if (verified.failed > 0) {
        // The details of each record go to the debug log, not to the toast
        logDebug('Legacy comments changed after the move', {
          errors: verified.errors,
        });
        throw new Error(
          `the comments of ${formatCount(verified.failed, 'record', 'records', ctx.ui.locale)} changed after they were moved. Click Move comments again to see which ${verified.failed === 1 ? 'one' : 'ones'}.`,
        );
      }
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
        'Delete the legacy fields only after all the comments are found and moved.',
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
      if (!isCurrentScope()) return;
      // Records changed after the move: the move is the next step again
      if (verified.failed > 0) setMigrationStatus('idle');
      await ctx.alert(cleanupErrorMessage(error));
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
      content: `The comment_log field is deleted from ${nameModels(modelsWithComments)}. This cannot be undone.`,
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
          cdaTokenError={getCdaTokenError(realTimeEnabled, trimmedCdaToken)}
          onSubmit={handleSubmit}
        />
        <LegacyGroup
          state={{
            migrationStatus,
            modelsWithComments,
            scanProgress,
            scanErrors,
            hasScanned,
            migrationProgress,
            migrationError,
            migrationResults,
            isCleaningUp,
          }}
          locale={locale}
          ctx={ctx}
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

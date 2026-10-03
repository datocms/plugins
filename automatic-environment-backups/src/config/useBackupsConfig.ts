import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackupCadence,
  BackupScheduleConfig,
  LambdaBackupStatus,
} from '../types/types';
import {
  type BackupEnvironment,
  enrichBackupStatusWithEnvironments,
  getBackupEnvironmentProgress,
  getCreatingBackupCadences,
} from '../utils/backupEnvironments';
import {
  type BackupCadencesResult,
  executeBackupCadences,
} from '../utils/backupExecution';
import {
  BACKUP_CADENCES,
  BACKUP_SCHEDULE_VERSION,
  getCadenceLabel,
  normalizeBackupScheduleConfig,
  toLocalDateKey,
} from '../utils/backupSchedule';
import { readCma } from '../utils/cmaRead';
import { createDebugLogger } from '../utils/debugLogger';
import { fetchLambdaBackupStatus } from '../utils/fetchLambdaBackupStatus';
import {
  createPluginParameterPersister,
  toPluginParameterRecord,
} from '../utils/pluginParameterMerging';
import { triggerLambdaBackupNow } from '../utils/triggerLambdaBackupNow';
import {
  buildConnectedLambdaConnectionState,
  buildDisconnectedLambdaConnectionState,
  getLambdaConnectionErrorDetails,
  LambdaHealthCheckError,
  normalizeLambdaBaseUrl,
  verifyLambdaHealth,
} from '../utils/verifyLambdaHealth';
import { generateAuthSecret } from './generateAuthSecret';
import {
  type BackupsParameters,
  getProjectTimezone,
  hasStoredBackupSchedule,
  isConnectionHealthy,
  readAuthSecret,
  readConnection,
  readDebug,
  readDeploymentUrl,
  readEnabledCadences,
} from './pluginParams';

const MISSING_AUTH_SECRET_MESSAGE =
  'Save a shared secret before using the backup service.';

/** Extract a human-readable message from an unknown thrown value. */
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

/** Apply asynchronous results only while their request still owns the UI. */
const commitIfActive = (controller: AbortController, commit: () => void) => {
  if (!controller.signal.aborted) {
    commit();
  }
};

/** The plugin's id from ctx, or undefined when it is missing/blank. */
const getPluginIdFromCtx = (ctx: RenderConfigScreenCtx): string | undefined => {
  const candidate = (ctx.plugin as { id?: unknown } | undefined)?.id;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
};

/** Transient (non-persisted) validation error surfaced by the Connect step. */
export type ConnectionTestError = {
  summary: string;
  details: string[];
};

const getConnectionPreflightError = (
  candidateUrl: string,
  secret: string,
): ConnectionTestError | undefined => {
  if (!candidateUrl) {
    return { summary: 'Save a deployment URL in step 2 first.', details: [] };
  }
  if (!secret) {
    return {
      summary: MISSING_AUTH_SECRET_MESSAGE,
      details: [
        'Save a shared secret in step 1 first, and configure the matching secret on your deployment.',
      ],
    };
  }
  return undefined;
};

/**
 * Central orchestration hook for the config wizard. Holds the ephemeral edit
 * state (secret/url/cadence/debug inputs), the queued authoritative-merge
 * persister, every per-step save+act handler, the run-once mount health ping,
 * and the overview/environment loaders. All persisted values are read via the
 * `pluginParams` getters over `ctx.plugin.attributes.parameters` — the single
 * source of truth — so no separate React snapshot can drift.
 */
export const useBackupsConfig = (ctx: RenderConfigScreenCtx) => {
  const params = ctx.plugin.attributes.parameters as BackupsParameters;
  const projectTimezone = getProjectTimezone(ctx.site);
  const canEdit = ctx.currentRole.meta.final_permissions.can_edit_schema;

  const savedSecret = readAuthSecret(params);
  const savedUrl = readDeploymentUrl(params);
  const connection = readConnection(params);
  const isConnected = isConnectionHealthy(params);

  // Ephemeral edit-state. A fresh install (no saved secret) pre-fills a strong
  // generated secret into the field, unsaved until [Save secret].
  const [secretInput, setSecretInput] = useState(
    () => savedSecret || generateAuthSecret(),
  );
  const [urlInput, setUrlInput] = useState(savedUrl);
  const [cadenceSelection, setCadenceSelection] = useState<BackupCadence[]>(
    () => readEnabledCadences(params, projectTimezone),
  );
  const [debugEnabled, setDebugEnabled] = useState(() => readDebug(params));

  // Activity flags.
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const [isSavingDeployment, setIsSavingDeployment] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMountChecking, setIsMountChecking] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [backupNowInFlightCadence, setBackupNowInFlightCadence] =
    useState<BackupCadence | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  // Connect-step transient error (pre-flight validation not written to params).
  const [connectionTestError, setConnectionTestError] =
    useState<ConnectionTestError | null>(null);

  const [deploymentUrlError, setDeploymentUrlError] = useState<string | null>(
    null,
  );

  // Overview / environment data.
  const [lambdaBackupStatus, setLambdaBackupStatus] = useState<
    LambdaBackupStatus | undefined
  >(undefined);
  const [availableEnvironmentIds, setAvailableEnvironmentIds] = useState<
    string[] | undefined
  >(undefined);
  const [overviewError, setOverviewError] = useState('');
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [hasUncertainBackup, setHasUncertainBackup] = useState(false);

  // Imperative locks take effect before React's next render, preventing double
  // clicks and overlapping connect/save/manual actions from dispatching twice.
  const actionInFlightRef = useRef(false);
  const backupRunRef = useRef<AbortController | null>(null);
  const uncertainBackupRef = useRef(false);
  const overviewRequestRef = useRef<AbortController | null>(null);
  const latestCtxRef = useRef(ctx);
  latestCtxRef.current = ctx;

  const debugLogger = useMemo(
    () => createDebugLogger(debugEnabled, 'ConfigScreen'),
    [debugEnabled],
  );
  const debugLoggerRef = useRef(debugLogger);
  debugLoggerRef.current = debugLogger;

  const hasRunMountCheckRef = useRef(false);
  const isMountCheckUnmountedRef = useRef(false);
  // Snapshot of the first-render params so the run-once mount effect always
  // validates against the values present at load, regardless of later persists.
  const initialMountRef = useRef<{
    secret: string;
    url: string;
    hasStoredSchedule: boolean;
    scheduleNormalization: ReturnType<typeof normalizeBackupScheduleConfig>;
  } | null>(null);
  if (!initialMountRef.current) {
    initialMountRef.current = {
      secret: savedSecret,
      url: savedUrl,
      hasStoredSchedule: hasStoredBackupSchedule(params),
      scheduleNormalization: normalizeBackupScheduleConfig({
        value: params?.backupSchedule,
        timezoneFallback: projectTimezone,
      }),
    };
  }

  const persistRef = useRef<ReturnType<
    typeof createPluginParameterPersister
  > | null>(null);
  if (!persistRef.current) {
    persistRef.current = createPluginParameterPersister({
      initialParameters: params,
      readLatest: async () => {
        const currentCtx = latestCtxRef.current;
        const pluginId = getPluginIdFromCtx(currentCtx);
        if (!pluginId || !currentCtx.currentUserAccessToken) {
          return undefined;
        }
        const plugin = await readCma(
          {
            apiToken: currentCtx.currentUserAccessToken,
            environment: currentCtx.environment,
            baseUrl: currentCtx.cmaBaseUrl,
          },
          (client) => client.plugins.find(pluginId),
        );
        return toPluginParameterRecord(plugin.parameters);
      },
      write: (parameters) =>
        latestCtxRef.current.updatePluginParameters(parameters),
    });
  }
  // The queue always reads current credentials and returns the parameters it
  // actually saved. A failed authoritative read blocks the write.
  const persistPluginParameters = persistRef.current;

  const fetchBackupEnvironments = useCallback(async (signal?: AbortSignal) => {
    const currentCtx = latestCtxRef.current;
    if (!currentCtx.currentUserAccessToken) {
      throw new Error(
        'Environment read access is required to verify backup completion.',
      );
    }
    return readCma(
      {
        apiToken: currentCtx.currentUserAccessToken,
        environment: currentCtx.environment,
        baseUrl: currentCtx.cmaBaseUrl,
        signal,
      },
      (client) => client.environments.list(),
    );
  }, []);

  const readVerifiedBackupStatus = useCallback(
    async (baseUrl: string, secret: string, signal?: AbortSignal) => {
      const status = await fetchLambdaBackupStatus({
        baseUrl,
        environment: latestCtxRef.current.environment,
        lambdaAuthSecret: secret,
        signal,
      });
      const environments: BackupEnvironment[] =
        await fetchBackupEnvironments(signal);
      if (signal?.aborted) {
        throw new DOMException('Backup observation aborted.', 'AbortError');
      }
      const readyIds = environments
        .filter((environment) => environment.meta.status === 'ready')
        .map((environment) => environment.id);
      // Reconcile snapshots: cron may start a fork after the service read but
      // before the CMA read. Creation timestamps still require readiness.
      const verifiedStatus = enrichBackupStatusWithEnvironments(
        status,
        environments,
      );
      if (backupRunRef.current) {
        const creating = getCreatingBackupCadences(environments);
        if (creating.length > 0) {
          setProgressMessage(
            creating
              .map((cadence) => {
                const percentage = getBackupEnvironmentProgress(
                  cadence,
                  environments,
                );
                return `Cloning ${getCadenceLabel(cadence).toLowerCase()} backup${percentage === undefined ? '…' : `: ${percentage}%`}`;
              })
              .join(' | '),
          );
        }
      }
      setAvailableEnvironmentIds(readyIds);
      return verifiedStatus;
    },
    [fetchBackupEnvironments],
  );

  const refreshLambdaBackupOverview = useCallback(
    async (baseUrl?: string, authSecret?: string) => {
      overviewRequestRef.current?.abort();
      const controller = new AbortController();
      overviewRequestRef.current = controller;
      const candidateUrl = (baseUrl || savedUrl).trim();
      const secret = (authSecret ?? savedSecret).trim();
      if (!candidateUrl || !secret) {
        setLambdaBackupStatus(undefined);
        setAvailableEnvironmentIds(undefined);
        setOverviewError(
          !candidateUrl
            ? 'Backup status is unavailable until a deployment URL is saved.'
            : 'Backup status is unavailable until the shared secret is saved.',
        );
        setIsLoadingOverview(false);
        return;
      }

      setIsLoadingOverview(true);
      try {
        const status = await readVerifiedBackupStatus(
          candidateUrl,
          secret,
          controller.signal,
        );
        commitIfActive(controller, () => setLambdaBackupStatus(status));
      } catch (error) {
        commitIfActive(controller, () => {
          setLambdaBackupStatus(undefined);
          setAvailableEnvironmentIds(undefined);
          setOverviewError(getErrorMessage(error));
        });
      } finally {
        commitIfActive(controller, () => setIsLoadingOverview(false));
      }
    },
    [readVerifiedBackupStatus, savedSecret, savedUrl],
  );

  const reportBackupOutcome = useCallback(
    async (
      outcome: BackupCadencesResult,
      baseUrl: string,
      lambdaAuthSecret: string,
    ) => {
      uncertainBackupRef.current = outcome.uncertain;
      setHasUncertainBackup(outcome.uncertain);
      if (outcome.completed.length > 0) {
        const plural = outcome.completed.length > 1 ? 's' : '';
        latestCtxRef.current.notice(
          `Backup environments are ready for ${outcome.completed.length} cadence${plural}.`,
        );
      }
      // Refresh first: a successful read must not erase partial execution errors.
      await refreshLambdaBackupOverview(baseUrl, lambdaAuthSecret);
      if (outcome.failures.length > 0) {
        setOverviewError(outcome.failures.join(' | '));
      }
    },
    [refreshLambdaBackupOverview],
  );

  const runBackupCadences = useCallback(
    async ({
      baseUrl,
      lambdaAuthSecret,
      cadences,
      onlyMissing,
    }: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadences: BackupCadence[];
      onlyMissing: boolean;
    }) => {
      if (backupRunRef.current || uncertainBackupRef.current) {
        return;
      }
      const controller = new AbortController();
      backupRunRef.current = controller;
      overviewRequestRef.current?.abort();
      setIsLoadingOverview(false);
      setOverviewError('');
      setBackupNowInFlightCadence(cadences[0] ?? null);
      setProgressMessage('Checking backup environments…');
      const environment = latestCtxRef.current.environment;
      try {
        const outcome = await executeBackupCadences({
          cadences,
          onlyMissing,
          continuousObservation: true,
          signal: controller.signal,
          readStatus: () =>
            readVerifiedBackupStatus(
              baseUrl,
              lambdaAuthSecret,
              controller.signal,
            ),
          confirmCompletion: async (cadence, status) =>
            Boolean(status.slots[cadence]?.lastManagedEnvironmentId),
          trigger: (scope) =>
            triggerLambdaBackupNow({
              baseUrl,
              environment,
              scope,
              lambdaAuthSecret,
              signal: controller.signal,
            }),
          onCadence: setBackupNowInFlightCadence,
          onProgress: setProgressMessage,
          onStatus: setLambdaBackupStatus,
        });
        if (controller.signal.aborted) {
          return;
        }
        await reportBackupOutcome(outcome, baseUrl, lambdaAuthSecret);
      } catch (error) {
        commitIfActive(controller, () =>
          setOverviewError(getErrorMessage(error)),
        );
      } finally {
        if (backupRunRef.current === controller) {
          backupRunRef.current = null;
        }
        commitIfActive(controller, () => {
          setProgressMessage(null);
          setBackupNowInFlightCadence(null);
        });
        controller.abort();
      }
    },
    [readVerifiedBackupStatus, reportBackupOutcome],
  );

  const ensureBackupsExistForCadences = useCallback(
    (input: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadences: BackupCadence[];
    }) => runBackupCadences({ ...input, onlyMissing: true }),
    [runBackupCadences],
  );

  /** Mount migrations and failure reports remain best-effort. */
  const persistMountParameters = useCallback(
    async (
      updates: Record<string, unknown>,
      expectedConnection?: { secret: string; url: string },
    ) => {
      try {
        await persistPluginParameters(updates, expectedConnection);
      } catch {
        // Ignore persistence errors on mount.
      }
    },
    [persistPluginParameters],
  );

  const reportMissingMountSecret = useCallback(
    async (url: string, secret: string, isCancelled: () => boolean) => {
      const disconnectedState = buildDisconnectedLambdaConnectionState(
        new LambdaHealthCheckError({
          code: 'MISSING_AUTH_SECRET',
          message: MISSING_AUTH_SECRET_MESSAGE,
          phase: 'config_mount',
          endpoint: `${url.replace(/\/+$/, '')}/api/datocms/plugin-health`,
        }),
        url,
        'config_mount',
      );
      await persistMountParameters(
        {
          lambdaConnection: disconnectedState,
          connectionValidationMode: null,
        },
        { secret, url },
      );
      if (!isCancelled()) {
        setIsMountChecking(false);
      }
    },
    [persistMountParameters],
  );

  const runMountHealthCheck = useCallback(
    async ({
      configuredDeploymentUrl,
      isCancelled,
    }: {
      configuredDeploymentUrl: string;
      isCancelled: () => boolean;
    }) => {
      const secret = (initialMountRef.current?.secret ?? '').trim();
      const currentConnectionMatches = () => {
        const currentParams = latestCtxRef.current.plugin.attributes
          .parameters as BackupsParameters;
        return (
          readAuthSecret(currentParams) === secret &&
          readDeploymentUrl(currentParams) === configuredDeploymentUrl
        );
      };

      if (!secret) {
        await reportMissingMountSecret(
          configuredDeploymentUrl,
          secret,
          isCancelled,
        );
        return;
      }

      debugLogger.log('Running mount health check', {
        configuredDeploymentUrl,
        phase: 'config_mount',
      });

      try {
        const verificationResult = await verifyLambdaHealth({
          baseUrl: configuredDeploymentUrl,
          environment: ctx.environment,
          phase: 'config_mount',
          lambdaAuthSecret: secret,
        });

        if (isCancelled() || !currentConnectionMatches()) {
          return;
        }

        const connectedState = buildConnectedLambdaConnectionState(
          verificationResult.endpoint,
          verificationResult.checkedAt,
          'config_mount',
        );

        setUrlInput(verificationResult.normalizedBaseUrl);
        setConnectionTestError(null);

        // Persist ONLY the connection result. The secret and URL are already
        // saved; re-writing them from the frozen first-render snapshot would
        // clobber a secret the user saves while this check is in flight.
        await persistPluginParameters(
          {
            lambdaConnection: connectedState,
            connectionValidationMode: 'health',
          },
          { secret, url: configuredDeploymentUrl },
        );
      } catch (error) {
        if (isCancelled() || !currentConnectionMatches()) {
          return;
        }

        const disconnectedState = buildDisconnectedLambdaConnectionState(
          error,
          configuredDeploymentUrl,
          'config_mount',
        );
        debugLogger.warn('Mount health check failed', disconnectedState);

        await persistMountParameters(
          {
            lambdaConnection: disconnectedState,
            connectionValidationMode: null,
          },
          { secret, url: configuredDeploymentUrl },
        );
      } finally {
        if (!isCancelled()) {
          setIsMountChecking(false);
          debugLogger.log('Mount health check finished');
        }
      }
    },
    [
      ctx.environment,
      debugLogger,
      persistPluginParameters,
      persistMountParameters,
      reportMissingMountSecret,
    ],
  );

  const runMigrateAndCheck = useCallback(
    async (isCancelled: () => boolean) => {
      const snapshot = initialMountRef.current;
      if (!snapshot) {
        return;
      }

      // Only migrate a schedule that was actually stored in a legacy shape.
      // A fresh install has no stored schedule, and persisting a default here
      // would make step 3 auto-complete with cadences the user never chose.
      if (
        snapshot.hasStoredSchedule &&
        snapshot.scheduleNormalization.requiresMigration
      ) {
        await persistMountParameters({
          backupSchedule: snapshot.scheduleNormalization.config,
        });
      }

      const configuredDeploymentUrl = snapshot.url;
      setIsMountChecking(true);

      if (!configuredDeploymentUrl.trim()) {
        debugLogger.log(
          'Skipping mount health check because no deployment URL is configured',
        );
        if (!isCancelled()) {
          setConnectionTestError(null);
          setIsMountChecking(false);
        }

        await persistMountParameters(
          {
            lambdaConnection: null,
            connectionValidationMode: null,
          },
          { secret: snapshot.secret, url: snapshot.url },
        );

        return;
      }

      await runMountHealthCheck({ configuredDeploymentUrl, isCancelled });
    },
    [debugLogger, persistMountParameters, runMountHealthCheck],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mount health must run once despite changing SDK ctx identities (see AGENTS.md).
  useEffect(() => {
    // A StrictMode remount re-enters this effect on the same fiber, so reset the
    // unmount flag here; a genuine unmount sets it again via the cleanup below
    // and is never followed by a re-entry.
    isMountCheckUnmountedRef.current = false;

    if (!hasRunMountCheckRef.current) {
      hasRunMountCheckRef.current = true;
      debugLoggerRef.current.log('Config screen mounted');
      void runMigrateAndCheck(() => isMountCheckUnmountedRef.current);
    }

    return () => {
      isMountCheckUnmountedRef.current = true;
      debugLoggerRef.current.log('Config screen unmounted');
    };
    // Must run exactly once per component instance (StrictMode double-invoke
    // included). Its callbacks close over `ctx`, whose identity changes after
    // every updatePluginParameters; listing them would re-fire the effect on
    // every render and, because the effect persists parameters, recreate the
    // infinite request loop this guard fixes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshLambdaBackupOverview();
    return () => overviewRequestRef.current?.abort();
  }, [refreshLambdaBackupOverview]);

  useEffect(
    () => () => {
      backupRunRef.current?.abort();
    },
    [],
  );

  const handleUrlChange = useCallback((value: string) => {
    setUrlInput(value);
    setDeploymentUrlError(null);
    setConnectionTestError(null);
  }, []);

  const regenerateSecret = useCallback(() => {
    setSecretInput(generateAuthSecret());
  }, []);

  const writeSecretToClipboard = useCallback(
    async (value: string, successMessage: string) => {
      if (!value) {
        return false;
      }
      try {
        await navigator.clipboard.writeText(value);
        ctx.notice(successMessage);
        return true;
      } catch {
        await ctx.alert('Could not copy the secret. Copy it manually.');
        return false;
      }
    },
    [ctx],
  );

  const copySecret = useCallback(async () => {
    const value = secretInput.trim();
    if (!value) {
      return;
    }
    await writeSecretToClipboard(value, 'Shared secret copied.');
  }, [secretInput, writeSecretToClipboard]);

  const copySavedSecret = useCallback(async () => {
    const value = savedSecret.trim();
    if (!value) {
      return;
    }
    await writeSecretToClipboard(value, 'Shared secret copied.');
  }, [savedSecret, writeSecretToClipboard]);

  const saveSecret = useCallback(async () => {
    if (actionInFlightRef.current || backupRunRef.current) {
      return false;
    }
    const nextSecret = secretInput.trim();
    if (!nextSecret) {
      await ctx.alert('Enter or generate an auth secret before saving.');
      return false;
    }

    actionInFlightRef.current = true;
    setIsSavingSecret(true);
    try {
      // The persister decides whether to invalidate the connection against the
      // authoritative secret, since this screen's saved snapshot may be stale.
      await persistPluginParameters({ lambdaAuthSecret: nextSecret });
      debugLogger.log('Auth secret saved');
      return true;
    } catch (error) {
      debugLogger.error('Could not save auth secret', error);
      await ctx.alert('Could not save the auth secret.');
      return false;
    } finally {
      actionInFlightRef.current = false;
      setIsSavingSecret(false);
    }
  }, [ctx, debugLogger, persistPluginParameters, secretInput]);

  /**
   * Persist the edited secret and immediately copy it to the clipboard so the
   * user can paste it into their deployment's `DATOCMS_BACKUPS_SHARED_SECRET`
   * env var in one action. Reuses {@link saveSecret} (validates + persists) and
   * {@link copySecret} (clipboard + notice/alert).
   */
  const saveAndCopySecret = useCallback(async () => {
    const didSave = await saveSecret();
    if (!didSave) {
      return;
    }

    await writeSecretToClipboard(
      secretInput.trim(),
      'Shared secret saved and copied.',
    );
  }, [saveSecret, secretInput, writeSecretToClipboard]);

  /** Discard the in-flight secret edit, restoring the field to the saved value. */
  const revertSecret = useCallback(() => {
    setSecretInput(savedSecret);
  }, [savedSecret]);

  const saveDeploymentUrl = useCallback(async () => {
    if (actionInFlightRef.current || backupRunRef.current || !canEdit) return;
    const candidateUrl = urlInput.trim();
    if (!candidateUrl) {
      setDeploymentUrlError('Enter the public URL for your deployment.');
      return;
    }

    actionInFlightRef.current = true;
    setIsSavingDeployment(true);
    setDeploymentUrlError(null);

    try {
      const normalizedUrl = normalizeLambdaBaseUrl(candidateUrl);
      const updates: Record<string, unknown> = {
        deploymentURL: normalizedUrl,
        netlifyURL: normalizedUrl,
        vercelURL: normalizedUrl,
      };

      await persistPluginParameters(updates);
      setUrlInput(normalizedUrl);
      setConnectionTestError(null);
      debugLogger.log('Deployment URL saved');
      ctx.notice('Deployment URL saved.');
    } catch (error) {
      const message =
        error instanceof LambdaHealthCheckError
          ? error.message
          : 'Could not save the deployment URL.';
      setDeploymentUrlError(message);
      debugLogger.error('Could not save deployment URL', error);
    } finally {
      actionInFlightRef.current = false;
      setIsSavingDeployment(false);
    }
  }, [canEdit, ctx, debugLogger, persistPluginParameters, urlInput]);

  const reportConnectionFailure = useCallback(
    async (
      error: unknown,
      candidateUrl: string,
      expectedConnection: { secret: string; url: string },
    ) => {
      if (!(error instanceof LambdaHealthCheckError)) {
        debugLogger.error('Unexpected error while connecting lambda', error);
        setConnectionTestError({
          summary: 'Unexpected error while connecting lambda.',
          details: [`Failure details: ${getErrorMessage(error)}`],
        });
        return;
      }

      const disconnectedState = buildDisconnectedLambdaConnectionState(
        error,
        candidateUrl,
        'config_connect',
      );
      debugLogger.warn('Lambda health check failed during connect', error);
      // Always surface the failure in the UI, independent of persistence.
      setConnectionTestError({
        summary: error.message || 'Connection test failed.',
        details: getLambdaConnectionErrorDetails(disconnectedState),
      });
      try {
        await persistPluginParameters(
          {
            deploymentURL: candidateUrl,
            netlifyURL: candidateUrl,
            vercelURL: candidateUrl,
            lambdaConnection: disconnectedState,
            connectionValidationMode: null,
          },
          expectedConnection,
        );
      } catch {
        // Error already surfaced via connectionTestError above.
      }
    },
    [debugLogger, persistPluginParameters],
  );

  const testConnection = useCallback(async () => {
    if (actionInFlightRef.current || backupRunRef.current) {
      return;
    }
    const candidateUrl = readDeploymentUrl(params);
    const secret = readAuthSecret(params);
    const preflightError = getConnectionPreflightError(candidateUrl, secret);
    if (preflightError) {
      setConnectionTestError(preflightError);
      return;
    }

    const expectedConnection = { secret, url: readDeploymentUrl(params) };
    actionInFlightRef.current = true;
    setIsConnecting(true);
    setConnectionTestError(null);

    try {
      const verificationResult = await verifyLambdaHealth({
        baseUrl: candidateUrl,
        environment: ctx.environment,
        phase: 'config_connect',
        lambdaAuthSecret: secret,
      });

      const connectedState = buildConnectedLambdaConnectionState(
        verificationResult.endpoint,
        verificationResult.checkedAt,
        'config_connect',
      );

      // Persist the deployment URL triplet (legacy netlify/vercel keys kept in
      // lockstep) together with the resulting connection state. The secret is
      // not re-written here — it is already saved, and re-persisting a value
      // captured before this multi-second request risks clobbering a concurrent
      // secret save.
      const persisted = await persistPluginParameters(
        {
          deploymentURL: verificationResult.normalizedBaseUrl,
          netlifyURL: verificationResult.normalizedBaseUrl,
          vercelURL: verificationResult.normalizedBaseUrl,
          lambdaConnection: connectedState,
          connectionValidationMode: 'health',
        },
        expectedConnection,
      );
      if (!persisted) {
        setConnectionTestError({
          summary:
            'The saved connection changed during the test. Test the current values again.',
          details: [],
        });
        return;
      }

      setUrlInput(verificationResult.normalizedBaseUrl);
      debugLogger.log('Lambda connected successfully', {
        endpoint: verificationResult.endpoint,
      });
      ctx.notice('Lambda function connected successfully.');

      // If a schedule is already saved (e.g. reconnecting to a fresh
      // deployment), create any missing backup environments now — matching the
      // old connect behavior. Fresh installs have no stored schedule yet, so
      // creation stays the Schedule step's responsibility.
      if (hasStoredBackupSchedule(persisted)) {
        await ensureBackupsExistForCadences({
          baseUrl: verificationResult.normalizedBaseUrl,
          lambdaAuthSecret: secret,
          cadences: readEnabledCadences(persisted, projectTimezone),
        });
      }
    } catch (error) {
      await reportConnectionFailure(error, candidateUrl, expectedConnection);
    } finally {
      actionInFlightRef.current = false;
      setIsConnecting(false);
    }
  }, [
    ctx,
    debugLogger,
    ensureBackupsExistForCadences,
    params,
    persistPluginParameters,
    projectTimezone,
    reportConnectionFailure,
  ]);

  const removeDeployment = useCallback(async () => {
    if (actionInFlightRef.current || backupRunRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    setIsDisconnecting(true);
    setConnectionTestError(null);
    setDeploymentUrlError(null);

    try {
      await persistPluginParameters({
        deploymentURL: '',
        netlifyURL: '',
        vercelURL: '',
        lambdaConnection: null,
        connectionValidationMode: null,
      });

      setUrlInput('');
      setLambdaBackupStatus(undefined);
      setOverviewError(
        'Backup status is unavailable until a deployment URL is saved.',
      );
      debugLogger.log('Deployment removed');
      ctx.notice('Saved deployment removed.');
    } catch (error) {
      debugLogger.error('Could not disconnect current lambda', error);
      await ctx.alert('Could not remove the saved deployment.');
    } finally {
      actionInFlightRef.current = false;
      setIsDisconnecting(false);
    }
  }, [ctx, debugLogger, persistPluginParameters]);

  const buildPersistedBackupSchedule = useCallback(
    (normalizedEnabledCadences: BackupCadence[]): BackupScheduleConfig => {
      const savedSchedule = normalizeBackupScheduleConfig({
        value: params?.backupSchedule,
        timezoneFallback: projectTimezone,
      }).config;
      const savedCadences = savedSchedule.enabledCadences;
      const didCadencesChange =
        savedCadences.length !== normalizedEnabledCadences.length ||
        savedCadences.some(
          (cadence, index) => cadence !== normalizedEnabledCadences[index],
        );
      return {
        version: BACKUP_SCHEDULE_VERSION,
        enabledCadences: normalizedEnabledCadences,
        timezone: projectTimezone,
        anchorLocalDate: didCadencesChange
          ? toLocalDateKey(new Date(), projectTimezone)
          : savedSchedule.anchorLocalDate,
        updatedAt: new Date().toISOString(),
      };
    },
    [params?.backupSchedule, projectTimezone],
  );

  const setCadenceEnabled = useCallback(
    (cadence: BackupCadence, enabled: boolean) => {
      setCadenceSelection((current) => {
        if (enabled) {
          if (current.includes(cadence)) {
            return current;
          }
          return BACKUP_CADENCES.filter(
            (candidate) => candidate === cadence || current.includes(candidate),
          );
        }
        return current.filter((candidate) => candidate !== cadence);
      });
    },
    [],
  );

  const saveSchedule = useCallback(async () => {
    if (
      actionInFlightRef.current ||
      backupRunRef.current ||
      uncertainBackupRef.current
    ) {
      return false;
    }
    const normalized = BACKUP_CADENCES.filter((cadence) =>
      cadenceSelection.includes(cadence),
    );
    if (normalized.length === 0) {
      await ctx.alert('Select at least one backup cadence.');
      return false;
    }

    actionInFlightRef.current = true;
    setIsSavingSchedule(true);
    try {
      const persistedSchedule = buildPersistedBackupSchedule(normalized);
      const persisted = await persistPluginParameters({
        backupSchedule: persistedSchedule,
      });
      debugLogger.log('Backup schedule saved', {
        enabledCadences: normalized,
      });
      ctx.notice('Backup schedule saved.');

      const baseUrl = readDeploymentUrl(persisted);
      const secret = readAuthSecret(persisted);
      if (baseUrl && secret && isConnectionHealthy(persisted)) {
        await ensureBackupsExistForCadences({
          baseUrl,
          lambdaAuthSecret: secret,
          cadences: normalized,
        });
      }
      return true;
    } catch (error) {
      debugLogger.error('Could not save backup schedule', error);
      await ctx.alert('Could not save the backup schedule.');
      return false;
    } finally {
      actionInFlightRef.current = false;
      setIsSavingSchedule(false);
    }
  }, [
    buildPersistedBackupSchedule,
    cadenceSelection,
    ctx,
    debugLogger,
    ensureBackupsExistForCadences,
    persistPluginParameters,
  ]);

  const saveDebug = useCallback(
    async (enabled: boolean) => {
      setDebugEnabled(enabled);
      try {
        await persistPluginParameters({ debug: enabled });
      } catch (error) {
        // Revert the optimistic toggle and tell the user it did not stick.
        setDebugEnabled(!enabled);
        debugLogger.error('Could not persist debug setting', error);
        await ctx.alert('Could not save the debug setting.');
      }
    },
    [ctx, debugLogger, persistPluginParameters],
  );

  const backupNow = useCallback(
    async (scope: BackupCadence) => {
      if (
        actionInFlightRef.current ||
        backupRunRef.current ||
        uncertainBackupRef.current
      ) {
        return;
      }
      const currentParams = latestCtxRef.current.plugin.attributes
        .parameters as BackupsParameters;
      const baseUrl = readDeploymentUrl(currentParams);
      const secret = readAuthSecret(currentParams);
      if (!isConnectionHealthy(currentParams) || !baseUrl || !secret) {
        setOverviewError(
          'Connect and authenticate the Lambda URL before running backup now.',
        );
        return;
      }
      actionInFlightRef.current = true;
      try {
        await runBackupCadences({
          baseUrl,
          lambdaAuthSecret: secret,
          cadences: [scope],
          onlyMissing: false,
        });
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [runBackupCadences],
  );

  const onOpenEnvironments = useCallback(async () => {
    const environmentPrefix = ctx.isEnvironmentPrimary
      ? ''
      : `/environments/${ctx.environment}`;
    await ctx.navigateTo(`${environmentPrefix}/project_settings/environments`);
  }, [ctx]);

  const onOpenAccessTokens = useCallback(async () => {
    await ctx.navigateTo('/project_settings/access_tokens');
  }, [ctx]);

  const canBackupNow =
    canEdit &&
    isConnected &&
    savedSecret.trim().length > 0 &&
    !isConnecting &&
    !isMountChecking &&
    !isDisconnecting &&
    !isSavingSecret &&
    !isSavingDeployment &&
    !isSavingSchedule &&
    !hasUncertainBackup;

  const isBusy =
    isSavingSecret ||
    isSavingDeployment ||
    isConnecting ||
    isSavingSchedule ||
    isDisconnecting ||
    backupNowInFlightCadence !== null;

  const connectionErrorDetails: string[] =
    !isConnected && connection?.status === 'disconnected'
      ? getLambdaConnectionErrorDetails(connection)
      : [];

  return {
    params,
    projectTimezone,
    canEdit,
    // saved reads
    savedSecret,
    savedUrl,
    connection,
    isConnected,
    connectionErrorDetails,
    // edit state
    secretInput,
    setSecretInput,
    urlInput,
    setUrlInput: handleUrlChange,
    cadenceSelection,
    setCadenceEnabled,
    debugEnabled,
    // handlers
    saveSecret,
    saveAndCopySecret,
    regenerateSecret,
    revertSecret,
    copySecret,
    copySavedSecret,
    saveDeploymentUrl,
    testConnection,
    removeDeployment,
    saveSchedule,
    saveDebug,
    backupNow,
    onOpenEnvironments,
    onOpenAccessTokens,
    // activity
    isSavingSecret,
    isSavingDeployment,
    isConnecting,
    isMountChecking,
    isDisconnecting,
    isSavingSchedule,
    backupNowInFlightCadence,
    progressMessage,
    connectionTestError,
    deploymentUrlError,
    // overview
    lambdaBackupStatus,
    availableEnvironmentIds,
    overviewError,
    isLoadingOverview,
    canBackupNow,
    isBusy,
    hasUncertainBackup,
  };
};

export type BackupsConfig = ReturnType<typeof useBackupsConfig>;

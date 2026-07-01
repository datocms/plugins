import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackupCadence,
  BackupScheduleConfig,
  LambdaBackupStatus,
} from '../types/types';
import {
  BACKUP_CADENCES,
  BACKUP_SCHEDULE_VERSION,
  getCadenceLabel,
  normalizeBackupScheduleConfig,
  toLocalDateKey,
} from '../utils/backupSchedule';
import { createDebugLogger } from '../utils/debugLogger';
import { fetchLambdaBackupStatus } from '../utils/fetchLambdaBackupStatus';
import {
  mergePluginParameterUpdates,
  toPluginParameterRecord,
} from '../utils/pluginParameterMerging';
import {
  LambdaBackupNowError,
  triggerLambdaBackupNow,
} from '../utils/triggerLambdaBackupNow';
import {
  buildConnectedLambdaConnectionState,
  buildDisconnectedLambdaConnectionState,
  getLambdaConnectionErrorDetails,
  LambdaHealthCheckError,
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
  readDeploymentUrl,
  readDebug,
  readEnabledCadences,
} from './pluginParams';

const MISSING_AUTH_SECRET_MESSAGE =
  'Enter Lambda auth secret before calling lambda endpoints.';
const BACKUP_NOW_AFTER_SAVE_RETRY_DELAY_MS = 1200;

/** Extract a human-readable message from an unknown thrown value. */
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

/** Resolve after `ms` milliseconds (used to space out backup-now retries). */
const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

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
  const [cadenceSelection, setCadenceSelection] = useState<BackupCadence[]>(() =>
    readEnabledCadences(params, projectTimezone),
  );
  const [debugEnabled, setDebugEnabled] = useState(() => readDebug(params));

  // Activity flags.
  const [isSavingSecret, setIsSavingSecret] = useState(false);
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

  // Overview / environment data.
  const [lambdaBackupStatus, setLambdaBackupStatus] = useState<
    LambdaBackupStatus | undefined
  >(undefined);
  const [availableEnvironmentIds, setAvailableEnvironmentIds] = useState<
    string[] | undefined
  >(undefined);
  const [overviewError, setOverviewError] = useState('');
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);

  const debugLogger = useMemo(
    () => createDebugLogger(debugEnabled, 'ConfigScreen'),
    [debugEnabled],
  );
  const debugLoggerRef = useRef(debugLogger);
  debugLoggerRef.current = debugLogger;

  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hasRunMountCheckRef = useRef(false);
  const isMountCheckUnmountedRef = useRef(false);
  // Merge base for the persist queue. Accumulates every write so sequential
  // persists compose, even without a CMA token to re-read authoritative params
  // (the frozen mount closure would otherwise merge each write against the stale
  // first-render params and silently drop the previous write).
  const latestPersistedParamsRef = useRef<Record<string, unknown>>(
    toPluginParameterRecord(params),
  );

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

  /**
   * Persist a partial parameter update. Serializes concurrent saves through a
   * promise queue and re-reads the authoritative parameters from the CMA before
   * merging, so unrelated keys are never clobbered by a stale local copy.
   */
  const persistPluginParameters = useCallback(
    async (updates: Record<string, unknown>) => {
      const persistTask = async () => {
        // Default merge base is the running accumulator so writes compose in
        // order regardless of token availability.
        let latestParameters = latestPersistedParamsRef.current;
        const pluginId = getPluginIdFromCtx(ctx);

        if (pluginId && ctx.currentUserAccessToken) {
          try {
            const client = buildClient({
              apiToken: ctx.currentUserAccessToken,
              environment: ctx.environment,
              baseUrl: ctx.cmaBaseUrl,
            });
            const plugin = await client.plugins.find(pluginId);
            // Authoritative read also picks up any external changes.
            latestParameters = toPluginParameterRecord(plugin.parameters);
          } catch (error) {
            debugLogger.warn(
              'Falling back to accumulated plugin parameters because authoritative read failed',
              { pluginId, error: getErrorMessage(error) },
            );
          }
        }

        const merged = mergePluginParameterUpdates(latestParameters, updates);
        latestPersistedParamsRef.current = merged;
        await ctx.updatePluginParameters(merged);
      };

      const queuedPersist = persistQueueRef.current.then(
        persistTask,
        persistTask,
      );
      persistQueueRef.current = queuedPersist.then(
        () => undefined,
        () => undefined,
      );
      return queuedPersist;
    },
    [ctx, debugLogger],
  );

  const refreshLambdaBackupOverview = useCallback(
    async (baseUrl?: string) => {
      const candidateUrl = (baseUrl || savedUrl).trim();
      const secret = savedSecret.trim();
      const shouldFetch = candidateUrl.length > 0 && secret.length > 0;

      if (!shouldFetch) {
        setLambdaBackupStatus(undefined);
        setOverviewError(
          candidateUrl.length === 0
            ? 'Backup status is unavailable until a Lambda URL is connected.'
            : 'Backup status is unavailable until the auth secret is saved.',
        );
        setIsLoadingOverview(false);
        return;
      }

      setIsLoadingOverview(true);
      setOverviewError('');

      try {
        const status = await fetchLambdaBackupStatus({
          baseUrl: candidateUrl,
          environment: ctx.environment,
          lambdaAuthSecret: secret,
        });
        setLambdaBackupStatus(status);
      } catch (error) {
        setLambdaBackupStatus(undefined);
        setOverviewError(
          error instanceof Error
            ? error.message
            : 'Could not load backup overview from lambda status endpoint.',
        );
      } finally {
        setIsLoadingOverview(false);
      }
    },
    [ctx.environment, savedSecret, savedUrl],
  );

  const fetchAvailableEnvironmentIds = useCallback(async () => {
    if (!ctx.currentUserAccessToken) {
      return undefined;
    }

    try {
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken,
        environment: ctx.environment,
        baseUrl: ctx.cmaBaseUrl,
      });
      const environments = await client.environments.list();
      return environments
        .map((environment) => environment.id)
        .filter((id) => typeof id === 'string' && id.trim().length > 0);
    } catch {
      return undefined;
    }
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  const refreshAvailableEnvironments = useCallback(async () => {
    const environmentIds = await fetchAvailableEnvironmentIds();
    setAvailableEnvironmentIds(environmentIds);
  }, [fetchAvailableEnvironmentIds]);

  const triggerBackupForSingleCadence = useCallback(
    async ({
      baseUrl,
      lambdaAuthSecret,
      cadence,
    }: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadence: BackupCadence;
    }): Promise<{
      success: boolean;
      environmentId?: string;
      errorMessage?: string;
    }> => {
      setBackupNowInFlightCadence(cadence);
      try {
        const result = await triggerLambdaBackupNow({
          baseUrl,
          environment: ctx.environment,
          scope: cadence,
          lambdaAuthSecret,
        });
        return { success: true, environmentId: result.createdEnvironmentId };
      } catch (error) {
        // A freshly-persisted schedule can race the lambda's own run; a 409
        // means "already creating" — retry once after a short delay.
        const isRaceCondition =
          error instanceof LambdaBackupNowError &&
          error.code === 'HTTP' &&
          error.httpStatus === 409;

        if (isRaceCondition) {
          try {
            await delay(BACKUP_NOW_AFTER_SAVE_RETRY_DELAY_MS);
            const retryResult = await triggerLambdaBackupNow({
              baseUrl,
              environment: ctx.environment,
              scope: cadence,
              lambdaAuthSecret,
            });
            return {
              success: true,
              environmentId: retryResult.createdEnvironmentId,
            };
          } catch (retryError) {
            return {
              success: false,
              errorMessage: `${getCadenceLabel(cadence)}: ${getErrorMessage(retryError)}`,
            };
          }
        }

        return {
          success: false,
          errorMessage: `${getCadenceLabel(cadence)}: ${getErrorMessage(error)}`,
        };
      }
    },
    [ctx.environment],
  );

  const ensureBackupsExistForCadences = useCallback(
    async ({
      baseUrl,
      lambdaAuthSecret,
      cadences,
    }: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadences: BackupCadence[];
    }) => {
      if (cadences.length === 0) {
        return;
      }

      try {
        const status = await fetchLambdaBackupStatus({
          baseUrl,
          environment: ctx.environment,
          lambdaAuthSecret,
        });

        const missing = cadences.filter(
          (cadence) => !status.slots[cadence]?.lastBackupAt,
        );

        if (missing.length === 0) {
          await refreshLambdaBackupOverview(baseUrl);
          await refreshAvailableEnvironments();
          return;
        }

        setProgressMessage('Creating initial backups…');

        const createdEnvironmentIds: string[] = [];
        const failedCadences: string[] = [];

        for (const cadence of missing) {
          setProgressMessage(
            `Creating ${getCadenceLabel(cadence).toLowerCase()} backup…`,
          );
          const outcome = await triggerBackupForSingleCadence({
            baseUrl,
            lambdaAuthSecret,
            cadence,
          });
          if (outcome.success && outcome.environmentId) {
            createdEnvironmentIds.push(outcome.environmentId);
          } else if (outcome.errorMessage) {
            failedCadences.push(outcome.errorMessage);
          }
        }

        if (createdEnvironmentIds.length > 0) {
          const plural = createdEnvironmentIds.length > 1 ? 's' : '';
          ctx.notice(
            `Created ${createdEnvironmentIds.length} backup environment${plural} for the saved schedule.`,
          );
        }
        if (failedCadences.length > 0) {
          setOverviewError(
            `Some automatic backup creations failed: ${failedCadences.join(' | ')}`,
          );
        }

        await refreshLambdaBackupOverview(baseUrl);
        await refreshAvailableEnvironments();
      } catch (error) {
        setOverviewError(
          error instanceof Error
            ? error.message
            : 'Could not automatically create missing backup environments.',
        );
      } finally {
        setProgressMessage(null);
        setBackupNowInFlightCadence(null);
      }
    },
    [
      ctx,
      refreshAvailableEnvironments,
      refreshLambdaBackupOverview,
      triggerBackupForSingleCadence,
    ],
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

      if (!secret) {
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          new LambdaHealthCheckError({
            code: 'MISSING_AUTH_SECRET',
            message: MISSING_AUTH_SECRET_MESSAGE,
            phase: 'config_mount',
            endpoint: `${configuredDeploymentUrl.replace(/\/+$/, '')}/api/datocms/plugin-health`,
          }),
          configuredDeploymentUrl,
          'config_mount',
        );
        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            connectionValidationMode: null,
          });
        } catch {
          // Ignore persistence failure on mount.
        }
        if (!isCancelled()) {
          setIsMountChecking(false);
        }
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

        if (isCancelled()) {
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
        await persistPluginParameters({
          lambdaConnection: connectedState,
          connectionValidationMode: 'health',
        });
      } catch (error) {
        if (isCancelled()) {
          return;
        }

        const disconnectedState = buildDisconnectedLambdaConnectionState(
          error,
          configuredDeploymentUrl,
          'config_mount',
        );
        debugLogger.warn('Mount health check failed', disconnectedState);

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            connectionValidationMode: null,
          });
        } catch {
          // Ignore persistence failure on mount.
        }
      } finally {
        if (!isCancelled()) {
          setIsMountChecking(false);
          debugLogger.log('Mount health check finished');
        }
      }
    },
    [ctx.environment, debugLogger, persistPluginParameters],
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
        try {
          await persistPluginParameters({
            backupSchedule: snapshot.scheduleNormalization.config,
          });
        } catch {
          // Best-effort schedule migration.
        }
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

        try {
          await persistPluginParameters({
            lambdaConnection: null,
            connectionValidationMode: null,
          });
        } catch {
          // Ignore persistence errors on mount.
        }

        return;
      }

      await runMountHealthCheck({ configuredDeploymentUrl, isCancelled });
    },
    [debugLogger, persistPluginParameters, runMountHealthCheck],
  );

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
  }, [refreshLambdaBackupOverview]);

  useEffect(() => {
    let isCancelled = false;

    const loadAvailableEnvironments = async () => {
      const environmentIds = await fetchAvailableEnvironmentIds();
      if (isCancelled) {
        return;
      }
      setAvailableEnvironmentIds(environmentIds);
    };

    void loadAvailableEnvironments();

    return () => {
      isCancelled = true;
    };
  }, [fetchAvailableEnvironmentIds]);

  const handleUrlChange = useCallback((value: string) => {
    setUrlInput(value);
    setConnectionTestError(null);
  }, []);

  const regenerateSecret = useCallback(() => {
    setSecretInput(generateAuthSecret());
  }, []);

  const copySecret = useCallback(async () => {
    const value = secretInput.trim();
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      ctx.notice('Auth secret copied to clipboard.');
    } catch {
      await ctx.alert('Could not copy the secret. Copy it manually.');
    }
  }, [ctx, secretInput]);

  const saveSecret = useCallback(async () => {
    const nextSecret = secretInput.trim();
    if (!nextSecret) {
      await ctx.alert('Enter or generate an auth secret before saving.');
      return;
    }

    setIsSavingSecret(true);
    try {
      const previousSecret = readAuthSecret(params);
      const secretChanged = nextSecret !== previousSecret;

      const updates: Record<string, unknown> = { lambdaAuthSecret: nextSecret };
      // Any secret change invalidates the recorded connection state (healthy or
      // failed): clear it so the Connect step re-gates and the user re-tests
      // against the new secret, instead of showing a stale error/OK.
      if (secretChanged) {
        updates.lambdaConnection = null;
        updates.connectionValidationMode = null;
      }

      await persistPluginParameters(updates);
      debugLogger.log('Auth secret saved', { secretChanged });
      ctx.notice('Auth secret saved.');
    } catch (error) {
      debugLogger.error('Could not save auth secret', error);
      await ctx.alert('Could not save the auth secret.');
    } finally {
      setIsSavingSecret(false);
    }
  }, [ctx, debugLogger, params, persistPluginParameters, secretInput]);

  const saveAndTestConnection = useCallback(async () => {
    const candidateUrl = urlInput.trim();
    if (!candidateUrl) {
      setConnectionTestError({
        summary: 'Enter your lambda deployment URL.',
        details: [],
      });
      return;
    }

    const secret = readAuthSecret(params);
    if (!secret) {
      setConnectionTestError({
        summary: MISSING_AUTH_SECRET_MESSAGE,
        details: [
          'Save an auth secret in step 1 first, and set the same value as DATOCMS_BACKUPS_SHARED_SECRET on your deployment.',
        ],
      });
      return;
    }

    const hadHealthyConnection = isConnectionHealthy(params);
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
      await persistPluginParameters({
        deploymentURL: verificationResult.normalizedBaseUrl,
        netlifyURL: verificationResult.normalizedBaseUrl,
        vercelURL: verificationResult.normalizedBaseUrl,
        lambdaConnection: connectedState,
        connectionValidationMode: 'health',
      });

      setUrlInput(verificationResult.normalizedBaseUrl);
      debugLogger.log('Lambda connected successfully', {
        endpoint: verificationResult.endpoint,
      });
      ctx.notice('Lambda function connected successfully.');

      // If a schedule is already saved (e.g. reconnecting to a fresh
      // deployment), create any missing backup environments now — matching the
      // old connect behavior. Fresh installs have no stored schedule yet, so
      // creation stays step 3's responsibility.
      if (hasStoredBackupSchedule(params)) {
        await ensureBackupsExistForCadences({
          baseUrl: verificationResult.normalizedBaseUrl,
          lambdaAuthSecret: secret,
          cadences: readEnabledCadences(params, projectTimezone),
        });
      }
    } catch (error) {
      if (error instanceof LambdaHealthCheckError) {
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
        // Never clobber a previously-healthy deployment on a failed test (e.g.
        // a typo). Only persist the failing URL/state when there is no working
        // connection to preserve, so the error stays sticky during setup.
        if (!hadHealthyConnection) {
          try {
            await persistPluginParameters({
              deploymentURL: candidateUrl,
              netlifyURL: candidateUrl,
              vercelURL: candidateUrl,
              lambdaConnection: disconnectedState,
              connectionValidationMode: null,
            });
          } catch {
            // Error already surfaced via connectionTestError above.
          }
        }
      } else {
        debugLogger.error('Unexpected error while connecting lambda', error);
        setConnectionTestError({
          summary: 'Unexpected error while connecting lambda.',
          details: [`Failure details: ${getErrorMessage(error)}`],
        });
      }
    } finally {
      setIsConnecting(false);
    }
  }, [
    ctx,
    debugLogger,
    ensureBackupsExistForCadences,
    params,
    persistPluginParameters,
    projectTimezone,
    urlInput,
  ]);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    setConnectionTestError(null);

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
        'Backup status is unavailable until a Lambda URL is connected.',
      );
      debugLogger.log('Lambda disconnected');
      ctx.notice('Current lambda function has been disconnected.');
    } catch (error) {
      debugLogger.error('Could not disconnect current lambda', error);
      await ctx.alert('Could not disconnect the current lambda function.');
    } finally {
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
    const normalized = BACKUP_CADENCES.filter((cadence) =>
      cadenceSelection.includes(cadence),
    );
    if (normalized.length === 0) {
      await ctx.alert('Select at least one backup cadence.');
      return;
    }

    setIsSavingSchedule(true);
    try {
      const persistedSchedule = buildPersistedBackupSchedule(normalized);
      await persistPluginParameters({ backupSchedule: persistedSchedule });
      debugLogger.log('Backup schedule saved', {
        enabledCadences: normalized,
      });
      ctx.notice('Backup schedule saved.');

      const baseUrl = readDeploymentUrl(params);
      const secret = readAuthSecret(params);
      if (baseUrl && secret) {
        await ensureBackupsExistForCadences({
          baseUrl,
          lambdaAuthSecret: secret,
          cadences: normalized,
        });
      }
    } catch (error) {
      debugLogger.error('Could not save backup schedule', error);
      await ctx.alert('Could not save the backup schedule.');
    } finally {
      setIsSavingSchedule(false);
    }
  }, [
    buildPersistedBackupSchedule,
    cadenceSelection,
    ctx,
    debugLogger,
    ensureBackupsExistForCadences,
    params,
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
      if (backupNowInFlightCadence) {
        return;
      }

      const candidateUrl = readDeploymentUrl(params);
      const secret = readAuthSecret(params);

      if (!candidateUrl) {
        setOverviewError('Connect a Lambda URL before running backup now.');
        return;
      }
      if (!secret) {
        setOverviewError(
          'Lambda auth secret is required before running backup now.',
        );
        return;
      }

      setBackupNowInFlightCadence(scope);
      setOverviewError('');

      try {
        const result = await triggerLambdaBackupNow({
          baseUrl: candidateUrl,
          environment: ctx.environment,
          scope,
          lambdaAuthSecret: secret,
        });
        ctx.notice(
          `${getCadenceLabel(scope)} backup created: ${result.createdEnvironmentId}.`,
        );
        await refreshLambdaBackupOverview(candidateUrl);
        await refreshAvailableEnvironments();
      } catch (error) {
        setOverviewError(
          error instanceof Error
            ? error.message
            : `Could not trigger ${getCadenceLabel(scope).toLowerCase()} backup.`,
        );
      } finally {
        setBackupNowInFlightCadence(null);
      }
    },
    [
      backupNowInFlightCadence,
      ctx,
      params,
      refreshAvailableEnvironments,
      refreshLambdaBackupOverview,
    ],
  );

  const onOpenEnvironments = useCallback(async () => {
    const environmentPrefix = ctx.isEnvironmentPrimary
      ? ''
      : `/environments/${ctx.environment}`;
    await ctx.navigateTo(`${environmentPrefix}/project_settings/environments`);
  }, [ctx]);

  const canBackupNow =
    isConnected &&
    savedSecret.trim().length > 0 &&
    !isConnecting &&
    !isMountChecking &&
    !isDisconnecting;

  const connectionErrorDetails: string[] =
    !isConnected && connection?.status === 'disconnected'
      ? getLambdaConnectionErrorDetails(connection)
      : [];

  return {
    params,
    projectTimezone,
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
    regenerateSecret,
    copySecret,
    saveAndTestConnection,
    disconnect,
    saveSchedule,
    saveDebug,
    backupNow,
    onOpenEnvironments,
    // activity
    isSavingSecret,
    isConnecting,
    isMountChecking,
    isDisconnecting,
    isSavingSchedule,
    backupNowInFlightCadence,
    progressMessage,
    connectionTestError,
    // overview
    lambdaBackupStatus,
    availableEnvironmentIds,
    overviewError,
    isLoadingOverview,
    canBackupNow,
  };
};

export type BackupsConfig = ReturnType<typeof useBackupsConfig>;

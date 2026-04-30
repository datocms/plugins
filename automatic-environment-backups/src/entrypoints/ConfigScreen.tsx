import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  Form,
  Section,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  BackupCadence,
  BackupOverviewRow,
  BackupScheduleConfig,
  ConnectionValidationMode,
  LambdaBackupStatus,
  LambdaConnectionState,
} from '../types/types';
import {
  BACKUP_CADENCES,
  BACKUP_SCHEDULE_VERSION,
  getCadenceLabel,
  normalizeBackupScheduleConfig,
  toLocalDateKey,
} from '../utils/backupSchedule';
import { buildBackupOverviewRows } from '../utils/buildBackupOverviewRows';
import { createDebugLogger, isDebugEnabled } from '../utils/debugLogger';
import {
  DEPLOY_PROVIDER_OPTIONS,
  type DeployProvider,
} from '../utils/deployProviders';
import { fetchLambdaBackupStatus } from '../utils/fetchLambdaBackupStatus';
import { getDeploymentUrlFromParameters } from '../utils/getDeploymentUrlFromParameters';
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

const DEFAULT_CONNECTION_ERROR_SUMMARY =
  'Could not validate the Automatic Backups deployment.';
const MISSING_AUTH_SECRET_MESSAGE =
  'Enter Lambda auth secret before calling lambda endpoints.';
const DEFAULT_LAMBDA_AUTH_SECRET = 'superSecretToken';
const BACKUP_NOW_AFTER_SAVE_RETRY_DELAY_MS = 1200;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function retryBackupNowAfterDelay({
  baseUrl,
  environment,
  scope,
  lambdaAuthSecret,
  cadence,
}: {
  baseUrl: string;
  environment: string;
  scope: BackupCadence;
  lambdaAuthSecret: string;
  cadence: BackupCadence;
}): Promise<{
  success: boolean;
  environmentId?: string;
  errorMessage?: string;
}> {
  try {
    await delay(BACKUP_NOW_AFTER_SAVE_RETRY_DELAY_MS);
    const retryResult = await triggerLambdaBackupNow({
      baseUrl,
      environment,
      scope,
      lambdaAuthSecret,
    });
    return { success: true, environmentId: retryResult.createdEnvironmentId };
  } catch (retryError) {
    const retryMessage = getErrorMessage(retryError);
    return {
      success: false,
      errorMessage: `${getCadenceLabel(cadence)}: ${retryMessage}`,
    };
  }
}

type PluginParameters = Record<string, unknown> | undefined;

const toConnectionValidationMode = (
  value: unknown,
): ConnectionValidationMode | undefined => {
  return value === 'health' ? value : undefined;
};

const toLambdaConnectionState = (
  value: unknown,
): LambdaConnectionState | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<LambdaConnectionState>;
  if (
    (candidate.status === 'connected' || candidate.status === 'disconnected') &&
    typeof candidate.endpoint === 'string' &&
    typeof candidate.lastCheckedAt === 'string' &&
    (candidate.lastCheckPhase === 'finish_installation' ||
      candidate.lastCheckPhase === 'config_mount' ||
      candidate.lastCheckPhase === 'config_connect')
  ) {
    return candidate as LambdaConnectionState;
  }

  return undefined;
};

const getProjectTimezone = (site: unknown): string => {
  if (
    site &&
    typeof site === 'object' &&
    'timezone' in site &&
    typeof (site as { timezone?: unknown }).timezone === 'string' &&
    (site as { timezone: string }).timezone.trim()
  ) {
    return (site as { timezone: string }).timezone.trim();
  }

  return 'UTC';
};

const getConnectionErrorSummary = (
  connection?: LambdaConnectionState,
): string => {
  if (!connection || connection.status !== 'disconnected') {
    return '';
  }

  return connection.errorMessage || DEFAULT_CONNECTION_ERROR_SUMMARY;
};

const getPluginIdFromCtx = (ctx: RenderConfigScreenCtx): string | undefined => {
  const candidate = (ctx.plugin as { id?: unknown } | undefined)?.id;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
};

const getInitialLambdaAuthSecret = (
  pluginParameters: PluginParameters,
): string => {
  const hasSecret =
    typeof pluginParameters?.lambdaAuthSecret === 'string' &&
    pluginParameters.lambdaAuthSecret.trim().length > 0;
  return hasSecret
    ? (pluginParameters?.lambdaAuthSecret as string)
    : DEFAULT_LAMBDA_AUTH_SECRET;
};

const getPingIndicator = ({
  connectionActivityMessage,
  isHealthChecking,
  isConnecting,
  connectionState,
  activeDeploymentUrl,
}: {
  connectionActivityMessage: string | null;
  isHealthChecking: boolean;
  isConnecting: boolean;
  connectionState: LambdaConnectionState | undefined;
  activeDeploymentUrl: string;
}): { label: string; color: string } => {
  if (connectionActivityMessage) {
    return { label: connectionActivityMessage, color: 'var(--warning-color)' };
  }
  if (isHealthChecking || isConnecting) {
    return { label: 'Checking ping...', color: 'var(--warning-color)' };
  }
  if (connectionState?.status === 'connected') {
    return {
      label: 'Connected (ping successful)',
      color: 'var(--notice-color)',
    };
  }
  if (connectionState?.status === 'disconnected') {
    return { label: 'Disconnected (ping failed)', color: 'var(--alert-color)' };
  }
  if (activeDeploymentUrl) {
    return { label: 'Connection pending', color: 'var(--light-body-color)' };
  }
  return {
    label: 'Disconnected (no lambda URL configured)',
    color: 'var(--light-body-color)',
  };
};

const getConnectButtonLabel = (
  isConnecting: boolean,
  hasActiveDeploymentUrl: boolean,
): string => {
  if (isConnecting) {
    return hasActiveDeploymentUrl ? 'Changing Lambda URL...' : 'Connecting...';
  }
  return hasActiveDeploymentUrl ? 'Change Lambda URL' : 'Connect';
};

const getInitialConnectionErrorSummary = (
  hasInitialConnectionErrorDetails: boolean,
  initialConnectionState: LambdaConnectionState | undefined,
): string => {
  if (!hasInitialConnectionErrorDetails) {
    return '';
  }
  return getConnectionErrorSummary(initialConnectionState);
};

const getInitialConnectionErrorDetails = (
  hasInitialConnectionErrorDetails: boolean,
  initialConnectionState: LambdaConnectionState | undefined,
): string[] => {
  if (!hasInitialConnectionErrorDetails || !initialConnectionState) {
    return [];
  }
  return getLambdaConnectionErrorDetails(initialConnectionState);
};

const didCadenceSelectionChange = (
  current: BackupCadence[],
  saved: BackupCadence[],
): boolean => {
  if (current.length !== saved.length) {
    return true;
  }
  return current.some((cadence, index) => cadence !== saved[index]);
};

const checkHasInitialConnectionErrorDetails = (
  initialDeploymentUrl: string,
  initialConnectionState: LambdaConnectionState | undefined,
): boolean => {
  if (initialDeploymentUrl.trim().length === 0) {
    return false;
  }
  if (initialConnectionState?.status !== 'disconnected') {
    return false;
  }
  return Boolean(
    initialConnectionState.errorCode ||
      initialConnectionState.errorMessage ||
      initialConnectionState.httpStatus ||
      initialConnectionState.responseSnippet,
  );
};

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const pluginParameters = ctx.plugin.attributes.parameters as PluginParameters;
  const initialDeploymentUrl = getDeploymentUrlFromParameters(pluginParameters);
  const initialLambdaAuthSecret = getInitialLambdaAuthSecret(pluginParameters);
  const initialDebugEnabled = isDebugEnabled(pluginParameters);
  const initialConnectionState = toLambdaConnectionState(
    pluginParameters?.lambdaConnection,
  );
  const initialValidationMode = toConnectionValidationMode(
    pluginParameters?.connectionValidationMode,
  );
  const projectTimezone = getProjectTimezone(ctx.site);
  const initialScheduleNormalization = normalizeBackupScheduleConfig({
    value: pluginParameters?.backupSchedule,
    timezoneFallback: projectTimezone,
  });
  const initialBackupSchedule = initialScheduleNormalization.config;

  const hasInitialConnectionErrorDetails =
    checkHasInitialConnectionErrorDetails(
      initialDeploymentUrl,
      initialConnectionState,
    );

  const [enabledCadencesSelection, setEnabledCadencesSelection] = useState<
    BackupCadence[]
  >(initialBackupSchedule.enabledCadences);
  const [debugEnabled, setDebugEnabled] = useState(initialDebugEnabled);
  const [savedFormValues, setSavedFormValues] = useState({
    debugEnabled: initialDebugEnabled,
    lambdaAuthSecret: initialLambdaAuthSecret,
    backupSchedule: initialBackupSchedule,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [deploymentUrlInput, setDeploymentUrlInput] =
    useState(initialDeploymentUrl);
  const [activeDeploymentUrl, setActiveDeploymentUrl] =
    useState(initialDeploymentUrl);
  const [lambdaAuthSecretInput, setLambdaAuthSecretInput] = useState(
    initialLambdaAuthSecret,
  );
  const [connectionState, setConnectionState] = useState<
    LambdaConnectionState | undefined
  >(initialConnectionState);
  const [connectionValidationMode, setConnectionValidationMode] = useState<
    ConnectionValidationMode | undefined
  >(initialValidationMode);
  const [connectionErrorSummary, setConnectionErrorSummary] = useState(
    getInitialConnectionErrorSummary(
      hasInitialConnectionErrorDetails,
      initialConnectionState,
    ),
  );
  const [connectionErrorDetails, setConnectionErrorDetails] = useState<
    string[]
  >(
    getInitialConnectionErrorDetails(
      hasInitialConnectionErrorDetails,
      initialConnectionState,
    ),
  );
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [lambdaBackupStatus, setLambdaBackupStatus] = useState<
    LambdaBackupStatus | undefined
  >(undefined);
  const [isLoadingBackupOverview, setIsLoadingBackupOverview] = useState(false);
  const [backupOverviewError, setBackupOverviewError] = useState('');
  const [availableEnvironmentIds, setAvailableEnvironmentIds] = useState<
    string[] | undefined
  >(undefined);
  const [backupNowInFlightCadence, setBackupNowInFlightCadence] =
    useState<BackupCadence | null>(null);
  const [connectionActivityMessage, setConnectionActivityMessage] = useState<
    string | null
  >(null);
  const debugLogger = createDebugLogger(debugEnabled, 'ConfigScreen');
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistPluginParameters = useCallback(
    async (updates: Record<string, unknown>) => {
      const persistTask = async () => {
        let latestParameters = toPluginParameterRecord(
          ctx.plugin.attributes.parameters,
        );
        const pluginId = getPluginIdFromCtx(ctx);

        if (pluginId && ctx.currentUserAccessToken) {
          try {
            const client = buildClient({
              apiToken: ctx.currentUserAccessToken,
              environment: ctx.environment,
            });
            const plugin = await client.plugins.find(pluginId);
            latestParameters = toPluginParameterRecord(plugin.parameters);
          } catch (error) {
            debugLogger.warn(
              'Falling back to local plugin parameters because authoritative read failed',
              {
                pluginId,
                error: getErrorMessage(error),
              },
            );
          }
        }

        await ctx.updatePluginParameters(
          mergePluginParameterUpdates(latestParameters, updates),
        );
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

  const clearConnectionErrorState = useCallback(() => {
    setConnectionErrorSummary('');
    setConnectionErrorDetails([]);
    setShowConnectionDetails(false);
  }, []);

  const getNormalizedLambdaAuthSecret = () => lambdaAuthSecretInput.trim();

  const applyDisconnectedState = useCallback((state: LambdaConnectionState) => {
    setConnectionState(state);
    setConnectionErrorSummary(getConnectionErrorSummary(state));
    setConnectionErrorDetails(getLambdaConnectionErrorDetails(state));
    setShowConnectionDetails(false);
  }, []);

  const refreshLambdaBackupOverview = useCallback(
    async (baseUrl?: string) => {
      const candidateUrl = (baseUrl || activeDeploymentUrl).trim();
      const normalizedLambdaAuthSecret =
        savedFormValues.lambdaAuthSecret.trim();
      const shouldFetch =
        candidateUrl.length > 0 && normalizedLambdaAuthSecret.length > 0;

      if (!shouldFetch) {
        setLambdaBackupStatus(undefined);
        setBackupOverviewError(
          candidateUrl.length === 0
            ? 'Lambda status is unavailable until the saved Lambda URL is connected with a healthy ping.'
            : 'Lambda status is unavailable until Lambda auth secret is configured and saved.',
        );
        setIsLoadingBackupOverview(false);
        return;
      }

      setIsLoadingBackupOverview(true);
      setBackupOverviewError('');

      try {
        const status = await fetchLambdaBackupStatus({
          baseUrl: candidateUrl,
          environment: ctx.environment,
          lambdaAuthSecret: normalizedLambdaAuthSecret,
        });
        setLambdaBackupStatus(status);
      } catch (error) {
        setLambdaBackupStatus(undefined);
        setBackupOverviewError(
          error instanceof Error
            ? error.message
            : 'Could not load backup overview from lambda status endpoint.',
        );
      } finally {
        setIsLoadingBackupOverview(false);
      }
    },
    [activeDeploymentUrl, ctx.environment, savedFormValues.lambdaAuthSecret],
  );

  const fetchAvailableEnvironmentIds = useCallback(async () => {
    if (!ctx.currentUserAccessToken) {
      return undefined;
    }

    try {
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken,
        environment: ctx.environment,
      });
      const environments = await client.environments.list();
      return environments
        .map((environment) => environment.id)
        .filter((id) => typeof id === 'string' && id.trim().length > 0);
    } catch {
      return undefined;
    }
  }, [ctx.currentUserAccessToken, ctx.environment]);

  const refreshAvailableEnvironments = useCallback(async () => {
    const environmentIds = await fetchAvailableEnvironmentIds();
    setAvailableEnvironmentIds(environmentIds);
  }, [fetchAvailableEnvironmentIds]);

  const triggerBackupForSingleCadence = useCallback(
    async ({
      baseUrl,
      lambdaAuthSecret,
      cadence,
      reason,
      setBackupNowInFlightCadence: setInFlight,
    }: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadence: BackupCadence;
      reason: 'connect' | 'schedule';
      setBackupNowInFlightCadence: (cadence: BackupCadence | null) => void;
    }): Promise<{
      success: boolean;
      environmentId?: string;
      errorMessage?: string;
    }> => {
      setInFlight(cadence);
      try {
        const result = await triggerLambdaBackupNow({
          baseUrl,
          environment: ctx.environment,
          scope: cadence,
          lambdaAuthSecret,
        });
        return { success: true, environmentId: result.createdEnvironmentId };
      } catch (error) {
        const isScheduleRaceCondition =
          reason === 'schedule' &&
          error instanceof LambdaBackupNowError &&
          error.code === 'HTTP' &&
          error.httpStatus === 409;

        if (isScheduleRaceCondition) {
          return retryBackupNowAfterDelay({
            baseUrl,
            environment: ctx.environment,
            scope: cadence,
            lambdaAuthSecret,
            cadence,
          });
        }

        return {
          success: false,
          errorMessage: `${getCadenceLabel(cadence)}: ${getErrorMessage(error)}`,
        };
      }
    },
    [ctx.environment],
  );

  const createMissingBackupsSequentially = useCallback(
    async ({
      baseUrl,
      lambdaAuthSecret,
      cadencesMissingEnvironment,
      reason,
    }: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadencesMissingEnvironment: BackupCadence[];
      reason: 'connect' | 'schedule';
    }): Promise<{
      createdEnvironmentIds: string[];
      failedCadences: string[];
    }> => {
      const processCadence = async (
        accumulated: {
          createdEnvironmentIds: string[];
          failedCadences: string[];
        },
        cadence: BackupCadence,
      ): Promise<{
        createdEnvironmentIds: string[];
        failedCadences: string[];
      }> => {
        if (reason === 'connect') {
          setConnectionActivityMessage(
            `Connected. Creating ${getCadenceLabel(cadence).toLowerCase()} backup...`,
          );
        }

        const outcome = await triggerBackupForSingleCadence({
          baseUrl,
          lambdaAuthSecret,
          cadence,
          reason,
          setBackupNowInFlightCadence,
        });

        if (outcome.success && outcome.environmentId) {
          accumulated.createdEnvironmentIds.push(outcome.environmentId);
        } else if (outcome.errorMessage) {
          accumulated.failedCadences.push(outcome.errorMessage);
        }

        return accumulated;
      };

      const initialAccumulator = {
        createdEnvironmentIds: [] as string[],
        failedCadences: [] as string[],
      };

      return cadencesMissingEnvironment.reduce(
        (chainedPromise, cadence) =>
          chainedPromise.then((acc) => processCadence(acc, cadence)),
        Promise.resolve(initialAccumulator),
      );
    },
    [triggerBackupForSingleCadence],
  );

  const reportBackupCreationResults = useCallback(
    ({
      createdEnvironmentIds,
      failedCadences,
      reason,
    }: {
      createdEnvironmentIds: string[];
      failedCadences: string[];
      reason: 'connect' | 'schedule';
    }) => {
      if (createdEnvironmentIds.length > 0) {
        const reasonLabel =
          reason === 'connect'
            ? 'after connecting Lambda'
            : 'for newly added schedule cadences';
        const plural = createdEnvironmentIds.length > 1 ? 's' : '';
        ctx.notice(
          `Created ${createdEnvironmentIds.length} backup environment${plural} ${reasonLabel}.`,
        );
      }

      if (failedCadences.length > 0) {
        setBackupOverviewError(
          `Some automatic backup creations failed: ${failedCadences.join(' | ')}`,
        );
      }
    },
    [ctx],
  );

  const ensureBackupsExistForCadences = useCallback(
    async ({
      baseUrl,
      lambdaAuthSecret,
      cadences,
      reason,
    }: {
      baseUrl: string;
      lambdaAuthSecret: string;
      cadences: BackupCadence[];
      reason: 'connect' | 'schedule';
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

        const cadencesMissingEnvironment = cadences.filter((cadence) => {
          const slot = status.slots[cadence];
          return !slot?.lastBackupAt;
        });

        if (cadencesMissingEnvironment.length === 0) {
          await refreshLambdaBackupOverview(baseUrl);
          await refreshAvailableEnvironments();
          return;
        }

        if (reason === 'connect') {
          setConnectionActivityMessage(
            'Connected. Creating initial backups...',
          );
        }

        const backupCreationResults = await createMissingBackupsSequentially({
          baseUrl,
          lambdaAuthSecret,
          cadencesMissingEnvironment,
          reason,
        });

        reportBackupCreationResults({ ...backupCreationResults, reason });

        await refreshLambdaBackupOverview(baseUrl);
        await refreshAvailableEnvironments();
      } catch (error) {
        setBackupOverviewError(
          error instanceof Error
            ? error.message
            : 'Could not automatically create missing backup environments.',
        );
      } finally {
        if (reason === 'connect') {
          setConnectionActivityMessage(null);
        }
        setBackupNowInFlightCadence(null);
      }
    },
    [
      ctx,
      createMissingBackupsSequentially,
      refreshAvailableEnvironments,
      refreshLambdaBackupOverview,
      reportBackupCreationResults,
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
      const normalizedLambdaAuthSecret = initialLambdaAuthSecret.trim();

      if (!normalizedLambdaAuthSecret) {
        const mountHealthEndpoint = `${configuredDeploymentUrl.replace(/\/+$/, '')}/api/datocms/plugin-health`;
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          new LambdaHealthCheckError({
            code: 'MISSING_AUTH_SECRET',
            message: MISSING_AUTH_SECRET_MESSAGE,
            phase: 'config_mount',
            endpoint: mountHealthEndpoint,
          }),
          configuredDeploymentUrl,
          'config_mount',
        );
        applyDisconnectedState(disconnectedState);
        setIsHealthChecking(false);
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
          lambdaAuthSecret: normalizedLambdaAuthSecret,
        });

        if (isCancelled()) {
          return;
        }

        const connectedState = buildConnectedLambdaConnectionState(
          verificationResult.endpoint,
          verificationResult.checkedAt,
          'config_mount',
        );

        setConnectionState(connectedState);
        setDeploymentUrlInput(verificationResult.normalizedBaseUrl);
        setActiveDeploymentUrl(verificationResult.normalizedBaseUrl);
        setConnectionValidationMode('health');
        clearConnectionErrorState();

        await persistPluginParameters({
          deploymentURL: verificationResult.normalizedBaseUrl,
          netlifyURL: verificationResult.normalizedBaseUrl,
          vercelURL: verificationResult.normalizedBaseUrl,
          lambdaConnection: connectedState,
          connectionValidationMode: 'health',
          lambdaAuthSecret: normalizedLambdaAuthSecret,
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
        applyDisconnectedState(disconnectedState);

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
          setIsHealthChecking(false);
          debugLogger.log('Mount health check finished');
        }
      }
    },
    [
      applyDisconnectedState,
      clearConnectionErrorState,
      ctx.environment,
      debugLogger,
      initialLambdaAuthSecret,
      persistPluginParameters,
    ],
  );

  const runMigrateAndCheck = useCallback(
    async (isCancelled: () => boolean) => {
      if (initialScheduleNormalization.requiresMigration) {
        try {
          await persistPluginParameters({
            backupSchedule: initialBackupSchedule,
          });
        } catch {
          // Best-effort schedule migration.
        }
      }

      const configuredDeploymentUrl = initialDeploymentUrl;
      setIsHealthChecking(true);

      if (!configuredDeploymentUrl.trim()) {
        debugLogger.log(
          'Skipping mount health check because no deployment URL is configured',
        );
        if (!isCancelled()) {
          setConnectionState(undefined);
          setConnectionValidationMode(undefined);
          clearConnectionErrorState();
          setIsHealthChecking(false);
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
    [
      clearConnectionErrorState,
      debugLogger,
      initialBackupSchedule,
      initialDeploymentUrl,
      initialScheduleNormalization.requiresMigration,
      persistPluginParameters,
      runMountHealthCheck,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    debugLogger.log('Config screen mounted', {
      initialDeploymentUrl,
      initialValidationMode,
      hasInitialConnectionState: Boolean(initialConnectionState),
      debugEnabled,
    });

    void runMigrateAndCheck(isCancelled);

    return () => {
      cancelled = true;
      debugLogger.log('Config screen unmounted');
    };
  }, [
    debugEnabled,
    debugLogger,
    initialConnectionState,
    initialDeploymentUrl,
    initialValidationMode,
    runMigrateAndCheck,
  ]);

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

  const handleConnectLambdaError = useCallback(
    async (error: unknown, candidateUrl: string) => {
      if (error instanceof LambdaHealthCheckError) {
        debugLogger.warn('Lambda health check failed during connect', error);
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          error,
          candidateUrl,
          'config_connect',
        );
        applyDisconnectedState(disconnectedState);

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            connectionValidationMode: null,
          });
        } catch {
          // Ignore persistence errors while showing errors in UI.
        }
      } else {
        debugLogger.error('Unexpected error while connecting lambda', error);
        setConnectionErrorSummary('Unexpected error while connecting lambda.');
        setConnectionErrorDetails([
          'Unexpected error while connecting lambda.',
          `Failure details: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ]);
        setShowConnectionDetails(false);
      }
    },
    [applyDisconnectedState, debugLogger, persistPluginParameters],
  );

  const connectLambdaHandler = async () => {
    const candidateUrl = deploymentUrlInput.trim();
    if (!candidateUrl) {
      setConnectionErrorSummary('Enter your lambda deployment URL.');
      setConnectionErrorDetails([]);
      setShowConnectionDetails(false);
      return;
    }

    const normalizedLambdaAuthSecret = getNormalizedLambdaAuthSecret();
    if (!normalizedLambdaAuthSecret) {
      setConnectionErrorSummary(MISSING_AUTH_SECRET_MESSAGE);
      setConnectionErrorDetails([
        MISSING_AUTH_SECRET_MESSAGE,
        'Set the same value as DATOCMS_BACKUPS_SHARED_SECRET configured in the lambda deployment.',
      ]);
      setShowConnectionDetails(false);
      return;
    }

    debugLogger.log('Connecting lambda deployment', { candidateUrl });
    setConnectionActivityMessage(null);
    setIsConnecting(true);
    clearConnectionErrorState();

    try {
      const verificationResult = await verifyLambdaHealth({
        baseUrl: candidateUrl,
        environment: ctx.environment,
        phase: 'config_connect',
        lambdaAuthSecret: normalizedLambdaAuthSecret,
      });

      const connectedState = buildConnectedLambdaConnectionState(
        verificationResult.endpoint,
        verificationResult.checkedAt,
        'config_connect',
      );

      setConnectionState(connectedState);
      setDeploymentUrlInput(verificationResult.normalizedBaseUrl);
      setActiveDeploymentUrl(verificationResult.normalizedBaseUrl);
      setConnectionValidationMode('health');
      clearConnectionErrorState();

      await persistPluginParameters({
        deploymentURL: verificationResult.normalizedBaseUrl,
        netlifyURL: verificationResult.normalizedBaseUrl,
        vercelURL: verificationResult.normalizedBaseUrl,
        lambdaConnection: connectedState,
        connectionValidationMode: 'health',
        lambdaAuthSecret: normalizedLambdaAuthSecret,
      });

      debugLogger.log('Lambda connected successfully', {
        endpoint: verificationResult.endpoint,
        normalizedBaseUrl: verificationResult.normalizedBaseUrl,
        mode: 'health',
      });
      ctx.notice('Lambda function connected successfully.');
      await ensureBackupsExistForCadences({
        baseUrl: verificationResult.normalizedBaseUrl,
        lambdaAuthSecret: normalizedLambdaAuthSecret,
        cadences: savedFormValues.backupSchedule.enabledCadences,
        reason: 'connect',
      });
    } catch (error) {
      await handleConnectLambdaError(error, candidateUrl);
    } finally {
      setConnectionActivityMessage(null);
      setIsConnecting(false);
    }
  };

  const disconnectCurrentLambdaHandler = async () => {
    debugLogger.log('Disconnecting lambda deployment', {
      activeDeploymentUrl,
    });
    setIsDisconnecting(true);
    clearConnectionErrorState();

    try {
      await persistPluginParameters({
        deploymentURL: '',
        netlifyURL: '',
        vercelURL: '',
        lambdaConnection: null,
        connectionValidationMode: null,
      });

      setDeploymentUrlInput('');
      setActiveDeploymentUrl('');
      setConnectionState(undefined);
      setConnectionValidationMode(undefined);
      setLambdaBackupStatus(undefined);
      setConnectionActivityMessage(null);
      setBackupOverviewError(
        'Lambda status is unavailable until the saved Lambda URL is connected with a healthy ping.',
      );
      debugLogger.log('Lambda disconnected');
      ctx.notice('Current lambda function has been disconnected.');
    } catch (error) {
      debugLogger.error('Could not disconnect current lambda', error);
      setConnectionErrorSummary('Could not disconnect the current lambda.');
      setConnectionErrorDetails([
        'Could not disconnect the current lambda function.',
      ]);
      setShowConnectionDetails(false);
      await ctx.alert('Could not disconnect the current lambda function.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const buildPersistedBackupSchedule = useCallback(
    (normalizedEnabledCadences: BackupCadence[]): BackupScheduleConfig => {
      const savedCadences = savedFormValues.backupSchedule.enabledCadences;
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
          : savedFormValues.backupSchedule.anchorLocalDate,
        updatedAt: new Date().toISOString(),
      };
    },
    [projectTimezone, savedFormValues.backupSchedule],
  );

  const saveSettingsHandler = async () => {
    const normalizedEnabledCadences = BACKUP_CADENCES.filter((cadence) =>
      enabledCadencesSelection.includes(cadence),
    );
    const normalizedLambdaAuthSecret = getNormalizedLambdaAuthSecret();

    if (normalizedEnabledCadences.length === 0) {
      await ctx.alert('Select at least one backup cadence.');
      return;
    }

    debugLogger.log('Saving plugin settings', {
      debugEnabled,
      activeDeploymentUrl,
      connectionStatus: connectionState?.status,
      connectionValidationMode,
      enabledCadences: normalizedEnabledCadences,
      timezone: projectTimezone,
    });

    const hasConnectedLambdaForSave =
      activeDeploymentUrl.trim().length > 0 &&
      normalizedLambdaAuthSecret.length > 0 &&
      connectionState?.status === 'connected' &&
      connectionValidationMode === 'health' &&
      !isHealthChecking &&
      !isConnecting;

    if (!hasConnectedLambdaForSave) {
      await ctx.alert(
        'Cannot save unless Lambda URL and Lambda auth secret are configured and ping status is Connected.',
      );
      return;
    }

    setIsLoading(true);

    try {
      const persistedDeploymentUrl = activeDeploymentUrl.trim();
      const persistedConnectionState = connectionState ?? null;
      const persistedValidationMode: ConnectionValidationMode | null =
        connectionValidationMode ?? null;
      const persistedBackupSchedule = buildPersistedBackupSchedule(
        normalizedEnabledCadences,
      );

      await persistPluginParameters({
        debug: debugEnabled,
        lambdaAuthSecret: normalizedLambdaAuthSecret,
        deploymentURL: persistedDeploymentUrl,
        netlifyURL: persistedDeploymentUrl,
        vercelURL: persistedDeploymentUrl,
        lambdaConnection: persistedConnectionState,
        connectionValidationMode: persistedValidationMode,
        backupSchedule: persistedBackupSchedule,
      });

      setSavedFormValues({
        debugEnabled,
        lambdaAuthSecret: normalizedLambdaAuthSecret,
        backupSchedule: persistedBackupSchedule,
      });

      if (normalizedEnabledCadences.length > 0) {
        await ensureBackupsExistForCadences({
          baseUrl: persistedDeploymentUrl,
          lambdaAuthSecret: normalizedLambdaAuthSecret,
          cadences: normalizedEnabledCadences,
          reason: 'schedule',
        });
      }

      ctx.notice(
        `Settings saved. Runtime mode: Lambda (cron). Debug logging is ${
          debugEnabled ? 'enabled' : 'disabled'
        }.`,
      );
    } catch (error) {
      debugLogger.error('Could not save plugin settings', error);
      await ctx.alert('Could not save plugin settings.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeployProviderClick = (provider: DeployProvider) => {
    const option = DEPLOY_PROVIDER_OPTIONS.find(
      (candidate) => candidate.provider === provider,
    );
    if (!option) {
      return;
    }

    debugLogger.log('Opening deploy provider', { provider, url: option.url });
    window.open(option.url, '_blank', 'noreferrer');
  };

  const setCadenceEnabled = (cadence: BackupCadence, enabled: boolean) => {
    setEnabledCadencesSelection((current) => {
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
  };

  const openEnvironmentsSettings = async (
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    event.preventDefault();
    const environmentPrefix = ctx.isEnvironmentPrimary
      ? ''
      : `/environments/${ctx.environment}`;
    await ctx.navigateTo(`${environmentPrefix}/project_settings/environments`);
  };

  const triggerBackupNowForCadence = async (scope: BackupCadence) => {
    if (backupNowInFlightCadence) {
      return;
    }

    const candidateUrl = activeDeploymentUrl.trim();
    const normalizedLambdaAuthSecret = savedFormValues.lambdaAuthSecret.trim();

    if (!candidateUrl) {
      setBackupOverviewError('Connect a Lambda URL before running backup now.');
      return;
    }

    if (!normalizedLambdaAuthSecret) {
      setBackupOverviewError(
        'Lambda auth secret is required before running backup now.',
      );
      return;
    }

    setBackupNowInFlightCadence(scope);
    setBackupOverviewError('');

    try {
      const result = await triggerLambdaBackupNow({
        baseUrl: candidateUrl,
        environment: ctx.environment,
        scope,
        lambdaAuthSecret: normalizedLambdaAuthSecret,
      });

      ctx.notice(
        `${getCadenceLabel(scope)} backup created: ${result.createdEnvironmentId}.`,
      );
      await refreshLambdaBackupOverview(candidateUrl);
      await refreshAvailableEnvironments();
    } catch (error) {
      setBackupOverviewError(
        error instanceof Error
          ? error.message
          : `Could not trigger ${getCadenceLabel(scope).toLowerCase()} backup.`,
      );
    } finally {
      setBackupNowInFlightCadence(null);
    }
  };

  const hasActiveDeploymentUrl = activeDeploymentUrl.trim().length > 0;

  const pingIndicator = getPingIndicator({
    connectionActivityMessage,
    isHealthChecking,
    isConnecting,
    connectionState,
    activeDeploymentUrl,
  });

  const connectButtonLabel = getConnectButtonLabel(
    isConnecting,
    hasActiveDeploymentUrl,
  );
  const disconnectButtonLabel = isDisconnecting
    ? 'Disconnecting...'
    : 'Disconnect';

  const lambdaActionButtonStyle: CSSProperties = {
    width: '100%',
    height: '40px',
    fontSize: 'var(--font-size-m)',
    fontWeight: 500,
    lineHeight: '1',
    padding: '0 var(--spacing-m)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    flex: '1 1 0',
    whiteSpace: 'nowrap',
  };

  const cardStyle = {
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    background: '#fff',
    padding: 'var(--spacing-l)',
    marginBottom: 'var(--spacing-l)',
    textAlign: 'left' as const,
  };

  const subtleTextStyle = {
    margin: 0,
    color: 'var(--light-body-color)',
    fontSize: 'var(--font-size-xs)',
  };

  const infoTextStyle = {
    marginTop: 0,
    marginBottom: 'var(--spacing-s)',
    color: 'var(--base-body-color)',
    fontSize: 'var(--font-size-s)',
  };

  const backupScheduleCardStyle: CSSProperties = {
    ...cardStyle,
    paddingTop: 'var(--spacing-m)',
    paddingBottom: 'var(--spacing-m)',
  };

  const backupScheduleTitleStyle: CSSProperties = {
    marginTop: 0,
    marginBottom: 'var(--spacing-m)',
    fontSize: 'var(--font-size-l)',
  };

  const backupScheduleInfoTextStyle: CSSProperties = {
    marginTop: 0,
    marginBottom: 'var(--spacing-m)',
    color: 'var(--base-body-color)',
    fontSize: '12px',
    lineHeight: '1.35',
  };

  const backupScheduleCadenceGridStyle: CSSProperties = {
    display: 'grid',
    gap: 'var(--spacing-s)',
  };

  const advancedSettingsStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-m)',
  };

  const overviewGridStyle: CSSProperties = {
    display: 'grid',
    gap: 'var(--spacing-s)',
  };

  const overviewRowStyle: CSSProperties = {
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    padding: 'var(--spacing-m)',
    background: '#fff',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    columnGap: 'var(--spacing-m)',
    alignItems: 'center',
  };

  const overviewRowHeaderStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-s)',
    marginBottom: 'var(--spacing-xs)',
  };

  const overviewRowContentStyle: CSSProperties = {
    minWidth: 0,
  };

  const overviewRowLabelStyle: CSSProperties = {
    marginTop: 0,
    marginBottom: 0,
    fontSize: 'var(--font-size-m)',
  };

  const overviewRowInfoStyle: CSSProperties = {
    margin: 0,
    fontSize: 'var(--font-size-s)',
  };

  const overviewRowActionStyle: CSSProperties = {
    alignSelf: 'center',
    minWidth: '140px',
  };

  const switchFieldNoHintGapStyle = {
    '--spacing-s': '0',
  } as CSSProperties;

  const switchFieldNoHintGapStyleWithExtraSpacing = {
    ...switchFieldNoHintGapStyle,
    marginBottom: '0.25rem',
  } as CSSProperties;

  const normalizedCadenceSelection = BACKUP_CADENCES.filter((cadence) =>
    enabledCadencesSelection.includes(cadence),
  );
  const hasCadenceSelectionChanged = didCadenceSelectionChange(
    normalizedCadenceSelection,
    savedFormValues.backupSchedule.enabledCadences,
  );
  const hasLambdaAuthSecret = lambdaAuthSecretInput.trim().length > 0;
  const hasSavedLambdaAuthSecret =
    savedFormValues.lambdaAuthSecret.trim().length > 0;
  const hasLambdaAuthSecretChanged =
    lambdaAuthSecretInput.trim() !== savedFormValues.lambdaAuthSecret.trim();
  const hasUnsavedChanges =
    debugEnabled !== savedFormValues.debugEnabled ||
    hasLambdaAuthSecretChanged ||
    hasCadenceSelectionChanged;

  const canSaveWithLambdaMode =
    hasActiveDeploymentUrl &&
    hasLambdaAuthSecret &&
    connectionState?.status === 'connected' &&
    connectionValidationMode === 'health' &&
    !isHealthChecking &&
    !isConnecting;

  const canTriggerBackupNow =
    hasActiveDeploymentUrl &&
    hasSavedLambdaAuthSecret &&
    connectionState?.status === 'connected' &&
    connectionValidationMode === 'health' &&
    !isHealthChecking &&
    !isConnecting &&
    !isDisconnecting;

  const savedBackupSchedule = savedFormValues.backupSchedule;
  const backupOverviewRows: BackupOverviewRow[] = buildBackupOverviewRows({
    scheduleConfig: savedBackupSchedule,
    lambdaStatus: lambdaBackupStatus,
    availableEnvironmentIds,
  });

  return (
    <Canvas ctx={ctx}>
      <div
        style={{
          maxWidth: '760px',
          margin: '0 auto',
        }}
      >
        <div style={cardStyle}>
          <h2
            style={{
              marginTop: 0,
              marginBottom: 'var(--spacing-s)',
              fontSize: 'var(--font-size-l)',
            }}
          >
            Lambda setup
          </h2>

          <p style={infoTextStyle}>
            <strong>Current URL:</strong>{' '}
            <span style={{ wordBreak: 'break-all' }}>
              {activeDeploymentUrl || 'No lambda function connected.'}
            </span>
          </p>

          <p
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'center',
              gap: 'var(--spacing-s)',
              marginTop: 0,
              marginBottom: 'var(--spacing-s)',
              fontSize: 'var(--font-size-s)',
              color: 'var(--light-body-color)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '999px',
                background: pingIndicator.color,
              }}
            />
            <span>{pingIndicator.label}</span>
          </p>

          <p style={{ ...subtleTextStyle, marginBottom: 'var(--spacing-l)' }}>
            Status is based on the `/api/datocms/plugin-health` ping.
          </p>

          <TextField
            name="deploymentURL"
            id="deploymentURL"
            label="Lambda URL"
            value={deploymentUrlInput}
            placeholder="https://backups.example.com/"
            onChange={(newValue) => {
              setDeploymentUrlInput(newValue);
              clearConnectionErrorState();
            }}
          />

          <div style={{ marginTop: 'var(--spacing-s)' }}>
            <TextField
              name="lambdaAuthSecret"
              id="lambdaAuthSecret"
              label="Lambda auth secret"
              value={lambdaAuthSecretInput}
              placeholder={`Shared secret configured in lambda env (default: ${DEFAULT_LAMBDA_AUTH_SECRET})`}
              onChange={(newValue) => {
                setLambdaAuthSecretInput(newValue);
                clearConnectionErrorState();
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'nowrap',
              width: '100%',
              gap: 'var(--spacing-s)',
              marginTop: 'var(--spacing-l)',
            }}
          >
            <div style={{ flex: '1 1 0' }}>
              <Dropdown
                renderTrigger={({ onClick }) => (
                  <Button
                    buttonType="muted"
                    onClick={onClick}
                    disabled={
                      isConnecting || isHealthChecking || isDisconnecting
                    }
                    style={lambdaActionButtonStyle}
                  >
                    Deploy lambda
                  </Button>
                )}
              >
                <DropdownMenu alignment="left">
                  {DEPLOY_PROVIDER_OPTIONS.map((option) => (
                    <DropdownOption
                      key={option.provider}
                      onClick={() => handleDeployProviderClick(option.provider)}
                    >
                      {option.label}
                    </DropdownOption>
                  ))}
                </DropdownMenu>
              </Dropdown>
            </div>

            <Button
              onClick={disconnectCurrentLambdaHandler}
              buttonType="negative"
              disabled={
                isDisconnecting ||
                isHealthChecking ||
                !activeDeploymentUrl.trim()
              }
              style={lambdaActionButtonStyle}
            >
              {disconnectButtonLabel}
            </Button>

            <Button
              buttonType="primary"
              onClick={connectLambdaHandler}
              disabled={isConnecting || isHealthChecking || isDisconnecting}
              style={lambdaActionButtonStyle}
            >
              {connectButtonLabel}
            </Button>
          </div>
        </div>

        {connectionErrorSummary && (
          <div
            style={{
              border: '1px solid rgba(var(--alert-color-rgb-components), 0.5)',
              borderRadius: '6px',
              background: 'rgba(var(--alert-color-rgb-components), 0.08)',
              padding: 'var(--spacing-m)',
              marginBottom: 'var(--spacing-m)',
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 'var(--spacing-s)' }}>
              {connectionErrorSummary}
            </p>
            {connectionErrorDetails.length > 0 && (
              <Button
                buttonType="muted"
                buttonSize="s"
                onClick={() => setShowConnectionDetails((current) => !current)}
              >
                {showConnectionDetails ? 'Hide details' : 'Show details'}
              </Button>
            )}
          </div>
        )}

        {showConnectionDetails && connectionErrorDetails.length > 0 && (
          <div
            style={{
              border: '1px solid rgba(var(--alert-color-rgb-components), 0.5)',
              borderRadius: '6px',
              background: '#fff',
              padding: 'var(--spacing-m)',
              marginBottom: 'var(--spacing-l)',
              textAlign: 'left',
            }}
          >
            {connectionErrorDetails.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        )}

        <div style={backupScheduleCardStyle}>
          <h2 style={backupScheduleTitleStyle}>Backup schedule</h2>

          <p style={backupScheduleInfoTextStyle}>
            The scheduler runs once a day. The number of backups depends on your
            selected schedule options.
          </p>

          <div style={backupScheduleCadenceGridStyle}>
            {BACKUP_CADENCES.map((cadence) => (
              <div
                key={`cadence-toggle-${cadence}`}
                style={switchFieldNoHintGapStyle}
              >
                <SwitchField
                  name={`cadence_${cadence}`}
                  id={`cadence_${cadence}`}
                  label={getCadenceLabel(cadence)}
                  value={enabledCadencesSelection.includes(cadence)}
                  onChange={(newValue) => setCadenceEnabled(cadence, newValue)}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <h2
            style={{
              marginTop: 0,
              marginBottom: 'var(--spacing-s)',
              fontSize: 'var(--font-size-l)',
            }}
          >
            Backup overview
          </h2>

          {isLoadingBackupOverview && (
            <p style={{ ...subtleTextStyle, marginBottom: 'var(--spacing-s)' }}>
              Refreshing Lambda backup status...
            </p>
          )}

          {backupOverviewError && (
            <p
              style={{
                ...subtleTextStyle,
                marginBottom: 'var(--spacing-s)',
                color: 'var(--alert-color)',
              }}
            >
              {backupOverviewError}
            </p>
          )}

          <div style={overviewGridStyle}>
            {backupOverviewRows.map((row) => {
              const isBackupNowLoading = backupNowInFlightCadence === row.scope;
              const isBackupNowDisabled =
                !canTriggerBackupNow || backupNowInFlightCadence !== null;

              return (
                <div
                  key={`backup-overview-${row.scope}`}
                  style={overviewRowStyle}
                >
                  <div style={overviewRowContentStyle}>
                    <div style={overviewRowHeaderStyle}>
                      <h3 style={overviewRowLabelStyle}>
                        {getCadenceLabel(row.scope)}
                      </h3>
                    </div>
                    <p style={overviewRowInfoStyle}>
                      <strong>Last backup:</strong> {row.lastBackup}
                    </p>
                    <p style={overviewRowInfoStyle}>
                      <strong>Next backup:</strong> {row.nextBackup}
                    </p>
                    <p style={overviewRowInfoStyle}>
                      <strong>Environment:</strong>{' '}
                      {row.environmentLinked ? (
                        <a
                          href="/project_settings/environments"
                          onClick={openEnvironmentsSettings}
                        >
                          {row.environmentName}
                        </a>
                      ) : (
                        row.environmentName
                      )}
                    </p>
                    {row.environmentStatusNote && (
                      <p style={overviewRowInfoStyle}>
                        <strong>Status:</strong> {row.environmentStatusNote}
                      </p>
                    )}
                  </div>
                  <div style={overviewRowActionStyle}>
                    <Button
                      buttonType="muted"
                      buttonSize="s"
                      fullWidth
                      onClick={() => {
                        void triggerBackupNowForCadence(row.scope);
                      }}
                      disabled={isBackupNowDisabled}
                    >
                      {isBackupNowLoading ? 'Backing up...' : 'Backup now'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Form>
          <Section
            title="Advanced settings"
            collapsible={{
              isOpen: showAdvancedSettings,
              onToggle: () => setShowAdvancedSettings((current) => !current),
            }}
          >
            <div style={advancedSettingsStyle}>
              <div style={switchFieldNoHintGapStyleWithExtraSpacing}>
                <SwitchField
                  name="debug"
                  id="debug"
                  label="Enable debug logs"
                  hint="When enabled, plugin events and requests are logged to the browser console."
                  value={debugEnabled}
                  onChange={(newValue) => setDebugEnabled(newValue)}
                />
              </div>

              <p style={subtleTextStyle}>
                This plugin runs in Lambda cron mode only.
              </p>
            </div>
          </Section>

          <Button
            onClick={saveSettingsHandler}
            fullWidth
            buttonType={isLoading ? 'muted' : 'primary'}
            disabled={
              isLoading ||
              isDisconnecting ||
              isConnecting ||
              !canSaveWithLambdaMode ||
              !hasUnsavedChanges
            }
          >
            Save
          </Button>
        </Form>
      </div>
    </Canvas>
  );
}

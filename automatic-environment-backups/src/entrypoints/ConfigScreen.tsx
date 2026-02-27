import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
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
} from "datocms-react-ui";
import { CSSProperties, MouseEvent, useCallback, useEffect, useState } from "react";
import {
  AutomaticBackupsScheduleState,
  BackupCadence,
  BackupScheduleConfig,
  BackupOverviewRow,
  ConnectionValidationMode,
  LambdaBackupStatus,
  LambdaConnectionState,
  RuntimeMode,
} from "../types/types";
import {
  attemptLegacyInitialization,
  LegacyInitializationError,
} from "../utils/attemptLegacyInitialization";
import {
  DEPLOY_PROVIDER_OPTIONS,
  DeployProvider,
  PLUGIN_README_URL,
} from "../utils/deployProviders";
import { createDebugLogger, isDebugEnabled } from "../utils/debugLogger";
import { getDeploymentUrlFromParameters } from "../utils/getDeploymentUrlFromParameters";
import { getRuntimeMode } from "../utils/getRuntimeMode";
import {
  buildConnectedLambdaConnectionState,
  buildDisconnectedLambdaConnectionState,
  getLambdaConnectionErrorDetails,
  LambdaHealthCheckError,
  shouldUseLegacyInitializationFallback,
  verifyLambdaHealth,
} from "../utils/verifyLambdaHealth";
import {
  disconnectLambdaScheduler,
  DisconnectLambdaSchedulerError,
  getDisconnectLambdaSchedulerErrorDetails,
} from "../utils/disconnectLambdaScheduler";
import {
  getTriggerBackupNowErrorDetails,
  triggerBackupNow,
  TriggerBackupNowError,
} from "../utils/triggerBackupNow";
import {
  BACKUP_CADENCES,
  getCadenceLabel,
  normalizeBackupScheduleConfig,
  parseTimeToMinuteOfDay,
  toLocalDateKey,
} from "../utils/backupSchedule";
import { buildBackupOverviewRows } from "../utils/buildBackupOverviewRows";
import { fetchLambdaBackupStatus } from "../utils/fetchLambdaBackupStatus";

const DEFAULT_CONNECTION_ERROR_SUMMARY =
  "Could not validate the Automatic Backups deployment.";
const LEGACY_WARNING_MESSAGE =
  "This deployment does not expose /api/datocms/plugin-health yet. It was connected using the legacy initialization fallback. Update and redeploy the lambda function.";
const LEGACY_CONNECTED_NOTICE =
  "Connected using legacy initialization fallback. Update the lambda function to support /api/datocms/plugin-health.";
const SCHEDULER_DISABLE_WARNING_MESSAGE =
  "Could not disable the remote scheduler. This lambda deployment may still run cron backups. To avoid duplicate backups, manually disable or delete the lambda cron deployment.";

type PluginParameters = Record<string, unknown> | undefined;

const toConnectionValidationMode = (
  value: unknown,
): ConnectionValidationMode | undefined => {
  return value === "health" || value === "legacy" ? value : undefined;
};

const toLambdaConnectionState = (
  value: unknown,
): LambdaConnectionState | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<LambdaConnectionState>;
  if (
    (candidate.status === "connected" || candidate.status === "disconnected") &&
    typeof candidate.endpoint === "string" &&
    typeof candidate.lastCheckedAt === "string" &&
    (candidate.lastCheckPhase === "finish_installation" ||
      candidate.lastCheckPhase === "config_mount" ||
      candidate.lastCheckPhase === "config_connect")
  ) {
    return candidate as LambdaConnectionState;
  }

  return undefined;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const getProjectTimezone = (site: unknown): string => {
  if (
    site &&
    typeof site === "object" &&
    "timezone" in site &&
    typeof (site as { timezone?: unknown }).timezone === "string" &&
    (site as { timezone: string }).timezone.trim()
  ) {
    return (site as { timezone: string }).timezone.trim();
  }

  return "UTC";
};

const toCadenceMap = (
  value: unknown,
): Partial<Record<BackupCadence, string>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const next: Partial<Record<BackupCadence, string>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!BACKUP_CADENCES.includes(key as BackupCadence)) {
      continue;
    }
    const normalized = asOptionalString(entry);
    if (normalized) {
      next[key as BackupCadence] = normalized;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const toAutomaticBackupsScheduleState = (
  value: unknown,
): AutomaticBackupsScheduleState => {
  if (!isObject(value)) {
    return {};
  }

  return {
    ...value,
    lastRunLocalDateByCadence: toCadenceMap(value.lastRunLocalDateByCadence),
    lastRunAtByCadence: toCadenceMap(value.lastRunAtByCadence),
    lastManagedEnvironmentIdByCadence: toCadenceMap(
      value.lastManagedEnvironmentIdByCadence,
    ),
    lastExecutionModeByCadence: toCadenceMap(
      value.lastExecutionModeByCadence,
    ) as AutomaticBackupsScheduleState["lastExecutionModeByCadence"],
    lastErrorByCadence: toCadenceMap(value.lastErrorByCadence),
    dailyLastRunDate: asOptionalString(value.dailyLastRunDate),
    weeklyLastRunKey: asOptionalString(value.weeklyLastRunKey),
    lastDailyRunAt: asOptionalString(value.lastDailyRunAt),
    lastWeeklyRunAt: asOptionalString(value.lastWeeklyRunAt),
    lastDailyManagedEnvironmentId: asOptionalString(value.lastDailyManagedEnvironmentId),
    lastWeeklyManagedEnvironmentId: asOptionalString(value.lastWeeklyManagedEnvironmentId),
    lastDailyExecutionMode:
      value.lastDailyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastWeeklyExecutionMode:
      value.lastWeeklyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastDailyError: asOptionalString(value.lastDailyError),
    lastWeeklyError: asOptionalString(value.lastWeeklyError),
    executionLockRunId: asOptionalString(value.executionLockRunId),
    executionLockOwnerUserId: asOptionalString(value.executionLockOwnerUserId),
    executionLockAcquiredAt: asOptionalString(value.executionLockAcquiredAt),
    executionLockExpiresAt: asOptionalString(value.executionLockExpiresAt),
  };
};

const getConnectionErrorSummary = (
  connection?: LambdaConnectionState,
): string => {
  if (!connection || connection.status !== "disconnected") {
    return "";
  }

  return connection.errorMessage || DEFAULT_CONNECTION_ERROR_SUMMARY;
};

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const pluginParameters = ctx.plugin.attributes.parameters as PluginParameters;
  const legacyInstallationState =
    typeof pluginParameters?.installationState === "string"
      ? pluginParameters.installationState
      : undefined;
  const legacyHasBeenPrompted =
    typeof pluginParameters?.hasBeenPrompted === "boolean"
      ? pluginParameters.hasBeenPrompted
      : undefined;
  const initialDeploymentUrl = getDeploymentUrlFromParameters(pluginParameters);
  const initialLegacyNetlifyUrl =
    typeof pluginParameters?.netlifyURL === "string"
      ? pluginParameters.netlifyURL
      : "";
  const fallbackInitialDeploymentUrl =
    initialDeploymentUrl.trim() || initialLegacyNetlifyUrl.trim();
  const initialDebugEnabled = isDebugEnabled(pluginParameters);
  const initialConnectionState = toLambdaConnectionState(
    pluginParameters?.lambdaConnection,
  );
  const initialValidationMode = toConnectionValidationMode(
    pluginParameters?.connectionValidationMode,
  );
  const initialRuntimeMode = getRuntimeMode(pluginParameters);
  const projectTimezone = getProjectTimezone(ctx.site);
  const initialScheduleNormalization = normalizeBackupScheduleConfig({
    value: pluginParameters?.backupSchedule,
    timezoneFallback: projectTimezone,
  });
  const initialBackupSchedule = initialScheduleNormalization.config;
  const initialAutomaticBackupsScheduleState = toAutomaticBackupsScheduleState(
    pluginParameters?.automaticBackupsSchedule,
  );

  const hasInitialConnectionErrorDetails =
    fallbackInitialDeploymentUrl.trim().length > 0 &&
    initialConnectionState?.status === "disconnected" &&
    Boolean(
      initialConnectionState.errorCode ||
        initialConnectionState.errorMessage ||
        initialConnectionState.httpStatus ||
        initialConnectionState.responseSnippet,
    );

  const [runtimeModeSelection, setRuntimeModeSelection] = useState<RuntimeMode>(
    initialRuntimeMode,
  );
  const [enabledCadencesSelection, setEnabledCadencesSelection] = useState<
    BackupCadence[]
  >(initialBackupSchedule.enabledCadences);
  const [lambdalessTimeSelection, setLambdalessTimeSelection] = useState(
    initialBackupSchedule.lambdalessTime,
  );
  const [debugEnabled, setDebugEnabled] = useState(initialDebugEnabled);
  const [savedFormValues, setSavedFormValues] = useState({
    runtimeMode: initialRuntimeMode,
    debugEnabled: initialDebugEnabled,
    backupSchedule: initialBackupSchedule,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState(false);

  const [deploymentUrlInput, setDeploymentUrlInput] = useState(
    fallbackInitialDeploymentUrl,
  );
  const [activeDeploymentUrl, setActiveDeploymentUrl] = useState(
    fallbackInitialDeploymentUrl,
  );
  const [connectionState, setConnectionState] = useState<
    LambdaConnectionState | undefined
  >(initialConnectionState);
  const [connectionValidationMode, setConnectionValidationMode] = useState<
    ConnectionValidationMode | undefined
  >(initialValidationMode);
  const [connectionErrorSummary, setConnectionErrorSummary] = useState(
    hasInitialConnectionErrorDetails
      ? getConnectionErrorSummary(initialConnectionState)
      : "",
  );
  const [connectionErrorDetails, setConnectionErrorDetails] = useState<string[]>(
    hasInitialConnectionErrorDetails
      ? getLambdaConnectionErrorDetails(initialConnectionState as LambdaConnectionState)
      : [],
  );
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [legacyUpgradeWarning, setLegacyUpgradeWarning] = useState(
    initialValidationMode === "legacy" ? LEGACY_WARNING_MESSAGE : "",
  );
  const [backupNowErrorSummary, setBackupNowErrorSummary] = useState("");
  const [backupNowErrorDetails, setBackupNowErrorDetails] = useState<string[]>(
    [],
  );
  const [showBackupNowDetails, setShowBackupNowDetails] = useState(false);
  const [schedulerDisableWarning, setSchedulerDisableWarning] = useState("");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [lambdaBackupStatus, setLambdaBackupStatus] = useState<
    LambdaBackupStatus | undefined
  >(undefined);
  const [isLoadingBackupOverview, setIsLoadingBackupOverview] = useState(false);
  const [backupOverviewError, setBackupOverviewError] = useState("");
  const debugLogger = createDebugLogger(debugEnabled, "ConfigScreen");

  const persistPluginParameters = async (updates: Record<string, unknown>) => {
    await ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      ...updates,
    });
  };

  const clearConnectionErrorState = () => {
    setConnectionErrorSummary("");
    setConnectionErrorDetails([]);
    setShowConnectionDetails(false);
  };

  const clearBackupNowErrorState = () => {
    setBackupNowErrorSummary("");
    setBackupNowErrorDetails([]);
    setShowBackupNowDetails(false);
  };

  const clearSchedulerDisableWarning = () => {
    setSchedulerDisableWarning("");
  };

  const applyDisconnectedState = (state: LambdaConnectionState) => {
    setConnectionState(state);
    setConnectionErrorSummary(getConnectionErrorSummary(state));
    setConnectionErrorDetails(getLambdaConnectionErrorDetails(state));
    setShowConnectionDetails(false);
  };

  const disableRemoteSchedulerIfNeeded = async (
    candidateBaseUrl: string,
  ): Promise<boolean> => {
    if (!candidateBaseUrl.trim()) {
      return true;
    }

    try {
      const result = await disconnectLambdaScheduler({
        baseUrl: candidateBaseUrl,
        environment: ctx.environment,
      });
      debugLogger.log("Remote scheduler disabled", {
        endpoint: result.endpoint,
        attemptName: result.attemptName,
      });
      clearSchedulerDisableWarning();
      return true;
    } catch (error) {
      if (error instanceof DisconnectLambdaSchedulerError) {
        debugLogger.warn(
          "Could not disable remote scheduler before local disconnect",
          {
            normalizedBaseUrl: error.normalizedBaseUrl,
            failures: error.failures,
          },
        );
        debugLogger.warn(
          "Remote scheduler disable failure details",
          getDisconnectLambdaSchedulerErrorDetails(error),
        );
      } else {
        debugLogger.error("Unexpected error while disabling remote scheduler", error);
      }

      setSchedulerDisableWarning(SCHEDULER_DISABLE_WARNING_MESSAGE);
      return false;
    }
  };

  const refreshLambdaBackupOverview = useCallback(
    async (baseUrl?: string) => {
      const candidateUrl = (baseUrl || activeDeploymentUrl).trim();
      const shouldFetch =
        savedFormValues.runtimeMode === "lambda" && candidateUrl.length > 0;

      if (!shouldFetch) {
        setLambdaBackupStatus(undefined);
        if (savedFormValues.runtimeMode === "lambda") {
          setBackupOverviewError(
            "Lambda status is unavailable until the saved Lambda URL is connected with a healthy ping.",
          );
        } else {
          setBackupOverviewError("");
        }
        setIsLoadingBackupOverview(false);
        return;
      }

      setIsLoadingBackupOverview(true);
      setBackupOverviewError("");

      try {
        const status = await fetchLambdaBackupStatus({
          baseUrl: candidateUrl,
          environment: ctx.environment,
        });
        setLambdaBackupStatus(status);
      } catch (error) {
        setLambdaBackupStatus(undefined);
        setBackupOverviewError(
          error instanceof Error
            ? error.message
            : "Could not load backup overview from lambda status endpoint.",
        );
      } finally {
        setIsLoadingBackupOverview(false);
      }
    },
    [
      activeDeploymentUrl,
      ctx.environment,
      savedFormValues.runtimeMode,
    ],
  );

  useEffect(() => {
    let isCancelled = false;
    debugLogger.log("Config screen mounted", {
      initialDeploymentUrl,
      initialValidationMode,
      initialRuntimeMode,
      hasInitialConnectionState: Boolean(initialConnectionState),
      debugEnabled,
    });

    const migrateAndCheck = async () => {
      if (initialScheduleNormalization.requiresMigration) {
        try {
          await persistPluginParameters({
            backupSchedule: initialBackupSchedule,
          });
        } catch {
          // Best-effort schedule migration.
        }
      }

      if (initialRuntimeMode !== "lambda") {
        debugLogger.log(
          "Skipping mount health check because cron mode is disabled",
        );
        return;
      }

      let configuredDeploymentUrl = fallbackInitialDeploymentUrl;

      if (!initialDeploymentUrl.trim() && initialLegacyNetlifyUrl.trim()) {
        configuredDeploymentUrl = initialLegacyNetlifyUrl.trim();
        if (!isCancelled) {
          setDeploymentUrlInput(configuredDeploymentUrl);
          setActiveDeploymentUrl(configuredDeploymentUrl);
        }

        try {
          await persistPluginParameters({
            deploymentURL: configuredDeploymentUrl,
            netlifyURL: configuredDeploymentUrl,
            vercelURL: configuredDeploymentUrl,
            runtimeMode: "lambda",
            lambdaFullMode: true,
          });
        } catch {
          // Best-effort migration. Continue with UI state even if persistence fails.
        }
      }

      setIsHealthChecking(true);

      if (!configuredDeploymentUrl.trim()) {
        debugLogger.log(
          "Skipping mount health check because no deployment URL is configured",
        );
        if (!isCancelled) {
          setConnectionState(undefined);
          setConnectionValidationMode(undefined);
          clearConnectionErrorState();
          setIsHealthChecking(false);
        }

        try {
          await persistPluginParameters({
            lambdaConnection: null,
            connectionValidationMode: null,
            runtimeMode: "lambda",
            lambdaFullMode: true,
          });
        } catch {
          // Ignore persistence errors on mount.
        }

        return;
      }

      debugLogger.log("Running mount health check", {
        configuredDeploymentUrl,
        phase: "config_mount",
      });

      try {
        const verificationResult = await verifyLambdaHealth({
          baseUrl: configuredDeploymentUrl,
          environment: ctx.environment,
          phase: "config_mount",
        });

        if (isCancelled) {
          return;
        }

        const connectedState = buildConnectedLambdaConnectionState(
          verificationResult.endpoint,
          verificationResult.checkedAt,
          "config_mount",
        );

        setConnectionState(connectedState);
        setDeploymentUrlInput(verificationResult.normalizedBaseUrl);
        setActiveDeploymentUrl(verificationResult.normalizedBaseUrl);
        setConnectionValidationMode("health");
        setLegacyUpgradeWarning("");
        clearConnectionErrorState();

        await persistPluginParameters({
          deploymentURL: verificationResult.normalizedBaseUrl,
          netlifyURL: verificationResult.normalizedBaseUrl,
          vercelURL: verificationResult.normalizedBaseUrl,
          lambdaConnection: connectedState,
          connectionValidationMode: "health",
          runtimeMode: "lambda",
          lambdaFullMode: true,
          hasBeenPrompted: legacyHasBeenPrompted ?? true,
          installationState:
            legacyInstallationState === "installed"
              ? legacyInstallationState
              : "installed",
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        const canKeepLegacyConnectedState =
          initialValidationMode === "legacy" &&
          initialConnectionState?.status === "connected" &&
          shouldUseLegacyInitializationFallback(error);

        if (canKeepLegacyConnectedState) {
          debugLogger.warn(
            "Mount health check failed but keeping legacy connected state",
            error,
          );
          setConnectionState(initialConnectionState);
          setConnectionValidationMode("legacy");
          setLegacyUpgradeWarning(LEGACY_WARNING_MESSAGE);
          clearConnectionErrorState();
          setIsHealthChecking(false);
          return;
        }

        const disconnectedState = buildDisconnectedLambdaConnectionState(
          error,
          configuredDeploymentUrl,
          "config_mount",
        );
        debugLogger.warn("Mount health check failed", disconnectedState);
        applyDisconnectedState(disconnectedState);

        if (shouldUseLegacyInitializationFallback(error)) {
          setLegacyUpgradeWarning(LEGACY_WARNING_MESSAGE);
        }

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            connectionValidationMode: initialValidationMode ?? null,
            runtimeMode: "lambda",
            lambdaFullMode: true,
          });
        } catch {
          // Ignore persistence failure on mount.
        }
      } finally {
        if (!isCancelled) {
          setIsHealthChecking(false);
          debugLogger.log("Mount health check finished");
        }
      }
    };

    migrateAndCheck();

    return () => {
      isCancelled = true;
      debugLogger.log("Config screen unmounted");
    };
  }, []);

  useEffect(() => {
    void refreshLambdaBackupOverview();
  }, [refreshLambdaBackupOverview]);

  const connectLambdaHandler = async () => {
    if (runtimeModeSelection !== "lambda") {
      await ctx.alert("Enable 'Use Cronjobs' before connecting a lambda deployment.");
      return;
    }

    const candidateUrl = deploymentUrlInput.trim();
    if (!candidateUrl) {
      setConnectionErrorSummary("Enter your lambda deployment URL.");
      setConnectionErrorDetails([]);
      setShowConnectionDetails(false);
      return;
    }

    debugLogger.log("Connecting lambda deployment", { candidateUrl });
    setIsConnecting(true);
    clearConnectionErrorState();
    clearBackupNowErrorState();
    clearSchedulerDisableWarning();
    setLegacyUpgradeWarning("");

    try {
      const verificationResult = await verifyLambdaHealth({
        baseUrl: candidateUrl,
        environment: ctx.environment,
        phase: "config_connect",
      });

      const connectedState = buildConnectedLambdaConnectionState(
        verificationResult.endpoint,
        verificationResult.checkedAt,
        "config_connect",
      );

      setConnectionState(connectedState);
      setDeploymentUrlInput(verificationResult.normalizedBaseUrl);
      setActiveDeploymentUrl(verificationResult.normalizedBaseUrl);
      setConnectionValidationMode("health");
      clearConnectionErrorState();

      await persistPluginParameters({
        deploymentURL: verificationResult.normalizedBaseUrl,
        netlifyURL: verificationResult.normalizedBaseUrl,
        vercelURL: verificationResult.normalizedBaseUrl,
        lambdaConnection: connectedState,
        connectionValidationMode: "health",
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === "lambda",
        hasBeenPrompted: legacyHasBeenPrompted ?? true,
        installationState:
          legacyInstallationState === "installed"
            ? legacyInstallationState
            : "installed",
      });

      debugLogger.log("Lambda connected successfully", {
        endpoint: verificationResult.endpoint,
        normalizedBaseUrl: verificationResult.normalizedBaseUrl,
        mode: "health",
      });
      ctx.notice("Lambda function connected successfully.");
      await refreshLambdaBackupOverview(verificationResult.normalizedBaseUrl);
      return;
    } catch (error) {
      if (shouldUseLegacyInitializationFallback(error)) {
        debugLogger.warn(
          "Health endpoint unavailable, attempting legacy initialization fallback",
          error,
        );
        setLegacyUpgradeWarning(LEGACY_WARNING_MESSAGE);

        try {
          const fallbackResult = await attemptLegacyInitialization(candidateUrl);

          const legacyConnectedState: LambdaConnectionState = {
            status: "connected",
            endpoint: fallbackResult.endpoint,
            lastCheckedAt: fallbackResult.initializedAt,
            lastCheckPhase: "config_connect",
          };

          setConnectionState(legacyConnectedState);
          setDeploymentUrlInput(fallbackResult.normalizedBaseUrl);
          setActiveDeploymentUrl(fallbackResult.normalizedBaseUrl);
          setConnectionValidationMode("legacy");
          clearConnectionErrorState();

          await persistPluginParameters({
            deploymentURL: fallbackResult.normalizedBaseUrl,
            netlifyURL: fallbackResult.normalizedBaseUrl,
            vercelURL: fallbackResult.normalizedBaseUrl,
            lambdaConnection: legacyConnectedState,
            connectionValidationMode: "legacy",
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === "lambda",
            hasBeenPrompted: legacyHasBeenPrompted ?? true,
            installationState:
              legacyInstallationState === "installed"
                ? legacyInstallationState
                : "installed",
          });

          debugLogger.log("Lambda connected through legacy initialization fallback", {
            endpoint: fallbackResult.endpoint,
            normalizedBaseUrl: fallbackResult.normalizedBaseUrl,
            mode: "legacy",
          });
          ctx.notice(LEGACY_CONNECTED_NOTICE);
          return;
        } catch (fallbackError) {
          debugLogger.error("Legacy initialization fallback failed", fallbackError);
          setConnectionState(undefined);
          setConnectionValidationMode(undefined);
          setConnectionErrorSummary("Could not connect the lambda deployment.");
          setConnectionErrorDetails([
            "Could not connect using the legacy initialization endpoint.",
            fallbackError instanceof LegacyInitializationError
              ? `Endpoint called: ${fallbackError.endpoint}.`
              : "Endpoint called: unknown.",
            `Failure details: ${
              fallbackError instanceof Error
                ? fallbackError.message
                : "Unknown error"
            }`,
            "Update and redeploy the lambda function with /api/datocms/plugin-health and try again.",
          ]);
          setShowConnectionDetails(false);

          try {
            await persistPluginParameters({
              lambdaConnection: null,
              connectionValidationMode: null,
              runtimeMode: runtimeModeSelection,
              lambdaFullMode: runtimeModeSelection === "lambda",
            });
          } catch {
            // Ignore persistence errors here.
          }

          return;
        }
      }

      if (error instanceof LambdaHealthCheckError) {
        debugLogger.warn("Lambda health check failed during connect", error);
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          error,
          candidateUrl,
          "config_connect",
        );
        applyDisconnectedState(disconnectedState);

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            connectionValidationMode: null,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === "lambda",
          });
        } catch {
          // Ignore persistence errors while showing errors in UI.
        }
      } else {
        debugLogger.error("Unexpected error while connecting lambda", error);
        setConnectionErrorSummary("Unexpected error while connecting lambda.");
        setConnectionErrorDetails([
          "Unexpected error while connecting lambda.",
          `Failure details: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ]);
        setShowConnectionDetails(false);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectCurrentLambdaHandler = async () => {
    debugLogger.log("Disconnecting lambda deployment", {
      activeDeploymentUrl,
    });
    setIsDisconnecting(true);
    clearConnectionErrorState();
    clearBackupNowErrorState();
    clearSchedulerDisableWarning();
    setLegacyUpgradeWarning("");

    try {
      const candidateBaseUrl =
        activeDeploymentUrl.trim() || deploymentUrlInput.trim();
      const remoteDisableSucceeded = await disableRemoteSchedulerIfNeeded(
        candidateBaseUrl,
      );

      await persistPluginParameters({
        deploymentURL: "",
        netlifyURL: "",
        vercelURL: "",
        lambdaConnection: null,
        connectionValidationMode: null,
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === "lambda",
      });

      setDeploymentUrlInput("");
      setActiveDeploymentUrl("");
      setConnectionState(undefined);
      setConnectionValidationMode(undefined);
      setLambdaBackupStatus(undefined);
      setBackupOverviewError(
        savedFormValues.runtimeMode === "lambda"
          ? "Lambda status is unavailable until the saved Lambda URL is connected with a healthy ping."
          : "",
      );
      debugLogger.log("Lambda disconnected");
      ctx.notice(
        remoteDisableSucceeded
          ? "Current lambda function has been disconnected."
          : "Current lambda function has been disconnected locally, but remote scheduler disable failed. To avoid duplicate backups, manually disable or delete the lambda cron deployment.",
      );
    } catch (error) {
      debugLogger.error("Could not disconnect current lambda", error);
      setConnectionErrorSummary("Could not disconnect the current lambda.");
      setConnectionErrorDetails([
        "Could not disconnect the current lambda function.",
      ]);
      setShowConnectionDetails(false);
      await ctx.alert("Could not disconnect the current lambda function.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const saveSettingsHandler = async () => {
    const normalizedEnabledCadences = BACKUP_CADENCES.filter((cadence) =>
      enabledCadencesSelection.includes(cadence),
    );
    const normalizedLambdalessTime = lambdalessTimeSelection.trim();

    if (normalizedEnabledCadences.length === 0) {
      await ctx.alert("Select at least one backup cadence.");
      return;
    }

    if (parseTimeToMinuteOfDay(normalizedLambdalessTime) === null) {
      await ctx.alert("Use HH:mm format for Lambda-less time.");
      return;
    }

    debugLogger.log("Saving plugin settings", {
      runtimeModeSelection,
      debugEnabled,
      activeDeploymentUrl,
      connectionStatus: connectionState?.status,
      connectionValidationMode,
      enabledCadences: normalizedEnabledCadences,
      lambdalessTime: normalizedLambdalessTime,
      timezone: projectTimezone,
    });

    const hasConnectedLambdaForSave =
      runtimeModeSelection !== "lambda" ||
      (activeDeploymentUrl.trim().length > 0 &&
        connectionState?.status === "connected" &&
        connectionValidationMode === "health" &&
        !isHealthChecking &&
        !isConnecting);

    if (!hasConnectedLambdaForSave) {
      await ctx.alert(
        "Cannot save while 'Use Cronjobs' is enabled unless the Lambda URL is connected and ping status is Connected.",
      );
      return;
    }

    setIsLoading(true);
    clearSchedulerDisableWarning();

    try {
      let persistedDeploymentUrl = activeDeploymentUrl.trim();
      let persistedConnectionState = connectionState ?? null;
      let persistedValidationMode: ConnectionValidationMode | null =
        connectionValidationMode ?? null;
      let remoteDisableSucceeded = true;
      const savedCadences = savedFormValues.backupSchedule.enabledCadences;
      const didCadencesChange =
        savedCadences.length !== normalizedEnabledCadences.length ||
        savedCadences.some(
          (cadence, index) => cadence !== normalizedEnabledCadences[index],
        );
      const persistedBackupSchedule: BackupScheduleConfig = {
        version: 1,
        enabledCadences: normalizedEnabledCadences,
        timezone: projectTimezone,
        lambdalessTime: normalizedLambdalessTime,
        anchorLocalDate: didCadencesChange
          ? toLocalDateKey(new Date(), projectTimezone)
          : savedFormValues.backupSchedule.anchorLocalDate,
        updatedAt: new Date().toISOString(),
      };

      if (runtimeModeSelection === "lambdaless") {
        remoteDisableSucceeded = await disableRemoteSchedulerIfNeeded(
          persistedDeploymentUrl,
        );
        persistedDeploymentUrl = "";
        persistedConnectionState = null;
        persistedValidationMode = null;
        setDeploymentUrlInput("");
        setActiveDeploymentUrl("");
        setConnectionState(undefined);
        setConnectionValidationMode(undefined);
        setLegacyUpgradeWarning("");
        clearConnectionErrorState();
        clearBackupNowErrorState();
        setLambdaBackupStatus(undefined);
        setBackupOverviewError("");
      }

      await persistPluginParameters({
        debug: debugEnabled,
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === "lambda",
        deploymentURL: persistedDeploymentUrl,
        netlifyURL: persistedDeploymentUrl,
        vercelURL: persistedDeploymentUrl,
        lambdaConnection: persistedConnectionState,
        connectionValidationMode: persistedValidationMode,
        backupSchedule: persistedBackupSchedule,
      });

      setSavedFormValues({
        runtimeMode: runtimeModeSelection,
        debugEnabled,
        backupSchedule: persistedBackupSchedule,
      });

      ctx.notice(
        remoteDisableSucceeded
          ? `Settings saved. Runtime mode: ${
              runtimeModeSelection === "lambda"
                ? "Lambda-full (cron)"
                : "Lambda-less (on boot)"
            }. Debug logging is ${debugEnabled ? "enabled" : "disabled"}.`
          : "Settings saved, but remote scheduler disable failed. To avoid duplicate backups, manually disable or delete the lambda cron deployment.",
      );
    } catch (error) {
      debugLogger.error("Could not save plugin settings", error);
      await ctx.alert("Could not save plugin settings.");
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

    debugLogger.log("Opening deploy provider", { provider, url: option.url });
    window.open(option.url, "_blank", "noreferrer");
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
    await ctx.navigateTo("/project_settings/environments");
  };

  const triggerBackupNowHandler = async () => {
    const candidateUrl = (activeDeploymentUrl || deploymentUrlInput).trim();
    if (!candidateUrl) {
      setBackupNowErrorSummary(
        "Enter or connect a lambda URL before triggering a backup.",
      );
      setBackupNowErrorDetails([]);
      setShowBackupNowDetails(false);
      return;
    }

    debugLogger.log("Triggering backup now", {
      candidateUrl,
      environment: ctx.environment,
    });
    setIsTriggeringBackup(true);
    clearBackupNowErrorState();

    try {
      const result = await triggerBackupNow({
        baseUrl: candidateUrl,
        environment: ctx.environment,
      });

      setDeploymentUrlInput(result.normalizedBaseUrl);
      setActiveDeploymentUrl(result.normalizedBaseUrl);
      debugLogger.log("Backup trigger request succeeded", {
        endpoint: result.endpoint,
        method: result.method,
        attemptName: result.attemptName,
      });
      ctx.notice(
        `Backup triggered successfully via ${result.method} ${result.endpoint}.`,
      );
      await refreshLambdaBackupOverview(result.normalizedBaseUrl);
    } catch (error) {
      if (error instanceof TriggerBackupNowError) {
        debugLogger.warn("All backup trigger attempts failed", {
          normalizedBaseUrl: error.normalizedBaseUrl,
          failures: error.failures,
        });
        setBackupNowErrorSummary("Could not trigger backup now.");
        setBackupNowErrorDetails(getTriggerBackupNowErrorDetails(error));
        setShowBackupNowDetails(false);
      } else if (error instanceof LambdaHealthCheckError) {
        debugLogger.warn(
          "Backup trigger failed because URL normalization/validation failed",
          error,
        );
        setBackupNowErrorSummary("Could not trigger backup now.");
        setBackupNowErrorDetails([
          `Failure details: ${error.message}`,
          `Endpoint attempted: ${error.endpoint}.`,
        ]);
        setShowBackupNowDetails(false);
      } else {
        debugLogger.error("Unexpected error while triggering backup now", error);
        setBackupNowErrorSummary("Could not trigger backup now.");
        setBackupNowErrorDetails([
          `Failure details: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ]);
        setShowBackupNowDetails(false);
      }
    } finally {
      setIsTriggeringBackup(false);
    }
  };

  const isLambdaFullModeEnabled = runtimeModeSelection === "lambda";
  const pingIndicator =
    isHealthChecking || isConnecting
      ? {
          label: "Checking ping...",
          color: "var(--warning-color)",
        }
      : connectionValidationMode === "legacy" &&
          connectionState?.status === "connected"
        ? {
            label: "Connected (legacy fallback)",
            color: "var(--warning-color)",
          }
        : connectionState?.status === "connected"
          ? {
              label: "Connected (ping successful)",
              color: "var(--notice-color)",
            }
          : connectionState?.status === "disconnected"
            ? {
                label: "Disconnected (ping failed)",
                color: "var(--alert-color)",
              }
            : activeDeploymentUrl
              ? {
                  label: "Connection pending",
                  color: "var(--light-body-color)",
                }
              : {
                  label: "Disconnected (no lambda URL configured)",
                  color: "var(--light-body-color)",
                };

  const hasActiveDeploymentUrl = activeDeploymentUrl.trim().length > 0;
  const connectButtonLabel = isConnecting
    ? hasActiveDeploymentUrl
      ? "Changing Lambda URL..."
      : "Connecting..."
    : hasActiveDeploymentUrl
      ? "Change Lambda URL"
      : "Connect";
  const disconnectButtonLabel = isDisconnecting ? "Disconnecting..." : "Disconnect";
  const backupNowButtonLabel = isTriggeringBackup
    ? "Running test backup..."
    : "Run lambda test backup";
  const hasHealthyConnectedLambda =
    connectionValidationMode === "health" && connectionState?.status === "connected";
  const backupNowButtonDisabled =
    isTriggeringBackup ||
    isConnecting ||
    isHealthChecking ||
    isDisconnecting ||
    !hasHealthyConnectedLambda;

  const lambdaActionButtonStyle: CSSProperties = {
    width: "100%",
    height: "40px",
    fontSize: "var(--font-size-m)",
    fontWeight: 500,
    lineHeight: "1",
    padding: "0 var(--spacing-m)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    flex: "1 1 0",
    whiteSpace: "nowrap",
  };

  const cardStyle = {
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    background: "#fff",
    padding: "var(--spacing-l)",
    marginBottom: "var(--spacing-l)",
    textAlign: "left" as const,
  };

  const subtleTextStyle = {
    margin: 0,
    color: "var(--light-body-color)",
    fontSize: "var(--font-size-xs)",
  };

  const infoTextStyle = {
    marginTop: 0,
    marginBottom: "var(--spacing-s)",
    color: "var(--base-body-color)",
    fontSize: "var(--font-size-s)",
  };

  const advancedSettingsStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-m)",
  };

  const overviewGridStyle: CSSProperties = {
    display: "grid",
    gap: "var(--spacing-s)",
  };

  const overviewRowStyle: CSSProperties = {
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    padding: "var(--spacing-m)",
    background: "#fff",
  };

  const overviewRowLabelStyle: CSSProperties = {
    marginTop: 0,
    marginBottom: "var(--spacing-xs)",
    fontSize: "var(--font-size-m)",
  };

  const overviewRowInfoStyle: CSSProperties = {
    margin: 0,
    fontSize: "var(--font-size-s)",
  };

  const switchFieldNoHintGapStyle = {
    "--spacing-s": "0",
  } as CSSProperties;

  const switchFieldNoHintGapStyleWithExtraSpacing = {
    ...switchFieldNoHintGapStyle,
    marginBottom: "0.25rem",
  } as CSSProperties;

  const lambdaSetupDisabled =
    isConnecting || isDisconnecting || isHealthChecking || isLoading;

  const normalizedCadenceSelection = BACKUP_CADENCES.filter((cadence) =>
    enabledCadencesSelection.includes(cadence),
  );
  const hasCadenceSelectionChanged =
    normalizedCadenceSelection.length !==
      savedFormValues.backupSchedule.enabledCadences.length ||
    normalizedCadenceSelection.some(
      (cadence, index) =>
        cadence !== savedFormValues.backupSchedule.enabledCadences[index],
    );
  const hasLambdalessTimeChanged =
    lambdalessTimeSelection.trim() !==
    savedFormValues.backupSchedule.lambdalessTime;
  const hasUnsavedChanges =
    debugEnabled !== savedFormValues.debugEnabled ||
    runtimeModeSelection !== savedFormValues.runtimeMode ||
    hasCadenceSelectionChanged ||
    hasLambdalessTimeChanged;

  const canSaveWithLambdaMode =
    !isLambdaFullModeEnabled ||
    (hasActiveDeploymentUrl &&
      connectionState?.status === "connected" &&
      connectionValidationMode === "health" &&
      !isHealthChecking &&
      !isConnecting);

  const lambdaSaveBlockReason = !isLambdaFullModeEnabled
    ? ""
    : !hasActiveDeploymentUrl
      ? "To save with cronjobs enabled, connect a Lambda URL first."
      : isHealthChecking || isConnecting
        ? "Wait for the Lambda ping check to finish."
        : connectionState?.status !== "connected" || connectionValidationMode !== "health"
          ? "To save with cronjobs enabled, Lambda status must be Connected (ping successful)."
          : "";

  const savedRuntimeMode = savedFormValues.runtimeMode;
  const savedBackupSchedule = savedFormValues.backupSchedule;
  const backupOverviewRows: BackupOverviewRow[] = buildBackupOverviewRows({
    runtimeMode: savedRuntimeMode,
    scheduleState: initialAutomaticBackupsScheduleState,
    scheduleConfig: savedBackupSchedule,
    lambdaStatus: savedRuntimeMode === "lambda" ? lambdaBackupStatus : undefined,
  });

  return (
    <Canvas ctx={ctx}>
      <div
        style={{
          maxWidth: "760px",
          margin: "0 auto",
        }}
      >
        {isLambdaFullModeEnabled && (
          <div style={cardStyle}>
            <h2
              style={{
                marginTop: 0,
                marginBottom: "var(--spacing-s)",
                fontSize: "var(--font-size-l)",
              }}
            >
              Lambda setup
            </h2>

            <p style={infoTextStyle}>
              <strong>Current URL:</strong>{" "}
              <span style={{ wordBreak: "break-all" }}>
                {activeDeploymentUrl || "No lambda function connected."}
              </span>
            </p>

            <p
              style={{
                display: "flex",
                justifyContent: "flex-start",
                alignItems: "center",
                gap: "var(--spacing-s)",
                marginTop: 0,
                marginBottom: "var(--spacing-s)",
                fontSize: "var(--font-size-s)",
                color: "var(--light-body-color)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: "10px",
                  height: "10px",
                  borderRadius: "999px",
                  background: pingIndicator.color,
                }}
              />
              <span>{pingIndicator.label}</span>
            </p>

            <p style={{ ...subtleTextStyle, marginBottom: "var(--spacing-l)" }}>
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
                clearBackupNowErrorState();
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "nowrap",
                width: "100%",
                gap: "var(--spacing-s)",
                marginTop: "var(--spacing-l)",
              }}
            >
              <div style={{ flex: "1 1 0" }}>
                <Dropdown
                  renderTrigger={({ onClick }) => (
                    <Button
                      buttonType="muted"
                      onClick={onClick}
                      disabled={
                        isConnecting ||
                        isHealthChecking ||
                        isDisconnecting ||
                        isTriggeringBackup
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
                  isTriggeringBackup ||
                  !activeDeploymentUrl.trim()
                }
                style={lambdaActionButtonStyle}
              >
                {disconnectButtonLabel}
              </Button>

              <Button
                buttonType="primary"
                onClick={connectLambdaHandler}
                disabled={
                  isConnecting ||
                  isHealthChecking ||
                  isDisconnecting ||
                  isTriggeringBackup
                }
                style={lambdaActionButtonStyle}
              >
                {connectButtonLabel}
              </Button>
            </div>

            <div style={{ marginTop: "var(--spacing-s)" }}>
              <Button
                buttonType="muted"
                onClick={triggerBackupNowHandler}
                disabled={backupNowButtonDisabled}
                style={lambdaActionButtonStyle}
              >
                {backupNowButtonLabel}
              </Button>
            </div>
          </div>
        )}

        {isLambdaFullModeEnabled && legacyUpgradeWarning && (
          <div
            style={{
              border: "1px solid var(--warning-color)",
              borderRadius: "6px",
              background: "rgba(255, 184, 0, 0.12)",
              padding: "var(--spacing-m)",
              marginBottom: "var(--spacing-m)",
            }}
          >
            <p style={{ margin: 0 }}>{legacyUpgradeWarning}</p>
          </div>
        )}

        {schedulerDisableWarning && (
          <div
            style={{
              border: "1px solid var(--warning-color)",
              borderRadius: "6px",
              background: "rgba(255, 184, 0, 0.12)",
              padding: "var(--spacing-m)",
              marginBottom: "var(--spacing-m)",
            }}
          >
            <p style={{ margin: 0 }}>{schedulerDisableWarning}</p>
          </div>
        )}

        {isLambdaFullModeEnabled && backupNowErrorSummary && (
          <div
            style={{
              border: "1px solid rgba(var(--alert-color-rgb-components), 0.5)",
              borderRadius: "6px",
              background: "rgba(var(--alert-color-rgb-components), 0.08)",
              padding: "var(--spacing-m)",
              marginBottom: "var(--spacing-m)",
            }}
          >
            <p style={{ marginTop: 0, marginBottom: "var(--spacing-s)" }}>
              {backupNowErrorSummary}
            </p>
            {backupNowErrorDetails.length > 0 && (
              <Button
                buttonType="muted"
                buttonSize="s"
                onClick={() => setShowBackupNowDetails((current) => !current)}
              >
                {showBackupNowDetails ? "Hide details" : "Show details"}
              </Button>
            )}
          </div>
        )}

        {isLambdaFullModeEnabled &&
          showBackupNowDetails &&
          backupNowErrorDetails.length > 0 && (
            <div
              style={{
                border: "1px solid rgba(var(--alert-color-rgb-components), 0.5)",
                borderRadius: "6px",
                background: "#fff",
                padding: "var(--spacing-m)",
                marginBottom: "var(--spacing-l)",
                textAlign: "left",
              }}
            >
              {backupNowErrorDetails.map((detail, index) => (
                <p key={`config-backup-now-error-${index}`}>{detail}</p>
              ))}
            </div>
          )}

        {isLambdaFullModeEnabled && connectionErrorSummary && (
          <div
            style={{
              border: "1px solid rgba(var(--alert-color-rgb-components), 0.5)",
              borderRadius: "6px",
              background: "rgba(var(--alert-color-rgb-components), 0.08)",
              padding: "var(--spacing-m)",
              marginBottom: "var(--spacing-m)",
            }}
          >
            <p style={{ marginTop: 0, marginBottom: "var(--spacing-s)" }}>
              {connectionErrorSummary}
            </p>
            {connectionErrorDetails.length > 0 && (
              <Button
                buttonType="muted"
                buttonSize="s"
                onClick={() => setShowConnectionDetails((current) => !current)}
              >
                {showConnectionDetails ? "Hide details" : "Show details"}
              </Button>
            )}
          </div>
        )}

        {isLambdaFullModeEnabled &&
          showConnectionDetails &&
          connectionErrorDetails.length > 0 && (
            <div
              style={{
                border: "1px solid rgba(var(--alert-color-rgb-components), 0.5)",
                borderRadius: "6px",
                background: "#fff",
                padding: "var(--spacing-m)",
                marginBottom: "var(--spacing-l)",
                textAlign: "left",
              }}
            >
              {connectionErrorDetails.map((detail, index) => (
                <p key={`config-health-error-${index}`}>{detail}</p>
              ))}
            </div>
          )}

        <div style={cardStyle}>
          <h2
            style={{
              marginTop: 0,
              marginBottom: "var(--spacing-s)",
              fontSize: "var(--font-size-l)",
            }}
          >
            Backup schedule
          </h2>

          <p style={infoTextStyle}>
            Pick the backups you want to keep. The interface is intentionally simple.
          </p>

          <p style={{ ...subtleTextStyle, marginBottom: "var(--spacing-s)" }}>
            <strong>Project timezone:</strong> {projectTimezone}
          </p>

          <div style={{ display: "grid", gap: "var(--spacing-xs)" }}>
            {BACKUP_CADENCES.map((cadence) => (
              <div key={`cadence-toggle-${cadence}`} style={switchFieldNoHintGapStyle}>
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

          {runtimeModeSelection === "lambdaless" ? (
            <div style={{ marginTop: "var(--spacing-s)" }}>
              <TextField
                name="lambdalessTime"
                id="lambdalessTime"
                label="Lambda-less run time"
                hint="Format: HH:mm (project timezone). Runs on next dashboard login at or after this time."
                value={lambdalessTimeSelection}
                placeholder="00:00"
                onChange={(newValue) => setLambdalessTimeSelection(newValue)}
              />
            </div>
          ) : (
            <p style={{ ...subtleTextStyle, marginTop: "var(--spacing-s)" }}>
              Lambda mode runs once a day from provider cron. Custom time is only
              applied in Lambda-less mode.
            </p>
          )}
        </div>

        <div style={cardStyle}>
          <h2
            style={{
              marginTop: 0,
              marginBottom: "var(--spacing-s)",
              fontSize: "var(--font-size-l)",
            }}
          >
            Backup overview
          </h2>

          <p style={infoTextStyle}>
            Overview for the <strong>saved</strong> runtime mode. All timestamps are in UTC.
          </p>

          <p style={{ ...subtleTextStyle, marginBottom: "var(--spacing-s)" }}>
            <strong>Saved mode:</strong>{" "}
            {savedRuntimeMode === "lambda" ? "Cronjobs (Lambda)" : "Lambdaless on boot"}
          </p>

          {savedRuntimeMode === "lambda" && isLoadingBackupOverview && (
            <p style={{ ...subtleTextStyle, marginBottom: "var(--spacing-s)" }}>
              Refreshing Lambda backup status...
            </p>
          )}

          {savedRuntimeMode === "lambda" && backupOverviewError && (
            <p
              style={{
                ...subtleTextStyle,
                marginBottom: "var(--spacing-s)",
                color: "var(--alert-color)",
              }}
            >
              {backupOverviewError}
            </p>
          )}

          <div style={overviewGridStyle}>
            {backupOverviewRows.map((row) => (
              <div key={`backup-overview-${row.scope}`} style={overviewRowStyle}>
                <h3 style={overviewRowLabelStyle}>{getCadenceLabel(row.scope)}</h3>
                <p style={overviewRowInfoStyle}>
                  <strong>Last backup:</strong> {row.lastBackup}
                </p>
                <p style={overviewRowInfoStyle}>
                  <strong>Next backup:</strong> {row.nextBackup}
                </p>
                <p style={overviewRowInfoStyle}>
                  <strong>Environment:</strong>{" "}
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
              </div>
            ))}
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

              <div style={switchFieldNoHintGapStyle}>
                <SwitchField
                  name="useCronjobs"
                  id="useCronjobs"
                  label="Use Cronjobs"
                  hint="If enabled, backups rely on the external Lambda scheduler. If disabled, backups run on plugin boot."
                  value={isLambdaFullModeEnabled}
                  switchInputProps={{
                    name: "useCronjobs",
                    value: isLambdaFullModeEnabled,
                    disabled: lambdaSetupDisabled,
                  }}
                  onChange={(newValue) => {
                    setRuntimeModeSelection(newValue ? "lambda" : "lambdaless");
                    clearConnectionErrorState();
                    clearBackupNowErrorState();
                    clearSchedulerDisableWarning();
                    setLegacyUpgradeWarning("");
                  }}
                />
              </div>

              <p style={subtleTextStyle}>
                <a
                  href={`${PLUGIN_README_URL}#runtime-modes`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Runtime mode guide and tradeoffs
                </a>
              </p>

              {isLambdaFullModeEnabled && (
                <p style={subtleTextStyle}>
                  Connect a Lambda URL above to save with cron mode enabled.
                </p>
              )}

              {runtimeModeSelection === "lambdaless" && hasActiveDeploymentUrl && (
                <p style={subtleTextStyle}>
                  Lambda is currently connected. Click Save to complete the switch to
                  Lambda-less and clear the connected URL.
                </p>
              )}

              {lambdaSaveBlockReason && (
                <p
                  style={{
                    ...subtleTextStyle,
                    color: "var(--alert-color)",
                  }}
                >
                  {lambdaSaveBlockReason}
                </p>
              )}
            </div>
          </Section>

          {!showAdvancedSettings && lambdaSaveBlockReason && (
            <p
              style={{
                ...subtleTextStyle,
                marginTop: "var(--spacing-s)",
                color: "var(--alert-color)",
              }}
            >
              Open Advanced settings to configure cron mode before saving.
            </p>
          )}

          <Button
            onClick={saveSettingsHandler}
            fullWidth
            buttonType={isLoading ? "muted" : "primary"}
            disabled={
              isLoading ||
              isDisconnecting ||
              isConnecting ||
              isTriggeringBackup ||
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

import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import {
  Button,
  Canvas,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  SwitchField,
  TextField,
} from "datocms-react-ui";
import { CSSProperties, useEffect, useState } from "react";
import {
  ConnectionValidationMode,
  LambdaConnectionState,
} from "../types/types";
import {
  attemptLegacyInitialization,
  LegacyInitializationError,
} from "../utils/attemptLegacyInitialization";
import {
  DEPLOY_PROVIDER_OPTIONS,
  DeployProvider,
} from "../utils/deployProviders";
import { getDeploymentUrlFromParameters } from "../utils/getDeploymentUrlFromParameters";
import {
  buildConnectedLambdaConnectionState,
  buildDisconnectedLambdaConnectionState,
  getLambdaConnectionErrorDetails,
  LambdaHealthCheckError,
  shouldUseLegacyInitializationFallback,
  verifyLambdaHealth,
} from "../utils/verifyLambdaHealth";
import {
  getTriggerBackupNowErrorDetails,
  triggerBackupNow,
  TriggerBackupNowError,
} from "../utils/triggerBackupNow";
import { createDebugLogger, isDebugEnabled } from "../utils/debugLogger";

const DEFAULT_CONNECTION_ERROR_SUMMARY =
  "Could not validate the Automatic Backups deployment.";
const LEGACY_WARNING_MESSAGE =
  "This deployment does not expose /api/datocms/plugin-health yet. It was connected using the legacy initialization fallback. Update and redeploy the lambda function.";
const LEGACY_CONNECTED_NOTICE =
  "Connected using legacy initialization fallback. Update the lambda function to support /api/datocms/plugin-health.";

type PluginParameters = Record<string, unknown> | undefined;

const toConnectionValidationMode = (
  value: unknown,
): ConnectionValidationMode | undefined => {
  return value === "health" || value === "legacy" ? value : undefined;
};

const toLambdaConnectionState = (value: unknown): LambdaConnectionState | undefined => {
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
    typeof pluginParameters?.netlifyURL === "string" ? pluginParameters.netlifyURL : "";
  const fallbackInitialDeploymentUrl =
    initialDeploymentUrl.trim() || initialLegacyNetlifyUrl.trim();
  const initialDebugEnabled = isDebugEnabled(pluginParameters);
  const initialConnectionState = toLambdaConnectionState(
    pluginParameters?.lambdaConnection,
  );
  const initialValidationMode = toConnectionValidationMode(
    pluginParameters?.connectionValidationMode,
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

  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState(false);
  const [isUpdatingDebugSetting, setIsUpdatingDebugSetting] = useState(false);
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
  const [debugEnabled, setDebugEnabled] = useState(initialDebugEnabled);
  const debugLogger = createDebugLogger(debugEnabled, "ConfigScreen");

  const persistPluginParameters = async (updates: Record<string, unknown>) => {
    await ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      debug: debugEnabled,
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

  const updateDebugLoggingHandler = async (nextValue: boolean) => {
    if (nextValue === debugEnabled) {
      return;
    }

    const previousValue = debugEnabled;
    setIsUpdatingDebugSetting(true);
    setDebugEnabled(nextValue);

    try {
      await persistPluginParameters({ debug: nextValue });
      if (nextValue) {
        console.log("[automatic-backups][ConfigScreen] Debug logging enabled");
      }
      ctx.notice(`Debug logging ${nextValue ? "enabled" : "disabled"}.`);
    } catch (error) {
      setDebugEnabled(previousValue);
      await ctx.alert("Could not update debug logging setting.");
      if (nextValue || previousValue) {
        console.error(
          "[automatic-backups][ConfigScreen] Failed to persist debug setting",
          error,
        );
      }
    } finally {
      setIsUpdatingDebugSetting(false);
    }
  };

  const applyDisconnectedState = (state: LambdaConnectionState) => {
    setConnectionState(state);
    setConnectionErrorSummary(getConnectionErrorSummary(state));
    setConnectionErrorDetails(getLambdaConnectionErrorDetails(state));
    setShowConnectionDetails(false);
  };

  useEffect(() => {
    let isCancelled = false;
    debugLogger.log("Config screen mounted", {
      initialDeploymentUrl,
      initialValidationMode,
      hasInitialConnectionState: Boolean(initialConnectionState),
      debugEnabled,
    });

    const migrateAndCheck = async () => {
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
          });
        } catch {
          // Best-effort migration. Continue with UI state even if persistence fails.
        }
      }

      if (!configuredDeploymentUrl.trim()) {
        debugLogger.log("Skipping mount health check because no deployment URL is configured");
        return;
      }

      setIsHealthChecking(true);
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
        debugLogger.log("Mount health check succeeded", {
          endpoint: verificationResult.endpoint,
          normalizedBaseUrl: verificationResult.normalizedBaseUrl,
        });

        await persistPluginParameters({
          deploymentURL: verificationResult.normalizedBaseUrl,
          netlifyURL: verificationResult.normalizedBaseUrl,
          lambdaConnection: connectedState,
          connectionValidationMode: "health",
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

  const connectLambdaHandler = async () => {
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
        lambdaConnection: connectedState,
        connectionValidationMode: "health",
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
            lambdaConnection: legacyConnectedState,
            connectionValidationMode: "legacy",
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
          setConnectionErrorSummary(
            "Could not connect the lambda deployment.",
          );
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
    setLegacyUpgradeWarning("");

    try {
      await persistPluginParameters({
        deploymentURL: "",
        netlifyURL: "",
        lambdaConnection: null,
        connectionValidationMode: null,
      });

      setDeploymentUrlInput("");
      setActiveDeploymentUrl("");
      setConnectionState(undefined);
      setConnectionValidationMode(undefined);
      debugLogger.log("Lambda disconnected");
      ctx.notice("Current lambda function has been disconnected.");
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

    debugLogger.log("Triggering backup now", { candidateUrl, environment: ctx.environment });
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
        debugLogger.warn("Backup trigger failed because URL normalization/validation failed", error);
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
    : "Run lambda test Backup";
  const hasHealthyConnectedLambda =
    connectionValidationMode === "health" &&
    connectionState?.status === "connected";
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

  return (
    <Canvas ctx={ctx}>
      <div
        style={{
          maxWidth: "760px",
          margin: "0 auto",
        }}
      >
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

        {legacyUpgradeWarning && (
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

        {backupNowErrorSummary && (
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

        {showBackupNowDetails && backupNowErrorDetails.length > 0 && (
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

        {connectionErrorSummary && (
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

        {showConnectionDetails && connectionErrorDetails.length > 0 && (
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
            Debug
          </h2>
          <p style={{ ...infoTextStyle, marginBottom: "var(--spacing-m)" }}>
            Enable verbose console logs to help troubleshoot connection and backup
            trigger issues.
          </p>
          <SwitchField
            name="debugLogging"
            id="debugLogging"
            label="Enable debug logging"
            hint="Logs appear in the browser console with the [automatic-backups] prefix."
            value={debugEnabled}
            switchInputProps={{
              name: "debugLogging",
              value: debugEnabled,
              disabled: isUpdatingDebugSetting,
            }}
            onChange={(nextValue) => {
              void updateDebugLoggingHandler(nextValue);
            }}
          />
        </div>

      </div>
    </Canvas>
  );
}

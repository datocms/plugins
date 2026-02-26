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
import { CSSProperties, useEffect, useState } from "react";
import {
  automaticBinCleanupObject,
  LambdaConnectionState,
} from "../types/types";
import {
  DEPLOY_PROVIDER_OPTIONS,
  DeployProvider,
  PLUGIN_README_URL,
} from "../utils/deployProviders";
import { createDebugLogger, isDebugEnabled } from "../utils/debugLogger";
import { getDeploymentUrlFromParameters } from "../utils/getDeploymentUrlFromParameters";
import { getRuntimeMode, RuntimeMode } from "../utils/getRuntimeMode";
import {
  ensureRecordBinWebhook,
  getRecordBinWebhookSyncErrorDetails,
  isRecordBinWebhookSyncError,
  removeAllManagedRecordBinWebhooks,
  removeRecordBinWebhook,
  RecordBinWebhookSyncError,
} from "../utils/recordBinWebhook";
import {
  buildConnectedLambdaConnectionState,
  buildDisconnectedLambdaConnectionState,
  getLambdaConnectionErrorDetails,
  LambdaHealthCheckError,
  verifyLambdaHealth,
} from "../utils/verifyLambdaHealth";

const DEFAULT_CONNECTION_ERROR_SUMMARY =
  "Could not validate the Record Bin lambda deployment.";

const getConnectionErrorSummary = (
  connection?: LambdaConnectionState
): string => {
  if (!connection || connection.status !== "disconnected") {
    return "";
  }

  return connection.errorMessage || DEFAULT_CONNECTION_ERROR_SUMMARY;
};

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const initialConnectionState = (ctx.plugin.attributes.parameters.lambdaConnection ??
    undefined) as LambdaConnectionState | undefined;
  const initialRuntimeMode = getRuntimeMode(ctx.plugin.attributes.parameters);
  const initialDeploymentUrl = getDeploymentUrlFromParameters(
    ctx.plugin.attributes.parameters
  );
  const initialDebugEnabled = isDebugEnabled(ctx.plugin.attributes.parameters);
  const initialNumberOfDays = String(
    (ctx.plugin.attributes.parameters?.automaticBinCleanup as automaticBinCleanupObject)
      ?.numberOfDays ?? "30"
  );
  const hasInitialConnectionErrorDetails =
    initialDeploymentUrl.trim().length > 0 &&
    initialConnectionState?.status === "disconnected" &&
    Boolean(
      initialConnectionState.errorCode ||
        initialConnectionState.errorMessage ||
        initialConnectionState.httpStatus ||
        initialConnectionState.responseSnippet
    );

  const [numberOfDays, setNumberOfDays] = useState(
    initialNumberOfDays
  );
  const [debugEnabled, setDebugEnabled] = useState(initialDebugEnabled);
  const [runtimeModeSelection, setRuntimeModeSelection] = useState<RuntimeMode>(
    initialRuntimeMode
  );
  const [savedFormValues, setSavedFormValues] = useState({
    numberOfDays: initialNumberOfDays,
    debugEnabled: initialDebugEnabled,
    runtimeMode: initialRuntimeMode,
  });
  const [isLoading, setLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [deploymentUrlInput, setDeploymentUrlInput] = useState(
    initialDeploymentUrl
  );
  const [activeDeploymentUrl, setActiveDeploymentUrl] = useState(
    initialDeploymentUrl
  );
  const [connectionState, setConnectionState] = useState<
    LambdaConnectionState | undefined
  >(initialConnectionState);
  const [connectionErrorSummary, setConnectionErrorSummary] = useState(
    hasInitialConnectionErrorDetails
      ? getConnectionErrorSummary(initialConnectionState)
      : ""
  );
  const [connectionErrorDetails, setConnectionErrorDetails] = useState<string[]>(
    hasInitialConnectionErrorDetails
      ? getLambdaConnectionErrorDetails(initialConnectionState)
      : []
  );
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
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

  const applyDisconnectedState = (state: LambdaConnectionState) => {
    setConnectionState(state);
    setConnectionErrorSummary(getConnectionErrorSummary(state));
    setConnectionErrorDetails(getLambdaConnectionErrorDetails(state));
    setShowConnectionDetails(false);
  };

  const applyWebhookSyncErrorState = (
    error: RecordBinWebhookSyncError,
    operation: "connect" | "disconnect"
  ) => {
    setConnectionErrorSummary(error.message);
    setConnectionErrorDetails(
      getRecordBinWebhookSyncErrorDetails(error, operation)
    );
    setShowConnectionDetails(false);
  };

  const canManageWebhooks =
    ctx.currentRole?.meta?.final_permissions?.can_manage_webhooks === true;

  const removeManagedWebhooksForLambdaLessMode = async ({
    trigger,
    notifyOnFailure,
  }: {
    trigger: "config_mount" | "settings_save";
    notifyOnFailure: boolean;
  }) => {
    try {
      const webhookRemovalResult = await removeAllManagedRecordBinWebhooks({
        currentUserAccessToken: ctx.currentUserAccessToken,
        canManageWebhooks,
        environment: ctx.environment,
      });
      debugLogger.log("Managed Record Bin webhooks synchronized in Lambda-less mode", {
        trigger,
        action: webhookRemovalResult.action,
        webhookIds: webhookRemovalResult.webhookIds,
      });
    } catch (webhookRemovalError) {
      debugLogger.warn(
        "Could not synchronize managed Record Bin webhooks in Lambda-less mode",
        webhookRemovalError
      );
      if (notifyOnFailure) {
        await ctx.notice(
          "Runtime was saved as Lambda-less, but one or more managed '🗑 Record Bin' webhooks could not be removed automatically. Remove them manually if needed."
        );
      }
    }
  };

  useEffect(() => {
    let isCancelled = false;
    debugLogger.log("Config screen mounted", {
      initialDebugEnabled,
      hasInitialConnectionState: !!initialConnectionState,
    });

    const runHealthCheck = async () => {
      setIsHealthChecking(true);

      if (initialRuntimeMode !== "lambda") {
        debugLogger.log(
          "Skipping lambda health check because Lambda-full mode is not selected"
        );
        await removeManagedWebhooksForLambdaLessMode({
          trigger: "config_mount",
          notifyOnFailure: false,
        });
        if (!isCancelled) {
          setIsHealthChecking(false);
        }
        return;
      }

      const configuredDeploymentUrl = getDeploymentUrlFromParameters(
        ctx.plugin.attributes.parameters
      );
      if (!isCancelled) {
        setDeploymentUrlInput(configuredDeploymentUrl);
        setActiveDeploymentUrl(configuredDeploymentUrl);
      }
      debugLogger.log("Running lambda health check", {
        phase: "config_mount",
        deploymentUrl: configuredDeploymentUrl,
      });

      if (!configuredDeploymentUrl.trim()) {
        debugLogger.log(
          "Skipping lambda health check because no deployment URL is configured"
        );
        if (!isCancelled) {
          setConnectionState(undefined);
          clearConnectionErrorState();
          setIsHealthChecking(false);
        }

        try {
          await persistPluginParameters({
            lambdaConnection: null,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === "lambda",
          });
          debugLogger.log("Cleared lambda connection state without URL");
        } catch (persistError) {
          debugLogger.warn(
            "Failed to clear lambda connection state without URL",
            persistError
          );
        }

        return;
      }

      try {
        const verificationResult = await verifyLambdaHealth({
          baseUrl: configuredDeploymentUrl,
          environment: ctx.environment,
          phase: "config_mount",
          debug: debugEnabled,
        });
        debugLogger.log("Lambda health check succeeded", verificationResult);

        const connectedState = buildConnectedLambdaConnectionState(
          verificationResult.endpoint,
          verificationResult.checkedAt,
          "config_mount"
        );

        if (!isCancelled) {
          setConnectionState(connectedState);
          clearConnectionErrorState();
          setDeploymentUrlInput(verificationResult.normalizedBaseUrl);
          setActiveDeploymentUrl(verificationResult.normalizedBaseUrl);
        }

        try {
          await persistPluginParameters({
            deploymentURL: verificationResult.normalizedBaseUrl,
            vercelURL: verificationResult.normalizedBaseUrl,
            lambdaConnection: connectedState,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === "lambda",
          });
          debugLogger.log("Persisted connected lambda state on mount");
        } catch (persistError) {
          debugLogger.warn(
            "Failed to persist connected lambda state on mount",
            persistError
          );
        }
      } catch (healthCheckError) {
        debugLogger.warn("Lambda health check failed on mount", healthCheckError);
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          healthCheckError,
          configuredDeploymentUrl,
          "config_mount"
        );

        if (!isCancelled) {
          applyDisconnectedState(disconnectedState);
        }

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === "lambda",
          });
          debugLogger.log("Persisted disconnected lambda state on mount");
        } catch (persistError) {
          debugLogger.warn(
            "Failed to persist disconnected lambda state on mount",
            persistError
          );
        }
      } finally {
        if (!isCancelled) {
          setIsHealthChecking(false);
        }
        debugLogger.log("Lambda health check on mount finished");
      }
    };

    runHealthCheck();

    return () => {
      isCancelled = true;
      debugLogger.log("Config screen unmounted");
    };
  }, []);

  const connectLambdaHandler = async () => {
    if (runtimeModeSelection !== "lambda") {
      await ctx.alert(
        "Enable 'Also save records deleted from the API' before connecting a lambda deployment."
      );
      return;
    }

    const candidateUrl = deploymentUrlInput.trim();
    if (!candidateUrl) {
      setConnectionErrorSummary("Enter your lambda deployment URL.");
      setConnectionErrorDetails([]);
      setShowConnectionDetails(false);
      return;
    }

    debugLogger.log("Connecting lambda function from config", { candidateUrl });
    setIsConnecting(true);
    clearConnectionErrorState();

    try {
      const verificationResult = await verifyLambdaHealth({
        baseUrl: candidateUrl,
        environment: ctx.environment,
        phase: "config_connect",
        debug: debugEnabled,
      });
      debugLogger.log("Lambda connect health check succeeded", verificationResult);

      const webhookSyncResult = await ensureRecordBinWebhook({
        currentUserAccessToken: ctx.currentUserAccessToken,
        canManageWebhooks,
        environment: ctx.environment,
        lambdaBaseUrl: verificationResult.normalizedBaseUrl,
      });
      debugLogger.log("Record Bin webhook synchronized on connect", {
        action: webhookSyncResult.action,
        webhookId: webhookSyncResult.webhookId,
      });

      const connectedState = buildConnectedLambdaConnectionState(
        verificationResult.endpoint,
        verificationResult.checkedAt,
        "config_connect"
      );
      setConnectionState(connectedState);
      setDeploymentUrlInput(verificationResult.normalizedBaseUrl);
      setActiveDeploymentUrl(verificationResult.normalizedBaseUrl);
      clearConnectionErrorState();

      await persistPluginParameters({
        deploymentURL: verificationResult.normalizedBaseUrl,
        vercelURL: verificationResult.normalizedBaseUrl,
        lambdaConnection: connectedState,
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === "lambda",
      });
      debugLogger.log("Persisted connected lambda state from config connect");
      ctx.notice("Lambda function connected successfully.");
    } catch (connectError) {
      if (connectError instanceof LambdaHealthCheckError) {
        debugLogger.warn("Lambda connect health check failed", connectError);
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          connectError,
          candidateUrl,
          "config_connect"
        );
        applyDisconnectedState(disconnectedState);

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === "lambda",
          });
          debugLogger.log("Persisted disconnected lambda state from connect");
        } catch (persistError) {
          debugLogger.warn(
            "Failed to persist disconnected lambda state from connect",
            persistError
          );
        }
      } else if (isRecordBinWebhookSyncError(connectError)) {
        debugLogger.warn("Record Bin webhook synchronization failed", connectError);
        applyWebhookSyncErrorState(connectError, "connect");
      } else {
        debugLogger.error(
          "Unexpected error while connecting lambda function",
          connectError
        );
        setConnectionErrorSummary("Unexpected error while connecting lambda.");
        setConnectionErrorDetails([
          "Unexpected error while connecting lambda.",
          `Failure details: ${connectError instanceof Error ? connectError.message : "Unknown error"}`,
        ]);
        setShowConnectionDetails(false);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectCurrentLambdaHandler = async () => {
    const previousActiveDeploymentUrl = activeDeploymentUrl;

    debugLogger.log("Disconnecting current lambda function", {
      activeDeploymentUrl,
    });

    setIsDisconnecting(true);
    clearConnectionErrorState();

    let webhookWasRemoved = false;

    try {
      const webhookRemovalResult = await removeRecordBinWebhook({
        currentUserAccessToken: ctx.currentUserAccessToken,
        canManageWebhooks,
        environment: ctx.environment,
      });
      webhookWasRemoved = webhookRemovalResult.action === "deleted";
      debugLogger.log("Record Bin webhook synchronized on disconnect", {
        action: webhookRemovalResult.action,
        webhookId: webhookRemovalResult.webhookId,
      });

      await persistPluginParameters({
        deploymentURL: "",
        vercelURL: "",
        lambdaConnection: null,
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === "lambda",
      });
      setDeploymentUrlInput("");
      setActiveDeploymentUrl("");
      setConnectionState(undefined);
      clearConnectionErrorState();
      debugLogger.log("Current lambda function disconnected");
      ctx.notice("Current lambda function has been disconnected.");
    } catch (disconnectError) {
      if (webhookWasRemoved && previousActiveDeploymentUrl.trim()) {
        try {
          const webhookRestoreResult = await ensureRecordBinWebhook({
            currentUserAccessToken: ctx.currentUserAccessToken,
            canManageWebhooks,
            environment: ctx.environment,
            lambdaBaseUrl: previousActiveDeploymentUrl,
          });
          debugLogger.warn(
            "Restored Record Bin webhook after disconnect failure",
            webhookRestoreResult
          );
        } catch (restoreError) {
          debugLogger.error(
            "Failed to restore Record Bin webhook after disconnect failure",
            restoreError
          );
        }
      }

      if (isRecordBinWebhookSyncError(disconnectError)) {
        debugLogger.warn(
          "Failed to synchronize Record Bin webhook on disconnect",
          disconnectError
        );
        applyWebhookSyncErrorState(disconnectError, "disconnect");
      } else {
        debugLogger.warn(
          "Failed to disconnect current lambda function",
          disconnectError
        );
        setConnectionErrorSummary("Could not disconnect the current lambda.");
        setConnectionErrorDetails([
          "Could not disconnect the current lambda function.",
          `Failure details: ${disconnectError instanceof Error ? disconnectError.message : "Unknown error"}`,
        ]);
        setShowConnectionDetails(false);
      }

      await ctx.alert("Could not disconnect the current lambda function.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleDeployProviderClick = (provider: DeployProvider) => {
    const option = DEPLOY_PROVIDER_OPTIONS.find(
      (candidate) => candidate.provider === provider
    );
    if (!option) {
      return;
    }

    debugLogger.log("Opening deploy helper from config", { provider });
    window.open(option.url, "_blank", "noreferrer");
  };

  const deletionHandler = async () => {
    const userInput = parseInt(numberOfDays as string, 10);
    debugLogger.log("Saving plugin settings", {
      numberOfDays,
      parsedNumberOfDays: userInput,
      debugEnabled,
      runtimeModeSelection,
    });

    if (isNaN(userInput)) {
      setError("Days must be an integer number");
      debugLogger.warn("Cannot save settings: numberOfDays is not a number");
      return;
    }

    const hasConnectedLambdaForSave =
      runtimeModeSelection !== "lambda" ||
      (activeDeploymentUrl.trim().length > 0 &&
        connectionState?.status === "connected" &&
        !isHealthChecking &&
        !isConnecting);
    if (!hasConnectedLambdaForSave) {
      await ctx.alert(
        "Cannot save while 'Also save records deleted from the API' is enabled unless the Lambda URL is connected and ping status is Connected."
      );
      return;
    }

    setLoading(true);

    try {
      let persistedDeploymentUrl = activeDeploymentUrl.trim();
      let persistedConnectionState = connectionState ?? null;

      if (runtimeModeSelection === "lambdaless") {
        debugLogger.log(
          "Lambda-less mode selected: synchronizing managed webhooks and clearing lambda URL"
        );
        await removeManagedWebhooksForLambdaLessMode({
          trigger: "settings_save",
          notifyOnFailure: true,
        });

        persistedDeploymentUrl = "";
        persistedConnectionState = null;
        setDeploymentUrlInput("");
        setActiveDeploymentUrl("");
        setConnectionState(undefined);
        clearConnectionErrorState();
      }

      await persistPluginParameters({
        debug: debugEnabled,
        automaticBinCleanup: { numberOfDays: userInput, timeStamp: "" },
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === "lambda",
        deploymentURL: persistedDeploymentUrl,
        vercelURL: persistedDeploymentUrl,
        lambdaConnection: persistedConnectionState,
      });
      debugLogger.log("Plugin settings saved", {
        numberOfDays: userInput,
        runtimeModeSelection,
      });

      ctx.notice(
        `Settings saved. Runtime mode: ${runtimeModeSelection === "lambda" ? "Lambda-full" : "Lambda-less"}. All records older than ${numberOfDays} days in the bin will be daily deleted. Debug logging is ${debugEnabled ? "enabled" : "disabled"}.`
      );
      setSavedFormValues({
        numberOfDays: String(userInput),
        debugEnabled,
        runtimeMode: runtimeModeSelection,
      });
    } catch (saveError) {
      debugLogger.warn("Failed to save plugin settings", saveError);
      await ctx.alert("Could not save plugin settings.");
    } finally {
      setLoading(false);
    }
  };

  const isLambdaFullModeEnabled = runtimeModeSelection === "lambda";
  const pingIndicator = isHealthChecking || isConnecting
    ? {
        label: "Checking ping...",
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
  const lambdaActionButtonStyle = {
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
    textAlign: "left",
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
  const advancedSettingsStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-m)",
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
  const hasUnsavedChanges =
    numberOfDays !== savedFormValues.numberOfDays ||
    debugEnabled !== savedFormValues.debugEnabled ||
    runtimeModeSelection !== savedFormValues.runtimeMode;
  const canSaveWithLambdaMode =
    !isLambdaFullModeEnabled ||
    (hasActiveDeploymentUrl &&
      connectionState?.status === "connected" &&
      !isHealthChecking &&
      !isConnecting);
  const lambdaSaveBlockReason = !isLambdaFullModeEnabled
    ? ""
    : !hasActiveDeploymentUrl
      ? "To save with API capture enabled, connect a Lambda URL first."
      : isHealthChecking || isConnecting
        ? "Wait for the Lambda ping check to finish."
        : connectionState?.status !== "connected"
          ? "To save with API capture enabled, Lambda status must be Connected."
          : "";

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
              placeholder="https://record-bin.example.com/"
              onChange={(newValue) => {
                setDeploymentUrlInput(newValue);
                clearConnectionErrorState();
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
              <Dropdown
                style={{ flex: "1 1 0" }}
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
              <Button
                onClick={disconnectCurrentLambdaHandler}
                buttonType="negative"
                disabled={
                  isDisconnecting || isHealthChecking || !activeDeploymentUrl.trim()
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

        <h2
          style={{
            marginTop: 0,
            marginBottom: "var(--spacing-s)",
            fontSize: "var(--font-size-l)",
          }}
        >
          Bin cleanup settings
        </h2>
        <Form>
          <TextField
            error={error}
            required
            name="numberOfDays"
            id="numberOfDays"
            label="Delete trashed records older than (days)"
            value={numberOfDays}
            onChange={(event) => {
              setNumberOfDays(event);
              setError("");
            }}
          />
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
                  name="lambdaMode"
                  id="lambdaMode"
                  label="Also save records deleted from the API"
                  hint="If you do not know what Serverless Functions are, keep this disabled"
                  value={isLambdaFullModeEnabled}
                  switchInputProps={{
                    disabled: lambdaSetupDisabled,
                  }}
                  onChange={(newValue) => {
                    setRuntimeModeSelection(newValue ? "lambda" : "lambdaless");
                    clearConnectionErrorState();
                  }}
                />
              </div>
              <p style={subtleTextStyle}>
                <a
                  href={`${PLUGIN_README_URL}#runtime-modes`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Runtime mode guide and differences
                </a>
              </p>
              {isLambdaFullModeEnabled && (
                <p style={subtleTextStyle}>
                  To capture API deletions, connect a Lambda function above.
                </p>
              )}
              {runtimeModeSelection === "lambdaless" && hasActiveDeploymentUrl && (
                <p style={subtleTextStyle}>
                  Lambda is currently connected. Click Save to complete the switch to
                  Lambda-less and remove the managed webhook.
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
              Open Advanced settings to configure API capture before saving.
            </p>
          )}
          <Button
            onClick={deletionHandler}
            fullWidth
            buttonType={isLoading ? "muted" : "primary"}
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

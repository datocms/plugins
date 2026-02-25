import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import {
  Button,
  Canvas,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  Form,
  SwitchField,
  TextField,
} from "datocms-react-ui";
import { useEffect, useState } from "react";
import {
  automaticBinCleanupObject,
  LambdaConnectionState,
} from "../types/types";
import {
  DEPLOY_PROVIDER_OPTIONS,
  DeployProvider,
} from "../utils/deployProviders";
import { createDebugLogger, isDebugEnabled } from "../utils/debugLogger";
import { getDeploymentUrlFromParameters } from "../utils/getDeploymentUrlFromParameters";
import {
  ensureRecordBinWebhook,
  getRecordBinWebhookSyncErrorDetails,
  isRecordBinWebhookSyncError,
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
  const [savedFormValues, setSavedFormValues] = useState({
    numberOfDays: initialNumberOfDays,
    debugEnabled: initialDebugEnabled,
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

  useEffect(() => {
    let isCancelled = false;
    debugLogger.log("Config screen mounted", {
      initialDebugEnabled,
      hasInitialConnectionState: !!initialConnectionState,
    });

    const runHealthCheck = async () => {
      setIsHealthChecking(true);

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
          await persistPluginParameters({ lambdaConnection: null });
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
          await persistPluginParameters({ lambdaConnection: disconnectedState });
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
          await persistPluginParameters({ lambdaConnection: disconnectedState });
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
    });

    if (isNaN(userInput)) {
      setError("Days must be an integer number");
      debugLogger.warn("Cannot save settings: numberOfDays is not a number");
      return;
    }

    setLoading(true);

    try {
      await persistPluginParameters({
        debug: debugEnabled,
        automaticBinCleanup: { numberOfDays: userInput, timeStamp: "" },
        lambdaConnection: connectionState ?? null,
      });
      debugLogger.log("Plugin settings saved", { numberOfDays: userInput });

      ctx.notice(
        `All records older than ${numberOfDays} days in the bin will be daily deleted. Debug logging is ${debugEnabled ? "enabled" : "disabled"}.`
      );
      setSavedFormValues({
        numberOfDays: String(userInput),
        debugEnabled,
      });
    } catch (saveError) {
      debugLogger.warn("Failed to save plugin settings", saveError);
      await ctx.alert("Could not save plugin settings.");
    } finally {
      setLoading(false);
    }
  };

  const pingIndicator = isHealthChecking || isConnecting
    ? { label: "Checking ping...", color: "#f39c12" }
    : connectionState?.status === "connected"
      ? { label: "Connected (ping successful)", color: "#1f8f45" }
      : connectionState?.status === "disconnected"
        ? { label: "Disconnected (ping failed)", color: "#c0392b" }
        : activeDeploymentUrl
          ? { label: "Connection pending", color: "#6b7280" }
          : {
              label: "Disconnected (no lambda URL configured)",
              color: "#6b7280",
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
  const lambdaSectionFont =
    "'Inter', 'Avenir Next', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
  const lambdaActionButtonStyle = {
    width: "100%",
    height: "40px",
    fontSize: "0.95rem",
    fontWeight: 500,
    lineHeight: "1",
    padding: "0 16px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    flex: "1 1 0",
    whiteSpace: "nowrap",
  };

  return (
    <Canvas ctx={ctx}>
      <div
        style={{
          maxWidth: "760px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            border: "1px solid #d8dde6",
            borderRadius: "12px",
            background: "#fff",
            padding: "24px",
            marginBottom: "20px",
            boxShadow: "0 1px 2px rgba(16, 24, 40, 0.06)",
            textAlign: "left",
            fontFamily: lambdaSectionFont,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "1.35rem" }}>
            Lambda Setup
          </h2>
          <p style={{ margin: "0 0 12px", color: "#374151", fontSize: "0.92rem" }}>
            <strong>Current URL:</strong>{" "}
            <span style={{ wordBreak: "break-all", color: "#111827", fontWeight: 600 }}>
              {activeDeploymentUrl || "No lambda function connected."}
            </span>
          </p>
          <p
            style={{
              display: "flex",
              justifyContent: "flex-start",
              alignItems: "center",
              gap: "8px",
              marginTop: 0,
              marginBottom: "4px",
              fontSize: "0.87rem",
              color: "#4b5563",
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
          <p style={{ color: "#6b7280", margin: "0 0 18px", fontSize: "0.82rem" }}>
            Status is based on the /api/datocms/plugin-health ping.
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
              gap: "10px",
              marginTop: "16px",
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

        {connectionErrorSummary && (
          <div
            style={{
              border: "1px solid #f7b4ad",
              borderRadius: "10px",
              background: "#fff6f5",
              padding: "14px",
              marginBottom: "12px",
            }}
          >
            <p style={{ marginTop: 0, marginBottom: "8px" }}>
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
              border: "1px solid #f7b4ad",
              borderRadius: "10px",
              background: "#fffdfd",
              padding: "14px",
              marginBottom: "20px",
              textAlign: "left",
            }}
          >
            {connectionErrorDetails.map((detail, index) => (
              <p key={`config-health-error-${index}`}>{detail}</p>
            ))}
          </div>
        )}

        <h2 style={{ marginBottom: "8px" }}>
          Always delete all trashed records older than
        </h2>
        <Form>
          <TextField
            error={error}
            required
            name="numberOfDays"
            id="numberOfDays"
            label="Days"
            value={numberOfDays}
            onChange={(event) => {
              setNumberOfDays(event);
              setError("");
            }}
          />
          <SwitchField
            name="debug"
            id="debug"
            label="Enable debug logs"
            hint="When enabled, plugin events and requests are logged to the browser console."
            value={debugEnabled}
            onChange={(newValue) => setDebugEnabled(newValue)}
          />
          <Button
            onClick={deletionHandler}
            fullWidth
            buttonType={isLoading ? "muted" : "primary"}
            disabled={
              isLoading ||
              isDisconnecting ||
              isConnecting ||
              (numberOfDays === savedFormValues.numberOfDays &&
                debugEnabled === savedFormValues.debugEnabled)
            }
          >
            Save
          </Button>
        </Form>
      </div>
    </Canvas>
  );
}

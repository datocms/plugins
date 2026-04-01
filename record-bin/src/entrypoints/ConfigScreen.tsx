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
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { LambdaConnectionState } from '../types/types';
import { createDebugLogger, isDebugEnabled } from '../utils/debugLogger';
import {
  DEPLOY_PROVIDER_OPTIONS,
  type DeployProvider,
  PLUGIN_README_URL,
} from '../utils/deployProviders';
import { getDeploymentUrlFromParameters } from '../utils/getDeploymentUrlFromParameters';
import { getRuntimeMode, type RuntimeMode } from '../utils/getRuntimeMode';
import {
  ensureRecordBinWebhook,
  getRecordBinWebhookSyncErrorDetails,
  isRecordBinWebhookSyncError,
  type RecordBinWebhookSyncError,
  removeAllManagedRecordBinWebhooks,
  removeRecordBinWebhook,
} from '../utils/recordBinWebhook';
import {
  buildConnectedLambdaConnectionState,
  buildDisconnectedLambdaConnectionState,
  getLambdaConnectionErrorDetails,
  LambdaHealthCheckError,
  verifyLambdaHealth,
} from '../utils/verifyLambdaHealth';

const DEFAULT_CONNECTION_ERROR_SUMMARY =
  'Could not validate the Record Bin lambda deployment.';

const getConnectionErrorSummary = (
  connection?: LambdaConnectionState,
): string => {
  if (!connection || connection.status !== 'disconnected') {
    return '';
  }

  return connection.errorMessage || DEFAULT_CONNECTION_ERROR_SUMMARY;
};

const getRecordBinPingIndicator = ({
  isHealthChecking,
  isConnecting,
  connectionState,
  activeDeploymentUrl,
}: {
  isHealthChecking: boolean;
  isConnecting: boolean;
  connectionState: LambdaConnectionState | undefined;
  activeDeploymentUrl: string;
}): { label: string; color: string } => {
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

const getRecordBinConnectButtonLabel = (
  isConnecting: boolean,
  hasActiveDeploymentUrl: boolean,
): string => {
  if (isConnecting) {
    return hasActiveDeploymentUrl ? 'Changing Lambda URL...' : 'Connecting...';
  }
  return hasActiveDeploymentUrl ? 'Change Lambda URL' : 'Connect';
};

const getLambdaSaveBlockReason = ({
  isLambdaFullModeEnabled,
  hasActiveDeploymentUrl,
  isHealthChecking,
  isConnecting,
  connectionState,
}: {
  isLambdaFullModeEnabled: boolean;
  hasActiveDeploymentUrl: boolean;
  isHealthChecking: boolean;
  isConnecting: boolean;
  connectionState: LambdaConnectionState | undefined;
}): string => {
  if (!isLambdaFullModeEnabled) {
    return '';
  }
  if (!hasActiveDeploymentUrl) {
    return 'To save with API capture enabled, connect a Lambda URL first.';
  }
  if (isHealthChecking || isConnecting) {
    return 'Wait for the Lambda ping check to finish.';
  }
  if (connectionState?.status !== 'connected') {
    return 'To save with API capture enabled, Lambda status must be Connected.';
  }
  return '';
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

const getInitialConnectionErrorSummary = (
  hasInitialConnectionErrorDetails: boolean,
  initialConnectionState: LambdaConnectionState | undefined,
): string => {
  if (!hasInitialConnectionErrorDetails) {
    return '';
  }
  return getConnectionErrorSummary(initialConnectionState);
};

const computeCanSaveWithLambdaMode = ({
  isLambdaFullModeEnabled,
  hasActiveDeploymentUrl,
  connectionStatus,
  isHealthChecking,
  isConnecting,
}: {
  isLambdaFullModeEnabled: boolean;
  hasActiveDeploymentUrl: boolean;
  connectionStatus: string | undefined;
  isHealthChecking: boolean;
  isConnecting: boolean;
}): boolean => {
  if (!isLambdaFullModeEnabled) {
    return true;
  }
  return (
    hasActiveDeploymentUrl &&
    connectionStatus === 'connected' &&
    !isHealthChecking &&
    !isConnecting
  );
};

const computeHasUnsavedChanges = (
  current: { debugEnabled: boolean; runtimeMode: string },
  saved: { debugEnabled: boolean; runtimeMode: string },
): boolean => {
  return (
    current.debugEnabled !== saved.debugEnabled ||
    current.runtimeMode !== saved.runtimeMode
  );
};

const LAMBDA_ACTION_BUTTON_STYLE: React.CSSProperties = {
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

const CARD_STYLE: React.CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  background: '#fff',
  padding: 'var(--spacing-l)',
  marginBottom: 'var(--spacing-l)',
  textAlign: 'left',
};

const SUBTLE_TEXT_STYLE: React.CSSProperties = {
  margin: 0,
  color: 'var(--light-body-color)',
  fontSize: 'var(--font-size-xs)',
};

const INFO_TEXT_STYLE: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 'var(--spacing-s)',
  color: 'var(--base-body-color)',
  fontSize: 'var(--font-size-s)',
};

const ADVANCED_SETTINGS_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--spacing-m)',
};

const SWITCH_FIELD_NO_HINT_GAP_STYLE: React.CSSProperties = {
  '--spacing-s': '0',
} as React.CSSProperties;

const SWITCH_FIELD_NO_HINT_GAP_WITH_EXTRA_SPACING: React.CSSProperties = {
  '--spacing-s': '0',
  marginBottom: '0.25rem',
} as React.CSSProperties;

const computeShowConnectionError = (
  isLambdaFullModeEnabled: boolean,
  connectionErrorSummary: string,
): boolean => isLambdaFullModeEnabled && connectionErrorSummary.length > 0;

const computeShowConnectionErrorDetails = (
  isLambdaFullModeEnabled: boolean,
  showConnectionDetails: boolean,
  errorDetailsCount: number,
): boolean =>
  isLambdaFullModeEnabled && showConnectionDetails && errorDetailsCount > 0;

const computeShowLambdaLessWarning = (
  runtimeModeSelection: string,
  hasActiveDeploymentUrl: boolean,
): boolean => runtimeModeSelection === 'lambdaless' && hasActiveDeploymentUrl;

const computeShowSaveBlockOutsideAdvanced = (
  showAdvancedSettings: boolean,
  lambdaSaveBlockReason: string,
): boolean => !showAdvancedSettings && lambdaSaveBlockReason.length > 0;

const computeSaveButtonDisabled = ({
  isLoading,
  isDisconnecting,
  isConnecting,
  canSaveWithLambdaMode,
  hasUnsavedChanges,
}: {
  isLoading: boolean;
  isDisconnecting: boolean;
  isConnecting: boolean;
  canSaveWithLambdaMode: boolean;
  hasUnsavedChanges: boolean;
}): boolean =>
  isLoading ||
  isDisconnecting ||
  isConnecting ||
  !canSaveWithLambdaMode ||
  !hasUnsavedChanges;

const computeLambdaActionButtonsDisabled = (
  isConnecting: boolean,
  isHealthChecking: boolean,
  isDisconnecting: boolean,
): boolean => isConnecting || isHealthChecking || isDisconnecting;

const computeDislambdaActionButtonsDisabled = (
  isDisconnecting: boolean,
  isHealthChecking: boolean,
  activeDeploymentUrl: string,
): boolean =>
  isDisconnecting || isHealthChecking || !activeDeploymentUrl.trim();

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const initialConnectionState = (ctx.plugin.attributes.parameters
    .lambdaConnection ?? undefined) as LambdaConnectionState | undefined;
  const initialRuntimeMode = getRuntimeMode(ctx.plugin.attributes.parameters);
  const initialDeploymentUrl = getDeploymentUrlFromParameters(
    ctx.plugin.attributes.parameters,
  );
  const initialDebugEnabled = isDebugEnabled(ctx.plugin.attributes.parameters);
  const hasInitialConnectionErrorDetails =
    checkHasInitialConnectionErrorDetails(
      initialDeploymentUrl,
      initialConnectionState,
    );

  const [debugEnabled, setDebugEnabled] = useState(initialDebugEnabled);
  const [runtimeModeSelection, setRuntimeModeSelection] =
    useState<RuntimeMode>(initialRuntimeMode);
  const [savedFormValues, setSavedFormValues] = useState({
    debugEnabled: initialDebugEnabled,
    runtimeMode: initialRuntimeMode,
  });
  const [isLoading, setLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [deploymentUrlInput, setDeploymentUrlInput] =
    useState(initialDeploymentUrl);
  const [activeDeploymentUrl, setActiveDeploymentUrl] =
    useState(initialDeploymentUrl);
  const [connectionState, setConnectionState] = useState<
    LambdaConnectionState | undefined
  >(initialConnectionState);
  const [connectionErrorSummary, setConnectionErrorSummary] = useState(
    getInitialConnectionErrorSummary(
      hasInitialConnectionErrorDetails,
      initialConnectionState,
    ),
  );
  const [connectionErrorDetails, setConnectionErrorDetails] = useState<
    string[]
  >(
    hasInitialConnectionErrorDetails
      ? getLambdaConnectionErrorDetails(initialConnectionState)
      : [],
  );
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const debugLogger = createDebugLogger(debugEnabled, 'ConfigScreen');

  const persistPluginParameters = useCallback(
    async (
      updates: Record<string, unknown>,
      options?: { dropAutomaticBinCleanup?: boolean },
    ) => {
      const nextParameters = {
        ...ctx.plugin.attributes.parameters,
        ...updates,
      } as Record<string, unknown>;

      if (options?.dropAutomaticBinCleanup) {
        delete nextParameters.automaticBinCleanup;
      }

      await ctx.updatePluginParameters(nextParameters);
    },
    [ctx],
  );

  const clearConnectionErrorState = useCallback(() => {
    setConnectionErrorSummary('');
    setConnectionErrorDetails([]);
    setShowConnectionDetails(false);
  }, []);

  const applyDisconnectedState = useCallback((state: LambdaConnectionState) => {
    setConnectionState(state);
    setConnectionErrorSummary(getConnectionErrorSummary(state));
    setConnectionErrorDetails(getLambdaConnectionErrorDetails(state));
    setShowConnectionDetails(false);
  }, []);

  const applyWebhookSyncErrorState = useCallback(
    (error: RecordBinWebhookSyncError, operation: 'connect' | 'disconnect') => {
      setConnectionErrorSummary(error.message);
      setConnectionErrorDetails(
        getRecordBinWebhookSyncErrorDetails(error, operation),
      );
      setShowConnectionDetails(false);
    },
    [],
  );

  const canManageWebhooks =
    ctx.currentRole?.meta?.final_permissions?.can_manage_webhooks === true;

  const removeManagedWebhooksForLambdaLessMode = useCallback(
    async ({
      trigger,
      notifyOnFailure,
    }: {
      trigger: 'config_mount' | 'settings_save';
      notifyOnFailure: boolean;
    }) => {
      try {
        const webhookRemovalResult = await removeAllManagedRecordBinWebhooks({
          currentUserAccessToken: ctx.currentUserAccessToken,
          canManageWebhooks,
          environment: ctx.environment,
        });
        debugLogger.log(
          'Managed Record Bin webhooks synchronized in Lambda-less mode',
          {
            trigger,
            action: webhookRemovalResult.action,
            webhookIds: webhookRemovalResult.webhookIds,
          },
        );
      } catch (webhookRemovalError) {
        debugLogger.warn(
          'Could not synchronize managed Record Bin webhooks in Lambda-less mode',
          webhookRemovalError,
        );
        if (notifyOnFailure) {
          await ctx.notice(
            "Runtime was saved as Lambda-less, but one or more managed '🗑 Record Bin' webhooks could not be removed automatically. Remove them manually if needed.",
          );
        }
      }
    },
    [canManageWebhooks, ctx, debugLogger],
  );

  const runMountHealthCheckForUrl = useCallback(
    async ({
      configuredDeploymentUrl,
      isCancelled,
    }: {
      configuredDeploymentUrl: string;
      isCancelled: () => boolean;
    }) => {
      try {
        const verificationResult = await verifyLambdaHealth({
          baseUrl: configuredDeploymentUrl,
          environment: ctx.environment,
          phase: 'config_mount',
          debug: debugEnabled,
        });
        debugLogger.log('Lambda health check succeeded', verificationResult);

        const connectedState = buildConnectedLambdaConnectionState(
          verificationResult.endpoint,
          verificationResult.checkedAt,
          'config_mount',
        );

        if (!isCancelled()) {
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
            lambdaFullMode: runtimeModeSelection === 'lambda',
          });
          debugLogger.log('Persisted connected lambda state on mount');
        } catch (persistError) {
          debugLogger.warn(
            'Failed to persist connected lambda state on mount',
            persistError,
          );
        }
      } catch (healthCheckError) {
        debugLogger.warn(
          'Lambda health check failed on mount',
          healthCheckError,
        );
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          healthCheckError,
          configuredDeploymentUrl,
          'config_mount',
        );

        if (!isCancelled()) {
          applyDisconnectedState(disconnectedState);
        }

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === 'lambda',
          });
          debugLogger.log('Persisted disconnected lambda state on mount');
        } catch (persistError) {
          debugLogger.warn(
            'Failed to persist disconnected lambda state on mount',
            persistError,
          );
        }
      } finally {
        if (!isCancelled()) {
          setIsHealthChecking(false);
        }
        debugLogger.log('Lambda health check on mount finished');
      }
    },
    [
      applyDisconnectedState,
      clearConnectionErrorState,
      ctx.environment,
      debugEnabled,
      debugLogger,
      persistPluginParameters,
      runtimeModeSelection,
    ],
  );

  const runMountHealthCheck = useCallback(
    async (isCancelled: () => boolean) => {
      setIsHealthChecking(true);

      if (initialRuntimeMode !== 'lambda') {
        debugLogger.log(
          'Skipping lambda health check because Lambda-full mode is not selected',
        );
        await removeManagedWebhooksForLambdaLessMode({
          trigger: 'config_mount',
          notifyOnFailure: false,
        });
        if (!isCancelled()) {
          setIsHealthChecking(false);
        }
        return;
      }

      const configuredDeploymentUrl = getDeploymentUrlFromParameters(
        ctx.plugin.attributes.parameters,
      );
      if (!isCancelled()) {
        setDeploymentUrlInput(configuredDeploymentUrl);
        setActiveDeploymentUrl(configuredDeploymentUrl);
      }
      debugLogger.log('Running lambda health check', {
        phase: 'config_mount',
        deploymentUrl: configuredDeploymentUrl,
      });

      if (!configuredDeploymentUrl.trim()) {
        debugLogger.log(
          'Skipping lambda health check because no deployment URL is configured',
        );
        if (!isCancelled()) {
          setConnectionState(undefined);
          clearConnectionErrorState();
          setIsHealthChecking(false);
        }

        try {
          await persistPluginParameters({
            lambdaConnection: null,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === 'lambda',
          });
          debugLogger.log('Cleared lambda connection state without URL');
        } catch (persistError) {
          debugLogger.warn(
            'Failed to clear lambda connection state without URL',
            persistError,
          );
        }
        return;
      }

      await runMountHealthCheckForUrl({ configuredDeploymentUrl, isCancelled });
    },
    [
      clearConnectionErrorState,
      ctx.plugin.attributes.parameters,
      debugLogger,
      initialRuntimeMode,
      persistPluginParameters,
      removeManagedWebhooksForLambdaLessMode,
      runtimeModeSelection,
      runMountHealthCheckForUrl,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    debugLogger.log('Config screen mounted', {
      initialDebugEnabled,
      hasInitialConnectionState: !!initialConnectionState,
    });

    void runMountHealthCheck(isCancelled);

    return () => {
      cancelled = true;
      debugLogger.log('Config screen unmounted');
    };
  }, [
    debugLogger,
    initialConnectionState,
    initialDebugEnabled,
    runMountHealthCheck,
  ]);

  const handleConnectLambdaError = useCallback(
    async (connectError: unknown, candidateUrl: string) => {
      if (connectError instanceof LambdaHealthCheckError) {
        debugLogger.warn('Lambda connect health check failed', connectError);
        const disconnectedState = buildDisconnectedLambdaConnectionState(
          connectError,
          candidateUrl,
          'config_connect',
        );
        applyDisconnectedState(disconnectedState);

        try {
          await persistPluginParameters({
            lambdaConnection: disconnectedState,
            runtimeMode: runtimeModeSelection,
            lambdaFullMode: runtimeModeSelection === 'lambda',
          });
          debugLogger.log('Persisted disconnected lambda state from connect');
        } catch (persistError) {
          debugLogger.warn(
            'Failed to persist disconnected lambda state from connect',
            persistError,
          );
        }
      } else if (isRecordBinWebhookSyncError(connectError)) {
        debugLogger.warn(
          'Record Bin webhook synchronization failed',
          connectError,
        );
        applyWebhookSyncErrorState(connectError, 'connect');
      } else {
        debugLogger.error(
          'Unexpected error while connecting lambda function',
          connectError,
        );
        setConnectionErrorSummary('Unexpected error while connecting lambda.');
        setConnectionErrorDetails([
          'Unexpected error while connecting lambda.',
          `Failure details: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`,
        ]);
        setShowConnectionDetails(false);
      }
    },
    [
      applyDisconnectedState,
      applyWebhookSyncErrorState,
      debugLogger,
      persistPluginParameters,
      runtimeModeSelection,
    ],
  );

  const connectLambdaHandler = useCallback(async () => {
    if (runtimeModeSelection !== 'lambda') {
      await ctx.alert(
        "Enable 'Also save records deleted from the API' before connecting a lambda deployment.",
      );
      return;
    }

    const candidateUrl = deploymentUrlInput.trim();
    if (!candidateUrl) {
      setConnectionErrorSummary('Enter your lambda deployment URL.');
      setConnectionErrorDetails([]);
      setShowConnectionDetails(false);
      return;
    }

    debugLogger.log('Connecting lambda function from config', { candidateUrl });
    setIsConnecting(true);
    clearConnectionErrorState();

    try {
      const verificationResult = await verifyLambdaHealth({
        baseUrl: candidateUrl,
        environment: ctx.environment,
        phase: 'config_connect',
        debug: debugEnabled,
      });
      debugLogger.log(
        'Lambda connect health check succeeded',
        verificationResult,
      );

      const webhookSyncResult = await ensureRecordBinWebhook({
        currentUserAccessToken: ctx.currentUserAccessToken,
        canManageWebhooks,
        environment: ctx.environment,
        lambdaBaseUrl: verificationResult.normalizedBaseUrl,
      });
      debugLogger.log('Record Bin webhook synchronized on connect', {
        action: webhookSyncResult.action,
        webhookId: webhookSyncResult.webhookId,
      });

      const connectedState = buildConnectedLambdaConnectionState(
        verificationResult.endpoint,
        verificationResult.checkedAt,
        'config_connect',
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
        lambdaFullMode: runtimeModeSelection === 'lambda',
      });
      debugLogger.log('Persisted connected lambda state from config connect');
      ctx.notice('Lambda function connected successfully.');
    } catch (connectError) {
      await handleConnectLambdaError(connectError, candidateUrl);
    } finally {
      setIsConnecting(false);
    }
  }, [
    canManageWebhooks,
    clearConnectionErrorState,
    ctx,
    debugEnabled,
    debugLogger,
    deploymentUrlInput,
    handleConnectLambdaError,
    persistPluginParameters,
    runtimeModeSelection,
  ]);

  const handleDisconnectError = useCallback(
    async ({
      disconnectError,
      webhookWasRemoved,
      previousActiveDeploymentUrl,
    }: {
      disconnectError: unknown;
      webhookWasRemoved: boolean;
      previousActiveDeploymentUrl: string;
    }) => {
      if (webhookWasRemoved && previousActiveDeploymentUrl.trim()) {
        try {
          const webhookRestoreResult = await ensureRecordBinWebhook({
            currentUserAccessToken: ctx.currentUserAccessToken,
            canManageWebhooks,
            environment: ctx.environment,
            lambdaBaseUrl: previousActiveDeploymentUrl,
          });
          debugLogger.warn(
            'Restored Record Bin webhook after disconnect failure',
            webhookRestoreResult,
          );
        } catch (restoreError) {
          debugLogger.error(
            'Failed to restore Record Bin webhook after disconnect failure',
            restoreError,
          );
        }
      }

      if (isRecordBinWebhookSyncError(disconnectError)) {
        debugLogger.warn(
          'Failed to synchronize Record Bin webhook on disconnect',
          disconnectError,
        );
        applyWebhookSyncErrorState(disconnectError, 'disconnect');
      } else {
        debugLogger.warn(
          'Failed to disconnect current lambda function',
          disconnectError,
        );
        setConnectionErrorSummary('Could not disconnect the current lambda.');
        setConnectionErrorDetails([
          'Could not disconnect the current lambda function.',
          `Failure details: ${disconnectError instanceof Error ? disconnectError.message : 'Unknown error'}`,
        ]);
        setShowConnectionDetails(false);
      }

      await ctx.alert('Could not disconnect the current lambda function.');
    },
    [applyWebhookSyncErrorState, canManageWebhooks, ctx, debugLogger],
  );

  const disconnectCurrentLambdaHandler = useCallback(async () => {
    const previousActiveDeploymentUrl = activeDeploymentUrl;

    debugLogger.log('Disconnecting current lambda function', {
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
      webhookWasRemoved = webhookRemovalResult.action === 'deleted';
      debugLogger.log('Record Bin webhook synchronized on disconnect', {
        action: webhookRemovalResult.action,
        webhookId: webhookRemovalResult.webhookId,
      });

      await persistPluginParameters({
        deploymentURL: '',
        vercelURL: '',
        lambdaConnection: null,
        runtimeMode: runtimeModeSelection,
        lambdaFullMode: runtimeModeSelection === 'lambda',
      });
      setDeploymentUrlInput('');
      setActiveDeploymentUrl('');
      setConnectionState(undefined);
      clearConnectionErrorState();
      debugLogger.log('Current lambda function disconnected');
      ctx.notice('Current lambda function has been disconnected.');
    } catch (disconnectError) {
      await handleDisconnectError({
        disconnectError,
        webhookWasRemoved,
        previousActiveDeploymentUrl,
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [
    activeDeploymentUrl,
    canManageWebhooks,
    clearConnectionErrorState,
    ctx,
    debugLogger,
    handleDisconnectError,
    persistPluginParameters,
    runtimeModeSelection,
  ]);

  const handleDeployProviderClick = useCallback(
    (provider: DeployProvider) => {
      const option = DEPLOY_PROVIDER_OPTIONS.find(
        (candidate) => candidate.provider === provider,
      );
      if (!option) {
        return;
      }

      debugLogger.log('Opening deploy helper from config', { provider });
      window.open(option.url, '_blank', 'noreferrer');
    },
    [debugLogger],
  );

  const saveSettingsHandler = useCallback(async () => {
    debugLogger.log('Saving plugin settings', {
      debugEnabled,
      runtimeModeSelection,
    });

    const hasConnectedLambdaForSave =
      runtimeModeSelection !== 'lambda' ||
      (activeDeploymentUrl.trim().length > 0 &&
        connectionState?.status === 'connected' &&
        !isHealthChecking &&
        !isConnecting);
    if (!hasConnectedLambdaForSave) {
      await ctx.alert(
        "Cannot save while 'Also save records deleted from the API' is enabled unless the Lambda URL is connected and ping status is Connected.",
      );
      return;
    }

    setLoading(true);

    try {
      let persistedDeploymentUrl = activeDeploymentUrl.trim();
      let persistedConnectionState = connectionState ?? null;

      if (runtimeModeSelection === 'lambdaless') {
        debugLogger.log(
          'Lambda-less mode selected: synchronizing managed webhooks and clearing lambda URL',
        );
        await removeManagedWebhooksForLambdaLessMode({
          trigger: 'settings_save',
          notifyOnFailure: true,
        });

        persistedDeploymentUrl = '';
        persistedConnectionState = null;
        setDeploymentUrlInput('');
        setActiveDeploymentUrl('');
        setConnectionState(undefined);
        clearConnectionErrorState();
      }

      await persistPluginParameters(
        {
          debug: debugEnabled,
          runtimeMode: runtimeModeSelection,
          lambdaFullMode: runtimeModeSelection === 'lambda',
          deploymentURL: persistedDeploymentUrl,
          vercelURL: persistedDeploymentUrl,
          lambdaConnection: persistedConnectionState,
        },
        { dropAutomaticBinCleanup: true },
      );
      debugLogger.log('Plugin settings saved', {
        runtimeModeSelection,
      });

      ctx.notice(
        `Settings saved. Runtime mode: ${runtimeModeSelection === 'lambda' ? 'Lambda-full' : 'Lambda-less'}. Debug logging is ${debugEnabled ? 'enabled' : 'disabled'}.`,
      );
      setSavedFormValues({
        debugEnabled,
        runtimeMode: runtimeModeSelection,
      });
    } catch (saveError) {
      debugLogger.warn('Failed to save plugin settings', saveError);
      await ctx.alert('Could not save plugin settings.');
    } finally {
      setLoading(false);
    }
  }, [
    activeDeploymentUrl,
    clearConnectionErrorState,
    connectionState,
    ctx,
    debugEnabled,
    debugLogger,
    isConnecting,
    isHealthChecking,
    persistPluginParameters,
    removeManagedWebhooksForLambdaLessMode,
    runtimeModeSelection,
  ]);

  const isLambdaFullModeEnabled = runtimeModeSelection === 'lambda';
  const hasActiveDeploymentUrl = activeDeploymentUrl.trim().length > 0;
  const pingIndicator = getRecordBinPingIndicator({
    isHealthChecking,
    isConnecting,
    connectionState,
    activeDeploymentUrl,
  });
  const connectButtonLabel = getRecordBinConnectButtonLabel(
    isConnecting,
    hasActiveDeploymentUrl,
  );
  const disconnectButtonLabel = isDisconnecting
    ? 'Disconnecting...'
    : 'Disconnect';
  const lambdaSetupDisabled =
    isConnecting || isDisconnecting || isHealthChecking || isLoading;
  const hasUnsavedChanges = computeHasUnsavedChanges(
    { debugEnabled, runtimeMode: runtimeModeSelection },
    savedFormValues,
  );
  const canSaveWithLambdaMode = computeCanSaveWithLambdaMode({
    isLambdaFullModeEnabled,
    hasActiveDeploymentUrl,
    connectionStatus: connectionState?.status,
    isHealthChecking,
    isConnecting,
  });
  const lambdaSaveBlockReason = getLambdaSaveBlockReason({
    isLambdaFullModeEnabled,
    hasActiveDeploymentUrl,
    isHealthChecking,
    isConnecting,
    connectionState,
  });

  const showConnectionError = computeShowConnectionError(
    isLambdaFullModeEnabled,
    connectionErrorSummary,
  );
  const showConnectionErrorDetails = computeShowConnectionErrorDetails(
    isLambdaFullModeEnabled,
    showConnectionDetails,
    connectionErrorDetails.length,
  );
  const showLambdaLessWarning = computeShowLambdaLessWarning(
    runtimeModeSelection,
    hasActiveDeploymentUrl,
  );
  const showSaveBlockOutsideAdvanced = computeShowSaveBlockOutsideAdvanced(
    showAdvancedSettings,
    lambdaSaveBlockReason,
  );
  const saveButtonDisabled = computeSaveButtonDisabled({
    isLoading,
    isDisconnecting,
    isConnecting,
    canSaveWithLambdaMode,
    hasUnsavedChanges,
  });
  const lambdaActionButtonsDisabled = computeLambdaActionButtonsDisabled(
    isConnecting,
    isHealthChecking,
    isDisconnecting,
  );
  const dislambdaActionButtonsDisabled = computeDislambdaActionButtonsDisabled(
    isDisconnecting,
    isHealthChecking,
    activeDeploymentUrl,
  );

  return (
    <Canvas ctx={ctx}>
      <div
        style={{
          maxWidth: '760px',
          margin: '0 auto',
        }}
      >
        {isLambdaFullModeEnabled && (
          <div style={CARD_STYLE}>
            <h2
              style={{
                marginTop: 0,
                marginBottom: 'var(--spacing-s)',
                fontSize: 'var(--font-size-l)',
              }}
            >
              Lambda setup
            </h2>
            <p style={INFO_TEXT_STYLE}>
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
            <p
              style={{ ...SUBTLE_TEXT_STYLE, marginBottom: 'var(--spacing-l)' }}
            >
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
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'nowrap',
                width: '100%',
                gap: 'var(--spacing-s)',
                marginTop: 'var(--spacing-l)',
              }}
            >
              <Dropdown
                style={{ flex: '1 1 0' }}
                renderTrigger={({ onClick }) => (
                  <Button
                    buttonType="muted"
                    onClick={onClick}
                    disabled={lambdaActionButtonsDisabled}
                    style={LAMBDA_ACTION_BUTTON_STYLE}
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
                disabled={dislambdaActionButtonsDisabled}
                style={LAMBDA_ACTION_BUTTON_STYLE}
              >
                {disconnectButtonLabel}
              </Button>
              <Button
                buttonType="primary"
                onClick={connectLambdaHandler}
                disabled={lambdaActionButtonsDisabled}
                style={LAMBDA_ACTION_BUTTON_STYLE}
              >
                {connectButtonLabel}
              </Button>
            </div>
          </div>
        )}

        {showConnectionError && (
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

        {showConnectionErrorDetails && (
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

        <Form>
          <Section
            title="Advanced settings"
            collapsible={{
              isOpen: showAdvancedSettings,
              onToggle: () => setShowAdvancedSettings((current) => !current),
            }}
          >
            <div style={ADVANCED_SETTINGS_STYLE}>
              <div style={SWITCH_FIELD_NO_HINT_GAP_WITH_EXTRA_SPACING}>
                <SwitchField
                  name="debug"
                  id="debug"
                  label="Enable debug logs"
                  hint="When enabled, plugin events and requests are logged to the browser console."
                  value={debugEnabled}
                  onChange={(newValue) => setDebugEnabled(newValue)}
                />
              </div>
              <div style={SWITCH_FIELD_NO_HINT_GAP_STYLE}>
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
                    setRuntimeModeSelection(newValue ? 'lambda' : 'lambdaless');
                    clearConnectionErrorState();
                  }}
                />
              </div>
              <p style={SUBTLE_TEXT_STYLE}>
                <a
                  href={`${PLUGIN_README_URL}#runtime-modes`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Runtime mode guide and differences
                </a>
              </p>
              {isLambdaFullModeEnabled && (
                <p style={SUBTLE_TEXT_STYLE}>
                  To capture API deletions, connect a Lambda function above.
                </p>
              )}
              {showLambdaLessWarning && (
                <p style={SUBTLE_TEXT_STYLE}>
                  Lambda is currently connected. Click Save to complete the
                  switch to Lambda-less and remove the managed webhook.
                </p>
              )}
              {lambdaSaveBlockReason && (
                <p
                  style={{
                    ...SUBTLE_TEXT_STYLE,
                    color: 'var(--alert-color)',
                  }}
                >
                  {lambdaSaveBlockReason}
                </p>
              )}
            </div>
          </Section>
          {showSaveBlockOutsideAdvanced && (
            <p
              style={{
                ...SUBTLE_TEXT_STYLE,
                marginTop: 'var(--spacing-s)',
                color: 'var(--alert-color)',
              }}
            >
              Open Advanced settings to configure API capture before saving.
            </p>
          )}
          <Button
            onClick={saveSettingsHandler}
            fullWidth
            buttonType={isLoading ? 'muted' : 'primary'}
            disabled={saveButtonDisabled}
          >
            Save
          </Button>
        </Form>
      </div>
    </Canvas>
  );
}

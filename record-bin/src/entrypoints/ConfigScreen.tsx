import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InfoList from 'datocms-react-ui/InfoList';
import { Page } from 'datocms-react-ui/Page';
import Pill, { type PillTone } from 'datocms-react-ui/Pill';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { LambdaConnectionState } from '../types/types';
import { createDebugLogger, isDebugEnabled } from '../utils/debugLogger';
import {
  DEPLOY_PROVIDER_OPTIONS,
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
import s from './styles.module.css';

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

type DisabledReason = { reason: string } | undefined;

const getLambdaStatus = ({
  isHealthChecking,
  isConnecting,
  connectionState,
  activeDeploymentUrl,
}: {
  isHealthChecking: boolean;
  isConnecting: boolean;
  connectionState: LambdaConnectionState | undefined;
  activeDeploymentUrl: string;
}): { label: string; tone: PillTone } => {
  if (isHealthChecking || isConnecting) {
    return { label: 'Checking…', tone: 'neutral' };
  }
  if (connectionState?.status === 'connected') {
    return { label: 'Connected', tone: 'success' };
  }
  if (connectionState?.status === 'disconnected') {
    return { label: 'Disconnected', tone: 'warning' };
  }
  if (activeDeploymentUrl) {
    return { label: 'Not checked', tone: 'neutral' };
  }
  return { label: 'Not connected', tone: 'neutral' };
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

const getInitialConnectionErrorDetails = (
  hasDetails: boolean,
  state: LambdaConnectionState | undefined,
): string[] =>
  hasDetails && state ? getLambdaConnectionErrorDetails(state) : [];

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

const getConnectDisabled = ({
  isHealthChecking,
  isDisconnecting,
  deploymentUrlInput,
}: {
  isHealthChecking: boolean;
  isDisconnecting: boolean;
  deploymentUrlInput: string;
}): DisabledReason => {
  if (isHealthChecking) {
    return { reason: 'Wait for the connection check to finish.' };
  }
  if (isDisconnecting) {
    return { reason: 'Wait for the Lambda function to disconnect.' };
  }
  if (!deploymentUrlInput.trim()) {
    return { reason: 'Enter the URL of your Lambda function.' };
  }
  return undefined;
};

const getSaveDisabled = ({
  isDisconnecting,
  isConnecting,
  canSaveWithLambdaMode,
  lambdaSaveBlockReason,
  hasUnsavedChanges,
}: {
  isDisconnecting: boolean;
  isConnecting: boolean;
  canSaveWithLambdaMode: boolean;
  lambdaSaveBlockReason: string;
  hasUnsavedChanges: boolean;
}): DisabledReason => {
  if (isDisconnecting) {
    return { reason: 'Wait for the Lambda function to disconnect.' };
  }
  if (isConnecting) {
    return { reason: 'Wait for the Lambda function to connect.' };
  }
  if (!canSaveWithLambdaMode) {
    return { reason: lambdaSaveBlockReason };
  }
  if (!hasUnsavedChanges) {
    return { reason: 'There are no changes to save.' };
  }
  return undefined;
};

type LambdaFunctionGroupProps = {
  status: { label: string; tone: PillTone };
  showConnectionError: boolean;
  errorTone: 'warning' | 'danger';
  connectionErrorSummary: string;
  connectionErrorDetails: string[];
  showConnectionDetails: boolean;
  showConnectionErrorDetails: boolean;
  onToggleConnectionDetails: () => void;
  activeDeploymentUrl: string;
  disconnectDisabled: DisabledReason;
  onDisconnect: () => Promise<void>;
  deploymentUrlInput: string;
  onDeploymentUrlChange: (value: string | null) => void;
  connectLabel: string;
  connectDisabled: DisabledReason;
  onConnect: () => Promise<void>;
};

function LambdaFunctionGroup({
  status,
  showConnectionError,
  errorTone,
  connectionErrorSummary,
  connectionErrorDetails,
  showConnectionDetails,
  showConnectionErrorDetails,
  onToggleConnectionDetails,
  activeDeploymentUrl,
  disconnectDisabled,
  onDisconnect,
  deploymentUrlInput,
  onDeploymentUrlChange,
  connectLabel,
  connectDisabled,
  onConnect,
}: LambdaFunctionGroupProps) {
  const hasActiveDeploymentUrl = activeDeploymentUrl.trim().length > 0;

  return (
    <Page.Group
      title="Lambda function"
      tone={status.tone === 'warning' ? 'warning' : undefined}
      status={<Pill tone={status.tone}>{status.label}</Pill>}
      actions={
        <Dropdown triggerComponent={ButtonTrigger} tone="ghost" label="Deploy">
          <Dropdown.Menu placement="bottom-end">
            {DEPLOY_PROVIDER_OPTIONS.map((option) => (
              <Dropdown.Option key={option.provider} href={option.url} newTab>
                {option.label}
              </Dropdown.Option>
            ))}
          </Dropdown.Menu>
        </Dropdown>
      }
      footer={
        <div className={s.actions}>
          <Button
            label={connectLabel}
            onClick={onConnect}
            disabled={connectDisabled}
          />
          {hasActiveDeploymentUrl && (
            <Button
              tone="ghost"
              label="Disconnect"
              onClick={onDisconnect}
              disabled={disconnectDisabled}
            />
          )}
        </div>
      }
    >
      {showConnectionError && (
        <Callout tone={errorTone}>{connectionErrorSummary}</Callout>
      )}
      {showConnectionError && connectionErrorDetails.length > 0 && (
        <div className={s.block}>
          <Button
            tone="ghost"
            label={showConnectionDetails ? 'Hide details' : 'Show details'}
            onClick={onToggleConnectionDetails}
          />
          {showConnectionErrorDetails && (
            <div className={s.snippet}>
              <CodeSnippet
                ariaLabel="Error details"
                code={connectionErrorDetails.join('\n')}
                maxHeight={240}
              />
            </div>
          )}
        </div>
      )}
      {hasActiveDeploymentUrl && (
        <InfoList className={s.block}>
          <InfoList.Row title="Current URL">{activeDeploymentUrl}</InfoList.Row>
        </InfoList>
      )}
      <FieldWrapper
        label="Lambda URL"
        hint="The plugin pings /api/datocms/plugin-health at this URL to check the connection."
      >
        <StringInput
          code
          value={deploymentUrlInput}
          placeholder="https://record-bin.example.com/"
          onChange={onDeploymentUrlChange}
        />
      </FieldWrapper>
    </Page.Group>
  );
}

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const initialConnectionState = (ctx.plugin.attributes.parameters
    ?.lambdaConnection ?? undefined) as LambdaConnectionState | undefined;
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
    getInitialConnectionErrorDetails(
      hasInitialConnectionErrorDetails,
      initialConnectionState,
    ),
  );
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
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
          cmaBaseUrl: ctx.cmaBaseUrl,
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
          void ctx.customToast({
            type: 'warning',
            message:
              "Runtime was saved as Lambda-less, but one or more managed '🗑 Record Bin' webhooks could not be removed automatically. Remove them manually if needed.",
          });
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: The health check runs once, when the screen opens.
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
  }, []);

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
        cmaBaseUrl: ctx.cmaBaseUrl,
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
            cmaBaseUrl: ctx.cmaBaseUrl,
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
        cmaBaseUrl: ctx.cmaBaseUrl,
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

  const saveDisabled = getSaveDisabled({
    isDisconnecting,
    isConnecting,
    canSaveWithLambdaMode,
    lambdaSaveBlockReason,
    hasUnsavedChanges,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Enter in the Lambda URL field submits the form too
    if (saveDisabled || isLoading) {
      return;
    }

    void saveSettingsHandler();
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the switches start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      <form onSubmit={handleSubmit}>
        <Page.Section className={s.lastSection}>
          <FieldWrapper hint="Logs the plugin's events and requests to the browser console.">
            <SwitchInput
              label="Enable debug logs"
              value={debugEnabled}
              onChange={(value) => setDebugEnabled(Boolean(value))}
            />
          </FieldWrapper>
          <FieldWrapper
            hint="Needs a Lambda function that you deploy. If you don't know what serverless functions are, keep this off."
            docs={{
              label: 'Runtime modes',
              to: `${PLUGIN_README_URL}#runtime-modes`,
            }}
          >
            <SwitchInput
              label="Also save records deleted from the API"
              value={isLambdaFullModeEnabled}
              disabled={lambdaSetupDisabled}
              onChange={(value) => {
                setRuntimeModeSelection(value ? 'lambda' : 'lambdaless');
                clearConnectionErrorState();
              }}
            />
          </FieldWrapper>
          {/* Only for the API capture, thus right under its switch */}
          {isLambdaFullModeEnabled && (
            <LambdaFunctionGroup
              status={getLambdaStatus({
                isHealthChecking,
                isConnecting,
                connectionState,
                activeDeploymentUrl,
              })}
              showConnectionError={computeShowConnectionError(
                isLambdaFullModeEnabled,
                connectionErrorSummary,
              )}
              errorTone={
                connectionState?.status === 'disconnected'
                  ? 'warning'
                  : 'danger'
              }
              connectionErrorSummary={connectionErrorSummary}
              connectionErrorDetails={connectionErrorDetails}
              showConnectionDetails={showConnectionDetails}
              showConnectionErrorDetails={computeShowConnectionErrorDetails(
                isLambdaFullModeEnabled,
                showConnectionDetails,
                connectionErrorDetails.length,
              )}
              onToggleConnectionDetails={() =>
                setShowConnectionDetails((current) => !current)
              }
              activeDeploymentUrl={activeDeploymentUrl}
              disconnectDisabled={
                isHealthChecking
                  ? { reason: 'Wait for the connection check to finish.' }
                  : undefined
              }
              onDisconnect={disconnectCurrentLambdaHandler}
              deploymentUrlInput={deploymentUrlInput}
              onDeploymentUrlChange={(value) => {
                setDeploymentUrlInput(value ?? '');
                clearConnectionErrorState();
              }}
              connectLabel={hasActiveDeploymentUrl ? 'Change URL' : 'Connect'}
              connectDisabled={getConnectDisabled({
                isHealthChecking,
                isDisconnecting,
                deploymentUrlInput,
              })}
              onConnect={connectLambdaHandler}
            />
          )}
          {computeShowLambdaLessWarning(
            runtimeModeSelection,
            hasActiveDeploymentUrl,
          ) && (
            <Callout tone="warning">
              Saving switches to Lambda-less mode and removes the webhook of the
              connected Lambda function.
            </Callout>
          )}
        </Page.Section>
        <Button
          submit
          tone="primary"
          label="Save"
          busy={isLoading}
          disabled={saveDisabled}
        />
      </form>
    </Canvas>
  );
}

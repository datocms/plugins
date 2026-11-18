import type { ExecuteItemFormDropdownActionCtx } from 'datocms-plugin-sdk';
import type { errorObject } from '../types/types';
import { createBoundedFetch } from './boundedFetch';
import { createDebugLogger, isDebugEnabled } from './debugLogger';
import { getDeploymentUrlFromParameters } from './getDeploymentUrlFromParameters';
import { getRuntimeMode } from './getRuntimeMode';
import {
  isLambdaLessRestoreError,
  restoreRecordWithoutLambda,
} from './lambdaLessRestore';
import { isPackedRecordBinBody } from './recordBinStorage';
import {
  buildRestoreErrorPayload,
  isRestoreSuccessResponse,
  parseJsonStringSafely,
} from './restoreError';

/** The action of the record form's dropdown that restores a record of the bin. */
export const RESTORE_ACTION_ID = 'restoreRecord';

/** The modal that shows the full error of a failed restoration. */
export const ERROR_MODAL_ID = 'errorModal';

type DebugLogger = ReturnType<typeof createDebugLogger>;

function buildRecordEditPath(
  environment: string,
  isEnvironmentPrimary: boolean,
  modelId: string,
  recordId: string,
): string {
  const environmentPrefix = isEnvironmentPrimary
    ? ''
    : `/environments/${environment}`;
  return `${environmentPrefix}/editor/item_types/${modelId}/items/${recordId}`;
}

const parseLambdaRecordBody = async (
  rawRecordBody: unknown,
  debugLogger: DebugLogger,
  alertFn: (message: string) => Promise<unknown>,
): Promise<{ success: false } | { success: true; parsedBody: unknown }> => {
  try {
    const parsedBody =
      typeof rawRecordBody === 'string'
        ? JSON.parse(rawRecordBody)
        : rawRecordBody;
    return { success: true, parsedBody };
  } catch (error) {
    debugLogger.warn('Could not parse record_body JSON before restore', error);
    await alertFn('The record body is not valid JSON.');
    return { success: false };
  }
};

const executeRestoreViaLambda = async ({
  deploymentURL,
  parsedRecordBody,
  trashRecordId,
  debugLogger,
  alertFn,
  noticeFn,
  navigateTo,
  environment,
  isEnvironmentPrimary,
  setError,
}: {
  deploymentURL: string;
  parsedRecordBody: Record<string, unknown>;
  trashRecordId: string;
  debugLogger: DebugLogger;
  alertFn: (message: string) => Promise<unknown>;
  noticeFn: (message: string) => void;
  navigateTo: (path: string) => void;
  environment: string;
  isEnvironmentPrimary: boolean;
  setError: (error: errorObject) => void;
}): Promise<boolean> => {
  const parsedBody = { ...parsedRecordBody, trashRecordID: trashRecordId };
  const requestBody = JSON.stringify(parsedBody);
  debugLogger.log('Sending restoration request to lambda', {
    deploymentURL,
    requestBodyLength: requestBody.length,
  });

  let restoreResponse: Response;
  try {
    // A legacy lambda may commit a POST even if the response is lost. Bound the
    // wait, but never automatically repeat an unreconciled remote restoration.
    restoreResponse = await createBoundedFetch(60000)(deploymentURL, {
      method: 'POST',
      body: requestBody,
      headers: { Accept: '*/*', 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const restorationError = buildRestoreErrorPayload(error);
    setError(restorationError);
    debugLogger.warn(
      'Restoration request failed before receiving response',
      restorationError,
    );
    await alertFn(
      'The restore API did not confirm the result. Check whether the record was restored before trying again.',
    );
    return false;
  }

  debugLogger.log('Received restoration response', {
    status: restoreResponse.status,
  });

  const rawResponseBody = await restoreResponse.text();
  const parsedResponse = parseJsonStringSafely(rawResponseBody);

  if (!restoreResponse.ok || !isRestoreSuccessResponse(parsedResponse)) {
    const fallbackMessage = restoreResponse.ok
      ? 'The restore API returned an invalid success payload.'
      : `The restore API request failed with status ${restoreResponse.status}.`;
    const trimmedResponseBody = rawResponseBody.trim();
    const restorationError = buildRestoreErrorPayload(
      parsedResponse ?? rawResponseBody,
      {
        fullErrorPayload:
          trimmedResponseBody.length > 0 ? trimmedResponseBody : undefined,
        fallbackMessage,
      },
    );
    setError(restorationError);
    debugLogger.warn('Restoration request failed', {
      status: restoreResponse.status,
      restorationError,
    });
    await alertFn('The record could not be restored.');
    return false;
  }

  debugLogger.log('Restoration succeeded', {
    restoredRecordId: parsedResponse.restoredRecord.id,
    restoredModelId: parsedResponse.restoredRecord.modelID,
  });
  noticeFn('The record has been restored.');
  navigateTo(
    buildRecordEditPath(
      environment,
      isEnvironmentPrimary,
      parsedResponse.restoredRecord.modelID,
      parsedResponse.restoredRecord.id,
    ),
  );
  return true;
};

const executeRestoreWithoutLambda = async ({
  trashRecordId,
  parsedRecordBody,
  currentUserAccessToken,
  cmaBaseUrl,
  environment,
  debugLogger,
  alertFn,
  noticeFn,
  navigateTo,
  isEnvironmentPrimary,
  setError,
}: {
  trashRecordId: string;
  parsedRecordBody: unknown;
  currentUserAccessToken: string | null | undefined;
  cmaBaseUrl?: string;
  environment: string;
  debugLogger: DebugLogger;
  alertFn: (message: string) => Promise<unknown>;
  noticeFn: (message: string) => void;
  navigateTo: (path: string) => void;
  isEnvironmentPrimary: boolean;
  setError: (error: errorObject) => void;
}): Promise<void> => {
  debugLogger.log('Sending restoration request through Lambda-less runtime');

  let parsedResponse:
    | Awaited<ReturnType<typeof restoreRecordWithoutLambda>>
    | undefined;
  try {
    parsedResponse = await restoreRecordWithoutLambda({
      currentUserAccessToken,
      currentEnvironment: environment,
      cmaBaseUrl,
      recordBody: parsedRecordBody,
      trashRecordID: trashRecordId,
    });
  } catch (error) {
    if (isLambdaLessRestoreError(error)) {
      setError(error.restorationError);
      debugLogger.warn(
        'Lambda-less restoration request failed',
        error.restorationError,
      );
      await alertFn('The record could not be restored.');
      return;
    }
    throw error;
  }

  if (!parsedResponse) {
    return;
  }

  debugLogger.log('Lambda-less restoration succeeded', {
    restoredRecordId: parsedResponse.restoredRecord.id,
    restoredModelId: parsedResponse.restoredRecord.modelID,
  });
  if (parsedResponse.cleanupError) {
    debugLogger.warn(
      'Restored record archive cleanup failed',
      parsedResponse.cleanupError,
    );
    await alertFn(
      'The record was restored, but its archive could not be removed.',
    );
  }
  noticeFn('The record has been restored.');
  navigateTo(
    buildRecordEditPath(
      environment,
      isEnvironmentPrimary,
      parsedResponse.restoredRecord.modelID,
      parsedResponse.restoredRecord.id,
    ),
  );
};

const runLambdaModeRestore = async ({
  parsedRecordBody,
  pluginParameters,
  trashRecordId,
  debugLogger,
  alertFn,
  noticeFn,
  navigateTo,
  environment,
  isEnvironmentPrimary,
  setError,
}: {
  parsedRecordBody: unknown;
  pluginParameters: Record<string, unknown>;
  trashRecordId: string | undefined;
  debugLogger: DebugLogger;
  alertFn: (message: string) => Promise<unknown>;
  noticeFn: (message: string) => void;
  navigateTo: (path: string) => void;
  environment: string;
  isEnvironmentPrimary: boolean;
  setError: (error: errorObject) => void;
}): Promise<void> => {
  const deploymentURL = getDeploymentUrlFromParameters(pluginParameters);

  if (!deploymentURL) {
    debugLogger.warn('Missing deployment URL while restoring record');
    await alertFn('The plugin deployment URL is missing.');
    return;
  }

  const isInvalidBody =
    !parsedRecordBody ||
    typeof parsedRecordBody !== 'object' ||
    Array.isArray(parsedRecordBody);
  if (isInvalidBody) {
    debugLogger.warn('record_body must be a JSON object for lambda restore');
    await alertFn('The record body is not a valid restore payload.');
    return;
  }

  if (!trashRecordId) {
    debugLogger.warn('Missing trash record id in lambda restore');
    await alertFn('Could not determine the trash record to remove.');
    return;
  }

  await executeRestoreViaLambda({
    deploymentURL,
    parsedRecordBody: parsedRecordBody as Record<string, unknown>,
    trashRecordId,
    debugLogger,
    alertFn,
    noticeFn,
    navigateTo,
    environment,
    isEnvironmentPrimary,
    setError,
  });
};

/** One restoration at a time, as the record form's button allowed. */
let restorationInProgress = false;

/**
 * The host message for a failed restoration. When the failure has a full
 * error, the message offers it ("See the full error" opens it in a modal),
 * as the record form's button did under its message.
 */
function failureAlert(ctx: ExecuteItemFormDropdownActionCtx) {
  let failure: errorObject | undefined;
  const setError = (error: errorObject) => {
    failure = error;
  };
  const alertFn = async (message: string): Promise<unknown> => {
    const details = failure;
    failure = undefined;
    if (!details) return ctx.alert(message);
    // Not awaited: the toast stays until the user closes it.
    void ctx
      .customToast({
        type: 'alert',
        message,
        cta: { label: 'See the full error', value: 'details' },
      })
      .then((choice) =>
        choice === 'details'
          ? ctx.openModal({
              id: ERROR_MODAL_ID,
              title: 'Restoration error',
              width: 'l',
              parameters: { errorPayload: details.fullErrorPayload },
            })
          : undefined,
      );
    return undefined;
  };
  return { setError, alertFn };
}

/**
 * Restores the record that the open record of the bin archives, from its
 * `record_body` as the form holds it: through the deployed Lambda for its
 * legacy archives, else through the API. It then opens the restored record.
 */
export async function restoreRecordFromBin(
  ctx: ExecuteItemFormDropdownActionCtx,
): Promise<void> {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    'restoreRecordFromBin',
  );
  if (restorationInProgress) return;
  restorationInProgress = true;
  debugLogger.log('Starting record restoration', {
    itemId: ctx.item?.id,
    itemTypeId: ctx.itemType.id,
  });

  const runtimeMode = getRuntimeMode(ctx.plugin.attributes.parameters);
  const rawRecordBody = ctx.formValues.record_body;

  const { setError, alertFn } = failureAlert(ctx);
  const noticeFn = (message: string) => {
    void ctx.notice(message);
  };
  const navigateTo = (path: string) => {
    void ctx.navigateTo(path);
  };

  try {
    const parseResult = await parseLambdaRecordBody(
      rawRecordBody,
      debugLogger,
      alertFn,
    );
    if (!parseResult.success) return;
    const parsedRecordBody = parseResult.parsedBody;
    const isLocallyCapturedRecord =
      typeof parsedRecordBody === 'object' &&
      parsedRecordBody !== null &&
      '__record_bin' in parsedRecordBody;
    // Existing deployments retain the legacy webhook flow. Locally captured
    // archives are restored by the plugin itself.
    if (
      runtimeMode === 'lambda' &&
      !isPackedRecordBinBody(parsedRecordBody) &&
      !isLocallyCapturedRecord
    ) {
      await runLambdaModeRestore({
        parsedRecordBody,
        pluginParameters: ctx.plugin.attributes.parameters as Record<
          string,
          unknown
        >,
        trashRecordId: ctx.item?.id,
        debugLogger,
        alertFn,
        noticeFn,
        navigateTo,
        environment: ctx.environment,
        isEnvironmentPrimary: ctx.isEnvironmentPrimary,
        setError,
      });
      return;
    }

    if (!ctx.item?.id) {
      debugLogger.warn('Missing trash record id in lambda-less restore');
      await alertFn('Could not determine the trash record to remove.');
      return;
    }

    await executeRestoreWithoutLambda({
      trashRecordId: ctx.item.id,
      parsedRecordBody,
      currentUserAccessToken: ctx.currentUserAccessToken,
      cmaBaseUrl: ctx.cmaBaseUrl,
      environment: ctx.environment,
      debugLogger,
      alertFn,
      noticeFn,
      navigateTo,
      isEnvironmentPrimary: ctx.isEnvironmentPrimary,
      setError,
    });
  } catch (err) {
    setError(buildRestoreErrorPayload(err));
    debugLogger.error('Restoration flow failed', err);
    await alertFn('The record could not be restored.');
  } finally {
    restorationInProgress = false;
  }
}

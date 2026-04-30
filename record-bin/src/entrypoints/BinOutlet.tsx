import type { RenderItemFormOutletCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, FieldGroup, Form } from 'datocms-react-ui';
import { useCallback, useState } from 'react';
import type { errorObject } from '../types/types';
import { createDebugLogger, isDebugEnabled } from '../utils/debugLogger';
import { getDeploymentUrlFromParameters } from '../utils/getDeploymentUrlFromParameters';
import { getRuntimeMode } from '../utils/getRuntimeMode';
import {
  isLambdaLessRestoreError,
  restoreRecordWithoutLambda,
} from '../utils/lambdaLessRestore';
import {
  buildRestoreErrorPayload,
  isRestoreSuccessResponse,
  parseJsonStringSafely,
} from '../utils/restoreError';

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
    restoreResponse = await fetch(deploymentURL, {
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
    await alertFn('The record could not be restored!');
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
    await alertFn('The record could not be restored!');
    return false;
  }

  debugLogger.log('Restoration succeeded', {
    restoredRecordId: parsedResponse.restoredRecord.id,
    restoredModelId: parsedResponse.restoredRecord.modelID,
  });
  noticeFn('The record has been successfully restored!');
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
  currentUserAccessToken: string | null;
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
      await alertFn('The record could not be restored!');
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
  noticeFn('The record has been successfully restored!');
  navigateTo(
    buildRecordEditPath(
      environment,
      isEnvironmentPrimary,
      parsedResponse.restoredRecord.modelID,
      parsedResponse.restoredRecord.id,
    ),
  );
};

const getPrimaryErrorLine = (restorationError: errorObject): string => {
  const details = restorationError.simplifiedError.details;
  const detailMessage =
    (typeof details.field === 'string' && details.field) ||
    (Array.isArray(details.extraneous_attributes) &&
    details.extraneous_attributes.length > 0
      ? details.extraneous_attributes.join(', ')
      : undefined) ||
    (typeof details.message === 'string' && details.message) ||
    'No details available';

  return `${restorationError.simplifiedError.code || 'UNKNOWN'}: ${detailMessage}`;
};

const getSecondaryErrorLine = (
  restorationError: errorObject,
): string | undefined => {
  const details = restorationError.simplifiedError.details;

  if (typeof details.code === 'string' && details.code.trim().length > 0) {
    return `Details code: ${details.code}`;
  }

  if (
    typeof details.field_id === 'string' &&
    details.field_id.trim().length > 0
  ) {
    return `Field ID: ${details.field_id}`;
  }

  if (
    typeof details.field_label === 'string' &&
    details.field_label.trim().length > 0
  ) {
    return `Field label: ${details.field_label}`;
  }

  return undefined;
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

const RESTORATION_ERROR_BOX_STYLE = {
  border: '1px solid rgba(var(--alert-color-rgb-components), 0.5)',
  borderRadius: '6px',
  background: 'rgba(var(--alert-color-rgb-components), 0.08)',
  padding: 'var(--spacing-m)',
  marginBottom: 'var(--spacing-m)',
};

const BinOutlet = ({ ctx }: { ctx: RenderItemFormOutletCtx }) => {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    'BinOutlet',
  );
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<errorObject>();

  const restorationHandler = useCallback(async () => {
    debugLogger.log('Starting record restoration', {
      itemId: ctx.item?.id,
      itemTypeId: ctx.itemType.id,
    });
    setError(undefined);
    setLoading(true);

    const runtimeMode = getRuntimeMode(ctx.plugin.attributes.parameters);
    const rawRecordBody = ctx.formValues.record_body;

    const parseResult = await parseLambdaRecordBody(
      rawRecordBody,
      debugLogger,
      ctx.alert.bind(ctx),
    );
    if (!parseResult.success) {
      setLoading(false);
      return;
    }
    const parsedRecordBody = parseResult.parsedBody;

    const alertFn = ctx.alert.bind(ctx);
    const noticeFn = ctx.notice.bind(ctx);
    const navigateTo = ctx.navigateTo.bind(ctx);

    try {
      if (runtimeMode === 'lambda') {
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
        environment: ctx.environment,
        debugLogger,
        alertFn,
        noticeFn,
        navigateTo,
        isEnvironmentPrimary: ctx.isEnvironmentPrimary,
        setError,
      });
    } catch (err) {
      debugLogger.error('Restoration flow failed', err);
      await alertFn('The record could not be restored!');
    } finally {
      setLoading(false);
    }
  }, [ctx, debugLogger]);

  const errorModalHandler = async () => {
    if (!error) {
      return;
    }

    debugLogger.log('Opening restoration error modal');
    await ctx.openModal({
      id: 'errorModal',
      title: 'Restoration error',
      width: 'l',
      parameters: { errorPayload: error.fullErrorPayload },
    });
  };

  const primaryErrorLine = error ? getPrimaryErrorLine(error) : undefined;
  const secondaryErrorLine = error ? getSecondaryErrorLine(error) : undefined;

  return (
    <Canvas ctx={ctx}>
      <Form>
        <FieldGroup>
          <Button
            buttonType={isLoading ? 'muted' : 'primary'}
            disabled={isLoading}
            fullWidth
            onClick={restorationHandler}
          >
            Restore record ♻️
          </Button>
        </FieldGroup>
        <FieldGroup>
          {error && (
            <div style={RESTORATION_ERROR_BOX_STYLE}>
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: 'var(--spacing-s)',
                  fontSize: 'var(--font-size-m)',
                }}
              >
                Restoration error
              </h3>
              <p style={{ marginTop: 0, marginBottom: 'var(--spacing-s)' }}>
                Restoring a record is an optimistic operation. If this record
                references linked records that no longer exist, restoration can
                fail.
              </p>
              <p style={{ marginTop: 0, marginBottom: 'var(--spacing-s)' }}>
                In case of API errors, inspect the details below and update the{' '}
                <code>record_body</code> JSON if needed before trying again.
              </p>
              <p style={{ marginTop: 0, marginBottom: 'var(--spacing-s)' }}>
                {primaryErrorLine}
              </p>
              {secondaryErrorLine && (
                <p style={{ marginTop: 0, marginBottom: 'var(--spacing-s)' }}>
                  {secondaryErrorLine}
                </p>
              )}
              <Button onClick={errorModalHandler}>
                See full restoration error report
              </Button>
              <p style={{ marginTop: 'var(--spacing-s)', marginBottom: 0 }}>
                You can manually correct the JSON payload, save the record, and
                re-attempt restoration.
              </p>
            </div>
          )}
        </FieldGroup>
      </Form>
    </Canvas>
  );
};

export default BinOutlet;

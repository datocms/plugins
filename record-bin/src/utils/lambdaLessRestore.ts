import { buildClient } from '@datocms/cma-client-browser';
import type { errorObject } from '../types/types';
import { extractEntityModelId } from './recordBinPayload';
import { resolveRecordBinBody } from './recordBinStorage';
import { createRestoreEntitySanitizer } from './restoreEntity';
import { buildRestoreErrorPayload } from './restoreError';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class LambdaLessRestoreError extends Error {
  readonly restorationError: errorObject;
  constructor(message: string, restorationError: errorObject) {
    super(message);
    this.name = 'LambdaLessRestoreError';
    this.restorationError = restorationError;
  }
}

export const isLambdaLessRestoreError = (
  error: unknown,
): error is LambdaLessRestoreError => error instanceof LambdaLessRestoreError;

export type RestoreRecordWithoutLambdaInput = {
  currentUserAccessToken: string | null | undefined;
  currentEnvironment: string;
  cmaBaseUrl?: string;
  recordBody: unknown;
  trashRecordID: string;
};

export type RestoreRecordWithoutLambdaResult = {
  restoredRecord: { id: string; modelID: string };
  cleanupError?: errorObject;
};

// Reusing the deleted record's ID preserves its original identity. Numeric IDs
// in historical payloads cannot be reused by the current CMA.
const reusableId = (entity: Record<string, unknown>): string | undefined =>
  typeof entity.id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(entity.id)
    ? entity.id
    : undefined;

export const restoreRecordWithoutLambda = async ({
  currentUserAccessToken,
  currentEnvironment,
  cmaBaseUrl,
  recordBody,
  trashRecordID,
}: RestoreRecordWithoutLambdaInput): Promise<RestoreRecordWithoutLambdaResult> => {
  let client: ReturnType<typeof buildClient>;
  let restoredRecord: RestoreRecordWithoutLambdaResult['restoredRecord'];
  try {
    if (!currentUserAccessToken)
      throw new Error(
        'Missing currentUserAccessToken for Lambda-less restore.',
      );
    if (!trashRecordID) throw new Error('Missing archive record ID.');
    const normalizedPayload = await resolveRecordBinBody(
      recordBody,
      currentEnvironment,
    );
    const modelID = extractEntityModelId(normalizedPayload.entity);
    if (!modelID) throw new Error('The archived record has no model.');
    const id = reusableId(normalizedPayload.entity);
    if (id === trashRecordID)
      throw new Error(
        'The archived record ID cannot be the archive record itself.',
      );
    client = buildClient({
      apiToken: currentUserAccessToken,
      environment: currentEnvironment,
      ...(cmaBaseUrl ? { baseUrl: cmaBaseUrl } : {}),
    });
    const sanitize = createRestoreEntitySanitizer(client);
    const requestBody = await sanitize(normalizedPayload.entity, id);
    // Raw Item SDK methods transform item-shaped JSON metadata recursively.
    const response = await client.request<unknown>({
      method: 'POST',
      url: '/items',
      body: { data: requestBody },
    });
    if (
      !isRecord(response) ||
      !isRecord(response.data) ||
      typeof response.data.id !== 'string'
    ) {
      throw new Error('The CMA returned an invalid record response.');
    }
    restoredRecord = {
      id: response.data.id,
      modelID: extractEntityModelId(response.data) ?? modelID,
    };
  } catch (error) {
    if (isLambdaLessRestoreError(error)) throw error;
    throw new LambdaLessRestoreError(
      'The record could not be restored!',
      buildRestoreErrorPayload(error),
    );
  }

  try {
    await client.items.destroy(trashRecordID);
    return { restoredRecord };
  } catch (error) {
    return {
      restoredRecord,
      cleanupError: buildRestoreErrorPayload(error, {
        fallbackMessage:
          'The record was restored, but its archive could not be removed.',
      }),
    };
  }
};

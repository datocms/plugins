import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { errorObject } from '../types/types';
import {
  CmaRequestScheduler,
  createBoundedFetch,
  getStatus,
  retryCmaOperation,
  retryCmaRead,
} from './cmaRequests';
import { extractEntityModelId } from './recordBinPayload';
import { resolveRecordBinBody, sha256 } from './recordBinStorage';
import {
  createRestoreEntitySanitizer,
  equalRestoreEntities,
} from './restoreEntity';
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

const restorationId = async (
  entity: Record<string, unknown>,
  environment: string,
  trashRecordID: string,
): Promise<string> => {
  // Reusing a deleted UUID preserves its original identity and makes retries idempotent.
  if (typeof entity.id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(entity.id))
    return entity.id;
  // Numeric IDs in historical payloads cannot be reused by the current CMA.
  const hash = await sha256(
    JSON.stringify(['record-bin-restore', environment, trashRecordID]),
  );
  const bytes = Uint8Array.from(hash.slice(0, 32).match(/.{2}/g) ?? [], (hex) =>
    Number.parseInt(hex, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return btoa(String.fromCharCode(...Array.from(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

type Entity = Record<string, unknown>;
type FindRecord = (id: string) => Promise<Entity | undefined>;
type RestoreContext = {
  client: Client;
  scheduler: CmaRequestScheduler;
  find: FindRecord;
  sanitize: ReturnType<typeof createRestoreEntitySanitizer>;
  requestBody: Entity;
  id: string;
  modelID: string;
};

const createRecordFinder =
  (client: Client, scheduler: CmaRequestScheduler): FindRecord =>
  async (recordId) => {
    try {
      // Raw Item SDK methods transform item-shaped JSON metadata recursively.
      const response = await retryCmaRead(
        () =>
          client.request<unknown>({
            method: 'GET',
            url: `/items/${encodeURIComponent(recordId)}`,
            queryParams: { nested: true },
          }),
        scheduler,
      );
      if (!isRecord(response) || !isRecord(response.data))
        throw new Error('The CMA returned an invalid record response.');
      return response.data;
    } catch (error) {
      if (getStatus(error) === 404) return undefined;
      throw error;
    }
  };

const confirmRestoredEntity = async (
  context: RestoreContext,
  existing: Entity,
  code = 'RESTORE_CONFLICT',
) => {
  if (
    existing.id === context.id &&
    extractEntityModelId(existing) === context.modelID
  ) {
    const restoredEntity = await context.sanitize(existing, context.id);
    const archivedMeta = isRecord(context.requestBody.meta)
      ? context.requestBody.meta
      : {};
    if (isRecord(restoredEntity.meta)) {
      // The CMA supplies omitted timestamps. Compare explicitly archived dates
      // strictly, while keeping every attribute in the integrity check.
      for (const timestamp of ['created_at', 'first_published_at']) {
        if (!Object.hasOwn(archivedMeta, timestamp))
          delete restoredEntity.meta[timestamp];
      }
    }
    if (equalRestoreEntities(restoredEntity, context.requestBody)) return;
  }
  const message =
    code === 'RESTORE_CONFLICT'
      ? 'A different record already uses this ID. The archive was preserved.'
      : 'The restored record content does not match the archive. The archive was preserved.';
  throw new LambdaLessRestoreError(
    message,
    buildRestoreErrorPayload({
      code,
      details: { code, message, record_id: context.id },
    }),
  );
};

const createOrConfirmRecord = async (context: RestoreContext) => {
  // Reconcile the stable ID before every POST, including uncertain responses.
  let retryWrite = false;
  await retryCmaOperation(async () => {
    retryWrite = false;
    const existing = await context.find(context.id);
    if (existing) {
      await confirmRestoredEntity(context, existing);
      return;
    }
    await context.scheduler.beforeRequest();
    try {
      const response = await context.client.request<unknown>({
        method: 'POST',
        url: '/items',
        body: { data: context.requestBody },
      });
      if (
        !isRecord(response) ||
        !isRecord(response.data) ||
        response.data.id !== context.id ||
        extractEntityModelId(response.data) !== context.modelID
      ) {
        throw new Error(
          'The CMA did not confirm the restored record ID and model.',
        );
      }
    } catch (error) {
      if (isLambdaLessRestoreError(error)) throw error;
      const reconciled = await context.find(context.id);
      if (!reconciled) {
        retryWrite = true;
        throw error;
      }
      await confirmRestoredEntity(context, reconciled);
      return;
    }
    // Read retries have their own budget; an exhausted read must not restart
    // the mutation loop or repeat reconciliation after an uncertain response.
    const verified = await context.find(context.id);
    if (!verified)
      throw new Error(
        'The restored record could not be read back. The archive was preserved.',
      );
    await confirmRestoredEntity(context, verified, 'RESTORE_INTEGRITY_ERROR');
  }, context.scheduler, undefined, () => retryWrite);
};

const removeArchive = async (
  context: RestoreContext,
  trashRecordID: string,
): Promise<errorObject | undefined> => {
  try {
    // DELETE is idempotent; resolve a lost response by confirming absence.
    let retryWrite = false;
    await retryCmaOperation(async () => {
      retryWrite = false;
      await context.scheduler.beforeRequest();
      try {
        await context.client.items.destroy(trashRecordID);
      } catch (error) {
        if (getStatus(error) === 404 || !(await context.find(trashRecordID)))
          return;
        retryWrite = true;
        throw error;
      }
    }, context.scheduler, undefined, () => retryWrite);
    return undefined;
  } catch (error) {
    return buildRestoreErrorPayload(error, {
      fallbackMessage:
        'The record was restored, but its archive could not be removed.',
    });
  }
};

export const restoreRecordWithoutLambda = async ({
  currentUserAccessToken,
  currentEnvironment,
  cmaBaseUrl,
  recordBody,
  trashRecordID,
}: RestoreRecordWithoutLambdaInput): Promise<RestoreRecordWithoutLambdaResult> => {
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
    const id = await restorationId(
      normalizedPayload.entity,
      currentEnvironment,
      trashRecordID,
    );
    if (id === trashRecordID)
      throw new Error(
        'The archived record ID cannot be the archive record itself.',
      );
    const scheduler = new CmaRequestScheduler();
    const client = buildClient({
      apiToken: currentUserAccessToken,
      environment: currentEnvironment,
      autoRetry: false,
      fetchFn: createBoundedFetch(),
      requestTimeout: 30000,
      ...(cmaBaseUrl ? { baseUrl: cmaBaseUrl } : {}),
    });
    const read = <T>(operation: () => Promise<T>) =>
      retryCmaRead(operation, scheduler);
    const sanitize = createRestoreEntitySanitizer(client, read);
    const requestBody = await sanitize(normalizedPayload.entity, id);
    const context: RestoreContext = {
      client,
      scheduler,
      find: createRecordFinder(client, scheduler),
      sanitize,
      requestBody,
      id,
      modelID,
    };
    await createOrConfirmRecord(context);
    const cleanupError = await removeArchive(context, trashRecordID);
    return {
      restoredRecord: { id, modelID },
      ...(cleanupError ? { cleanupError } : {}),
    };
  } catch (error) {
    if (isLambdaLessRestoreError(error)) throw error;
    throw new LambdaLessRestoreError(
      'The record could not be restored!',
      buildRestoreErrorPayload(error),
    );
  }
};

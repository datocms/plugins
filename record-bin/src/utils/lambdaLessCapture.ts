import { buildClient, type SchemaTypes } from '@datocms/cma-client-browser';
import type { OnBeforeItemsDestroyCtx } from 'datocms-plugin-sdk';
import { canonicalJson } from './archiveIdentity';
import {
  CmaRequestScheduler,
  createBoundedFetch,
  getStatus,
  isRetryableError,
  retryCmaRead,
  retryDelay,
  runWithConcurrency,
  throwIfAborted,
  waitForRequest,
} from './cmaRequests';
import { createDebugLogger, isDebugEnabled } from './debugLogger';
import { ensureRecordBinModel } from './recordBinModel';
import {
  buildRecordBinCompatiblePayload,
  extractEntityAttributes,
  extractEntityModelId,
} from './recordBinPayload';
import {
  prepareRecordBinBody,
  resolveRecordBinBody,
  sha256,
} from './recordBinStorage';
import { equalRestoreEntities } from './restoreEntity';

const BATCH_SIZE = 20; // Nested lists permit at most 30; bound the response buffer.
const CONCURRENCY = 4;
type Entity = Record<string, unknown>;
type CmaClient = ReturnType<typeof buildClient>;
const isRecord = (value: unknown): value is Entity =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function buildTrashLabel(attributes: Entity, modelID: string): string {
  const title = Object.values(attributes).find(
    (value) => typeof value === 'string' && Number.isNaN(Number(value)),
  );
  return `${typeof title === 'string' ? title.slice(0, 150) : 'No title record'} | Model: ${modelID} | ${new Date().toDateString()}`;
}

function versionOf(entity: Entity): string {
  const meta = entity.meta;
  if (
    !isRecord(meta) ||
    typeof meta.current_version !== 'string' ||
    typeof meta.updated_at !== 'string'
  ) {
    throw new Error(
      'Record version metadata is missing; a consistent archive cannot be verified.',
    );
  }
  return JSON.stringify([
    meta.current_version,
    meta.updated_at,
    extractEntityModelId(entity),
  ]);
}

function archiveIdFromDigest(digest: string): string {
  const bytes = new Uint8Array(
    digest
      .slice(0, 32)
      .match(/../g)
      ?.map((hex) => Number.parseInt(hex, 16)) ?? [],
  );
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  return btoa(String.fromCharCode(...Array.from(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildCaptureClient(
  ctx: CaptureContext,
  signal?: AbortSignal,
): CmaClient {
  if (!ctx.currentUserAccessToken)
    throw new Error('Missing currentUserAccessToken.');
  return buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    autoRetry: false,
    fetchFn: createBoundedFetch(signal),
    requestTimeout: 35_000,
    ...(ctx.cmaBaseUrl ? { baseUrl: ctx.cmaBaseUrl } : {}),
  });
}

function entitiesFromResponse(response: unknown, batch: string[]) {
  if (!isRecord(response) || !Array.isArray(response.data))
    throw new Error('Invalid record list response.');
  const expected = new Set(batch);
  const entities = new Map<string, Entity>();
  for (const entity of response.data) {
    if (
      !isRecord(entity) ||
      typeof entity.id !== 'string' ||
      !expected.has(entity.id) ||
      entities.has(entity.id)
    ) {
      throw new Error('Unexpected or duplicate record in capture response.');
    }
    entities.set(entity.id, entity);
  }
  return entities;
}

function requireCaptureEntity(entity: Entity | undefined): Entity {
  if (entity?.type !== 'item' || !isRecord(entity.attributes)) {
    throw new Error(
      'Selected record was omitted from the complete capture response.',
    );
  }
  return entity;
}

export type LambdaLessCaptureProgress = {
  phase: 'capturing' | 'verifying';
  totalCount: number;
  capturedCount: number;
  verifiedCount: number;
  failedCount: number;
  skippedCount: number;
};
export type LambdaLessCaptureResult = {
  capturedCount: number;
  failedItemIds: string[];
  skippedRecordBinItems: number;
  allowDeletion: boolean;
  cancelled: boolean;
};
export type CaptureOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: LambdaLessCaptureProgress) => void;
  scheduler?: CmaRequestScheduler;
};

export type CaptureContext = Pick<
  OnBeforeItemsDestroyCtx,
  'plugin' | 'currentUserAccessToken' | 'environment' | 'cmaBaseUrl' | 'notice'
>;

class ArchiveWriter {
  constructor(
    private readonly client: CmaClient,
    private readonly ctx: CaptureContext,
    private readonly binId: string,
    private readonly scheduler: CmaRequestScheduler,
    private readonly signal?: AbortSignal,
  ) {}

  async archive(entity: Entity, itemId: string, modelID: string) {
    const capturedAt = new Date().toISOString();
    const payload = buildRecordBinCompatiblePayload({
      environment: this.ctx.environment,
      entity,
      capturedAt,
    });
    const archiveId = archiveIdFromDigest(
      await sha256(canonicalJson([this.ctx.environment, entity])),
    );
    const makeBody = (recordBody: string) => ({
      data: {
        type: 'item',
        id: archiveId,
        relationships: {
          item_type: { data: { type: 'item_type', id: this.binId } },
        },
        attributes: {
          label: buildTrashLabel(extractEntityAttributes(entity), modelID),
          model: modelID,
          record_body: recordBody,
          date_of_deletion: capturedAt,
        },
      },
    });
    const recordBody = await prepareRecordBinBody({
      payload,
      sourceItemId: itemId,
      environment: this.ctx.environment,
      inlineRequestBytes: (body) =>
        new TextEncoder().encode(JSON.stringify(makeBody(body))).byteLength,
    });
    await this.writeArchive(() => makeBody(recordBody), archiveId, entity);
  }

  private async verifyArchive(
    response: unknown,
    archiveId: string,
    entity: Entity,
  ) {
    if (
      !isRecord(response) ||
      !isRecord(response.data) ||
      response.data.id !== archiveId ||
      extractEntityModelId(response.data) !== this.binId
    ) {
      throw new Error('Invalid archive write response.');
    }
    const stored = await resolveRecordBinBody(
      extractEntityAttributes(response.data).record_body,
      this.ctx.environment,
      { signal: this.signal },
    );
    if (
      stored.environment !== this.ctx.environment ||
      !equalRestoreEntities(stored.entity, entity)
    ) {
      throw new Error(
        'Stored archive does not match the complete source record.',
      );
    }
  }

  private async reconcileArchive(archiveId: string, entity: Entity) {
    try {
      const existing = await retryCmaRead(
        () =>
          this.client.request({ method: 'GET', url: `/items/${archiveId}` }),
        this.scheduler,
        this.signal,
      );
      await this.verifyArchive(existing, archiveId, entity);
      return true;
    } catch (readError) {
      if (getStatus(readError) !== 404) throw readError;
      return false;
    }
  }

  private async waitBeforeRetry(writeError: unknown, attempt: number) {
    if (!isRetryableError(writeError) || attempt >= 4) throw writeError;
    const delay = retryDelay(writeError, attempt);
    if (getStatus(writeError) === 429) this.scheduler.onRateLimit(delay);
    await waitForRequest(delay, this.signal);
  }

  private async writeArchive(
    makeBody: () => object,
    archiveId: string,
    entity: Entity,
  ) {
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(this.signal);
      await this.scheduler.beforeRequest(this.signal);
      try {
        const response = await this.client.request({
          method: 'POST',
          url: '/items',
          body: makeBody(),
        });
        await this.verifyArchive(response, archiveId, entity);
        return;
      } catch (writeError) {
        throwIfAborted(this.signal);
        // A timeout or conflict may follow a commit: reconcile before repeating.
        if (await this.reconcileArchive(archiveId, entity)) return;
        await this.waitBeforeRetry(writeError, attempt);
      }
    }
  }
}

class CaptureOperation {
  private readonly result: LambdaLessCaptureResult = {
    capturedCount: 0,
    failedItemIds: [],
    skippedRecordBinItems: 0,
    allowDeletion: false,
    cancelled: false,
  };
  private readonly versions = new Map<string, string>();
  private readonly debugLogger;
  private verifiedCount = 0;

  constructor(
    private readonly ids: string[],
    private readonly ctx: CaptureContext,
    private readonly scheduler: CmaRequestScheduler,
    private readonly signal?: AbortSignal,
    private readonly onProgress?: CaptureOptions['onProgress'],
  ) {
    this.debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'lambdaLessCapture',
    );
  }

  private progress(phase: LambdaLessCaptureProgress['phase']) {
    this.onProgress?.({
      phase,
      totalCount: this.ids.length,
      capturedCount: this.result.capturedCount,
      verifiedCount: this.verifiedCount,
      failedCount: this.result.failedItemIds.length,
      skippedCount: this.result.skippedRecordBinItems,
    });
  }

  private fail(itemIds: string[]) {
    for (const id of itemIds) this.result.failedItemIds.push(id);
  }

  private async readBatch(client: CmaClient, batch: string[], nested: boolean) {
    // SDK raw helpers recursively transform JSON fields; preserve the actual response.
    const response: unknown = await retryCmaRead(
      () =>
        client.request({
          method: 'GET',
          url: '/items',
          queryParams: {
            filter: { ids: batch.join(',') },
            nested,
            page: { limit: batch.length, offset: 0 },
          },
        }),
      this.scheduler,
      this.signal,
    );
    return entitiesFromResponse(response, batch);
  }

  private async captureItem(
    itemId: string,
    entities: Map<string, Entity>,
    binId: string,
    writer: ArchiveWriter,
  ) {
    throwIfAborted(this.signal);
    try {
      const entity = requireCaptureEntity(entities.get(itemId));
      const modelID = extractEntityModelId(entity);
      if (!modelID) throw new Error('Record model is missing.');
      if (modelID === binId) {
        this.result.skippedRecordBinItems++;
        this.progress('capturing');
        return;
      }
      const version = versionOf(entity);
      await writer.archive(entity, itemId, modelID);
      this.versions.set(itemId, version);
      this.result.capturedCount++;
    } catch (error) {
      throwIfAborted(this.signal);
      this.fail([itemId]);
      this.debugLogger.warn('Archive failed; deletion will be blocked', {
        itemId,
        error,
      });
    }
    this.progress('capturing');
  }

  private async captureBatch(
    client: CmaClient,
    batch: string[],
    binId: string,
    writer: ArchiveWriter,
  ) {
    let entities: Map<string, Entity>;
    try {
      entities = await this.readBatch(client, batch, true);
    } catch (error) {
      throwIfAborted(this.signal);
      this.fail(batch);
      throw error;
    }
    await runWithConcurrency(batch, CONCURRENCY, (itemId) =>
      this.captureItem(itemId, entities, binId, writer),
    );
  }

  private async capture(client: CmaClient, binId: string) {
    const writer = new ArchiveWriter(
      client,
      this.ctx,
      binId,
      this.scheduler,
      this.signal,
    );
    this.progress('capturing');
    // One nested batch and four serialized records are live for any selection size.
    for (let offset = 0; offset < this.ids.length; offset += BATCH_SIZE) {
      throwIfAborted(this.signal);
      await this.captureBatch(
        client,
        this.ids.slice(offset, offset + BATCH_SIZE),
        binId,
        writer,
      );
      if (this.result.failedItemIds.length) break;
    }
  }

  private verifyVersions(batch: string[], entities: Map<string, Entity>) {
    for (const id of batch) {
      const entity = entities.get(id);
      if (!entity || versionOf(entity) !== this.versions.get(id))
        this.fail([id]);
      else this.verifiedCount++;
    }
  }

  private async verify(client: CmaClient) {
    this.progress('verifying');
    for (let offset = 0; offset < this.ids.length; offset += BATCH_SIZE) {
      throwIfAborted(this.signal);
      const batch = this.ids
        .slice(offset, offset + BATCH_SIZE)
        .filter((id) => this.versions.has(id));
      if (!batch.length) continue;
      let entities: Map<string, Entity>;
      try {
        entities = await this.readBatch(client, batch, false);
      } catch (error) {
        throwIfAborted(this.signal);
        this.fail(batch);
        throw error;
      }
      this.verifyVersions(batch, entities);
      this.progress('verifying');
      if (this.result.failedItemIds.length) break;
    }
  }

  private handleFailure(error: unknown) {
    this.result.cancelled = this.signal?.aborted === true;
    if (!this.result.cancelled && this.result.failedItemIds.length === 0)
      this.fail(this.ids.filter((id) => !this.versions.has(id)));
    this.debugLogger.warn(
      'Capture could not complete; deletion blocked',
      error,
    );
  }

  async run(): Promise<LambdaLessCaptureResult> {
    try {
      throwIfAborted(this.signal);
      if (this.ids.length === 0) return { ...this.result, allowDeletion: true };
      if (
        this.ids.some((id) => typeof id !== 'string' || !id || id.includes(','))
      )
        throw new Error('Invalid deletion selection.');
      const client = buildCaptureClient(this.ctx, this.signal);
      const bin = await ensureRecordBinModel(client, {
        scheduler: this.scheduler,
        signal: this.signal,
      });
      await this.capture(client, bin.id);
      if (this.result.failedItemIds.length === 0) await this.verify(client);
      this.result.allowDeletion =
        this.result.failedItemIds.length === 0 &&
        this.result.capturedCount + this.result.skippedRecordBinItems ===
          this.ids.length &&
        this.verifiedCount === this.result.capturedCount;
    } catch (error) {
      this.handleFailure(error);
    }
    if (!this.result.allowDeletion && !this.result.cancelled) {
      await this.ctx.notice(
        'Record Bin could not verify a complete archive. Deletion was cancelled; the original records have been kept.',
      );
    }
    return this.result;
  }
}

export async function captureDeletedItemsWithoutLambda(
  items: readonly Pick<SchemaTypes.Item, 'id'>[],
  ctx: CaptureContext,
  {
    signal,
    onProgress,
    scheduler = new CmaRequestScheduler(),
  }: CaptureOptions = {},
): Promise<LambdaLessCaptureResult> {
  const ids = Array.from(new Set(items.map((item) => item.id)));
  return new CaptureOperation(ids, ctx, scheduler, signal, onProgress).run();
}

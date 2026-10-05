import { buildClient, type SchemaTypes } from '@datocms/cma-client-browser';
import type { OnBeforeItemsDestroyCtx } from 'datocms-plugin-sdk';
import { createDebugLogger, isDebugEnabled } from './debugLogger';
import { ensureRecordBinModel } from './recordBinModel';
import {
  buildRecordBinCompatiblePayload,
  extractEntityAttributes,
  extractEntityModelId,
} from './recordBinPayload';
import { prepareRecordBinBody } from './recordBinStorage';

const BATCH_SIZE = 20; // Nested lists permit at most 30.
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

function buildCaptureClient(ctx: CaptureContext): CmaClient {
  if (!ctx.currentUserAccessToken)
    throw new Error('Missing currentUserAccessToken.');
  return buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    ...(ctx.cmaBaseUrl ? { baseUrl: ctx.cmaBaseUrl } : {}),
  });
}

async function runWithConcurrency<T>(
  inputs: readonly T[],
  limit: number,
  operation: (input: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++;
      await operation(inputs[index]);
    }
  };
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(limit, inputs.length) }, worker),
  );
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
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

export type LambdaLessCaptureResult = {
  capturedCount: number;
  failedItemIds: string[];
  skippedRecordBinItems: number;
  allowDeletion: boolean;
};

export type CaptureContext = Pick<
  OnBeforeItemsDestroyCtx,
  'plugin' | 'currentUserAccessToken' | 'environment' | 'cmaBaseUrl' | 'notice'
>;

async function archiveRecord(
  client: CmaClient,
  ctx: CaptureContext,
  binId: string,
  entity: Entity,
  itemId: string,
  modelID: string,
) {
  const capturedAt = new Date().toISOString();
  const payload = buildRecordBinCompatiblePayload({
    environment: ctx.environment,
    entity,
    capturedAt,
  });
  const makeBody = (recordBody: string) => ({
    data: {
      type: 'item',
      relationships: {
        item_type: { data: { type: 'item_type', id: binId } },
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
    environment: ctx.environment,
    inlineRequestBytes: (body) =>
      new TextEncoder().encode(JSON.stringify(makeBody(body))).byteLength,
  });
  await client.request({
    method: 'POST',
    url: '/items',
    body: makeBody(recordBody),
  });
}

class CaptureOperation {
  private readonly result: LambdaLessCaptureResult = {
    capturedCount: 0,
    failedItemIds: [],
    skippedRecordBinItems: 0,
    allowDeletion: false,
  };
  private readonly versions = new Map<string, string>();
  private readonly debugLogger;
  private verifiedCount = 0;

  constructor(
    private readonly ids: string[],
    private readonly ctx: CaptureContext,
  ) {
    this.debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'lambdaLessCapture',
    );
  }

  private fail(itemIds: string[]) {
    for (const id of itemIds) this.result.failedItemIds.push(id);
  }

  private async readBatch(client: CmaClient, batch: string[], nested: boolean) {
    // SDK raw helpers recursively transform JSON fields; preserve the actual response.
    const response: unknown = await client.request({
      method: 'GET',
      url: '/items',
      queryParams: {
        filter: { ids: batch.join(',') },
        nested,
        page: { limit: batch.length, offset: 0 },
      },
    });
    return entitiesFromResponse(response, batch);
  }

  private async captureItem(
    client: CmaClient,
    itemId: string,
    entities: Map<string, Entity>,
    binId: string,
  ) {
    try {
      const entity = requireCaptureEntity(entities.get(itemId));
      const modelID = extractEntityModelId(entity);
      if (!modelID) throw new Error('Record model is missing.');
      if (modelID === binId) {
        this.result.skippedRecordBinItems++;
        return;
      }
      const version = versionOf(entity);
      await archiveRecord(client, this.ctx, binId, entity, itemId, modelID);
      this.versions.set(itemId, version);
      this.result.capturedCount++;
    } catch (error) {
      this.fail([itemId]);
      this.debugLogger.warn('Archive failed; deletion will be blocked', {
        itemId,
        error,
      });
    }
  }

  private async captureBatch(
    client: CmaClient,
    batch: string[],
    binId: string,
  ) {
    let entities: Map<string, Entity>;
    try {
      entities = await this.readBatch(client, batch, true);
    } catch (error) {
      this.fail(batch);
      throw error;
    }
    await runWithConcurrency(batch, CONCURRENCY, (itemId) =>
      this.captureItem(client, itemId, entities, binId),
    );
  }

  private async capture(client: CmaClient, binId: string) {
    for (let offset = 0; offset < this.ids.length; offset += BATCH_SIZE) {
      await this.captureBatch(
        client,
        this.ids.slice(offset, offset + BATCH_SIZE),
        binId,
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

  // Records edited while they were being archived must not be deleted.
  private async verify(client: CmaClient) {
    for (let offset = 0; offset < this.ids.length; offset += BATCH_SIZE) {
      const batch = this.ids
        .slice(offset, offset + BATCH_SIZE)
        .filter((id) => this.versions.has(id));
      if (!batch.length) continue;
      let entities: Map<string, Entity>;
      try {
        entities = await this.readBatch(client, batch, false);
      } catch (error) {
        this.fail(batch);
        throw error;
      }
      this.verifyVersions(batch, entities);
      if (this.result.failedItemIds.length) break;
    }
  }

  private handleFailure(error: unknown) {
    if (this.result.failedItemIds.length === 0)
      this.fail(this.ids.filter((id) => !this.versions.has(id)));
    this.debugLogger.warn(
      'Capture could not complete; deletion blocked',
      error,
    );
  }

  async run(): Promise<LambdaLessCaptureResult> {
    try {
      if (this.ids.length === 0) return { ...this.result, allowDeletion: true };
      if (
        this.ids.some((id) => typeof id !== 'string' || !id || id.includes(','))
      )
        throw new Error('Invalid deletion selection.');
      const client = buildCaptureClient(this.ctx);
      const bin = await ensureRecordBinModel(client);
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
    if (!this.result.allowDeletion) {
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
): Promise<LambdaLessCaptureResult> {
  const ids = Array.from(new Set(items.map((item) => item.id)));
  return new CaptureOperation(ids, ctx).run();
}

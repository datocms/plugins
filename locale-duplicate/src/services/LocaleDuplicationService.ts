import {
  ApiError,
  buildClient,
  type Client,
} from '@datocms/cma-client-browser';
import type { Item, ItemType } from '../types';
import {
  type DuplicationProgress,
  type DuplicationStats,
  initialDuplicationStats,
} from './duplicationTypes';
import { buildLocaleUpdates, type FieldSchema } from './localeUpdates';

export type ProgressCallback = (update: DuplicationProgress) => void;

export interface DuplicationConfig {
  sourceLocale: string;
  targetLocale: string;
  selectedModelIds?: string[];
  useDraftRecords?: boolean;
  publishAfterDuplication?: boolean;
  abortSignal?: { current: boolean };
}

export interface DuplicationResult {
  totalRecordsProcessed: number;
  successfulRecords: number;
  failedRecords: number;
  publishedRecords: number;
  stats: DuplicationStats;
}

// CMA has no ID-only projection: smaller discovery pages also bound heavy scalar content.
const ID_PAGE_SIZE = 100;
const NESTED_PAGE_SIZE = 30;
const WORKERS = 3;
const PUBLISH_BATCH_SIZE = 200;

type ModelSelection = { model: ItemType; ids: string[] };
type Publication = { id: string; version: string };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return (
      error.errors.map((entry) => entry.attributes.code).join(', ') ||
      `HTTP ${error.response.status}`
    );
  }
  return error instanceof Error ? error.message : String(error);
}

function fatalError(error: unknown): boolean {
  return (
    error instanceof ApiError && [401, 403].includes(error.response.status)
  );
}

function isStaleVersion(error: unknown): boolean {
  return error instanceof ApiError && !!error.findError('STALE_ITEM_VERSION');
}

/** One run holds IDs and counters, one nested page, and at most three record updates. */
class DuplicationRun {
  readonly stats = initialDuplicationStats();
  private readonly schema = new Map<string, Promise<FieldSchema[]>>();
  private readonly publications: Publication[] = [];
  private progress = 0;

  constructor(
    private readonly client: Client,
    private readonly config: DuplicationConfig,
    private readonly onProgress: ProgressCallback,
  ) {
    this.stats.startTime = Date.now();
  }

  private get cancelled(): boolean {
    return this.config.abortSignal?.current === true;
  }

  private emit(
    message: string,
    type: DuplicationProgress['type'],
    progress = this.progress,
    model?: ItemType,
    recordId?: string,
  ) {
    this.progress = Math.max(this.progress, progress);
    this.onProgress({
      message,
      type,
      timestamp: Date.now(),
      progress: this.progress,
      modelId: model?.id,
      modelName: model?.name,
      recordId,
    });
  }

  private snapshot(
    message: string,
    type: DuplicationProgress['type'] = 'info',
    progress = this.progress,
  ) {
    this.progress = Math.max(this.progress, progress);
    this.onProgress({
      message,
      type,
      timestamp: Date.now(),
      progress: this.progress,
      stats: {
        ...this.stats,
        modelStats: Object.fromEntries(
          Object.entries(this.stats.modelStats).map(([id, value]) => [
            id,
            { ...value },
          ]),
        ),
      },
    });
  }

  private loadFields = (modelId: string): Promise<FieldSchema[]> => {
    let fields = this.schema.get(modelId);
    if (!fields) {
      fields = this.client.fields.list(modelId).then((fields) =>
        fields.map(({ api_key, field_type, localized }) => ({
          api_key,
          field_type,
          localized,
        })),
      );
      this.schema.set(modelId, fields);
      fields.catch(() => this.schema.delete(modelId));
    }
    return fields;
  };

  private async discoverModel(model: ItemType): Promise<string[]> {
    const ids = new Set<string>();
    let offset = 0;
    let expectedCount: number | undefined;
    while (!this.cancelled) {
      // biome-ignore lint/performance/noAwaitInLoops: Stable sequential pages are discarded after retaining only IDs.
      const response = await this.client.items.rawList({
        filter: { type: model.id },
        order_by: 'id_ASC',
        version:
          this.config.useDraftRecords === false ? 'published' : 'current',
        page: { offset, limit: ID_PAGE_SIZE },
      });
      expectedCount ??= response.meta.total_count;
      if (expectedCount !== response.meta.total_count) {
        throw new Error(
          'The record collection changed during discovery. This model was not copied.',
        );
      }
      if (response.data.length === 0 && offset < expectedCount) {
        throw new Error(
          'Record listing ended before the reported total. This model was not copied.',
        );
      }
      for (const record of response.data) {
        if (ids.has(record.id))
          throw new Error(
            'Duplicate ID in pagination; this model was not copied.',
          );
        ids.add(record.id);
      }
      offset += response.data.length;
      this.emit(
        `Found ${ids.size} of ${expectedCount} records in ${model.name}`,
        'info',
      );
      if (offset >= expectedCount) break;
    }
    return [...ids];
  }

  private async discover(): Promise<ModelSelection[]> {
    const allModels = await this.client.itemTypes.list();
    const selected = this.config.selectedModelIds
      ? new Set(this.config.selectedModelIds)
      : undefined;
    const models = allModels.filter(
      (model) => !model.modular_block && (!selected || selected.has(model.id)),
    );
    if (selected && models.length !== selected.size)
      throw new Error('Some selected models are no longer available');
    this.stats.totalModels = models.length;
    const selection: ModelSelection[] = [];
    for (const model of models) {
      if (this.cancelled) break;
      this.stats.modelStats[model.id] = {
        name: model.name,
        success: 0,
        error: 0,
        total: 0,
      };
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Discovery does not flood the CMA with parallel model requests.
        const ids = await this.discoverModel(model);
        selection.push({ model, ids });
        this.stats.totalToProcess += ids.length;
      } catch (error) {
        if (fatalError(error)) throw error;
        this.stats.modelFailures++;
        this.emit(
          `Could not load ${model.name}: ${describeError(error)}`,
          'error',
          this.progress,
          model,
        );
      }
      this.snapshot(
        `Discovered ${this.stats.totalToProcess} records`,
        'info',
        (10 * selection.length) / Math.max(1, models.length),
      );
    }
    return selection;
  }

  private recordFinished(
    model: ItemType,
    id: string,
    result: 'success' | 'skipped' | 'error',
    error?: unknown,
  ) {
    const modelStats = this.stats.modelStats[model.id];
    modelStats.total++;
    this.stats.totalRecords++;
    if (result === 'error') {
      modelStats.error++;
      this.stats.failedRecords++;
      this.emit(
        `Could not update ${id} in ${model.name}: ${describeError(error)}`,
        'error',
        this.progress,
        model,
        id,
      );
    } else {
      modelStats.success++;
      this.stats.successfulRecords++;
      if (result === 'skipped') this.stats.skippedRecords++;
      this.emit(
        result === 'skipped'
          ? `No changes needed for record ${id}`
          : `Updated record ${id} in ${model.name}`,
        'success',
        this.progress,
        model,
        id,
      );
    }
  }

  private async writeRecord(
    source: Item,
    current: Item,
    fields: FieldSchema[],
  ): Promise<Item | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      // biome-ignore lint/performance/noAwaitInLoops: Retry only stale versions against a freshly rebuilt payload.
      const updates = await buildLocaleUpdates(
        source,
        current,
        fields,
        this.config.sourceLocale,
        this.config.targetLocale,
        this.loadFields,
      );
      if (Object.keys(updates).length === 0) return undefined;
      if (this.cancelled) return undefined;
      try {
        return await this.client.items.update(current.id, {
          ...updates,
          meta: { current_version: current.meta.current_version },
        });
      } catch (error) {
        if (!isStaleVersion(error)) throw error;
        current = await this.client.items.find(current.id, { nested: true });
        source = this.config.useDraftRecords === false ? source : current;
      }
    }
    throw new Error(
      'Record kept changing during duplication; no overwrite was forced',
    );
  }

  private async processRecord(
    record: Item,
    model: ItemType,
    fields: FieldSchema[],
  ) {
    if (this.cancelled) return;
    try {
      const current =
        this.config.useDraftRecords === false
          ? await this.client.items.find(record.id, { nested: true })
          : record;
      const updated = await this.writeRecord(record, current, fields);
      // A dispatched update is counted even when cancellation arrives while it is in flight.
      if (!updated && this.cancelled) return;
      if (
        updated &&
        this.config.publishAfterDuplication &&
        model.draft_mode_active
      ) {
        this.publications.push({
          id: updated.id,
          version: updated.meta.current_version,
        });
      }
      this.recordFinished(model, record.id, updated ? 'success' : 'skipped');
    } catch (error) {
      this.recordFinished(model, record.id, 'error', error);
      if (fatalError(error)) throw error;
    }
  }

  private async processPage(
    records: Item[],
    model: ItemType,
    fields: FieldSchema[],
  ) {
    let index = 0;
    let failure: unknown;
    await Promise.all(
      Array.from({ length: Math.min(WORKERS, records.length) }, async () => {
        while (!this.cancelled && !failure) {
          const record = records[index++];
          if (!record) return;
          try {
            // biome-ignore lint/performance/noAwaitInLoops: Each worker consumes one record at a time, at most three in flight.
            await this.processRecord(record, model, fields);
          } catch (error) {
            failure = error;
          }
        }
      }),
    );
    if (failure) throw failure;
  }

  private async copyModel({ model, ids }: ModelSelection) {
    const fields = await this.loadFields(model.id);
    for (
      let offset = 0;
      offset < ids.length && !this.cancelled;
      offset += NESTED_PAGE_SIZE
    ) {
      const pageIds = ids.slice(offset, offset + NESTED_PAGE_SIZE);
      // biome-ignore lint/performance/noAwaitInLoops: Consume a bounded nested page before fetching another.
      const records = await this.client.items.list({
        filter: { ids: pageIds.join(',') },
        nested: true,
        version:
          this.config.useDraftRecords === false ? 'published' : 'current',
        page: { limit: NESTED_PAGE_SIZE },
      });
      if (this.cancelled) break;
      const available = new Set(records.map((record) => record.id));
      for (const id of pageIds) {
        if (!available.has(id))
          this.recordFinished(
            model,
            id,
            'error',
            'Record was deleted, unpublished or became inaccessible',
          );
      }
      await this.processPage(records, model, fields);
      this.snapshot(
        `Processed ${this.stats.totalRecords} of ${this.stats.totalToProcess} records`,
        'info',
        10 +
          ((this.config.publishAfterDuplication ? 75 : 89) *
            this.stats.totalRecords) /
            Math.max(1, this.stats.totalToProcess),
      );
    }
  }

  private async publishedVersions(
    batch: Publication[],
  ): Promise<Map<string, Item>> {
    const records = new Map<string, Item>();
    for (let offset = 0; offset < batch.length; offset += ID_PAGE_SIZE) {
      // biome-ignore lint/performance/noAwaitInLoops: Publication checks use bounded non-nested reads.
      const page = await this.client.items.list({
        filter: {
          ids: batch
            .slice(offset, offset + ID_PAGE_SIZE)
            .map((record) => record.id)
            .join(','),
        },
        version: 'current',
        page: { limit: ID_PAGE_SIZE },
      });
      for (const record of page) records.set(record.id, record);
    }
    return records;
  }

  private async publishBatch(batch: Publication[]) {
    let result: Awaited<ReturnType<Client['items']['rawBulkPublish']>>;
    try {
      result = await this.client.items.rawBulkPublish({
        data: {
          type: 'item_bulk_publish_operation',
          relationships: {
            items: {
              data: batch.map(({ id }) => ({ type: 'item' as const, id })),
            },
          },
        },
      });
    } catch (error) {
      this.stats.failedPublications += batch.length;
      this.emit(`Publication batch failed: ${describeError(error)}`, 'error');
      if (fatalError(error)) throw error;
      return;
    }
    const { successful, failed } = result.meta;
    this.stats.publishedRecords += successful;
    this.stats.failedPublications += failed;
    if (failed > 0)
      this.emit(
        `Publication completed with ${failed} failed records in this batch.`,
        'error',
      );
  }

  private async publish() {
    this.emit(
      `Publishing ${this.publications.length} updated records...`,
      'info',
      85,
    );
    for (
      let offset = 0;
      offset < this.publications.length && !this.cancelled;
      offset += PUBLISH_BATCH_SIZE
    ) {
      const batch = this.publications.slice(
        offset,
        offset + PUBLISH_BATCH_SIZE,
      );
      // biome-ignore lint/performance/noAwaitInLoops: Validate that the copied draft is still current before publishing it.
      const before = await this.publishedVersions(batch);
      const unchanged = batch.filter(
        (record) =>
          before.get(record.id)?.meta.current_version === record.version,
      );
      this.stats.failedPublications += batch.length - unchanged.length;
      if (unchanged.length !== batch.length)
        this.emit(
          'Some drafts changed after copying and were excluded from publication.',
          'error',
        );
      if (this.cancelled) break;
      if (unchanged.length > 0) {
        this.emit(
          `Publishing records ${offset + 1}–${offset + batch.length} of ${this.publications.length}...`,
          'info',
        );
        await this.publishBatch(unchanged);
      }
      this.snapshot(
        `Published ${this.stats.publishedRecords} records; ${this.stats.failedPublications} publication failures`,
        'info',
        85 +
          (14 * Math.min(offset + batch.length, this.publications.length)) /
            Math.max(1, this.publications.length),
      );
    }
  }

  private async copySelection(selection: ModelSelection[]) {
    for (const model of selection) {
      if (this.cancelled) break;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Models share a bounded pool of record workers.
        await this.copyModel(model);
      } catch (error) {
        if (fatalError(error)) throw error;
        this.stats.modelFailures++;
        this.emit(
          `Could not finish ${model.model.name}: ${describeError(error)}`,
          'error',
        );
      }
    }
  }

  async execute(): Promise<DuplicationResult> {
    if (
      !this.config.sourceLocale ||
      !this.config.targetLocale ||
      this.config.sourceLocale === this.config.targetLocale
    ) {
      throw new Error('Choose two different locales');
    }
    try {
      const selection = await this.discover();
      await this.copySelection(selection);
      if (this.config.publishAfterDuplication && !this.cancelled)
        await this.publish();
    } catch (error) {
      this.stats.modelFailures++;
      this.emit(`Duplication stopped: ${describeError(error)}`, 'error');
    }
    this.stats.cancelled = this.cancelled;
    this.stats.endTime = Date.now();
    this.stats.pendingPublications =
      this.publications.length -
      this.stats.publishedRecords -
      this.stats.failedPublications;
    const failed =
      this.stats.failedRecords +
      this.stats.failedPublications +
      this.stats.modelFailures;
    this.snapshot(
      this.cancelled
        ? 'Duplication aborted; completed changes are retained.'
        : failed > 0
          ? 'Duplication completed with errors.'
          : 'Migration completed successfully!',
      failed > 0 || this.cancelled ? 'error' : 'success',
      this.cancelled ? this.progress : 100,
    );
    return {
      totalRecordsProcessed: this.stats.totalRecords,
      successfulRecords: this.stats.successfulRecords,
      failedRecords: this.stats.failedRecords,
      publishedRecords: this.stats.publishedRecords,
      stats: this.stats,
    };
  }
}

export function runLocaleDuplication(
  client: Client,
  config: DuplicationConfig,
  onProgress: ProgressCallback,
) {
  return new DuplicationRun(client, config, onProgress).execute();
}

export class LocaleDuplicationService {
  private readonly client: Client;
  private onProgress: ProgressCallback | undefined;

  constructor(apiToken: string, environment?: string, baseUrl?: string) {
    if (!apiToken)
      throw new Error(
        'CMA access is unavailable. Enable the currentUserAccessToken permission.',
      );
    this.client = buildClient({ apiToken, environment, baseUrl });
  }

  duplicateContent(
    config: DuplicationConfig,
    onProgress: ProgressCallback,
  ): Promise<DuplicationResult> {
    if (this.onProgress)
      throw new Error('A duplication is already running in this service');
    this.onProgress = onProgress;
    return runLocaleDuplication(this.client, config, onProgress).finally(() => {
      this.onProgress = undefined;
    });
  }
}

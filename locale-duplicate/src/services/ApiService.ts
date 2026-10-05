/** Centralized DatoCMS API operations with explicit, bounded collection reads. */
import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { Field, Item, ItemType } from '../types';

export interface PaginationOptions {
  page?: number;
  perPage?: number;
  version?: 'published' | 'current';
}

type RecordReference = { type: 'item'; id: string };

export class PartialPublicationError extends Error {
  constructor(
    readonly publishedRecords: number,
    readonly failedRecords: number | undefined,
    readonly cause: unknown,
  ) {
    super(
      `Publication stopped after ${publishedRecords} confirmed publications. ${failedRecords === undefined ? 'The last batch outcome could not be confirmed.' : `${failedRecords} records failed in the last batch.`}`,
    );
    this.name = 'PartialPublicationError';
  }
}

function pageSize(perPage = 30): number {
  if (!Number.isSafeInteger(perPage) || perPage < 1) {
    throw new RangeError('perPage must be a positive integer.');
  }
  // Nested mode has a hard CMA limit of 30, regardless of project size.
  return Math.min(perPage, 30);
}

export class ApiService {
  private readonly client: Client;

  constructor(apiToken: string, environment?: string, baseUrl?: string) {
    this.client = buildClient({ apiToken, environment, baseUrl });
  }

  async fetchModels(excludeModularBlocks = true): Promise<ItemType[]> {
    const models = await this.client.itemTypes.list();
    return excludeModularBlocks
      ? models.filter((model) => !model.modular_block)
      : models;
  }

  async fetchFields(modelId: string): Promise<Field[]> {
    return this.client.fields.list(modelId);
  }

  /** Return one page and the server's total, never implicitly materialize all records. */
  async fetchRecords(
    modelId: string,
    options: PaginationOptions = {},
  ): Promise<{ data: Item[]; totalCount: number }> {
    const page = options.page ?? 1;
    const perPage = pageSize(options.perPage);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger((page - 1) * perPage)
    ) {
      throw new RangeError(
        'page must be a positive integer with a safe offset.',
      );
    }
    const response = await this.client.items.rawList({
      filter: { type: modelId },
      page: { offset: (page - 1) * perPage, limit: perPage },
      order_by: 'id_ASC',
      nested: true,
      version: options.version ?? 'current',
    });

    return {
      data: response.data.map((record) => ({
        ...record.attributes,
        __itemTypeId: record.__itemTypeId,
        id: record.id,
        type: record.type,
        item_type: record.relationships.item_type.data,
        creator: record.relationships.creator?.data,
        meta: record.meta,
      })),
      totalCount: response.meta.total_count,
    };
  }

  /** Pull records on demand; at most one page is held by this iterator. */
  async *iterateRecords(
    modelId: string,
    options: PaginationOptions = {},
  ): AsyncGenerator<Item> {
    const perPage = pageSize(options.perPage);
    for (let page = options.page ?? 1; ; page++) {
      // biome-ignore lint/performance/noAwaitInLoops: Fetch pages on demand to bound memory.
      const response = await this.fetchRecords(modelId, {
        ...options,
        page,
        perPage,
      });
      if (response.data.length === 0) {
        if ((page - 1) * perPage < response.totalCount)
          throw new Error('Record listing ended before the reported total.');
        return;
      }
      for (const record of response.data) yield record;
      if (page * perPage >= response.totalCount) return;
      if (response.data.length < perPage)
        throw new Error(
          'The CMA returned a short page before the reported total; the collection may have changed.',
        );
    }
  }

  async updateRecord(
    recordId: string,
    updates: Record<string, unknown>,
  ): Promise<Item> {
    return this.client.items.update(recordId, updates);
  }

  /** Publish incrementally and stop if a batch fails. */
  async publishRecords(
    records: Iterable<RecordReference> | AsyncIterable<RecordReference>,
  ): Promise<void> {
    let batch: RecordReference[] = [];
    let publishedRecords = 0;
    const publishBatch = async () => {
      let result: Awaited<ReturnType<Client['items']['rawBulkPublish']>>;
      try {
        result = await this.client.items.rawBulkPublish({
          data: {
            type: 'item_bulk_publish_operation',
            relationships: { items: { data: batch } },
          },
        });
      } catch (error) {
        throw new PartialPublicationError(publishedRecords, undefined, error);
      }
      const { successful, failed } = result.meta;
      if (
        !Number.isSafeInteger(successful) ||
        !Number.isSafeInteger(failed) ||
        successful < 0 ||
        failed < 0 ||
        successful + failed !== batch.length
      ) {
        throw new PartialPublicationError(
          publishedRecords,
          undefined,
          new Error('The CMA returned inconsistent publication totals.'),
        );
      }
      publishedRecords += successful;
      if (failed > 0)
        throw new PartialPublicationError(
          publishedRecords,
          failed,
          result.data,
        );
      batch = [];
    };

    for await (const record of records) {
      batch.push(record);
      if (batch.length === 200) await publishBatch();
    }
    if (batch.length > 0) await publishBatch();
  }
}

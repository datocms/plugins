import {
  buildClient,
  type Client,
  type ItemTypeDefinition,
  type RawApiTypes,
} from '@datocms/cma-client-browser';
import type { ContentModel, RecordInput } from '../types';

export type CmaClientContext = {
  currentUserAccessToken?: string | null;
  environment: string;
  cmaBaseUrl?: string;
};

export function buildCmaClient(ctx: CmaClientContext): Client {
  if (!ctx.currentUserAccessToken) {
    throw new Error(
      'Scanning saved records requires API access. Enable the plugin permission and reload the page.',
    );
  }
  return buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });
}

// Nested block payloads have a lower CMA page limit than flat record lists.
export const RECORDS_PAGE_SIZE = 30;
export type NestedRecord = RawApiTypes.ItemInstancesTargetSchema<
  ItemTypeDefinition,
  true
>['data'][number];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('The scan was cancelled.', 'AbortError');
}

function cancellable<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('The scan was cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    // Observe both outcomes even if cancellation wins: the SDK has no per-call signal.
    request
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function pageTotal(
  response: { data: NestedRecord[]; meta: { total_count: number } },
  offset: number,
  expectedTotal?: number,
): number {
  const total = response.meta?.total_count;
  if (
    !Array.isArray(response.data) ||
    !Number.isSafeInteger(total) ||
    total < 0
  ) {
    throw new Error(
      'The API returned an incomplete record page. Run the scan again.',
    );
  }
  if (expectedTotal !== undefined && total !== expectedTotal) {
    throw new Error(
      'The record count changed during the scan. Run the scan again for a complete result.',
    );
  }
  if (
    response.data.length > RECORDS_PAGE_SIZE ||
    offset + response.data.length > total
  ) {
    throw new Error(
      'The API returned inconsistent record pagination. Run the scan again.',
    );
  }
  if (response.data.length === 0 && offset < total) {
    throw new Error(
      'The API returned an empty page before all records were loaded. Run the scan again.',
    );
  }
  return total;
}

/** Reads one bounded page at a time; never silently treats a truncated response as complete. */
export async function* readRecords(
  client: Pick<Client, 'items'>,
  modelId: string,
  signal?: AbortSignal,
): AsyncGenerator<NestedRecord> {
  let offset = 0;
  let expectedTotal: number | undefined;
  const seen = new Set<string>();

  while (true) {
    throwIfAborted(signal);
    // biome-ignore lint/performance/noAwaitInLoops: Each page depends on the previous page and is cancellable before the next request.
    const response = await cancellable(
      client.items.rawList({
        nested: true,
        version: 'current',
        filter: { type: modelId },
        order_by: 'id_ASC',
        page: { offset, limit: RECORDS_PAGE_SIZE },
      }),
      signal,
    );
    throwIfAborted(signal);
    const total = pageTotal(response, offset, expectedTotal);
    expectedTotal = total;
    for (const record of response.data) {
      throwIfAborted(signal);
      if (!record.id || seen.has(record.id)) {
        throw new Error(
          'Records changed during pagination. Run the scan again for a complete result.',
        );
      }
      seen.add(record.id);
      yield record;
    }
    offset += response.data.length;
    if (offset >= total) return;
  }
}

type RawRecordInput = {
  id?: string;
  attributes: Record<string, unknown>;
};

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Accepts raw CMA records and the SDK's awaited formValuesToItem result. */
export function toRecordInput(
  raw: RawRecordInput,
  model: ContentModel,
  locale?: string,
): RecordInput {
  const titleField = model.fields.find(
    (field) => field.id === model.titleFieldId,
  );
  const rawTitle = titleField ? raw.attributes[titleField.apiKey] : undefined;
  let title = textValue(rawTitle);
  if (
    titleField?.localized &&
    rawTitle &&
    typeof rawTitle === 'object' &&
    !Array.isArray(rawTitle)
  ) {
    const titles = rawTitle as Record<string, unknown>;
    title =
      (locale ? textValue(titles[locale]) : undefined) ??
      Object.values(titles).map(textValue).find(Boolean);
  }
  return {
    id: raw.id,
    modelId: model.id,
    title: title ?? (raw.id ? `${model.name} ${raw.id}` : `New ${model.name}`),
    values: raw.attributes,
  };
}

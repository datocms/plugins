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

const INCONSISTENT_PAGES =
  'The API returned inconsistent record pagination. Run the scan again.';

/**
 * Requests a reading may make beyond three for every page of records, to step
 * back after deletions. Past that, records change too often to keep up with:
 * the reading goes on without checking that each page follows on from the one
 * before.
 */
const SPARE_REQUESTS = 50;

function pageTotal(
  response: { data: NestedRecord[]; meta: { total_count: number } },
  offset: number,
): number {
  const total = response.meta?.total_count;
  if (
    !Array.isArray(response.data) ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    response.data.some((record) => !record?.id)
  ) {
    throw new Error(
      'The API returned an incomplete record page. Run the scan again.',
    );
  }
  // An empty page past the end is consistent: records were deleted since the page before.
  if (
    response.data.length > RECORDS_PAGE_SIZE ||
    (response.data.length > 0 && offset + response.data.length > total)
  ) {
    throw new Error(INCONSISTENT_PAGES);
  }
  if (response.data.length === 0 && offset < total) {
    throw new Error(
      'The API returned an empty page before all records were loaded. Run the scan again.',
    );
  }
  return total;
}

/**
 * Reads one bounded page at a time, in ID order; never silently treats a
 * truncated response as complete.
 *
 * Records added or deleted during the reading shift the pages. Each page starts
 * with the last record of the page before, so a page that holds a record already
 * read follows on from it. One that doesn't means records before it were
 * deleted, and the reading steps back until it reaches records already read:
 * first by as many records as were deleted, then twice as far each time.
 * Records are yielded once each.
 *
 * If records change too often to keep up with, the reading still goes to the
 * end, then throws to say some records may be missing.
 */
export async function* readRecords(
  client: Pick<Client, 'items'>,
  modelId: string,
  signal?: AbortSignal,
): AsyncGenerator<NestedRecord> {
  const seen = new Set<string>();
  let offset = 0;
  let requests = 0;
  let lastTotal = 0;
  let largestTotal = 0;
  /** How far the last page stepped back; 0 when it followed on. */
  let stepBack = 0;
  let unchecked = false;

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
    const total = pageTotal(response, offset);
    requests += 1;
    const deleted = Math.max(0, lastTotal - total);
    lastTotal = total;
    largestTotal = Math.max(largestTotal, total);
    const followsOn =
      offset === 0 ||
      unchecked ||
      response.data.some((record) => seen.has(record.id));
    if (!followsOn) {
      const budget =
        3 * Math.ceil(largestTotal / (RECORDS_PAGE_SIZE - 1)) + SPARE_REQUESTS;
      if (requests > budget) unchecked = true;
      else {
        stepBack = stepBack === 0 ? deleted + 1 : stepBack * 2;
        offset = Math.max(0, Math.min(offset, total) - stepBack);
        continue;
      }
    }
    stepBack = 0;
    for (const record of response.data) {
      throwIfAborted(signal);
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      yield record;
    }
    const end = offset + response.data.length;
    if (end >= total) break;
    // The next page starts with this page's last record.
    if (response.data.length < 2) throw new Error(INCONSISTENT_PAGES);
    offset = end - 1;
  }
  if (unchecked) {
    throw new Error(
      'Records were added or deleted so often during the scan that some may be missing. Run the scan again for a complete result.',
    );
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

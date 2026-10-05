import type { Client } from '@datocms/cma-client-browser';

export type RecordReadClient = Pick<Client, 'request'>;
export type ExportRecord = Record<string, unknown> & { id: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRecord(): never {
  throw new Error('The API returned an invalid record response.');
}

function relationshipData(value: unknown): unknown {
  if (!isObject(value) || !Object.hasOwn(value, 'data')) invalidRecord();
  const data = value.data;
  if (data !== null && !isObject(data) && !Array.isArray(data)) {
    invalidRecord();
  }
  return data;
}

function normalizeRecord(value: unknown): ExportRecord {
  if (
    !isObject(value) ||
    value.type !== 'item' ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    !isObject(value.attributes) ||
    !isObject(value.relationships)
  ) {
    invalidRecord();
  }
  const itemType = relationshipData(value.relationships.item_type);
  if (
    !isObject(itemType) ||
    typeof itemType.id !== 'string' ||
    !itemType.id.trim()
  ) {
    invalidRecord();
  }
  if (value.meta !== undefined && !isObject(value.meta)) invalidRecord();
  const relationships = Object.fromEntries(
    Object.entries(value.relationships).map(([name, relationship]) => [
      name,
      relationshipData(relationship),
    ]),
  );

  // Match the SDK's root entity shape, preserving field payloads and raw nested
  // blocks by identity. Its recursive item deserializer also visits JSON fields
  // and mistakes arbitrary { type: 'item' } values for CMA block entities.
  const record = {
    __itemTypeId: itemType.id,
    id: value.id,
    type: value.type,
    ...value.attributes,
    ...relationships,
    ...(value.meta ? { meta: value.meta } : {}),
  };
  if (typeof record.id !== 'string' || !record.id.trim()) invalidRecord();
  return record;
}

export async function readRecordPage(
  client: RecordReadClient,
  queryParams: Record<string, unknown>,
): Promise<ExportRecord[]> {
  const body = await client.request<unknown>({
    method: 'GET',
    url: '/items',
    queryParams: { ...queryParams, nested: true },
  });
  if (!isObject(body) || !Array.isArray(body.data)) invalidRecord();
  return body.data.map(normalizeRecord);
}

export async function readRecord(
  client: RecordReadClient,
  id: string,
): Promise<ExportRecord> {
  if (!id.trim())
    throw new Error('A record ID is required to export a record.');
  const body = await client.request<unknown>({
    method: 'GET',
    url: `/items/${encodeURIComponent(id)}`,
    queryParams: { nested: true },
  });
  if (!isObject(body) || !isObject(body.data)) invalidRecord();
  return normalizeRecord(body.data);
}

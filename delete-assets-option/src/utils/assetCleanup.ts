import type { Client } from '@datocms/cma-client-browser';

// Keeps record and asset ID filters short, and bulk deletions below the
// server's 200-upload limit.
const ID_BATCH_SIZE = 100;
const DELETION_TIMEOUT = 30 * 60 * 1000;

export type FieldInfo = {
  api_key: string;
  field_type: string;
  localized: boolean;
};

type Wait = (milliseconds: number) => Promise<void>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function batches(ids: readonly string[]) {
  return Array.from({ length: Math.ceil(ids.length / ID_BATCH_SIZE) }, (_, i) =>
    ids.slice(i * ID_BATCH_SIZE, (i + 1) * ID_BATCH_SIZE),
  );
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

type Visitor = {
  add: (id: unknown) => void;
  fieldsOf: (modelId: string) => Promise<readonly FieldInfo[]>;
};

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

function modelIdOf(record: Record<string, unknown>) {
  const itemType = isObject(record.relationships)
    ? record.relationships.item_type
    : undefined;
  return isObject(itemType) && isObject(itemType.data)
    ? itemType.data.id
    : undefined;
}

async function visitNode(node: unknown, visitor: Visitor): Promise<void> {
  if (!isObject(node)) return;
  if (node.type === 'block' || node.type === 'inlineBlock') {
    await visitRecord(node.item, visitor);
  } else {
    await Promise.all(
      asArray(node.children).map((child) => visitNode(child, visitor)),
    );
  }
}

async function visitValue(
  fieldType: string,
  value: unknown,
  visitor: Visitor,
): Promise<void> {
  if (!isObject(value)) return;
  switch (fieldType) {
    case 'file':
      visitor.add(value.upload_id);
      return;
    case 'gallery':
      for (const file of asArray(value)) {
        if (isObject(file)) visitor.add(file.upload_id);
      }
      return;
    case 'seo':
      visitor.add(value.image);
      return;
    case 'single_block':
      return visitRecord(value, visitor);
    case 'rich_text':
      await Promise.all(
        asArray(value).map((block) => visitRecord(block, visitor)),
      );
      return;
    case 'structured_text':
      return visitNode(value.document, visitor);
  }
}

async function visitRecord(record: unknown, visitor: Visitor): Promise<void> {
  if (!isObject(record) || !isObject(record.attributes)) return;
  const attributes = record.attributes;
  const modelId = modelIdOf(record);
  if (typeof modelId !== 'string') return;

  const fields = await visitor.fieldsOf(modelId);
  await Promise.all(
    fields.flatMap((field) => {
      const value = attributes[field.api_key];
      const values =
        field.localized && isObject(value) ? Object.values(value) : [value];
      return values.map((v) => visitValue(field.field_type, v, visitor));
    }),
  );
}

/**
 * Returns a function that lists the assets used by a raw record fetched with
 * `nested: true`, including the ones in its blocks. Only asset, gallery and
 * SEO fields count: JSON, file metadata and links to other records don't.
 */
export function createUploadCollector(
  loadFields: (modelId: string) => Promise<readonly FieldInfo[]>,
) {
  const fieldsByModel = new Map<string, Promise<readonly FieldInfo[]>>();
  const fieldsOf = (modelId: string) => {
    let fields = fieldsByModel.get(modelId);
    if (!fields) {
      fields = loadFields(modelId);
      fieldsByModel.set(modelId, fields);
    }
    return fields;
  };

  return async (record: unknown): Promise<string[]> => {
    const uploadIds = new Set<string>();
    const add = (id: unknown) => {
      if (typeof id === 'string' && id.trim()) uploadIds.add(id);
    };
    await visitRecord(record, { add, fieldsOf });
    return [...uploadIds];
  };
}

export async function collectAssets(
  client: Client,
  recordIds: readonly string[],
): Promise<string[]> {
  const collect = createUploadCollector((modelId) =>
    client.fields.list(modelId),
  );
  const uploadIds = new Set<string>();
  // A draft can have replaced an asset still used by the published version.
  const queries = batches(recordIds).flatMap((ids) =>
    ['current', 'published'].map((version) => ({
      filter: { ids: ids.join(',') },
      nested: true,
      version,
    })),
  );
  await Promise.all(
    queries.map(async (query) => {
      for await (const record of client.items.rawListPagedIterator(query)) {
        for (const id of await collect(record)) uploadIds.add(id);
      }
    }),
  );
  return [...uploadIds];
}

/** Resolves once none of the records can be found anymore. */
export async function waitForRecordDeletion(
  client: Client,
  recordIds: readonly string[],
  wait: Wait = sleep,
) {
  const deadline = Date.now() + DELETION_TIMEOUT;
  let pending = batches(recordIds);
  let interval = 1000;
  while (pending.length > 0) {
    if (Date.now() > deadline) {
      throw new Error('The records were not deleted.');
    }
    // biome-ignore lint/performance/noAwaitInLoops: polling waits between checks.
    await wait(interval);
    interval = Math.min(interval * 2, 15000);
    const pages = await Promise.all(
      pending.map((ids) =>
        client.items.rawList({
          filter: { ids: ids.join(',') },
          page: { limit: 1 },
        }),
      ),
    );
    pending = pending.filter((_, i) => pages[i].meta.total_count > 0);
  }
}

/**
 * DatoCMS refuses to delete assets still used elsewhere, and reports them as
 * failed instead of failing the whole batch.
 */
export async function deleteAssets(
  client: Client,
  uploadIds: readonly string[],
) {
  let deleted = 0;
  let kept = 0;
  for (const ids of batches(uploadIds)) {
    // biome-ignore lint/performance/noAwaitInLoops: one bulk deletion at a time.
    const { meta } = await client.uploads.rawBulkDestroy({
      data: {
        type: 'upload_bulk_destroy_operation',
        relationships: {
          uploads: { data: ids.map((id) => ({ type: 'upload', id })) },
        },
      },
    });
    deleted += meta.successful;
    kept += ids.length - meta.successful;
  }
  return { deleted, kept };
}

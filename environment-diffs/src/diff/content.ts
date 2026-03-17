import type { ApiTypes, Client } from '@datocms/cma-client-browser';
import { throwIfCancelled, yieldToMainThread } from '../lib/async';
import { createEnvironmentClient } from '../lib/datocms';
import {
  buildDetailValue,
  determineDiffStatus,
  incrementSummary,
  makeSummaryCounts,
} from '../lib/diff';
import { stableClone } from '../lib/stable';
import type {
  CompareTaskContext,
  ContentDiffResult,
  ContentModelDefinition,
  ContentModelSummary,
  ContentSnapshot,
  NormalizedContentRecord,
} from '../types';

const OMITTED_RECORD_KEYS = new Set([
  'id',
  'type',
  'item_type',
  'creator',
  'meta',
  'created_at',
  'updated_at',
  'published_at',
  'first_published_at',
  'publication_scheduled_at',
  'unpublishing_scheduled_at',
  'current_version',
  'is_valid',
  'is_current_version_valid',
  'is_published_version_valid',
  'status',
  'stage',
  'has_children',
]);

function extractLocalizedText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const entry of Object.values(value)) {
      const text = extractLocalizedText(entry);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function normalizeFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFieldValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as Record<string, unknown>;

  if (
    typeof objectValue.upload_id === 'string' ||
    objectValue.type === 'upload' ||
    (typeof objectValue.id === 'string' && 'url' in objectValue && 'md5' in objectValue)
  ) {
    return {
      id:
        (typeof objectValue.id === 'string' && objectValue.id) ||
        (typeof objectValue.upload_id === 'string' ? objectValue.upload_id : null),
      type: 'upload',
    };
  }

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(objectValue).sort()) {
    if (OMITTED_RECORD_KEYS.has(key)) {
      continue;
    }

    result[key] = normalizeFieldValue(objectValue[key]);
  }

  if (typeof objectValue.id === 'string') {
    result.id = objectValue.id;
  }

  if (objectValue.item_type && typeof objectValue.item_type === 'object') {
    const itemTypeValue = objectValue.item_type as { id?: string };
    if (typeof itemTypeValue.id === 'string') {
      result.item_type = itemTypeValue.id;
    }
  }

  return result;
}

function resolveRecordLabel(
  fieldValues: Record<string, unknown>,
  model: ContentModelDefinition,
): string {
  if (model.titleFieldApiKey) {
    const titleValue = extractLocalizedText(fieldValues[model.titleFieldApiKey]);
    if (titleValue) {
      return titleValue;
    }
  }

  for (const field of model.fields) {
    const candidate = extractLocalizedText(fieldValues[field.apiKey]);
    if (candidate) {
      return candidate;
    }
  }

  return 'Untitled record';
}

function buildModelDefinition(
  itemType: ApiTypes.ItemType,
  fields: ApiTypes.Field[],
): ContentModelDefinition {
  return {
    id: itemType.id,
    name: itemType.name,
    apiKey: itemType.api_key,
    titleFieldApiKey:
      fields.find((field) => field.id === itemType.title_field?.id)?.api_key ?? null,
    fields: fields.map((field) => ({
      id: field.id,
      apiKey: field.api_key,
      label: field.label,
      fieldType: field.field_type,
    })),
  };
}

function normalizeRecord(
  record: Record<string, unknown>,
  model: ContentModelDefinition,
): NormalizedContentRecord {
  const fieldValues: Record<string, unknown> = {};

  for (const field of model.fields) {
    fieldValues[field.apiKey] = normalizeFieldValue(record[field.apiKey]);
  }

  const systemValues: Record<string, unknown> = {};
  if (typeof record.position !== 'undefined' && !model.fields.some((field) => field.apiKey === 'position')) {
    systemValues.position = record.position;
  }

  const meta = (record.meta ?? {}) as { status?: string | null };
  const id = typeof record.id === 'string' ? record.id : '';

  return {
    rowId: `record:${id}`,
    id,
    modelId: model.id,
    modelName: model.name,
    modelApiKey: model.apiKey,
    label: resolveRecordLabel(fieldValues, model),
    publicationStatus: meta.status ?? 'unpublished',
    systemValues,
    fieldValues: stableClone(fieldValues),
  };
}

async function fetchContentSnapshot(
  client: Client,
  context: CompareTaskContext,
  stage: number,
  stageLabel: string,
): Promise<ContentSnapshot> {
  context.reportProgress(stage, 4, `${stageLabel}: loading models`);
  const itemTypes = await client.itemTypes.list();
  const models = itemTypes.filter((itemType) => !itemType.modular_block);
  const definitions: ContentModelDefinition[] = [];
  const records: NormalizedContentRecord[] = [];

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    throwIfCancelled(context.signal);
    context.reportProgress(
      stage,
      4,
      `${stageLabel}: ${model.name} (${index + 1}/${models.length})`,
    );

    const fields = await client.fields.list(model.id);
    const definition = buildModelDefinition(model, fields);
    definitions.push(definition);

    for await (const record of client.items.listPagedIterator({
      nested: true,
      filter: {
        type: model.id,
      },
    })) {
      throwIfCancelled(context.signal);
      records.push(
        normalizeRecord(record as unknown as Record<string, unknown>, definition),
      );

      if (records.length % 25 === 0) {
        await yieldToMainThread();
      }
    }
  }

  return {
    models: definitions.sort((left, right) => left.name.localeCompare(right.name)),
    records,
  };
}

export function compareContentSnapshots(
  left: ContentSnapshot,
  right: ContentSnapshot,
): ContentDiffResult {
  const leftById = new Map(left.records.map((record) => [record.rowId, record]));
  const rightById = new Map(right.records.map((record) => [record.rowId, record]));
  const rowIds = Array.from(
    new Set([...leftById.keys(), ...rightById.keys()]),
  ).sort((leftId, rightId) => leftId.localeCompare(rightId));

  const summaryMap = new Map<string, ContentModelSummary>();

  for (const model of [...left.models, ...right.models]) {
    if (!summaryMap.has(model.id)) {
      summaryMap.set(model.id, {
        id: model.id,
        label: model.name,
        description: model.apiKey,
        apiKey: model.apiKey,
        counts: makeSummaryCounts(),
      });
    }
  }

  const rows: ContentDiffResult['rows'] = [];
  const details: ContentDiffResult['details'] = {};

  for (const rowId of rowIds) {
    const leftRecord = leftById.get(rowId);
    const rightRecord = rightById.get(rowId);
    const record = leftRecord ?? rightRecord;

    if (!record) {
      continue;
    }

    const payloadLeft = leftRecord
      ? {
          publicationStatus: leftRecord.publicationStatus,
          systemValues: leftRecord.systemValues,
          fieldValues: leftRecord.fieldValues,
        }
      : undefined;
    const payloadRight = rightRecord
      ? {
          publicationStatus: rightRecord.publicationStatus,
          systemValues: rightRecord.systemValues,
          fieldValues: rightRecord.fieldValues,
        }
      : undefined;

    const status = determineDiffStatus(payloadLeft, payloadRight);
    const summary = summaryMap.get(record.modelId);
    if (summary) {
      incrementSummary(summary.counts, status);
    }

    const detail = buildDetailValue(
      record.label,
      `${record.modelName} · ${record.id}`,
      status,
      payloadLeft,
      payloadRight,
    );

    details[rowId] = {
      ...detail,
      modelId: record.modelId,
      modelName: record.modelName,
    };

    rows.push({
      id: rowId,
      entityType: record.modelId,
      label: record.label,
      secondaryLabel: record.modelName,
      status,
      changedCount: detail.changes.length,
      modelId: record.modelId,
      modelName: record.modelName,
      publicationState:
        leftRecord?.publicationStatus === rightRecord?.publicationStatus
          ? leftRecord?.publicationStatus ?? rightRecord?.publicationStatus ?? 'unpublished'
          : `${leftRecord?.publicationStatus ?? 'missing'} → ${rightRecord?.publicationStatus ?? 'missing'}`,
    });
  }

  rows.sort((leftRow, rightRow) => {
    const modelComparison = leftRow.modelName.localeCompare(rightRow.modelName);
    if (modelComparison !== 0) {
      return modelComparison;
    }

    return leftRow.label.localeCompare(rightRow.label);
  });

  return {
    summaryRows: Array.from(summaryMap.values()).sort((leftRow, rightRow) =>
      leftRow.label.localeCompare(rightRow.label),
    ),
    rows,
    details,
  };
}

export async function buildContentDiff(
  apiToken: string,
  leftEnv: string,
  rightEnv: string,
  context: CompareTaskContext,
): Promise<ContentDiffResult> {
  const leftClient = createEnvironmentClient(apiToken, leftEnv);
  const rightClient = createEnvironmentClient(apiToken, rightEnv);

  const leftSnapshot = await fetchContentSnapshot(
    leftClient,
    context,
    1,
    `Loading ${leftEnv}`,
  );
  throwIfCancelled(context.signal);
  const rightSnapshot = await fetchContentSnapshot(
    rightClient,
    context,
    2,
    `Loading ${rightEnv}`,
  );
  throwIfCancelled(context.signal);
  context.reportProgress(3, 4, 'Comparing content snapshots');
  const result = compareContentSnapshots(leftSnapshot, rightSnapshot);
  context.reportProgress(4, 4, 'Content diff ready');
  return result;
}

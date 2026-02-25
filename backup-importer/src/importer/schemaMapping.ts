import type { Client } from '@datocms/cma-client-browser';
import type {
  FieldApiKeyMapByItemType,
  FieldMappingIssue,
  FieldMappingReport,
  FieldsetMappingReport,
  ItemTypeMappingIssue,
  ItemTypeMappingReport,
  JsonObject,
  RecordExportEnvelope,
  SchemaMappingReport,
} from './types';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function extractEntityId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return asString((value as Record<string, unknown>).id);
  }

  return null;
}

function extractItemTypeId(record: JsonObject): string | null {
  return extractEntityId(record.item_type);
}

function indexSourceItemTypeApiKeys(
  envelope: RecordExportEnvelope,
): Map<string, string> {
  const index = new Map<string, string>();

  for (const [sourceItemTypeId, sourceApiKey] of Object.entries(
    envelope.schema.itemTypeIdToApiKey,
  )) {
    index.set(sourceItemTypeId, sourceApiKey);
  }

  return index;
}

function indexSourceFieldsByItemType(
  envelope: RecordExportEnvelope,
): Map<
  string,
  Array<{
    fieldId: string;
    apiKey: string;
    fieldType: string | null;
    localized: boolean;
  }>
> {
  const result = new Map<
    string,
    Array<{
      fieldId: string;
      apiKey: string;
      fieldType: string | null;
      localized: boolean;
    }>
  >();

  for (const field of envelope.schema.fields) {
    const sourceItemTypeId = extractEntityId(field.item_type);
    const fieldId = asString(field.id);
    const apiKey = asString(field.api_key);

    if (!sourceItemTypeId || !apiKey || !fieldId) {
      continue;
    }

    const existing = result.get(sourceItemTypeId) ?? [];
    existing.push({
      fieldId,
      apiKey,
      fieldType: asString(field.field_type),
      localized: Boolean(field.localized),
    });
    result.set(sourceItemTypeId, existing);
  }

  return result;
}

export async function buildItemTypeIdMapFromApiKeys(
  client: Client,
  envelope: RecordExportEnvelope,
): Promise<ItemTypeMappingReport> {
  const itemTypeIdMap = new Map<string, string>();
  const missing: ItemTypeMappingIssue[] = [];
  const warnings: string[] = [];

  const targetItemTypes = await client.itemTypes.list();
  const targetIds = new Set<string>();
  const targetByApiKey = new Map<string, string>();
  const seenSourceModelIds = new Set<string>();

  for (const target of targetItemTypes) {
    targetIds.add(target.id);

    if (target.api_key) {
      targetByApiKey.set(target.api_key, target.id);
    }
  }

  for (const [sourceItemTypeId, sourceApiKey] of Object.entries(
    envelope.schema.itemTypeIdToApiKey,
  )) {
    seenSourceModelIds.add(sourceItemTypeId);

    if (targetIds.has(sourceItemTypeId)) {
      itemTypeIdMap.set(sourceItemTypeId, sourceItemTypeId);
      continue;
    }

    if (sourceApiKey && targetByApiKey.has(sourceApiKey)) {
      itemTypeIdMap.set(sourceItemTypeId, targetByApiKey.get(sourceApiKey)!);
      continue;
    }

    missing.push({
      sourceItemTypeId,
      sourceApiKey: sourceApiKey ?? null,
      reason: 'No target model matched source ID or api_key.',
    });
  }

  for (const record of envelope.records) {
    const sourceRecordId = asString(record.id);
    const sourceItemTypeId = extractItemTypeId(record);

    if (!sourceItemTypeId) {
      warnings.push(
        `Record '${sourceRecordId ?? 'unknown'}' is missing source item_type id.`,
      );
      continue;
    }

    if (!seenSourceModelIds.has(sourceItemTypeId)) {
      missing.push({
        sourceItemTypeId,
        sourceApiKey: envelope.schema.itemTypeIdToApiKey[sourceItemTypeId] ?? null,
        reason: `Record '${sourceRecordId ?? 'unknown'}' references an unmapped source model.`,
      });
      seenSourceModelIds.add(sourceItemTypeId);
    }
  }

  return {
    itemTypeIdMap,
    missing,
    warnings,
  };
}

export async function buildFieldApiKeyMapByItemType(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  itemTypeIdMap: Map<string, string>;
}): Promise<FieldMappingReport> {
  const fieldApiKeyMapByItemType: FieldApiKeyMapByItemType = new Map();
  const fieldIdMap = new Map<string, string>();
  const missing: FieldMappingIssue[] = [];
  const warnings: string[] = [];

  const sourceItemTypeApiKeys = indexSourceItemTypeApiKeys(args.envelope);
  const sourceFieldsByItemType = indexSourceFieldsByItemType(args.envelope);

  const targetFieldLists = new Map<string, Awaited<ReturnType<Client['fields']['list']>>>();

  await Promise.all(
    Array.from(args.itemTypeIdMap.values()).map(async (targetItemTypeId) => {
      if (targetFieldLists.has(targetItemTypeId)) {
        return;
      }

      const targetFields = await args.client.fields.list(targetItemTypeId);
      targetFieldLists.set(targetItemTypeId, targetFields);
    }),
  );

  for (const [sourceItemTypeId, targetItemTypeId] of args.itemTypeIdMap.entries()) {
    const sourceFields = sourceFieldsByItemType.get(sourceItemTypeId) ?? [];
    const sourceItemTypeApiKey = sourceItemTypeApiKeys.get(sourceItemTypeId) ?? null;
    const targetFields = targetFieldLists.get(targetItemTypeId) ?? [];
    const targetByApiKey = new Map(
      targetFields
        .filter((field) => Boolean(field.api_key))
        .map((field) => [field.api_key!, field]),
    );

    const perModelMap = new Map<string, string>();

    for (const sourceField of sourceFields) {
      const targetField = targetByApiKey.get(sourceField.apiKey);

      if (!targetField) {
        missing.push({
          sourceItemTypeId,
          sourceItemTypeApiKey,
          sourceFieldApiKey: sourceField.apiKey,
          reason: 'No target field matched source field api_key.',
        });
        continue;
      }

      perModelMap.set(sourceField.apiKey, targetField.api_key!);
      if (sourceField.fieldId && targetField.id) {
        fieldIdMap.set(sourceField.fieldId, targetField.id);
      }

      if (
        sourceField.fieldType &&
        targetField.field_type &&
        sourceField.fieldType !== targetField.field_type
      ) {
        warnings.push(
          `Field type mismatch for ${sourceItemTypeApiKey ?? sourceItemTypeId}.${sourceField.apiKey}: source '${sourceField.fieldType}', target '${targetField.field_type}'.`,
        );
      }

      if (sourceField.localized !== Boolean(targetField.localized)) {
        warnings.push(
          `Field localization mismatch for ${sourceItemTypeApiKey ?? sourceItemTypeId}.${sourceField.apiKey}.`,
        );
      }
    }

    fieldApiKeyMapByItemType.set(sourceItemTypeId, perModelMap);
  }

  return {
    fieldApiKeyMapByItemType,
    fieldIdMap,
    missing,
    warnings,
  };
}

function createEmptyFieldsetMappingReport(): FieldsetMappingReport {
  return {
    fieldsetIdMap: new Map<string, string>(),
    missing: [],
    warnings: [],
  };
}

export async function buildSchemaMapping(
  client: Client,
  envelope: RecordExportEnvelope,
): Promise<SchemaMappingReport> {
  const itemTypes = await buildItemTypeIdMapFromApiKeys(client, envelope);
  const fields = await buildFieldApiKeyMapByItemType({
    client,
    envelope,
    itemTypeIdMap: itemTypes.itemTypeIdMap,
  });

  return {
    itemTypes,
    fieldsets: createEmptyFieldsetMappingReport(),
    fields,
  };
}

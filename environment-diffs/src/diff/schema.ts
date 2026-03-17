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
  NormalizedSchemaEntity,
  SchemaDiffResult,
  SchemaDiffRow,
  SchemaEntityType,
  SchemaSnapshot,
} from '../types';

const SCHEMA_ENTITY_ORDER: SchemaEntityType[] = [
  'model',
  'block',
  'fieldset',
  'field',
];

function toRowId(entityType: SchemaEntityType, id: string) {
  return `${entityType}:${id}`;
}

function normalizeItemType(itemType: ApiTypes.ItemType): NormalizedSchemaEntity {
  const entityType: SchemaEntityType = itemType.modular_block ? 'block' : 'model';

  return {
    rowId: toRowId(entityType, itemType.id),
    id: itemType.id,
    entityType,
    label: itemType.name,
    apiKey: itemType.api_key,
    payload: stableClone({
      name: itemType.name,
      api_key: itemType.api_key,
      singleton: itemType.singleton,
      all_locales_required: itemType.all_locales_required,
      sortable: itemType.sortable,
      modular_block: itemType.modular_block,
      draft_mode_active: itemType.draft_mode_active,
      draft_saving_active: itemType.draft_saving_active,
      tree: itemType.tree,
      ordering_direction: itemType.ordering_direction,
      ordering_meta: itemType.ordering_meta,
      hint: itemType.hint,
      inverse_relationships_enabled: itemType.inverse_relationships_enabled,
      presentation_title_field: itemType.presentation_title_field?.id ?? null,
      presentation_image_field: itemType.presentation_image_field?.id ?? null,
      title_field: itemType.title_field?.id ?? null,
      image_preview_field: itemType.image_preview_field?.id ?? null,
      excerpt_field: itemType.excerpt_field?.id ?? null,
      ordering_field: itemType.ordering_field?.id ?? null,
      workflow: itemType.workflow?.id ?? null,
      collection_appearance: itemType.collection_appearance,
    }),
  };
}

function normalizeFieldset(
  itemType: ApiTypes.ItemType,
  fieldset: ApiTypes.Fieldset,
): NormalizedSchemaEntity {
  return {
    rowId: toRowId('fieldset', fieldset.id),
    id: fieldset.id,
    entityType: 'fieldset',
    label: fieldset.title,
    parentId: itemType.id,
    parentLabel: itemType.name,
    payload: stableClone({
      title: fieldset.title,
      hint: fieldset.hint,
      position: fieldset.position,
      item_type: itemType.id,
    }),
  };
}

function normalizeField(
  itemType: ApiTypes.ItemType,
  field: ApiTypes.Field,
): NormalizedSchemaEntity {
  return {
    rowId: toRowId('field', field.id),
    id: field.id,
    entityType: 'field',
    label: field.label,
    apiKey: field.api_key,
    parentId: itemType.id,
    parentLabel: itemType.name,
    payload: stableClone({
      label: field.label,
      api_key: field.api_key,
      field_type: field.field_type,
      localized: field.localized,
      default_value: field.default_value,
      hint: field.hint,
      validators: field.validators,
      appearance: field.appearance,
      position: field.position,
      deep_filtering_enabled: field.deep_filtering_enabled,
      fieldset: field.fieldset?.id ?? null,
      item_type: itemType.id,
    }),
  };
}

async function fetchSchemaSnapshot(
  client: Client,
  context: CompareTaskContext,
  stage: number,
  stageLabel: string,
): Promise<SchemaSnapshot> {
  context.reportProgress(stage, 4, `${stageLabel}: loading item types`);
  const itemTypes = await client.itemTypes.list();
  const entities: NormalizedSchemaEntity[] = itemTypes.map(normalizeItemType);

  for (let index = 0; index < itemTypes.length; index += 1) {
    const itemType = itemTypes[index];
    throwIfCancelled(context.signal);
    context.reportProgress(
      stage,
      4,
      `${stageLabel}: ${itemType.name} (${index + 1}/${itemTypes.length})`,
    );

    const fields = await client.fields.list(itemType.id);
    entities.push(...fields.map((field) => normalizeField(itemType, field)));

    if (!itemType.modular_block) {
      const fieldsets = await client.fieldsets.list(itemType.id);
      entities.push(
        ...fieldsets.map((fieldset) => normalizeFieldset(itemType, fieldset)),
      );
    }

    if ((index + 1) % 4 === 0) {
      await yieldToMainThread();
    }
  }

  return {
    entities,
  };
}

export function compareSchemaSnapshots(
  left: SchemaSnapshot,
  right: SchemaSnapshot,
): SchemaDiffResult {
  const leftById = new Map(left.entities.map((entity) => [entity.rowId, entity]));
  const rightById = new Map(right.entities.map((entity) => [entity.rowId, entity]));
  const rowIds = Array.from(
    new Set([...leftById.keys(), ...rightById.keys()]),
  ).sort((leftId, rightId) => leftId.localeCompare(rightId));

  const summary = {
    model: makeSummaryCounts(),
    block: makeSummaryCounts(),
    fieldset: makeSummaryCounts(),
    field: makeSummaryCounts(),
  };
  const rows: SchemaDiffRow[] = [];
  const details: SchemaDiffResult['details'] = {};

  for (const rowId of rowIds) {
    const leftEntity = leftById.get(rowId);
    const rightEntity = rightById.get(rowId);
    const entity = leftEntity ?? rightEntity;

    if (!entity) {
      continue;
    }

    const status = determineDiffStatus(leftEntity?.payload, rightEntity?.payload);
    incrementSummary(summary[entity.entityType], status);

    const detail = buildDetailValue(
      entity.label,
      entity.parentLabel
        ? `${entity.parentLabel}${entity.apiKey ? ` · ${entity.apiKey}` : ''}`
        : entity.apiKey,
      status,
      leftEntity?.payload,
      rightEntity?.payload,
    );

    details[rowId] = {
      ...detail,
      entityType: entity.entityType,
    };

    rows.push({
      id: rowId,
      entityType: entity.entityType,
      label: entity.label,
      secondaryLabel: entity.apiKey,
      parentLabel: entity.parentLabel,
      status,
      changedCount: detail.changes.length,
    });
  }

  rows.sort((leftRow, rightRow) => {
    const typeOrder =
      SCHEMA_ENTITY_ORDER.indexOf(leftRow.entityType) -
      SCHEMA_ENTITY_ORDER.indexOf(rightRow.entityType);

    if (typeOrder !== 0) {
      return typeOrder;
    }

    return leftRow.label.localeCompare(rightRow.label);
  });

  return {
    summary,
    rows,
    details,
  };
}

export async function buildSchemaDiff(
  apiToken: string,
  leftEnv: string,
  rightEnv: string,
  context: CompareTaskContext,
): Promise<SchemaDiffResult> {
  const leftClient = createEnvironmentClient(apiToken, leftEnv);
  const rightClient = createEnvironmentClient(apiToken, rightEnv);

  const leftSnapshot = await fetchSchemaSnapshot(
    leftClient,
    context,
    1,
    `Loading ${leftEnv}`,
  );
  throwIfCancelled(context.signal);
  const rightSnapshot = await fetchSchemaSnapshot(
    rightClient,
    context,
    2,
    `Loading ${rightEnv}`,
  );
  throwIfCancelled(context.signal);
  context.reportProgress(3, 4, 'Comparing schema snapshots');
  const result = compareSchemaSnapshots(leftSnapshot, rightSnapshot);
  context.reportProgress(4, 4, 'Schema diff ready');
  return result;
}

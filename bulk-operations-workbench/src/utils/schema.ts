import type { Client } from '@datocms/cma-client-browser';
import type { FieldSummary, ModelSummary, RoleSummary } from '../types';
import { TEXT_LIKE_FIELD_TYPES } from '../types';

type RawRecord = Record<string, unknown>;

function readRelationshipId(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const asRecord = value as RawRecord;
    if (typeof asRecord.id === 'string') {
      return asRecord.id;
    }
    const nestedData = asRecord.data;
    if (nestedData && typeof nestedData === 'object') {
      const nestedId = (nestedData as RawRecord).id;
      if (typeof nestedId === 'string') {
        return nestedId;
      }
    }
  }

  return null;
}

function mapRawModel(raw: RawRecord): ModelSummary {
  const attributes =
    raw.attributes && typeof raw.attributes === 'object'
      ? (raw.attributes as RawRecord)
      : undefined;

  const relationships =
    raw.relationships && typeof raw.relationships === 'object'
      ? (raw.relationships as RawRecord)
      : undefined;

  const workflowId =
    readRelationshipId(raw.workflow) ?? readRelationshipId(relationships?.workflow);

  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? attributes?.name ?? raw.id ?? ''),
    apiKey: String(raw.api_key ?? attributes?.api_key ?? raw.id ?? ''),
    workflowId,
  };
}

export async function loadModels(client: Client): Promise<ModelSummary[]> {
  const itemTypes = await client.itemTypes.list();

  return itemTypes
    .filter((itemType) => !itemType.modular_block)
    .map((itemType) => mapRawModel(itemType as RawRecord))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSiteLocales(client: Client): Promise<string[]> {
  const site = await client.site.find();
  return Array.isArray(site.locales) ? site.locales : [];
}

export async function loadRoles(client: Client): Promise<RoleSummary[]> {
  const roles = await client.roles.list();

  return roles
    .map((role) => ({
      id: role.id,
      name: role.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadFieldsForModel(
  client: Client,
  modelId: string,
): Promise<FieldSummary[]> {
  const fields = await client.fields.list(modelId);

  return fields
    .map((field) => ({
      ...field,
      itemTypeId: modelId,
      name: field.api_key,
    }))
    .sort((a, b) => a.api_key.localeCompare(b.api_key));
}

export function isTextLikeField(field: FieldSummary): boolean {
  return TEXT_LIKE_FIELD_TYPES.includes(field.field_type as never);
}

export function getTextLikeFields(fields: FieldSummary[]): FieldSummary[] {
  return fields.filter(isTextLikeField);
}

export function getFieldMap(fields: FieldSummary[]): Map<string, FieldSummary> {
  return new Map(fields.map((field) => [field.id, field]));
}

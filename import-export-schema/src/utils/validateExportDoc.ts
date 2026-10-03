import { fieldTypeDescriptions } from './datocms/schema';
import type { ExportDoc } from './types';

const fieldTypes = new Set(Object.keys(fieldTypeDescriptions));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the file envelope before indexing it or making any CMA changes. */
export function assertExportDoc(value: unknown): asserts value is ExportDoc {
  if (
    !isObject(value) ||
    (value.version !== '1' && value.version !== '2') ||
    !Array.isArray(value.entities)
  ) {
    throw new Error('Invalid export: expected a version 1 or 2 schema file.');
  }
  const allowedTypes = new Set(['item_type', 'field', 'fieldset', 'plugin']);
  const seen = new Set<string>();
  for (const entity of value.entities) {
    if (
      !isObject(entity) ||
      typeof entity.type !== 'string' ||
      !allowedTypes.has(entity.type) ||
      (typeof entity.id !== 'string' && typeof entity.id !== 'number') ||
      String(entity.id).length === 0 ||
      !isObject(entity.attributes)
    ) {
      throw new Error('Invalid export: malformed schema entity.');
    }
    const key = `${entity.type}:${entity.id}`;
    if (seen.has(key)) {
      throw new Error(`Invalid export: duplicate ${key}.`);
    }
    seen.add(key);
    validateAttributes(entity.type, entity.attributes);
  }
}

function validateAttributes(type: string, attributes: Record<string, unknown>) {
  const names =
    type === 'item_type'
      ? ['name', 'api_key']
      : type === 'field'
        ? ['label', 'api_key']
        : [];
  for (const name of names) {
    if (typeof attributes[name] !== 'string' || attributes[name].length === 0) {
      throw new Error(`Invalid export: ${type} requires ${name}.`);
    }
  }
  if (
    type === 'field' &&
    (typeof attributes.field_type !== 'string' ||
      !fieldTypes.has(attributes.field_type))
  ) {
    throw new Error('Invalid export: missing or unknown field_type.');
  }
}

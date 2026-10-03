import md5 from 'md5';
import { isValidCommentArray } from '../../src/entrypoints/utils/typeGuards';
import type { QaRecord } from './fixtures';

export type AggregateBinding = {
  aggregateId: string;
  sourceId: string;
  contentHashMD5: string;
};

export type AggregateBindingScope = {
  sourceModelId: string;
  recordIds: readonly string[];
  sourceCount: number;
};

function requireQa(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Record comments live QA: ${message}`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  requireQa(encoded !== undefined, 'aggregate content contains a non-JSON value');
  return encoded;
}

/** Hash complete JSON content; object keys are sorted and array order is preserved. */
export function createAggregateBinding(
  record: QaRecord,
  scope: AggregateBindingScope,
): AggregateBinding {
  const rawAttributes = record.attributes;
  const attributes = rawAttributes && typeof rawAttributes === 'object' && !Array.isArray(rawAttributes)
    ? rawAttributes as Record<string, unknown> : record;
  requireQa(typeof record.id === 'string' && record.id.length > 0, 'aggregate ID is missing');
  requireQa(attributes.model_id === scope.sourceModelId, 'aggregate is outside the QA source model');
  const sourceId = attributes.record_id;
  requireQa(typeof sourceId === 'string', 'aggregate source ID is missing');
  const index = scope.recordIds.indexOf(sourceId);
  requireQa(index >= 0 && index < scope.sourceCount, 'aggregate is outside the bounded QA source IDs');
  const content: unknown = typeof attributes.content === 'string'
    ? JSON.parse(attributes.content) : attributes.content;
  requireQa(isValidCommentArray(content), 'aggregate binding content is malformed');
  return { aggregateId: record.id, sourceId, contentHashMD5: md5(canonicalJson(content)) };
}

export function assertAggregateBindings(
  bindings: readonly AggregateBinding[],
  expectedCount: number,
): void {
  requireQa(bindings.length === expectedCount, `unexpected aggregate binding count: ${bindings.length}`);
  requireQa(new Set(bindings.map((binding) => binding.aggregateId)).size === expectedCount, 'aggregate binding IDs are duplicated');
  requireQa(new Set(bindings.map((binding) => binding.sourceId)).size === expectedCount, 'aggregate source bindings are duplicated');
}

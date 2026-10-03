import type { FieldCopyConfig, ModelOption } from '../types';

export const LARGE_SELECTION_THRESHOLD = 500;
export const VISIBLE_SELECTION_LIMIT = 100;
export const PLUGIN_PARAMETER_LIMIT_BYTES = 10_000;

export function validatePluginParameters(parameters: unknown): void {
  const size = new TextEncoder().encode(JSON.stringify(parameters)).byteLength;
  if (size > PLUGIN_PARAMETER_LIMIT_BYTES) {
    throw new Error(
      "Configuration exceeds DatoCMS's 10 KB plugin settings limit. Remove some field configurations before saving.",
    );
  }
}

function readFieldCopyConfig(entry: unknown): FieldCopyConfig | undefined {
  if (typeof entry !== 'object' || entry === null) return;
  const config = entry as Record<string, unknown>;
  if (
    typeof config.modelId !== 'string' ||
    !config.modelId ||
    typeof config.fieldId !== 'string' ||
    !config.fieldId
  ) {
    return;
  }
  return {
    modelId: config.modelId,
    fieldId: config.fieldId,
    modelLabel: typeof config.modelLabel === 'string' ? config.modelLabel : '',
    fieldLabel: typeof config.fieldLabel === 'string' ? config.fieldLabel : '',
  };
}

/** Keep the persisted shape, accepting old configurations without display labels. */
export function normalizeFieldCopyConfigs(value: unknown): FieldCopyConfig[] {
  if (!Array.isArray(value)) return [];

  const result: FieldCopyConfig[] = [];
  const seen = new Map<string, Set<string>>();
  for (const entry of value) {
    const config = readFieldCopyConfig(entry);
    if (!config) continue;
    let fields = seen.get(config.modelId);
    if (!fields) {
      fields = new Set();
      seen.set(config.modelId, fields);
    }
    if (fields.has(config.fieldId)) continue;
    fields.add(config.fieldId);
    result.push(config);
  }
  return result;
}

export function getLargeSelectionHint(
  count: number,
  noun: string,
): string | undefined {
  if (count <= LARGE_SELECTION_THRESHOLD) return;
  return `Showing up to ${VISIBLE_SELECTION_LIMIT} results. Type to search all ${count} ${noun}.`;
}

export function indexFieldCopyConfigs(
  configs: readonly FieldCopyConfig[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const config of configs) {
    let fields = result.get(config.modelId);
    if (!fields) {
      fields = new Set();
      result.set(config.modelId, fields);
    }
    fields.add(config.fieldId);
  }
  return result;
}

// SDK parameters are immutable snapshots. Weak keys release old configurations
// without retaining every version observed by overrideFieldExtensions.
const configurationIndexes = new WeakMap<object, Map<string, Set<string>>>();

export function isFieldCopyConfigured(
  parameters: unknown,
  modelId: string,
  fieldId: string,
): boolean {
  if (!Array.isArray(parameters)) return false;
  let index = configurationIndexes.get(parameters);
  if (!index) {
    index = indexFieldCopyConfigs(normalizeFieldCopyConfigs(parameters));
    configurationIndexes.set(parameters, index);
  }
  return index.get(modelId)?.has(fieldId) ?? false;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Small menus stay identical. Large menus search every option but render a bounded result. */
export function getVisibleOptions<T extends ModelOption>(
  options: readonly T[],
  query: string,
  selectedIds?: ReadonlySet<string>,
): readonly T[] {
  if (options.length <= LARGE_SELECTION_THRESHOLD) return options;
  const search = normalizeSearch(query.trim());
  const result: T[] = [];
  for (const option of options) {
    if (selectedIds?.has(option.value)) continue;
    if (
      !search ||
      normalizeSearch(option.label).includes(search) ||
      normalizeSearch(option.value).includes(search)
    ) {
      result.push(option);
      if (result.length === VISIBLE_SELECTION_LIMIT) break;
    }
  }
  return result;
}

/** Cache only a bounded number of visited models; share in-flight requests. */
export function createCachedModelLoader<T>(
  load: (modelId: string) => Promise<T[]>,
  cacheLimit = 20,
): (modelId: string) => Promise<T[]> {
  const cache = new Map<string, T[]>();
  const pending = new Map<string, Promise<T[]>>();
  return (modelId) => {
    const cached = cache.get(modelId);
    if (cached) {
      cache.delete(modelId);
      cache.set(modelId, cached);
      return Promise.resolve(cached);
    }
    const existing = pending.get(modelId);
    if (existing) return existing;

    const request = Promise.resolve()
      .then(() => load(modelId))
      .then((fields) => {
        cache.set(modelId, fields);
        while (cache.size > Math.max(0, cacheLimit)) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        return fields;
      })
      .finally(() => pending.delete(modelId));
    pending.set(modelId, request);
    return request;
  };
}

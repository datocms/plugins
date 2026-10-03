import {
  buildClient,
  type Client as CmaClient,
} from '@datocms/cma-client-browser';
import {
  ASSET_EXPORT_VERSION,
  ASSET_MANIFEST_FILENAME,
  ASSET_ZIP_ENTRY_PATTERN,
  ASSET_ZIP_FILENAME_TEMPLATE,
  MAX_FILES_PER_ZIP,
  MAX_ZIP_BYTES,
  readLastAssetExportSnapshot,
  SIZE_SAFETY_FACTOR,
} from './assetExport';
import { mapWithConcurrency, throwIfAborted } from './exportRuntime';

export const RECORD_EXPORT_VERSION = '2.1.0';

const PLUGIN_VERSION =
  process.env.REACT_APP_PLUGIN_VERSION ??
  process.env.npm_package_version ??
  '1.0.0';

type JsonObject = Record<string, unknown>;

export type ExportScope = 'bulk' | 'single-record';

export type ExportFilters = {
  modelIDs?: string[];
  textQuery?: string;
};

export type SiteManifestInfo = {
  sourceProjectId: string | null;
  sourceEnvironment: string | null;
  defaultLocale: string | null;
  locales: string[];
};

export type ConfigurationResourceName =
  | 'site'
  | 'scheduledPublications'
  | 'scheduledUnpublishings'
  | 'fieldsets'
  | 'menuItems'
  | 'schemaMenuItems'
  | 'modelFilters'
  | 'plugins'
  | 'workflows'
  | 'roles'
  | 'webhooks'
  | 'buildTriggers';

export type ConfigurationExportWarning = {
  resource: ConfigurationResourceName;
  message: string;
};

export type ScheduledActionSummary = {
  itemId: string;
  itemTypeId: string | null;
  scheduledAt: string;
  currentVersion: string | null;
};

export type ProjectConfigurationExport = {
  site: JsonObject | null;
  scheduledPublications: ScheduledActionSummary[];
  scheduledUnpublishings: ScheduledActionSummary[];
  fieldsets: JsonObject[];
  menuItems: JsonObject[];
  schemaMenuItems: JsonObject[];
  modelFilters: JsonObject[];
  plugins: JsonObject[];
  workflows: JsonObject[];
  roles: JsonObject[];
  webhooks: JsonObject[];
  buildTriggers: JsonObject[];
  warnings: ConfigurationExportWarning[];
};

export type SchemaFieldSummary = {
  fieldId: string;
  apiKey: string;
  fieldType: string;
  localized: boolean;
};

export type RecordReference = {
  recordSourceId: string;
  sourceBlockId: string | null;
  fieldApiKey: string;
  locale: string | null;
  jsonPath: string;
  targetSourceId: string;
  kind: string;
};

export type UploadReference = {
  recordSourceId: string;
  sourceBlockId: string | null;
  fieldApiKey: string;
  locale: string | null;
  jsonPath: string;
  targetSourceId: string;
  kind: string;
};

export type StructuredTextReference = {
  recordSourceId: string;
  sourceBlockId: string | null;
  fieldApiKey: string;
  locale: string | null;
  jsonPath: string;
  targetSourceId: string;
  targetType: 'record' | 'block';
  kind: 'link' | 'block';
};

export type BlockReference = {
  recordSourceId: string;
  sourceBlockId: string | null;
  fieldApiKey: string;
  locale: string | null;
  jsonPath: string;
  blockSourceId: string;
  blockModelId: string | null;
  parentBlockSourceId: string | null;
  kind: string;
  synthetic: boolean;
};

export type RecordExportPartition = {
  exportId: string;
  index: number;
  recordOffset: number;
  isLast: boolean;
};

export type RecordExportEnvelope = {
  manifest: {
    exportVersion: string;
    pluginVersion: string;
    exportedAt: string;
    sourceProjectId: string | null;
    sourceEnvironment: string | null;
    defaultLocale: string | null;
    locales: string[];
    scope: ExportScope;
    filtersUsed: ExportFilters;
    partition?: RecordExportPartition;
    configurationExport: {
      includedResources: ConfigurationResourceName[];
      warningCount: number;
    };
  };
  schema: {
    itemTypes: JsonObject[];
    fields: JsonObject[];
    itemTypeIdToApiKey: Record<string, string>;
    fieldIdToApiKey: Record<string, string>;
    fieldsByItemType: Record<string, SchemaFieldSummary[]>;
  };
  projectConfiguration: ProjectConfigurationExport;
  records: JsonObject[];
  referenceIndex: {
    recordRefs: RecordReference[];
    uploadRefs: UploadReference[];
    structuredTextRefs: StructuredTextReference[];
    blockRefs: BlockReference[];
  };
  assetPackageInfo: {
    packageVersion: string;
    zipNamingConvention: string;
    zipEntryNamingConvention: string;
    manifestFilename: string;
    chunkingDefaults: {
      maxZipBytes: number;
      maxFilesPerZip: number;
      sizeSafetyFactor: number;
    };
    lastAssetExportSnapshot: ReturnType<typeof readLastAssetExportSnapshot>;
  };
};

type ProjectConfigurationClient = Pick<
  CmaClient,
  | 'site'
  | 'fieldsets'
  | 'menuItems'
  | 'schemaMenuItems'
  | 'itemTypeFilters'
  | 'plugins'
  | 'workflows'
  | 'roles'
  | 'webhooks'
  | 'buildTriggers'
>;

type FieldDefinition = {
  fieldId: string;
  itemTypeId: string;
  apiKey: string;
  fieldType: string;
  localized: boolean;
};

type ReferenceContext = {
  recordSourceId: string;
  sourceBlockId: string | null;
  fieldApiKey: string;
  locale: string | null;
  jsonPath: string;
};

type ReferenceCollector = {
  maxEntries: number;
  entryCount: number;
  maxBytes: number;
  estimatedBytes: number;
  recordRefs: RecordReference[];
  uploadRefs: UploadReference[];
  structuredTextRefs: StructuredTextReference[];
  blockRefs: BlockReference[];
  recordRefKeys: Set<string>;
  uploadRefKeys: Set<string>;
  structuredTextRefKeys: Set<string>;
  blockRefKeys: Set<string>;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

function normalizeJsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isObject);
}

function asJsonObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function emptySiteManifestInfo(): SiteManifestInfo {
  return {
    sourceProjectId: null,
    sourceEnvironment: null,
    defaultLocale: null,
    locales: [],
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown error';
}

function defaultProjectConfigurationExport(): ProjectConfigurationExport {
  return {
    site: null,
    scheduledPublications: [],
    scheduledUnpublishings: [],
    fieldsets: [],
    menuItems: [],
    schemaMenuItems: [],
    modelFilters: [],
    plugins: [],
    workflows: [],
    roles: [],
    webhooks: [],
    buildTriggers: [],
    warnings: [],
  };
}

function extractEntityId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (isObject(value)) {
    return asString(value.id);
  }

  return null;
}

function extractUploadId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!isObject(value)) {
    return null;
  }

  return asString(value.id) ?? asString(value.upload_id);
}

function extractItemTypeId(entity: JsonObject): string | null {
  const relationships = asJsonObject(entity.relationships);
  const itemTypeRelationship = relationships
    ? asJsonObject(relationships.item_type)
    : null;
  return (
    extractEntityId(entity.item_type) ??
    extractEntityId(itemTypeRelationship?.data) ??
    (isObject(entity.meta) ? extractEntityId(entity.meta.item_type) : null)
  );
}

function entityAttributes(entity: JsonObject): JsonObject {
  // Nested blocks retain the JSON:API shape even when items.list() returns
  // deserialized top-level records. Keep the original payload and its paths.
  return !('item_type' in entity) &&
    isObject(entity.attributes) &&
    isObject(entity.relationships)
    ? entity.attributes
    : entity;
}

function entityAttributesPath(entity: JsonObject, jsonPath: string): string {
  return entityAttributes(entity) === entity
    ? jsonPath
    : appendPath(jsonPath, 'attributes');
}

function appendPath(basePath: string, segment: string | number): string {
  if (typeof segment === 'number') {
    return `${basePath}[${segment}]`;
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
    return `${basePath}.${segment}`;
  }

  return `${basePath}[${JSON.stringify(segment)}]`;
}

function createSyntheticBlockId(
  recordSourceId: string,
  jsonPath: string,
): string {
  return `synthetic::${recordSourceId}::${jsonPath}`;
}

export class ReferenceIndexLimitError extends Error {
  constructor(
    readonly limit: number,
    readonly unit: 'entries' | 'bytes' = 'entries',
  ) {
    super(`Reference index exceeds ${limit} ${unit} in one export part.`);
    this.name = 'ReferenceIndexLimitError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function createReferenceCollector(
  maxEntries = 50_000,
  maxBytes = 16 * 1024 * 1024,
): ReferenceCollector {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('The reference index limit must be a positive integer.');
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error(
      'The reference index byte budget must be a positive integer.',
    );
  }
  return {
    maxEntries,
    entryCount: 0,
    maxBytes,
    estimatedBytes: 0,
    recordRefs: [],
    uploadRefs: [],
    structuredTextRefs: [],
    blockRefs: [],
    recordRefKeys: new Set<string>(),
    uploadRefKeys: new Set<string>(),
    structuredTextRefKeys: new Set<string>(),
    blockRefKeys: new Set<string>(),
  };
}

function reserveReferenceEntry(collector: ReferenceCollector, key: string) {
  if (collector.entryCount >= collector.maxEntries) {
    throw new ReferenceIndexLimitError(collector.maxEntries);
  }
  // Budget both the deduplication key and the retained reference/context.
  // Four bytes per character conservatively covers their string storage and
  // prevents a few unusually deep JSON paths from defeating the entry cap.
  const estimatedBytes = 256 + key.length * 4;
  if (collector.estimatedBytes + estimatedBytes > collector.maxBytes) {
    throw new ReferenceIndexLimitError(collector.maxBytes, 'bytes');
  }
  collector.estimatedBytes += estimatedBytes;
  collector.entryCount++;
}

function getContextKey(
  context: Pick<
    ReferenceContext,
    'recordSourceId' | 'sourceBlockId' | 'fieldApiKey' | 'locale' | 'jsonPath'
  >,
): string {
  return JSON.stringify([
    context.recordSourceId,
    context.sourceBlockId ?? '',
    context.fieldApiKey,
    context.locale ?? '',
    context.jsonPath,
  ]);
}

function addRecordReference(
  collector: ReferenceCollector,
  context: ReferenceContext,
  targetSourceId: string,
  kind: string,
) {
  const key = `${getContextKey(context)}|${targetSourceId}|${kind}`;
  if (collector.recordRefKeys.has(key)) {
    return;
  }

  reserveReferenceEntry(collector, key);
  collector.recordRefKeys.add(key);
  collector.recordRefs.push({
    ...context,
    targetSourceId,
    kind,
  });
}

function addUploadReference(
  collector: ReferenceCollector,
  context: ReferenceContext,
  targetSourceId: string,
  kind: string,
) {
  const key = `${getContextKey(context)}|${targetSourceId}|${kind}`;
  if (collector.uploadRefKeys.has(key)) {
    return;
  }

  reserveReferenceEntry(collector, key);
  collector.uploadRefKeys.add(key);
  collector.uploadRefs.push({
    ...context,
    targetSourceId,
    kind,
  });
}

function addStructuredTextReference(
  collector: ReferenceCollector,
  context: ReferenceContext,
  targetSourceId: string,
  targetType: 'record' | 'block',
  kind: 'link' | 'block',
) {
  const key = `${getContextKey(context)}|${targetSourceId}|${targetType}|${kind}`;
  if (collector.structuredTextRefKeys.has(key)) {
    return;
  }

  reserveReferenceEntry(collector, key);
  collector.structuredTextRefKeys.add(key);
  collector.structuredTextRefs.push({
    ...context,
    targetSourceId,
    targetType,
    kind,
  });
}

function addBlockReference(
  collector: ReferenceCollector,
  context: ReferenceContext,
  blockSourceId: string,
  blockModelId: string | null,
  parentBlockSourceId: string | null,
  kind: string,
  synthetic: boolean,
) {
  const key = `${getContextKey(context)}|${blockSourceId}|${
    blockModelId ?? ''
  }|${parentBlockSourceId ?? ''}|${kind}`;

  if (collector.blockRefKeys.has(key)) {
    return;
  }

  reserveReferenceEntry(collector, key);
  collector.blockRefKeys.add(key);
  collector.blockRefs.push({
    ...context,
    blockSourceId,
    blockModelId,
    parentBlockSourceId,
    kind,
    synthetic,
  });
}

function normalizeFieldDefinitions(fields: JsonObject[]): FieldDefinition[] {
  const definitions: FieldDefinition[] = [];

  for (const field of fields) {
    const attributes = entityAttributes(field);
    const fieldId = asString(field.id);
    const itemTypeId = extractItemTypeId(field);
    const apiKey = asString(attributes.api_key);
    const fieldType = asString(attributes.field_type) ?? 'unknown';
    const localized = asBoolean(attributes.localized);

    if (!fieldId || !itemTypeId || !apiKey) {
      continue;
    }

    definitions.push({
      fieldId,
      itemTypeId,
      apiKey,
      fieldType,
      localized,
    });
  }

  return definitions;
}

type FieldDefinitionsByItemType = Map<string, Map<string, FieldDefinition>>;

function indexFieldsByItemType(
  fields: FieldDefinition[],
): FieldDefinitionsByItemType {
  const byItemType: FieldDefinitionsByItemType = new Map();

  for (const field of fields) {
    let definitions = byItemType.get(field.itemTypeId);
    if (!definitions) {
      definitions = new Map();
      byItemType.set(field.itemTypeId, definitions);
    }
    definitions.set(field.apiKey, field);
  }

  return byItemType;
}

type ReferenceTaskBase = {
  value: unknown;
  context: ReferenceContext;
  parentBlockSourceId: string | null;
  index?: number;
};

type ReferenceTask = ReferenceTaskBase &
  (
    | { mode: 'unknown' | 'structured-node' | 'structured-value' }
    | { mode: 'field'; definition: FieldDefinition }
    | { mode: 'block' | 'block-collection'; kind: string }
    | {
        mode: 'object-children';
        entries: [string, unknown][];
        entryMode: 'unknown' | 'structured-node';
        ignoredKey?: string;
      }
  );

const ENTITY_METADATA_KEYS = new Set([
  'id',
  'type',
  'item_type',
  'meta',
  'relationships',
  '__itemTypeId',
  'created_at',
  'updated_at',
  'is_valid',
  'position',
  'stage',
  'creator',
]);

function pushEntityFieldTasks(
  tasks: ReferenceTask[],
  entity: JsonObject,
  context: ReferenceContext,
  fieldDefinitionsByItemType: FieldDefinitionsByItemType,
  sourceBlockId: string | null,
) {
  const itemTypeId = extractItemTypeId(entity);
  const definitions = itemTypeId
    ? fieldDefinitionsByItemType.get(itemTypeId)
    : undefined;
  const attributes = entityAttributes(entity);
  const attributesPath = entityAttributesPath(entity, context.jsonPath);
  const entries = Object.entries(attributes);

  // A LIFO work stack visits fields in their payload order without recursive
  // calls, including deeply nested blocks and Structured Text documents.
  for (let index = entries.length - 1; index >= 0; index--) {
    const [apiKey, value] = entries[index];
    const definition = definitions?.get(apiKey);
    if (
      !definition &&
      attributes === entity &&
      ENTITY_METADATA_KEYS.has(apiKey)
    ) {
      continue;
    }
    const task = {
      value,
      context: {
        ...context,
        sourceBlockId,
        fieldApiKey: apiKey,
        jsonPath: appendPath(attributesPath, apiKey),
      },
      parentBlockSourceId: sourceBlockId,
    };
    tasks.push(
      definition
        ? { ...task, mode: 'field', definition }
        : { ...task, mode: 'unknown' },
    );
  }
}

type ReferenceTraversal = {
  tasks: ReferenceTask[];
  collector: ReferenceCollector;
  fieldsByItemType: FieldDefinitionsByItemType;
};

type FieldReferenceTask = ReferenceTaskBase & {
  mode: 'field';
  definition: FieldDefinition;
};
type BlockReferenceTask = ReferenceTaskBase & {
  mode: 'block' | 'block-collection';
  kind: string;
};
type ChildrenReferenceTask = ReferenceTaskBase & {
  mode: 'object-children';
  entries: [string, unknown][];
  entryMode: 'unknown' | 'structured-node';
  ignoredKey?: string;
};

function inspectLinkField(task: FieldReferenceTask, state: ReferenceTraversal) {
  const { value, context } = task;
  const fieldType = task.definition.fieldType;
  const values =
    (fieldType === 'links' || fieldType === 'gallery') && Array.isArray(value)
      ? value
      : [value];
  const upload = fieldType === 'file' || fieldType === 'gallery';
  for (let index = 0; index < values.length; index++) {
    const referenceContext =
      values === value
        ? { ...context, jsonPath: appendPath(context.jsonPath, index) }
        : context;
    const target = upload
      ? extractUploadId(values[index])
      : extractEntityId(values[index]);
    if (!target) continue;
    if (upload) {
      addUploadReference(state.collector, referenceContext, target, fieldType);
    } else {
      addRecordReference(state.collector, referenceContext, target, fieldType);
    }
  }
}

function inspectFieldTask(task: FieldReferenceTask, state: ReferenceTraversal) {
  if (task.definition.localized && isObject(task.value)) {
    const locales = Object.entries(task.value);
    for (let index = locales.length - 1; index >= 0; index--) {
      const [locale, value] = locales[index];
      state.tasks.push({
        ...task,
        value,
        definition: { ...task.definition, localized: false },
        context: {
          ...task.context,
          locale,
          jsonPath: appendPath(task.context.jsonPath, locale),
        },
      });
    }
    return;
  }
  switch (task.definition.fieldType) {
    case 'json':
      // Arbitrary JSON has no CMA reference semantics, even when it contains
      // objects shaped like items, uploads or blocks.
      return;
    case 'link':
    case 'links':
    case 'file':
    case 'gallery':
      inspectLinkField(task, state);
      return;
    case 'structured_text':
      state.tasks.push({ ...task, mode: 'structured-value' });
      return;
    case 'rich_text':
    case 'modular_content':
    case 'single_block':
      state.tasks.push({
        ...task,
        mode: 'block-collection',
        kind: task.definition.fieldType,
      });
      return;
    default:
      state.tasks.push({ ...task, mode: 'unknown' });
  }
}

function inspectBlockCollectionTask(
  task: BlockReferenceTask,
  state: ReferenceTraversal,
) {
  if (!Array.isArray(task.value)) {
    state.tasks.push({ ...task, mode: 'block' });
    return;
  }
  const index = task.index ?? 0;
  if (index >= task.value.length) return;
  state.tasks.push({ ...task, index: index + 1 });
  state.tasks.push({
    ...task,
    mode: 'block',
    index: undefined,
    value: task.value[index],
    context: {
      ...task.context,
      jsonPath: appendPath(task.context.jsonPath, index),
    },
  });
}

function inspectBlockTask(task: BlockReferenceTask, state: ReferenceTraversal) {
  const { value, context } = task;
  const existingId = extractEntityId(value);
  if (!existingId && !isObject(value)) return;
  const blockSourceId =
    existingId ??
    createSyntheticBlockId(context.recordSourceId, context.jsonPath);
  const blockModelId = isObject(value) ? extractItemTypeId(value) : null;
  addBlockReference(
    state.collector,
    context,
    blockSourceId,
    blockModelId,
    task.parentBlockSourceId,
    task.kind,
    !existingId,
  );
  if (task.kind.startsWith('structured_text_')) {
    addStructuredTextReference(
      state.collector,
      context,
      blockSourceId,
      'block',
      'block',
    );
  }
  if (isObject(value)) {
    pushEntityFieldTasks(
      state.tasks,
      value,
      context,
      state.fieldsByItemType,
      blockSourceId,
    );
  }
}

function inspectStructuredTextLinks(
  value: unknown[],
  context: ReferenceContext,
  collector: ReferenceCollector,
) {
  for (let index = 0; index < value.length; index++) {
    const target = extractEntityId(value[index]);
    if (!target) continue;
    const linkContext = {
      ...context,
      jsonPath: appendPath(appendPath(context.jsonPath, 'links'), index),
    };
    addRecordReference(
      collector,
      linkContext,
      target,
      'structured_text_links_array',
    );
    addStructuredTextReference(
      collector,
      linkContext,
      target,
      'record',
      'link',
    );
  }
}

function inspectStructuredValueTask(
  task: ReferenceTaskBase,
  state: ReferenceTraversal,
) {
  const { value, context } = task;
  if (!isObject(value)) return;
  if (Array.isArray(value.links)) {
    inspectStructuredTextLinks(value.links, context, state.collector);
  }
  if (Array.isArray(value.blocks)) {
    state.tasks.push({
      ...task,
      mode: 'block-collection',
      kind: 'structured_text_blocks_array',
      value: value.blocks,
      context: { ...context, jsonPath: appendPath(context.jsonPath, 'blocks') },
    });
  }
  state.tasks.push({
    ...task,
    mode: 'structured-node',
    value: 'document' in value ? value.document : value,
    context:
      'document' in value
        ? { ...context, jsonPath: appendPath(context.jsonPath, 'document') }
        : context,
  });
}

function pushObjectChildren(
  task: ReferenceTaskBase,
  value: JsonObject,
  state: ReferenceTraversal,
  mode: 'unknown' | 'structured-node',
  ignoredKey?: string,
) {
  state.tasks.push({
    ...task,
    mode: 'object-children',
    entries: Object.entries(value),
    entryMode: mode,
    ignoredKey,
    index: 0,
  });
}

function inspectObjectChildrenTask(
  task: ChildrenReferenceTask,
  state: ReferenceTraversal,
) {
  const index = task.index ?? 0;
  if (index >= task.entries.length) return;
  state.tasks.push({ ...task, index: index + 1 });
  const [key, value] = task.entries[index];
  if (key === task.ignoredKey) return;
  state.tasks.push({
    mode: task.entryMode,
    value,
    parentBlockSourceId: task.parentBlockSourceId,
    context: {
      ...task.context,
      jsonPath: appendPath(task.context.jsonPath, key),
    },
  });
}

function inspectStructuredNodeTask(
  task: ReferenceTaskBase,
  value: JsonObject,
  state: ReferenceTraversal,
) {
  const nodeType = asString(value.type);
  const context = {
    ...task.context,
    jsonPath: appendPath(task.context.jsonPath, 'item'),
  };
  if (nodeType === 'itemLink' || nodeType === 'inlineItem') {
    const target = extractEntityId(value.item);
    if (target) {
      addRecordReference(
        state.collector,
        context,
        target,
        `structured_text_${nodeType}`,
      );
      addStructuredTextReference(
        state.collector,
        context,
        target,
        'record',
        'link',
      );
    }
  } else if (nodeType === 'block' || nodeType === 'inlineBlock') {
    state.tasks.push({
      ...task,
      mode: 'block',
      value: value.item,
      context,
      kind:
        nodeType === 'block'
          ? 'structured_text_block'
          : 'structured_text_inline_block',
    });
  }
  pushObjectChildren(task, value, state, 'structured-node', 'item');
}

function inspectUnknownTask(
  task: ReferenceTaskBase,
  value: JsonObject,
  state: ReferenceTraversal,
) {
  const modelId = extractItemTypeId(value);
  if (modelId && state.fieldsByItemType.has(modelId)) {
    state.tasks.push({ ...task, mode: 'block', kind: 'nested_block' });
    return;
  }
  const type = asString(value.type);
  const target = extractEntityId(value);
  if (target && type === 'upload') {
    addUploadReference(state.collector, task.context, target, 'unknown_upload');
  } else if (target && type === 'item') {
    addRecordReference(state.collector, task.context, target, 'unknown_item');
  }
  pushObjectChildren(task, value, state, 'unknown');
}

function inspectArrayTask(task: ReferenceTask, state: ReferenceTraversal) {
  if (!Array.isArray(task.value)) return;
  const index = task.index ?? 0;
  if (index >= task.value.length) return;
  state.tasks.push({ ...task, index: index + 1 });
  state.tasks.push({
    ...task,
    index: undefined,
    value: task.value[index],
    context: {
      ...task.context,
      jsonPath: appendPath(task.context.jsonPath, index),
    },
  });
}

function inspectReferenceTask(task: ReferenceTask, state: ReferenceTraversal) {
  if (task.value === null || task.value === undefined) return;
  switch (task.mode) {
    case 'field':
      return inspectFieldTask(task, state);
    case 'block':
      return inspectBlockTask(task, state);
    case 'block-collection':
      return inspectBlockCollectionTask(task, state);
    case 'structured-value':
      return inspectStructuredValueTask(task, state);
    case 'object-children':
      return inspectObjectChildrenTask(task, state);
    default:
      if (Array.isArray(task.value)) return inspectArrayTask(task, state);
      if (!isObject(task.value)) return;
      if (task.mode === 'structured-node') {
        inspectStructuredNodeTask(task, task.value, state);
      } else {
        inspectUnknownTask(task, task.value, state);
      }
  }
}

function collectReferenceIndex(
  records: JsonObject[],
  fieldsByItemType: FieldDefinitionsByItemType,
  maxReferenceEntries?: number,
  maxReferenceBytes?: number,
) {
  const state: ReferenceTraversal = {
    tasks: [],
    collector: createReferenceCollector(maxReferenceEntries, maxReferenceBytes),
    fieldsByItemType,
  };
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    const recordSourceId = extractEntityId(record);
    if (!recordSourceId) continue;
    pushEntityFieldTasks(
      state.tasks,
      record,
      {
        recordSourceId,
        sourceBlockId: null,
        fieldApiKey: '',
        locale: null,
        jsonPath: `$.records[${recordIndex}]`,
      },
      fieldsByItemType,
      null,
    );
    while (state.tasks.length > 0) {
      const task = state.tasks.pop();
      if (task) inspectReferenceTask(task, state);
    }
  }
  const { collector } = state;
  return {
    recordRefs: collector.recordRefs,
    uploadRefs: collector.uploadRefs,
    structuredTextRefs: collector.structuredTextRefs,
    blockRefs: collector.blockRefs,
  };
}

function extractSiteManifestInfoFromSitePayload(
  sitePayload: JsonObject | null,
): SiteManifestInfo {
  if (!sitePayload) {
    return emptySiteManifestInfo();
  }

  const attributes = isObject(sitePayload.attributes)
    ? sitePayload.attributes
    : sitePayload;

  const locales = Array.isArray(attributes.locales)
    ? attributes.locales.filter(
        (locale): locale is string => typeof locale === 'string',
      )
    : [];
  const defaultLocale =
    asString(attributes.default_locale) ??
    asString(attributes.locale) ??
    locales[0] ??
    null;

  return {
    sourceProjectId: asString(sitePayload.id) ?? null,
    sourceEnvironment:
      asString(attributes.environment) ??
      asString(attributes.internal_subdomain) ??
      null,
    defaultLocale,
    locales,
  };
}

function getScheduledTimestamp(
  record: JsonObject,
  key: 'publication_scheduled_at' | 'unpublishing_scheduled_at',
): string | null {
  const directValue = asString(entityAttributes(record)[key]);
  if (directValue) {
    return directValue;
  }

  const meta = asJsonObject(record.meta);
  if (!meta) {
    return null;
  }

  return asString(meta[key]);
}

export function appendScheduledActions(
  configuration: Pick<
    ProjectConfigurationExport,
    'scheduledPublications' | 'scheduledUnpublishings'
  >,
  records: JsonObject[],
) {
  for (const record of records) {
    const itemId = extractEntityId(record);
    if (!itemId) {
      continue;
    }
    const meta = asJsonObject(record.meta);
    for (const [key, actions] of [
      ['publication_scheduled_at', configuration.scheduledPublications],
      ['unpublishing_scheduled_at', configuration.scheduledUnpublishings],
    ] as const) {
      const scheduledAt = getScheduledTimestamp(record, key);
      if (scheduledAt) {
        actions.push({
          itemId,
          itemTypeId: extractItemTypeId(record),
          scheduledAt,
          currentVersion: meta ? asString(meta.current_version) : null,
        });
      }
    }
  }
}

async function fetchResourceWithWarning<T>(args: {
  resource: ConfigurationResourceName;
  warnings: ConfigurationExportWarning[];
  operation: () => Promise<T>;
  fallback: T;
  signal?: AbortSignal;
}): Promise<T> {
  throwIfAborted(args.signal);
  try {
    const result = await args.operation();
    throwIfAborted(args.signal);
    return result;
  } catch (error) {
    throwIfAborted(args.signal);
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    args.warnings.push({
      resource: args.resource,
      message: normalizeErrorMessage(error),
    });
    return args.fallback;
  }
}

const CONFIGURATION_RESOURCE_NAMES: ConfigurationResourceName[] = [
  'site',
  'scheduledPublications',
  'scheduledUnpublishings',
  'fieldsets',
  'menuItems',
  'schemaMenuItems',
  'modelFilters',
  'plugins',
  'workflows',
  'roles',
  'webhooks',
  'buildTriggers',
];

export async function fetchProjectConfigurationExport(args: {
  client: ProjectConfigurationClient;
  itemTypes: JsonObject[];
  records: JsonObject[];
  signal?: AbortSignal;
}): Promise<{
  projectConfiguration: ProjectConfigurationExport;
  siteInfo: SiteManifestInfo;
}> {
  const warnings: ConfigurationExportWarning[] = [];

  const sitePayload = await fetchResourceWithWarning({
    resource: 'site',
    warnings,
    operation: () => args.client.site.find(),
    fallback: null,
    signal: args.signal,
  });
  const site = asJsonObject(sitePayload);

  const itemTypeIds = Array.from(
    new Set(
      args.itemTypes
        .map((itemType) => asString(itemType.id))
        .filter((itemTypeId): itemTypeId is string => Boolean(itemTypeId)),
    ),
  );

  const fieldsetGroups = await mapWithConcurrency(
    itemTypeIds,
    3,
    async (itemTypeId) =>
      normalizeJsonObjectArray(
        await fetchResourceWithWarning({
          resource: 'fieldsets',
          warnings,
          operation: async () => {
            try {
              return await args.client.fieldsets.list(itemTypeId);
            } catch (error) {
              throwIfAborted(args.signal);
              throw new Error(
                `Item type ${itemTypeId}: ${normalizeErrorMessage(error)}`,
              );
            }
          },
          fallback: [],
          signal: args.signal,
        }),
      ),
  );

  const resources: {
    resource: Exclude<
      ConfigurationResourceName,
      'site' | 'fieldsets' | 'scheduledPublications' | 'scheduledUnpublishings'
    >;
    operation: () => Promise<unknown>;
  }[] = [
    { resource: 'menuItems', operation: () => args.client.menuItems.list() },
    {
      resource: 'schemaMenuItems',
      operation: () => args.client.schemaMenuItems.list(),
    },
    {
      resource: 'modelFilters',
      operation: () => args.client.itemTypeFilters.list(),
    },
    { resource: 'plugins', operation: () => args.client.plugins.list() },
    { resource: 'workflows', operation: () => args.client.workflows.list() },
    { resource: 'roles', operation: () => args.client.roles.list() },
    { resource: 'webhooks', operation: () => args.client.webhooks.list() },
    {
      resource: 'buildTriggers',
      operation: () => args.client.buildTriggers.list(),
    },
  ];
  const results = await mapWithConcurrency(
    resources,
    3,
    async ({ resource, operation }) =>
      normalizeJsonObjectArray(
        await fetchResourceWithWarning({
          resource,
          operation,
          warnings,
          fallback: [],
          signal: args.signal,
        }),
      ),
  );
  const projectConfiguration = defaultProjectConfigurationExport();
  projectConfiguration.site = site;
  projectConfiguration.fieldsets = fieldsetGroups.flat();
  projectConfiguration.warnings = warnings;
  for (let index = 0; index < resources.length; index++) {
    projectConfiguration[resources[index].resource] = results[index];
  }
  appendScheduledActions(projectConfiguration, args.records);

  return {
    projectConfiguration,
    siteInfo: extractSiteManifestInfoFromSitePayload(site),
  };
}

export async function fetchSiteManifestInfo(
  apiToken: string,
  baseUrl?: string,
): Promise<SiteManifestInfo> {
  try {
    const client = buildClient({ apiToken, baseUrl });
    const payload = await client.site.rawFind();
    return extractSiteManifestInfoFromSitePayload(asJsonObject(payload.data));
  } catch (_error) {
    return emptySiteManifestInfo();
  }
}

export function buildRecordExportEnvelope(args: {
  records: JsonObject[];
  itemTypes: JsonObject[];
  fields: JsonObject[];
  siteInfo: SiteManifestInfo;
  projectConfiguration?: ProjectConfigurationExport;
  filtersUsed: ExportFilters;
  scope: ExportScope;
  partition?: RecordExportPartition;
  maxReferenceEntries?: number;
  maxReferenceBytes?: number;
}): RecordExportEnvelope {
  const normalizedFields = normalizeFieldDefinitions(args.fields);
  const fieldsByItemTypeIndex = indexFieldsByItemType(normalizedFields);
  const projectConfiguration =
    args.projectConfiguration ?? defaultProjectConfigurationExport();

  const itemTypeIdToApiKey = args.itemTypes.reduce<Record<string, string>>(
    (acc, itemType) => {
      const id = asString(itemType.id);
      const apiKey = asString(entityAttributes(itemType).api_key);

      if (id && apiKey) {
        acc[id] = apiKey;
      }

      return acc;
    },
    {},
  );

  const fieldIdToApiKey = normalizedFields.reduce<Record<string, string>>(
    (acc, field) => {
      acc[field.fieldId] = field.apiKey;
      return acc;
    },
    {},
  );

  const fieldsByItemType = normalizedFields.reduce<
    Record<string, SchemaFieldSummary[]>
  >((acc, field) => {
    if (!acc[field.itemTypeId]) {
      acc[field.itemTypeId] = [];
    }

    acc[field.itemTypeId].push({
      fieldId: field.fieldId,
      apiKey: field.apiKey,
      fieldType: field.fieldType,
      localized: field.localized,
    });

    return acc;
  }, {});

  return {
    manifest: {
      exportVersion: RECORD_EXPORT_VERSION,
      pluginVersion: PLUGIN_VERSION,
      exportedAt: new Date().toISOString(),
      sourceProjectId: args.siteInfo.sourceProjectId,
      sourceEnvironment: args.siteInfo.sourceEnvironment,
      defaultLocale: args.siteInfo.defaultLocale,
      locales: args.siteInfo.locales,
      scope: args.scope,
      filtersUsed: args.filtersUsed,
      ...(args.partition ? { partition: args.partition } : {}),
      configurationExport: {
        includedResources: CONFIGURATION_RESOURCE_NAMES,
        warningCount: projectConfiguration.warnings.length,
      },
    },
    schema: {
      itemTypes: args.itemTypes,
      fields: args.fields,
      itemTypeIdToApiKey,
      fieldIdToApiKey,
      fieldsByItemType,
    },
    projectConfiguration,
    records: args.records,
    referenceIndex: collectReferenceIndex(
      args.records,
      fieldsByItemTypeIndex,
      args.maxReferenceEntries,
      args.maxReferenceBytes,
    ),
    assetPackageInfo: {
      packageVersion: ASSET_EXPORT_VERSION,
      zipNamingConvention: ASSET_ZIP_FILENAME_TEMPLATE,
      zipEntryNamingConvention: ASSET_ZIP_ENTRY_PATTERN,
      manifestFilename: ASSET_MANIFEST_FILENAME,
      chunkingDefaults: {
        maxZipBytes: MAX_ZIP_BYTES,
        maxFilesPerZip: MAX_FILES_PER_ZIP,
        sizeSafetyFactor: SIZE_SAFETY_FACTOR,
      },
      lastAssetExportSnapshot: readLastAssetExportSnapshot(
        args.siteInfo.sourceProjectId,
        args.siteInfo.sourceEnvironment,
      ),
    },
  };
}

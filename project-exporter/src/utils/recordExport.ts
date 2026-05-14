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
  return (
    extractEntityId(entity.item_type) ??
    (isObject(entity.meta) ? extractEntityId(entity.meta.item_type) : null)
  );
}

function appendPath(basePath: string, segment: string): string {
  if (segment.startsWith('[')) {
    return `${basePath}${segment}`;
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
    return `${basePath}.${segment}`;
  }

  const escaped = segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${basePath}["${escaped}"]`;
}

function createSyntheticBlockId(
  recordSourceId: string,
  jsonPath: string,
): string {
  return `synthetic::${recordSourceId}::${jsonPath}`;
}

function createReferenceCollector(): ReferenceCollector {
  return {
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

function getContextKey(
  context: Pick<
    ReferenceContext,
    'recordSourceId' | 'sourceBlockId' | 'fieldApiKey' | 'locale' | 'jsonPath'
  >,
): string {
  return [
    context.recordSourceId,
    context.sourceBlockId ?? '',
    context.fieldApiKey,
    context.locale ?? '',
    context.jsonPath,
  ].join('|');
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
    const fieldId = asString(field.id);
    const itemTypeId = extractEntityId(field.item_type);
    const apiKey = asString(field.api_key);
    const fieldType = asString(field.field_type) ?? 'unknown';
    const localized = asBoolean(field.localized);

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

function indexFieldsByItemType(
  fields: FieldDefinition[],
): Map<string, FieldDefinition[]> {
  const byItemType = new Map<string, FieldDefinition[]>();

  for (const field of fields) {
    const existing = byItemType.get(field.itemTypeId) ?? [];
    existing.push(field);
    byItemType.set(field.itemTypeId, existing);
  }

  return byItemType;
}

function inspectLinkValue(
  value: unknown,
  context: ReferenceContext,
  collector: ReferenceCollector,
  kind: string,
) {
  const targetSourceId = extractEntityId(value);
  if (!targetSourceId) {
    return;
  }

  addRecordReference(collector, context, targetSourceId, kind);
}

function inspectLinksValue(
  value: unknown,
  context: ReferenceContext,
  collector: ReferenceCollector,
  kind: string,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      inspectLinkValue(
        entry,
        { ...context, jsonPath: appendPath(context.jsonPath, `[${index}]`) },
        collector,
        kind,
      );
    });
    return;
  }

  inspectLinkValue(value, context, collector, kind);
}

function inspectUploadValue(
  value: unknown,
  context: ReferenceContext,
  collector: ReferenceCollector,
  kind: string,
) {
  const targetSourceId = extractUploadId(value);
  if (!targetSourceId) {
    return;
  }

  addUploadReference(collector, context, targetSourceId, kind);
}

function inspectUploadsValue(
  value: unknown,
  context: ReferenceContext,
  collector: ReferenceCollector,
  kind: string,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      inspectUploadValue(
        entry,
        { ...context, jsonPath: appendPath(context.jsonPath, `[${index}]`) },
        collector,
        kind,
      );
    });
    return;
  }

  inspectUploadValue(value, context, collector, kind);
}

function inspectUnknownValue(
  value: unknown,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  parentBlockSourceId: string | null,
) {
  if (value === null || typeof value === 'undefined') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      inspectUnknownValue(
        entry,
        { ...context, jsonPath: appendPath(context.jsonPath, `[${index}]`) },
        fieldDefinitionsByItemType,
        collector,
        parentBlockSourceId,
      );
    });
    return;
  }

  if (!isObject(value)) {
    return;
  }

  const nestedItemTypeId = extractItemTypeId(value);
  const nestedId = extractEntityId(value);
  const knownModel =
    nestedItemTypeId && fieldDefinitionsByItemType.has(nestedItemTypeId);

  if (nestedId && knownModel) {
    inspectBlockObject(
      value,
      context,
      fieldDefinitionsByItemType,
      collector,
      'nested_block',
      parentBlockSourceId,
    );
    return;
  }

  const uploadLikeId = extractUploadId(value);
  const typeHint = asString(value.type)?.toLowerCase() ?? null;

  if (uploadLikeId && typeHint?.includes('upload')) {
    addUploadReference(collector, context, uploadLikeId, 'unknown_upload');
  }

  if (nestedId && typeHint?.includes('item')) {
    addRecordReference(collector, context, nestedId, 'unknown_item');
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    inspectUnknownValue(
      nestedValue,
      { ...context, jsonPath: appendPath(context.jsonPath, key) },
      fieldDefinitionsByItemType,
      collector,
      parentBlockSourceId,
    );
  }
}

function handleItemLinkOrInlineItemNode(
  nodeType: string,
  nodeItem: unknown,
  context: ReferenceContext,
  collector: ReferenceCollector,
) {
  const targetSourceId = extractEntityId(nodeItem);
  if (!targetSourceId) {
    return;
  }
  addRecordReference(
    collector,
    context,
    targetSourceId,
    `structured_text_${nodeType}`,
  );
  addStructuredTextReference(
    collector,
    context,
    targetSourceId,
    'record',
    'link',
  );
}

function handleBlockNode(
  nodeItem: unknown,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  parentBlockSourceId: string | null,
) {
  const blockSourceId = extractEntityId(nodeItem);
  if (blockSourceId) {
    addBlockReference(
      collector,
      context,
      blockSourceId,
      null,
      parentBlockSourceId,
      'structured_text_block',
      false,
    );
    addStructuredTextReference(
      collector,
      context,
      blockSourceId,
      'block',
      'block',
    );
  }

  if (isObject(nodeItem)) {
    inspectBlockObject(
      nodeItem,
      { ...context, jsonPath: appendPath(context.jsonPath, 'item') },
      fieldDefinitionsByItemType,
      collector,
      'structured_text_block',
      parentBlockSourceId,
    );
  }
}

function inspectStructuredTextNode(
  node: unknown,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  parentBlockSourceId: string | null,
) {
  if (node === null || typeof node === 'undefined') {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      inspectStructuredTextNode(
        entry,
        { ...context, jsonPath: appendPath(context.jsonPath, `[${index}]`) },
        fieldDefinitionsByItemType,
        collector,
        parentBlockSourceId,
      );
    });
    return;
  }

  if (!isObject(node)) {
    return;
  }

  const nodeType = asString(node.type);
  const nodeItem = node.item;

  if (nodeType === 'itemLink' || nodeType === 'inlineItem') {
    handleItemLinkOrInlineItemNode(nodeType, nodeItem, context, collector);
  }

  if (nodeType === 'block') {
    handleBlockNode(
      nodeItem,
      context,
      fieldDefinitionsByItemType,
      collector,
      parentBlockSourceId,
    );
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'item') {
      continue;
    }

    inspectStructuredTextNode(
      value,
      { ...context, jsonPath: appendPath(context.jsonPath, key) },
      fieldDefinitionsByItemType,
      collector,
      parentBlockSourceId,
    );
  }
}

function inspectStructuredTextValue(
  value: unknown,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  parentBlockSourceId: string | null,
) {
  if (!isObject(value)) {
    return;
  }

  if (Array.isArray(value.links)) {
    value.links.forEach((entry, index) => {
      const targetSourceId = extractEntityId(entry);
      if (!targetSourceId) {
        return;
      }

      const refContext = {
        ...context,
        jsonPath: appendPath(
          appendPath(context.jsonPath, 'links'),
          `[${index}]`,
        ),
      };

      addRecordReference(
        collector,
        refContext,
        targetSourceId,
        'structured_text_links_array',
      );
      addStructuredTextReference(
        collector,
        refContext,
        targetSourceId,
        'record',
        'link',
      );
    });
  }

  if (Array.isArray(value.blocks)) {
    value.blocks.forEach((entry, index) => {
      const refContext = {
        ...context,
        jsonPath: appendPath(
          appendPath(context.jsonPath, 'blocks'),
          `[${index}]`,
        ),
      };

      const blockSourceId = extractEntityId(entry);
      if (blockSourceId) {
        addBlockReference(
          collector,
          refContext,
          blockSourceId,
          null,
          parentBlockSourceId,
          'structured_text_blocks_array',
          false,
        );
        addStructuredTextReference(
          collector,
          refContext,
          blockSourceId,
          'block',
          'block',
        );
      }

      if (isObject(entry)) {
        inspectBlockObject(
          entry,
          refContext,
          fieldDefinitionsByItemType,
          collector,
          'structured_text_block',
          parentBlockSourceId,
        );
      }
    });
  }

  if ('document' in value) {
    inspectStructuredTextNode(
      value.document,
      { ...context, jsonPath: appendPath(context.jsonPath, 'document') },
      fieldDefinitionsByItemType,
      collector,
      parentBlockSourceId,
    );
  } else {
    inspectStructuredTextNode(
      value,
      context,
      fieldDefinitionsByItemType,
      collector,
      parentBlockSourceId,
    );
  }
}

function inspectFieldValue(
  value: unknown,
  fieldDefinition: FieldDefinition,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  parentBlockSourceId: string | null,
) {
  if (value === null || typeof value === 'undefined') {
    return;
  }

  if (fieldDefinition.localized && isObject(value)) {
    for (const [locale, localizedValue] of Object.entries(value)) {
      inspectFieldValue(
        localizedValue,
        { ...fieldDefinition, localized: false },
        {
          ...context,
          locale,
          jsonPath: appendPath(context.jsonPath, locale),
        },
        fieldDefinitionsByItemType,
        collector,
        parentBlockSourceId,
      );
    }
    return;
  }

  switch (fieldDefinition.fieldType) {
    case 'link':
      inspectLinkValue(value, context, collector, 'link');
      break;
    case 'links':
      inspectLinksValue(value, context, collector, 'links');
      break;
    case 'file':
      inspectUploadValue(value, context, collector, 'file');
      break;
    case 'gallery':
      inspectUploadsValue(value, context, collector, 'gallery');
      break;
    case 'structured_text':
    case 'rich_text':
      inspectStructuredTextValue(
        value,
        context,
        fieldDefinitionsByItemType,
        collector,
        parentBlockSourceId,
      );
      break;
    case 'modular_content':
      inspectBlockCollection(
        value,
        context,
        fieldDefinitionsByItemType,
        collector,
        'modular_content',
        parentBlockSourceId,
      );
      break;
    case 'single_block':
      inspectBlockCollection(
        value,
        context,
        fieldDefinitionsByItemType,
        collector,
        'single_block',
        parentBlockSourceId,
      );
      break;
    default:
      inspectUnknownValue(
        value,
        context,
        fieldDefinitionsByItemType,
        collector,
        parentBlockSourceId,
      );
      break;
  }
}

function inspectBlockObject(
  value: JsonObject,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  kind: string,
  parentBlockSourceId: string | null,
) {
  const existingId = extractEntityId(value);
  const blockSourceId =
    existingId ??
    createSyntheticBlockId(context.recordSourceId, context.jsonPath);
  const blockModelId = extractItemTypeId(value);
  const synthetic = !existingId;

  addBlockReference(
    collector,
    context,
    blockSourceId,
    blockModelId,
    parentBlockSourceId,
    kind,
    synthetic,
  );

  if (!blockModelId) {
    inspectUnknownValue(
      value,
      { ...context, sourceBlockId: blockSourceId },
      fieldDefinitionsByItemType,
      collector,
      blockSourceId,
    );
    return;
  }

  const fieldDefinitions = fieldDefinitionsByItemType.get(blockModelId) ?? [];
  const processedFieldKeys = new Set<string>();

  for (const fieldDefinition of fieldDefinitions) {
    if (!(fieldDefinition.apiKey in value)) {
      continue;
    }

    const blockFieldContext: ReferenceContext = {
      ...context,
      sourceBlockId: blockSourceId,
      fieldApiKey: fieldDefinition.apiKey,
      jsonPath: appendPath(context.jsonPath, fieldDefinition.apiKey),
    };

    inspectFieldValue(
      value[fieldDefinition.apiKey],
      fieldDefinition,
      blockFieldContext,
      fieldDefinitionsByItemType,
      collector,
      blockSourceId,
    );

    processedFieldKeys.add(fieldDefinition.apiKey);
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (processedFieldKeys.has(key) || key === 'id' || key === 'item_type') {
      continue;
    }

    inspectUnknownValue(
      nestedValue,
      {
        ...context,
        sourceBlockId: blockSourceId,
        fieldApiKey: key,
        jsonPath: appendPath(context.jsonPath, key),
      },
      fieldDefinitionsByItemType,
      collector,
      blockSourceId,
    );
  }
}

function inspectBlockCollection(
  value: unknown,
  context: ReferenceContext,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
  kind: string,
  parentBlockSourceId: string | null,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const blockContext = {
        ...context,
        jsonPath: appendPath(context.jsonPath, `[${index}]`),
      };

      if (isObject(entry)) {
        inspectBlockObject(
          entry,
          blockContext,
          fieldDefinitionsByItemType,
          collector,
          kind,
          parentBlockSourceId,
        );
        return;
      }

      const blockSourceId = extractEntityId(entry);
      if (blockSourceId) {
        addBlockReference(
          collector,
          blockContext,
          blockSourceId,
          null,
          parentBlockSourceId,
          kind,
          false,
        );
      }
    });
    return;
  }

  if (isObject(value)) {
    inspectBlockObject(
      value,
      context,
      fieldDefinitionsByItemType,
      collector,
      kind,
      parentBlockSourceId,
    );
  }
}

function inspectSingleRecord(
  record: JsonObject,
  recordIndex: number,
  ignoredKeys: Set<string>,
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
  collector: ReferenceCollector,
) {
  const recordSourceId = extractEntityId(record.id);
  if (!recordSourceId) {
    return;
  }

  const itemTypeId = extractItemTypeId(record);
  const recordPath = `$.records[${recordIndex}]`;
  const fieldDefinitions = itemTypeId
    ? (fieldDefinitionsByItemType.get(itemTypeId) ?? [])
    : [];
  const processedFieldKeys = new Set<string>();

  for (const fieldDefinition of fieldDefinitions) {
    if (!(fieldDefinition.apiKey in record)) {
      continue;
    }

    const context: ReferenceContext = {
      recordSourceId,
      sourceBlockId: null,
      fieldApiKey: fieldDefinition.apiKey,
      locale: null,
      jsonPath: appendPath(recordPath, fieldDefinition.apiKey),
    };

    inspectFieldValue(
      record[fieldDefinition.apiKey],
      fieldDefinition,
      context,
      fieldDefinitionsByItemType,
      collector,
      null,
    );

    processedFieldKeys.add(fieldDefinition.apiKey);
  }

  for (const [key, value] of Object.entries(record)) {
    if (processedFieldKeys.has(key) || ignoredKeys.has(key)) {
      continue;
    }

    inspectUnknownValue(
      value,
      {
        recordSourceId,
        sourceBlockId: null,
        fieldApiKey: key,
        locale: null,
        jsonPath: appendPath(recordPath, key),
      },
      fieldDefinitionsByItemType,
      collector,
      null,
    );
  }
}

function collectReferenceIndex(
  records: JsonObject[],
  fieldDefinitionsByItemType: Map<string, FieldDefinition[]>,
) {
  const collector = createReferenceCollector();
  const ignoredKeys = new Set([
    'id',
    'item_type',
    'meta',
    'created_at',
    'updated_at',
    'is_valid',
    'position',
    'stage',
    'creator',
  ]);

  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    inspectSingleRecord(
      record,
      recordIndex,
      ignoredKeys,
      fieldDefinitionsByItemType,
      collector,
    );
  }

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
    : {};

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
  const directValue = asString(record[key]);
  if (directValue) {
    return directValue;
  }

  const meta = asJsonObject(record.meta);
  if (!meta) {
    return null;
  }

  return asString(meta[key]);
}

function collectScheduledActions(
  records: JsonObject[],
  key: 'publication_scheduled_at' | 'unpublishing_scheduled_at',
): ScheduledActionSummary[] {
  const actions: ScheduledActionSummary[] = [];

  for (const record of records) {
    const itemId = extractEntityId(record.id);
    const scheduledAt = getScheduledTimestamp(record, key);

    if (!itemId || !scheduledAt) {
      continue;
    }

    const meta = asJsonObject(record.meta);
    actions.push({
      itemId,
      itemTypeId: extractItemTypeId(record),
      scheduledAt,
      currentVersion: meta ? asString(meta.current_version) : null,
    });
  }

  return actions;
}

async function fetchResourceWithWarning<T>(args: {
  resource: ConfigurationResourceName;
  warnings: ConfigurationExportWarning[];
  operation: () => Promise<T>;
  fallback: T;
}): Promise<T> {
  try {
    return await args.operation();
  } catch (error) {
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
  });
  const site = asJsonObject(sitePayload);

  const itemTypeIds = args.itemTypes
    .map((itemType) => asString(itemType.id))
    .filter((itemTypeId): itemTypeId is string => Boolean(itemTypeId));

  const fieldsetGroups = await Promise.all(
    itemTypeIds.map(async (itemTypeId) => {
      try {
        const rawFieldsets = await args.client.fieldsets.list(itemTypeId);
        return normalizeJsonObjectArray(rawFieldsets);
      } catch (error) {
        warnings.push({
          resource: 'fieldsets',
          message: `Item type ${itemTypeId}: ${normalizeErrorMessage(error)}`,
        });
        return [];
      }
    }),
  );

  const [
    menuItems,
    schemaMenuItems,
    modelFilters,
    plugins,
    workflows,
    roles,
    webhooks,
    buildTriggers,
  ] = await Promise.all([
    fetchResourceWithWarning({
      resource: 'menuItems',
      warnings,
      operation: () => args.client.menuItems.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'schemaMenuItems',
      warnings,
      operation: () => args.client.schemaMenuItems.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'modelFilters',
      warnings,
      operation: () => args.client.itemTypeFilters.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'plugins',
      warnings,
      operation: () => args.client.plugins.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'workflows',
      warnings,
      operation: () => args.client.workflows.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'roles',
      warnings,
      operation: () => args.client.roles.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'webhooks',
      warnings,
      operation: () => args.client.webhooks.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
    fetchResourceWithWarning({
      resource: 'buildTriggers',
      warnings,
      operation: () => args.client.buildTriggers.list(),
      fallback: [],
    }).then(normalizeJsonObjectArray),
  ]);

  const projectConfiguration: ProjectConfigurationExport = {
    site,
    scheduledPublications: collectScheduledActions(
      args.records,
      'publication_scheduled_at',
    ),
    scheduledUnpublishings: collectScheduledActions(
      args.records,
      'unpublishing_scheduled_at',
    ),
    fieldsets: fieldsetGroups.flat(),
    menuItems,
    schemaMenuItems,
    modelFilters,
    plugins,
    workflows,
    roles,
    webhooks,
    buildTriggers,
    warnings,
  };

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
}): RecordExportEnvelope {
  const normalizedFields = normalizeFieldDefinitions(args.fields);
  const fieldsByItemTypeIndex = indexFieldsByItemType(normalizedFields);
  const projectConfiguration =
    args.projectConfiguration ?? defaultProjectConfigurationExport();

  const itemTypeIdToApiKey = args.itemTypes.reduce<Record<string, string>>(
    (acc, itemType) => {
      const id = asString(itemType.id);
      const apiKey = asString(itemType.api_key);

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
    referenceIndex: collectReferenceIndex(args.records, fieldsByItemTypeIndex),
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
      lastAssetExportSnapshot: readLastAssetExportSnapshot(),
    },
  };
}

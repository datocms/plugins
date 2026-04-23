import type { BlockInfo } from '@ctypes/mentions';
import type { FieldInfo } from '@hooks/useMentions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { logError } from '@/utils/errorLogger';
import {
  type BlockValue,
  extractBlocksFromFieldValue,
  type FieldValidators,
  type FieldValue,
  getBlockIndex,
  getBlockModelId,
  getEditorType,
  getValidators,
  hasBlockAttributes,
  isBlockContainerType,
  isBlockValue,
  isFieldValueRecord,
  isPlainObject,
  isStructuredTextBlock,
  safeGetBlockAttributes,
} from './blockHelpers';

type LoadedItemTypeFields = Awaited<
  ReturnType<RenderItemFormSidebarCtx['loadItemTypeFields']>
>;

export type FieldLoadCache = Map<string, Promise<LoadedItemTypeFields>>;

function loadItemTypeFieldsCached(
  ctx: RenderItemFormSidebarCtx,
  fieldCache: FieldLoadCache,
  itemTypeId: string,
): Promise<LoadedItemTypeFields> {
  const cached = fieldCache.get(itemTypeId);
  if (cached) return cached;

  const fieldsPromise = ctx.loadItemTypeFields(itemTypeId);
  fieldCache.set(itemTypeId, fieldsPromise);
  return fieldsPromise;
}

export function extractLocalizedValue<T = unknown>(
  fieldValue: T,
  locale: string | undefined,
): T {
  if (
    !locale ||
    !fieldValue ||
    typeof fieldValue !== 'object' ||
    Array.isArray(fieldValue)
  ) {
    return fieldValue;
  }
  const localizedValue = fieldValue as Record<string, unknown>;
  if (locale in localizedValue) {
    return localizedValue[locale] as T;
  }
  return fieldValue;
}

interface PathNavigationOptions {
  checkBlockAttributes?: boolean;
}

function navigatePathPart(
  current: FieldValue,
  part: string,
  checkBlockAttributes: boolean,
): FieldValue | undefined {
  if (current === undefined || current === null) return undefined;

  const index = parseInt(part, 10);
  if (!Number.isNaN(index) && Array.isArray(current)) {
    return current[index];
  }

  if (isFieldValueRecord(current)) {
    if (
      checkBlockAttributes &&
      current.attributes &&
      isFieldValueRecord(current.attributes)
    ) {
      return current.attributes[part];
    }
    return current[part];
  }

  return undefined;
}

function navigateToPath(
  root: Record<string, FieldValue>,
  path: string,
  options: PathNavigationOptions = {},
): FieldValue | undefined {
  if (!path) return root;

  const pathParts = path.split('.');
  const checkBlockAttributes = options.checkBlockAttributes ?? false;
  let current: FieldValue = root;

  for (const part of pathParts) {
    const next = navigatePathPart(current, part, checkBlockAttributes);
    if (next === undefined) return undefined;
    current = next;
  }

  return current;
}

interface FieldValueAccessor {
  getFieldValue(fieldApiKey: string): FieldValue | undefined;
}

function createFormValuesAccessor(
  formValues: Record<string, FieldValue>,
  pathPrefix: string,
): FieldValueAccessor {
  return {
    getFieldValue: (apiKey) =>
      getFieldValueByPath(formValues, apiKey, pathPrefix),
  };
}

function createBlockAttributesAccessor(
  blockAttributes: Record<string, FieldValue>,
): FieldValueAccessor {
  return {
    getFieldValue: (apiKey) => blockAttributes[apiKey],
  };
}

function getAllowedBlockModelIds(
  fieldType: string,
  validators: FieldValidators | undefined,
): string[] {
  if (!validators) return [];

  if (fieldType === 'modular_content' || fieldType === 'single_block') {
    return validators.item_item_type?.item_types ?? [];
  }

  if (fieldType === 'structured_text') {
    return (
      validators.structured_text_blocks?.item_types ??
      validators.rich_text_blocks?.item_types ??
      []
    );
  }

  return [];
}

function getAvailableLocales(
  fieldValue: FieldValue,
  allLocales: string[],
): string[] | undefined {
  if (!isPlainObject(fieldValue)) {
    return allLocales.length > 0 ? [...allLocales] : undefined;
  }

  const localesWithValues = allLocales.filter((locale) => {
    const value = fieldValue[locale];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });

  return localesWithValues.length > 0 ? localesWithValues : [...allLocales];
}

interface BlockFieldProcessingConfig {
  ctx: RenderItemFormSidebarCtx;
  blockFields: LoadedItemTypeFields;
  blockAttrs: Record<string, FieldValue>;
  blockModelName: string;
  parentFieldLabel: string;
  basePath: string;
  depth: number;
  allLocales: string[];
  fieldCache: FieldLoadCache;
  blockIndex?: number;
}

async function processBlockField(
  blockField: BlockFieldProcessingConfig['blockFields'][number],
  config: BlockFieldProcessingConfig,
  displayIndexSuffix: string,
): Promise<FieldInfo[]> {
  const {
    ctx,
    blockAttrs,
    blockModelName,
    parentFieldLabel,
    basePath,
    depth,
    allLocales,
    fieldCache,
  } = config;

  const blockFieldApiKey = blockField.attributes.api_key;
  const blockFieldLabel = blockField.attributes.label;
  const blockFieldLocalized = blockField.attributes.localized;
  const blockFieldType = blockField.attributes.field_type;
  const blockFieldEditorType = getEditorType(blockField.attributes.appearance);
  const fieldPath = `${basePath}.${blockFieldApiKey}`;
  const displayLabel = `${parentFieldLabel} > ${blockModelName}${displayIndexSuffix} > ${blockFieldLabel}`;

  const nestedFieldValue = blockAttrs[blockFieldApiKey];
  const availableLocales = blockFieldLocalized
    ? getAvailableLocales(nestedFieldValue, allLocales)
    : undefined;

  const nestedIsBlockContainer = isBlockContainerType(blockFieldType);
  const nestedBlockFieldType = nestedIsBlockContainer
    ? blockFieldType
    : undefined;

  const fieldEntry: FieldInfo = {
    apiKey: blockFieldApiKey,
    label: blockFieldLabel,
    localized: blockFieldLocalized,
    fieldPath,
    displayLabel,
    depth,
    availableLocales,
    fieldType: blockFieldEditorType,
    isBlockContainer: nestedIsBlockContainer,
    blockFieldType: nestedBlockFieldType,
  };

  if (!nestedIsBlockContainer) {
    return [fieldEntry];
  }

  const nestedValidators = getValidators(blockField.attributes.validators);
  const nestedAllowedIds = getAllowedBlockModelIds(
    blockFieldType,
    nestedValidators,
  );
  const deeperFields = await loadNestedFieldsUnified(
    ctx,
    createBlockAttributesAccessor(blockAttrs),
    {
      parentFieldApiKey: blockFieldApiKey,
      parentFieldLabel: blockFieldLabel,
      parentFieldType: blockFieldType,
      allowedBlockModelIds: nestedAllowedIds,
      allLocales,
      depth: depth + 1,
      basePath,
      fieldCache,
    },
  );

  return [fieldEntry, ...deeperFields];
}

async function processBlockFields(
  config: BlockFieldProcessingConfig,
): Promise<FieldInfo[]> {
  const { blockFields, blockIndex } = config;

  const displayIndexSuffix =
    blockIndex !== undefined ? ` #${blockIndex + 1}` : '';

  const fieldArrays = await Promise.all(
    blockFields.map((blockField) =>
      processBlockField(blockField, config, displayIndexSuffix),
    ),
  );

  return fieldArrays.flat();
}

interface LoadNestedFieldsConfig {
  parentFieldApiKey: string;
  parentFieldLabel: string;
  parentFieldType: string;
  allowedBlockModelIds: string[];
  allLocales: string[];
  depth: number;
  basePath: string;
  fieldCache: FieldLoadCache;
}

async function loadSingleBlockFields(
  ctx: RenderItemFormSidebarCtx,
  fieldValue: ReturnType<FieldValueAccessor['getFieldValue']>,
  config: LoadNestedFieldsConfig,
): Promise<FieldInfo[]> {
  if (!isBlockValue(fieldValue)) return [];

  const {
    parentFieldApiKey,
    parentFieldLabel,
    allowedBlockModelIds,
    allLocales,
    depth,
    basePath,
    fieldCache,
  } = config;
  const blockModelId = getBlockModelId(fieldValue);

  if (!blockModelId || !allowedBlockModelIds.includes(blockModelId)) return [];

  const blockModel = ctx.itemTypes[blockModelId];
  if (!blockModel) return [];

  const blockModelName = blockModel.attributes.name;
  const newBasePath = basePath
    ? `${basePath}.${parentFieldApiKey}`
    : parentFieldApiKey;
  const blockAttrs = safeGetBlockAttributes(fieldValue);
  const blockFields = await loadItemTypeFieldsCached(
    ctx,
    fieldCache,
    blockModelId,
  );

  return processBlockFields({
    ctx,
    blockFields,
    blockAttrs,
    blockModelName,
    parentFieldLabel,
    basePath: newBasePath,
    depth,
    allLocales,
    fieldCache,
  });
}

async function loadMultiBlockFields(
  ctx: RenderItemFormSidebarCtx,
  blocks: ReturnType<typeof extractBlocksFromFieldValue>,
  config: LoadNestedFieldsConfig,
): Promise<FieldInfo[]> {
  const {
    parentFieldApiKey,
    parentFieldLabel,
    allLocales,
    depth,
    basePath,
    fieldCache,
  } = config;

  const blockPromises = blocks.map(async (block, blockIndex) => {
    const blockModelId = getBlockModelId(block);

    if (!blockModelId) {
      logError(
        'loadNestedFieldsUnified: Block without model ID found',
        undefined,
        {
          parentFieldApiKey,
          blockIndex,
          basePath,
          blockKeys: Object.keys(block),
        },
      );
      return [];
    }

    const blockModel = ctx.itemTypes[blockModelId];
    if (!blockModel) {
      logError(
        'loadNestedFieldsUnified: Block references unknown model',
        undefined,
        {
          parentFieldApiKey,
          blockIndex,
          blockModelId,
          basePath,
        },
      );
      return [];
    }

    const blockModelName = blockModel.attributes.name;
    const newBasePath = basePath
      ? `${basePath}.${parentFieldApiKey}.${blockIndex}`
      : `${parentFieldApiKey}.${blockIndex}`;
    const blockAttrs = safeGetBlockAttributes(block);
    const blockFields = await loadItemTypeFieldsCached(
      ctx,
      fieldCache,
      blockModelId,
    );

    return processBlockFields({
      ctx,
      blockFields,
      blockAttrs,
      blockModelName,
      parentFieldLabel,
      basePath: newBasePath,
      depth,
      allLocales,
      fieldCache,
      blockIndex,
    });
  });

  const fieldArrays = await Promise.all(blockPromises);
  return fieldArrays.flat();
}

async function loadNestedFieldsUnified(
  ctx: RenderItemFormSidebarCtx,
  accessor: FieldValueAccessor,
  config: LoadNestedFieldsConfig,
): Promise<FieldInfo[]> {
  const { parentFieldApiKey, parentFieldType } = config;
  const fieldValue = accessor.getFieldValue(parentFieldApiKey);

  if (parentFieldType === 'single_block') {
    return loadSingleBlockFields(ctx, fieldValue, config);
  }

  if (
    parentFieldType === 'modular_content' ||
    parentFieldType === 'structured_text'
  ) {
    const blocks = extractBlocksFromFieldValue(fieldValue, parentFieldType);
    return loadMultiBlockFields(ctx, blocks, config);
  }

  return [];
}

async function buildTopLevelFieldWithNested(
  ctx: RenderItemFormSidebarCtx,
  field: LoadedItemTypeFields[number],
  formValues: Record<string, FieldValue>,
  allLocales: string[],
  fieldCache: FieldLoadCache,
): Promise<FieldInfo[]> {
  const fieldType = field.attributes.field_type;
  const apiKey = field.attributes.api_key;
  const label = field.attributes.label;
  const localized = field.attributes.localized;
  const validators = getValidators(field.attributes.validators);
  const editorType = getEditorType(field.attributes.appearance);
  const fieldValue = formValues[apiKey];
  const availableLocales = localized
    ? getAvailableLocales(fieldValue, allLocales)
    : undefined;
  const blockContainerType = isBlockContainerType(fieldType)
    ? fieldType
    : undefined;

  const topLevelEntry: FieldInfo = {
    apiKey,
    label,
    localized,
    fieldPath: apiKey,
    displayLabel: label,
    depth: 0,
    availableLocales,
    fieldType: editorType,
    isBlockContainer: blockContainerType !== undefined,
    blockFieldType: blockContainerType,
  };

  if (!blockContainerType) {
    return [topLevelEntry];
  }

  const allowedBlockModelIds = getAllowedBlockModelIds(fieldType, validators);
  const nestedFields = await loadNestedFields(
    ctx,
    formValues,
    apiKey,
    label,
    fieldType,
    allowedBlockModelIds,
    allLocales,
    1, // depth
    fieldCache,
  );

  return [topLevelEntry, ...nestedFields];
}

export async function loadAllFields(
  ctx: RenderItemFormSidebarCtx,
): Promise<FieldInfo[]> {
  const formValues = ctx.formValues as Record<string, FieldValue>;
  const allLocales = ctx.site.attributes.locales;
  const fieldCache: FieldLoadCache = new Map();
  const topLevelFields = await loadItemTypeFieldsCached(
    ctx,
    fieldCache,
    ctx.itemType.id,
  );

  const fieldArrays = await Promise.all(
    topLevelFields.map((field) =>
      buildTopLevelFieldWithNested(
        ctx,
        field,
        formValues,
        allLocales,
        fieldCache,
      ),
    ),
  );

  return fieldArrays.flat();
}

async function loadNestedFields(
  ctx: RenderItemFormSidebarCtx,
  formValues: Record<string, FieldValue>,
  parentFieldApiKey: string,
  parentFieldLabel: string,
  parentFieldType: string,
  allowedBlockModelIds: string[],
  allLocales: string[],
  depth: number,
  fieldCache: FieldLoadCache,
  pathPrefix = '',
): Promise<FieldInfo[]> {
  const accessor = createFormValuesAccessor(formValues, pathPrefix);
  const basePath = pathPrefix || '';

  return loadNestedFieldsUnified(ctx, accessor, {
    parentFieldApiKey,
    parentFieldLabel,
    parentFieldType,
    allowedBlockModelIds,
    allLocales,
    depth,
    basePath,
    fieldCache,
  });
}

function getFieldValueByPath(
  formValues: Record<string, FieldValue>,
  fieldApiKey: string,
  pathPrefix: string,
): FieldValue | undefined {
  if (!pathPrefix) {
    return formValues[fieldApiKey];
  }

  const prefixValue = navigateToPath(formValues, pathPrefix, {
    checkBlockAttributes: true,
  });

  if (isFieldValueRecord(prefixValue)) {
    if (isFieldValueRecord(prefixValue.attributes)) {
      return prefixValue.attributes[fieldApiKey];
    }
    return prefixValue[fieldApiKey];
  }

  return undefined;
}

export function getBlocksForField(
  ctx: RenderItemFormSidebarCtx,
  fieldPath: string,
  blockFieldType:
    | 'modular_content'
    | 'structured_text'
    | 'single_block'
    | 'rich_text',
  locale?: string,
): BlockInfo[] {
  const formValues = ctx.formValues as Record<string, FieldValue>;
  const rawFieldValue = getValueAtPath(formValues, fieldPath);
  const fieldValue = extractLocalizedValue(rawFieldValue, locale);

  // Handle single_block - return single block info if present
  if (blockFieldType === 'single_block') {
    if (isBlockValue(fieldValue)) {
      const blockModelId = getBlockModelId(fieldValue);

      if (blockModelId) {
        const blockModel = ctx.itemTypes[blockModelId];
        if (blockModel) {
          return [
            {
              index: 0,
              modelId: blockModelId,
              modelName: blockModel.attributes.name,
            },
          ];
        }
      }
    }
    return [];
  }

  const blocks = extractBlocksFromFieldValue(fieldValue, blockFieldType);

  return blocks
    .map((block, arrayIndex) => {
      const blockModelId = block.itemTypeId ?? block.type;
      if (!blockModelId) return null;

      const blockModel = ctx.itemTypes[blockModelId];
      if (!blockModel) return null;

      return {
        index: getBlockIndex(block, arrayIndex),
        modelId: blockModelId,
        modelName: blockModel.attributes.name,
      };
    })
    .filter((b): b is BlockInfo => b !== null);
}

export async function getFieldsForBlock(
  ctx: RenderItemFormSidebarCtx,
  blockModelId: string,
  blockValue: Record<string, unknown> | null,
  basePath: string,
  fieldCache: FieldLoadCache = new Map(),
): Promise<FieldInfo[]> {
  const allLocales = ctx.site.attributes.locales;
  const blockFields = await loadItemTypeFieldsCached(
    ctx,
    fieldCache,
    blockModelId,
  );
  const blockAttrs = blockValue ?? {};

  return blockFields.map((field) => {
    const fieldApiKey = field.attributes.api_key;
    const fieldLabel = field.attributes.label;
    const fieldLocalized = field.attributes.localized;
    const fieldType = field.attributes.field_type;
    const editorType = getEditorType(field.attributes.appearance);
    const fieldPath = basePath ? `${basePath}.${fieldApiKey}` : fieldApiKey;
    const blockContainerType = isBlockContainerType(fieldType)
      ? fieldType
      : undefined;
    const nestedFieldValue = blockAttrs[fieldApiKey];
    const availableLocales = fieldLocalized
      ? getAvailableLocales(nestedFieldValue, allLocales)
      : undefined;

    return {
      apiKey: fieldApiKey,
      label: fieldLabel,
      localized: fieldLocalized,
      fieldPath,
      displayLabel: fieldLabel,
      depth: 0, // Will be displayed in nested context
      availableLocales,
      fieldType: editorType,
      isBlockContainer: blockContainerType !== undefined,
      blockFieldType: blockContainerType,
    };
  });
}

function getValueAtPath(
  formValues: Record<string, FieldValue>,
  path: string,
): FieldValue | undefined {
  return navigateToPath(formValues, path, { checkBlockAttributes: true });
}

function extractBlockAttrs(block: BlockValue): Record<string, unknown> {
  if (hasBlockAttributes(block)) {
    return block.attributes;
  }
  return block as Record<string, unknown>;
}

export function getBlockAttributesAtPath(
  ctx: RenderItemFormSidebarCtx,
  fieldPath: string,
  blockIndex: number,
  blockFieldType:
    | 'modular_content'
    | 'structured_text'
    | 'single_block'
    | 'rich_text',
  locale?: string,
): Record<string, unknown> | null {
  const formValues = ctx.formValues as Record<string, FieldValue>;
  const rawFieldValue = getValueAtPath(formValues, fieldPath);
  const fieldValue = extractLocalizedValue(rawFieldValue, locale);

  if (blockFieldType === 'single_block') {
    if (isBlockValue(fieldValue)) {
      return extractBlockAttrs(fieldValue);
    }
    return null;
  }

  const blocks = extractBlocksFromFieldValue(fieldValue, blockFieldType);
  const firstBlock = blocks[0];
  const hasStructuredTextBlocks =
    firstBlock && isStructuredTextBlock(firstBlock);

  if (hasStructuredTextBlocks) {
    // For structured text, blockIndex is the DAST index
    const block = blocks.find(
      (b) => isStructuredTextBlock(b) && b.__dastIndex === blockIndex,
    );
    if (block) {
      return extractBlockAttrs(block);
    }
  } else {
    if (blockIndex >= 0 && blockIndex < blocks.length) {
      const block = blocks[blockIndex];
      return extractBlockAttrs(block);
    }
  }

  return null;
}

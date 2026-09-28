import type {
  ContentField,
  ContentModel,
  ContentSchema,
  ExtractionResult,
  LinkOccurrence,
  RecordInput,
} from '../types';
import {
  htmlLinks,
  isUrlLikeValue,
  markdownLinks,
  plainTextLinks,
} from './text';

type ObjectValue = Record<string, unknown>;
type Context = {
  rootField: ContentField;
  rootLocale?: string;
  locale?: string;
  blockPath: string[];
  depth: number;
};

const MAX_DEPTH = 64;

function objectValue(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

function unwrapItem(value: ObjectValue): ObjectValue {
  const data = objectValue(value.data);
  return data && (data.type === 'item' || objectValue(data.relationships))
    ? data
    : value;
}

function attributesOf(value: ObjectValue): ObjectValue {
  const item = unwrapItem(value);
  return item.type === 'item' || objectValue(item.relationships)
    ? (objectValue(item.attributes) ?? item)
    : item;
}

function relationshipId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const relationship = objectValue(value);
  if (typeof relationship?.id === 'string') return relationship.id;
  const data = objectValue(relationship?.data);
  return typeof data?.id === 'string' ? data.id : undefined;
}

function modelIdOf(block: ObjectValue): string | undefined {
  const relationships = objectValue(block.relationships);
  return (
    relationshipId(relationships?.item_type) ??
    relationshipId(block.item_type) ??
    (typeof block.itemTypeId === 'string' ? block.itemTypeId : undefined)
  );
}

function scalarLinks(field: ContentField, value: unknown): string[] {
  if (typeof value !== 'string') return [];
  if (
    field.type === 'string' &&
    (!field.editor || field.editor === 'single_line')
  ) {
    return isUrlLikeValue(value) ? [value.trim()] : [];
  }
  if (field.type !== 'text') return [];
  switch (field.editor) {
    case 'markdown':
      return markdownLinks(value);
    case 'wysiwyg':
      return htmlLinks(value);
    case 'textarea':
    case '':
      return plainTextLinks(value);
    default:
      return [];
  }
}

function hasSupportedContainerEditor(field: ContentField): boolean {
  if (!field.editor) return true;
  if (field.type === 'single_block') {
    return ['framed_single_block', 'frameless_single_block'].includes(
      field.editor,
    );
  }
  return field.editor === field.type;
}

/** Extracts destinations only. Classification and all network access are separate. */
export function extractLinks(
  record: RecordInput,
  schema: ContentSchema,
  locales: readonly string[],
): ExtractionResult {
  const occurrences: LinkOccurrence[] = [];
  const warnings = new Set<string>();
  const activeObjects = new WeakSet<object>();
  const rootModel = schema.get(record.modelId);

  const warn = (message: string, context?: Context) => {
    const location = context
      ? [context.rootField.label, ...context.blockPath].join(' › ')
      : record.title;
    warnings.add(`${location}: ${message}`);
  };

  const add = (url: string, field: ContentField, context: Context) => {
    const fieldPath = context.rootLocale
      ? `${context.rootField.apiKey}.${context.rootLocale}`
      : context.rootField.apiKey;
    occurrences.push({
      id: `${record.id ?? 'unsaved'}:${record.modelId}:${occurrences.length}`,
      recordId: record.id,
      recordTitle: record.title,
      modelId: record.modelId,
      modelName: rootModel?.name ?? record.modelId,
      fieldPath,
      fieldLabel: field.label,
      locale: context.rootLocale ?? context.locale,
      blockPath: [...context.blockPath],
      url,
    });
  };

  const visitBlock = (value: unknown, context: Context, index?: number) => {
    if (value === null || value === undefined) return;
    const block = objectValue(value);
    if (!block) {
      warn(
        'Embedded block content is not loaded; some links could not be checked.',
        context,
      );
      return;
    }
    const item = unwrapItem(block);
    const modelId = modelIdOf(item);
    const model = modelId ? schema.get(modelId) : undefined;
    if (!model?.isBlock) {
      warn(
        'An embedded block model is unavailable; some links could not be checked.',
        context,
      );
      return;
    }
    visitModel(item, model, {
      ...context,
      depth: context.depth + 1,
      blockPath: [
        ...context.blockPath,
        `${model.name}${index === undefined ? '' : ` ${index + 1}`}`,
      ],
    });
  };

  const visitDastLink = (
    node: ObjectValue,
    field: ContentField,
    context: Context,
  ) => {
    if (typeof node.url === 'string') add(node.url, field, context);
    else warn('A Structured Text link has no readable destination.', context);
  };

  const visitDastNode = (
    value: unknown,
    field: ContentField,
    context: Context,
  ) => {
    const node = objectValue(value);
    if (!node) {
      warn(
        'Structured Text contains an unreadable node; some links could not be checked.',
        context,
      );
      return;
    }
    if (context.depth > MAX_DEPTH || activeObjects.has(node)) {
      warn('Content nesting could not be fully read.', context);
      return;
    }
    activeObjects.add(node);
    switch (node.type) {
      case 'link':
        visitDastLink(node, field, context);
        break;
      case 'block':
      case 'inlineBlock':
        visitBlock(node.item, context);
        break;
      default:
        for (const child of Array.isArray(node.children) ? node.children : []) {
          visitDastNode(child, field, { ...context, depth: context.depth + 1 });
        }
    }
    activeObjects.delete(node);
  };

  const visitStructuredText = (
    value: unknown,
    field: ContentField,
    context: Context,
  ) => {
    if (value === null || value === undefined) return;
    const wrapper = objectValue(value);
    const document = objectValue(wrapper?.document);
    if (
      wrapper?.schema !== 'dast' ||
      document?.type !== 'root' ||
      !Array.isArray(document.children)
    ) {
      warn(
        'Structured Text content is not available in its saved format.',
        context,
      );
      return;
    }
    visitDastNode(document, field, context);
  };

  const visitModularContent = (value: unknown, context: Context) => {
    if (value === null || value === undefined) return;
    if (!Array.isArray(value)) {
      warn(
        'Modular content is not loaded; some links could not be checked.',
        context,
      );
      return;
    }
    for (const [index, block] of value.entries())
      visitBlock(block, context, index);
  };

  const visitField = (
    field: ContentField,
    value: unknown,
    context: Context,
  ) => {
    for (const url of scalarLinks(field, value)) add(url, field, context);
    if (!hasSupportedContainerEditor(field)) return;
    const containerContext = {
      ...context,
      blockPath: [...context.blockPath, field.label],
    };
    switch (field.type) {
      case 'rich_text':
        visitModularContent(value, containerContext);
        return;
      case 'single_block':
        visitBlock(value, containerContext);
        return;
      case 'structured_text':
        visitStructuredText(value, field, containerContext);
    }
  };

  const visitModel = (
    value: ObjectValue,
    model: ContentModel,
    parent?: Context,
  ) => {
    if ((parent?.depth ?? 0) > MAX_DEPTH || activeObjects.has(value)) {
      warn('Content nesting could not be fully read.', parent);
      return;
    }
    activeObjects.add(value);
    const attributes = attributesOf(value);
    for (const field of model.fields) {
      const raw = attributes[field.apiKey];
      if (!field.localized) {
        visitField(
          field,
          raw,
          parent ?? { rootField: field, blockPath: [], depth: 0 },
        );
        continue;
      }
      visitLocalizedField(field, raw, parent);
    }
    activeObjects.delete(value);
  };

  const visitLocalizedField = (
    field: ContentField,
    value: unknown,
    parent?: Context,
  ) => {
    if (value === null || value === undefined) return;
    const localized = objectValue(value);
    const context = parent ?? { rootField: field, blockPath: [], depth: 0 };
    if (!localized) {
      warn(
        'Localized content is unavailable; some links could not be checked.',
        context,
      );
      return;
    }
    const selectedLocales = locales.length
      ? [...new Set(locales)]
      : Object.keys(localized);
    for (const locale of selectedLocales) {
      visitField(field, localized[locale], {
        ...context,
        rootLocale: parent ? parent.rootLocale : locale,
        locale,
      });
    }
  };

  if (rootModel) visitModel(record.values, rootModel);
  else warn('The record model is unavailable; its links could not be checked.');
  return { occurrences, warnings: [...warnings] };
}

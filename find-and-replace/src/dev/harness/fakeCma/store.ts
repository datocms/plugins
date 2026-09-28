import type { RawApiTypes } from '@datocms/cma-client-browser';
import { apiError, errorEntity, FakeApiError } from './http';
import { createIdSequence } from './ids';
import type { StoredItem } from './records';
import {
  buildSite,
  type FakeSchema,
  type RawField,
  SITE_LOCALES,
} from './schema';

/**
 * The fake project's records, kept in memory for the page's lifetime so a
 * replacement is visible to the next search. Records are stored nested (full
 * block objects); `render()` collapses blocks to ids for `nested=false`.
 */

type UnknownRecord = Record<string, unknown>;

export type ListQuery = {
  ids: ReadonlyArray<string> | null;
  /** Model ids or api keys. */
  types: ReadonlyArray<string> | null;
  statuses: ReadonlyArray<string> | null;
  text: string | null;
  offset: number;
  limit: number;
  orderBy: string | null;
  nested: boolean;
};

export type FakeStore = {
  readonly schema: FakeSchema;
  readonly site: RawApiTypes.Site;
  readonly locales: ReadonlyArray<string>;
  /** Every root record, in creation order (live objects: don't mutate). */
  records(): ReadonlyArray<StoredItem>;
  find(id: string): StoredItem | undefined;
  /** A deep copy, blocks nested or collapsed to ids. */
  render(item: StoredItem, nested: boolean): StoredItem;
  list(query: ListQuery): { data: StoredItem[]; totalCount: number };
  /** `PUT /items/:id`. Throws `FakeApiError`. Returns the saved record (nested). */
  update(id: string, body: unknown): StoredItem;
  /** `POST /items/:id/validate`. Throws `FakeApiError` when the result would be invalid. */
  validate(id: string, body: unknown): void;
  /** `PUT /items/:id/publish` (whole record). Throws `FakeApiError`. Returns the stored record (live: render it). */
  publish(id: string): StoredItem;
  /** Someone else edits the record in the dashboard: applies the change and bumps the version. */
  edit(id: string, change: (attributes: UnknownRecord) => void): void;
  /** Someone else saves the record without changing anything we look at. */
  touch(id: string): void;
  remove(id: string): void;
};

const MAX_PAGE_LIMIT = 500;
const CONTAINER_TYPES = new Set([
  'rich_text',
  'single_block',
  'structured_text',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function relationshipId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  if (typeof value.id === 'string') return value.id;
  return isRecord(value.data) && typeof value.data.id === 'string'
    ? value.data.id
    : null;
}

export function modelIdOf(item: { relationships?: unknown }): string | null {
  const relationships = isRecord(item.relationships) ? item.relationships : {};
  return relationshipId(relationships.item_type);
}

/** A field's value, or one entry per locale present when it is localized. */
function localeEntries(
  field: RawField,
  value: unknown,
): Array<[string | null, unknown]> {
  if (!field.attributes.localized) return [[null, value]];
  return isRecord(value) ? Object.entries(value) : [];
}

function mapStructuredTextNodes(
  value: unknown,
  mapBlockItem: (item: unknown) => unknown,
  mapLinkItem: (item: unknown) => unknown,
): unknown {
  const visit = (node: unknown): unknown => {
    if (!isRecord(node)) return node;
    if (node.type === 'block' || node.type === 'inlineBlock') {
      return { ...node, item: mapBlockItem(node.item) };
    }
    if (node.type === 'itemLink' || node.type === 'inlineItem') {
      return { ...clone(node), item: mapLinkItem(node.item) };
    }
    if (Array.isArray(node.children)) {
      return { ...node, children: node.children.map(visit) };
    }
    return clone(node);
  };

  if (!isRecord(value) || !isRecord(value.document)) return clone(value);
  // A hydration-only `blocks` list is never part of a stored or served value.
  const rest = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'blocks'),
  );
  return { ...rest, document: visit(value.document) };
}

function structuredTextBlocks(value: unknown): StoredItem[] {
  const found: StoredItem[] = [];
  const visit = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (
      (node.type === 'block' || node.type === 'inlineBlock') &&
      isRecord(node.item)
    ) {
      found.push(node.item as StoredItem);
      return;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  if (isRecord(value)) visit(value.document);
  return found;
}

function blocksInValue(field: RawField, value: unknown): StoredItem[] {
  switch (field.attributes.field_type) {
    case 'rich_text':
      return Array.isArray(value)
        ? (value.filter(isRecord) as StoredItem[])
        : [];
    case 'single_block':
      return isRecord(value) ? [value as StoredItem] : [];
    case 'structured_text':
      return structuredTextBlocks(value);
    default:
      return [];
  }
}

function collapseValue(field: RawField, value: unknown): unknown {
  switch (field.attributes.field_type) {
    case 'rich_text':
      return Array.isArray(value)
        ? value.map((block) => relationshipId(block))
        : value;
    case 'single_block':
      return isRecord(value) ? relationshipId(value) : value;
    case 'structured_text':
      return mapStructuredTextNodes(value, relationshipId, relationshipId);
    default:
      return value;
  }
}

function isEmptyValue(field: RawField, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (field.attributes.field_type === 'rich_text') {
    return Array.isArray(value) && value.length === 0;
  }
  if (field.attributes.field_type === 'structured_text') {
    const document = isRecord(value) ? value.document : null;
    return !isRecord(document) || !Array.isArray(document.children)
      ? true
      : document.children.length === 0;
  }
  return false;
}

function textLeaves(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) textLeaves(entry, into);
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) textLeaves(entry, into);
  }
}

const ORDERABLE: Readonly<Record<string, (item: StoredItem) => string>> = {
  id: (item) => item.id,
  _created_at: (item) => item.meta.created_at,
  _updated_at: (item) => item.meta.updated_at,
  _published_at: (item) => item.meta.published_at ?? '',
};

function sortItems(items: StoredItem[], orderBy: string | null): StoredItem[] {
  const match = orderBy?.match(/^(.+)_(ASC|DESC)$/);
  const key = match?.[1];
  const read = key ? ORDERABLE[key] : undefined;
  if (!read) return items;
  const direction = match?.[2] === 'DESC' ? -1 : 1;
  return [...items].sort((left, right) =>
    read(left) < read(right)
      ? -direction
      : read(left) > read(right)
        ? direction
        : 0,
  );
}

// ── Validation ──────────────────────────────────────────────────────────────

type Failure = {
  field: RawField;
  locale: string | null;
  code: string;
  extra?: Record<string, unknown>;
};

function readValidator(field: RawField, name: string): UnknownRecord | null {
  const validator = field.attributes.validators[name];
  return isRecord(validator) ? validator : null;
}

function lengthFailure(
  field: RawField,
  value: unknown,
): Record<string, unknown> | null {
  const length = readValidator(field, 'length');
  if (!length || typeof value !== 'string') return null;
  const { min, max, eq } = length;
  const tooShort = typeof min === 'number' && value.length < min;
  const tooLong = typeof max === 'number' && value.length > max;
  const notEqual = typeof eq === 'number' && value.length !== eq;
  return tooShort || tooLong || notEqual ? { min, max, eq } : null;
}

function slugFormatFailure(field: RawField, value: unknown): boolean {
  const format = readValidator(field, 'slug_format');
  if (!format || typeof value !== 'string' || value === '') return false;
  const pattern =
    typeof format.custom_pattern === 'string'
      ? new RegExp(format.custom_pattern)
      : /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;
  return !pattern.test(value);
}

function valueFailures(
  field: RawField,
  locale: string | null,
  value: unknown,
): Failure[] {
  const failures: Failure[] = [];
  if (readValidator(field, 'required') && isEmptyValue(field, value)) {
    failures.push({ field, locale, code: 'VALIDATION_REQUIRED' });
  }
  const length = lengthFailure(field, value);
  if (length) {
    failures.push({ field, locale, code: 'VALIDATION_LENGTH', extra: length });
  }
  if (slugFormatFailure(field, value)) {
    failures.push({ field, locale, code: 'VALIDATION_SLUG_FORMAT' });
  }
  return failures;
}

function invalidFieldError(failures: ReadonlyArray<Failure>): FakeApiError {
  return new FakeApiError(
    422,
    failures.map((failure) =>
      errorEntity('INVALID_FIELD', {
        field: failure.field.attributes.api_key,
        field_id: failure.field.id,
        field_label: failure.field.attributes.label,
        field_type: failure.field.attributes.field_type,
        code: failure.code,
        ...(failure.locale ? { locale: failure.locale } : {}),
        ...(failure.extra ?? {}),
      }),
    ),
  );
}

// ── The store ───────────────────────────────────────────────────────────────

export function createStore(
  schema: FakeSchema,
  initialRecords: ReadonlyArray<StoredItem>,
): FakeStore {
  const records = new Map<string, StoredItem>();
  for (const record of initialRecords) records.set(record.id, clone(record));

  const nextVersion = createIdSequence('version');
  const nextBlockId = createIdSequence('block');
  const site = buildSite(schema.itemTypes.map((itemType) => itemType.id));
  const locales: ReadonlyArray<string> = SITE_LOCALES;

  const fieldsOf = (modelId: string | null): ReadonlyArray<RawField> =>
    (modelId ? schema.fieldsByItemTypeId.get(modelId) : undefined) ?? [];

  const resolveModelId = (idOrApiKey: string): string | null =>
    schema.itemTypesById.has(idOrApiKey)
      ? idOrApiKey
      : (schema.itemTypes.find(
          (itemType) => itemType.attributes.api_key === idOrApiKey,
        )?.id ?? null);

  const isDraftModel = (modelId: string | null): boolean =>
    Boolean(
      modelId &&
        schema.itemTypesById.get(modelId)?.attributes.draft_mode_active,
    );

  function collectBlocks(
    modelId: string | null,
    attributes: UnknownRecord,
    into: Map<string, StoredItem>,
  ): void {
    for (const field of fieldsOf(modelId)) {
      if (!CONTAINER_TYPES.has(field.attributes.field_type)) continue;
      for (const [, value] of localeEntries(
        field,
        attributes[field.attributes.api_key],
      )) {
        for (const block of blocksInValue(field, value)) {
          into.set(block.id, block);
          collectBlocks(modelIdOf(block), block.attributes, into);
        }
      }
    }
  }

  function render(item: StoredItem, nested: boolean): StoredItem {
    const copy = clone(item);
    if (nested) return copy;
    for (const field of fieldsOf(modelIdOf(copy))) {
      const key = field.attributes.api_key;
      if (
        !CONTAINER_TYPES.has(field.attributes.field_type) ||
        !(key in copy.attributes)
      )
        continue;
      const value = copy.attributes[key];
      copy.attributes[key] =
        field.attributes.localized && isRecord(value)
          ? Object.fromEntries(
              Object.entries(value).map(([locale, entry]) => [
                locale,
                collapseValue(field, entry),
              ]),
            )
          : collapseValue(field, value);
    }
    return copy;
  }

  // ── Applying a request body ────────────────────────────────────────────

  type ApplyContext = { blocks: Map<string, StoredItem> };

  function newBlockMeta(): RawApiTypes.ItemMeta {
    const now = new Date().toISOString();
    return {
      created_at: now,
      updated_at: now,
      published_at: null,
      first_published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      status: null,
      is_valid: true,
      is_current_version_valid: null,
      is_published_version_valid: null,
      current_version: nextVersion(),
      stage: null,
      has_children: null,
    };
  }

  function allowedBlockModels(field: RawField): ReadonlyArray<string> {
    const names = [
      'rich_text_blocks',
      'single_block_blocks',
      'structured_text_blocks',
      'structured_text_inline_blocks',
    ];
    return names.flatMap((name) => {
      const itemTypes = readValidator(field, name)?.item_types;
      return Array.isArray(itemTypes)
        ? itemTypes.filter((id): id is string => typeof id === 'string')
        : [];
    });
  }

  function blockFieldError(field: RawField, code: string): FakeApiError {
    return invalidFieldError([{ field, locale: null, code }]);
  }

  /** The stored block a request block refers to (by id string or `{ id }`), or null for a new block. */
  function referencedBlock(
    field: RawField,
    value: unknown,
    context: ApplyContext,
  ): StoredItem | null {
    const id =
      typeof value === 'string'
        ? value
        : isRecord(value) && typeof value.id === 'string'
          ? value.id
          : null;
    if (id === null) return null;
    const existing = context.blocks.get(id);
    if (!existing) throw blockFieldError(field, 'VALIDATION_BLOCK_NOT_FOUND');
    return existing;
  }

  function blockAttributes(
    modelId: string,
    incoming: UnknownRecord,
    existing: StoredItem | null,
    context: ApplyContext,
  ): UnknownRecord {
    const attributes: UnknownRecord = {};
    for (const blockField of fieldsOf(modelId)) {
      const key = blockField.attributes.api_key;
      if (key in incoming) {
        attributes[key] = resolveField(blockField, incoming[key], context);
      } else {
        attributes[key] = existing ? clone(existing.attributes[key]) : null;
      }
    }
    return attributes;
  }

  /**
   * A block in a request: an id string keeps the stored block, `{ id,
   * attributes }` updates the listed fields of the stored block, and an object
   * without an id (with `relationships.item_type`) creates a block.
   */
  function resolveBlock(
    field: RawField,
    value: unknown,
    context: ApplyContext,
  ): StoredItem {
    const existing = referencedBlock(field, value, context);
    if (typeof value === 'string' && existing) return clone(existing);
    if (!isRecord(value)) {
      throw blockFieldError(field, 'VALIDATION_INVALID_BLOCK');
    }

    const modelId = modelIdOf(value) ?? (existing && modelIdOf(existing));
    if (!modelId || !allowedBlockModels(field).includes(modelId)) {
      throw blockFieldError(field, 'VALIDATION_ITEM_TYPE');
    }

    const incoming = isRecord(value.attributes) ? value.attributes : {};
    return {
      type: 'item',
      id: existing?.id ?? nextBlockId(),
      attributes: blockAttributes(modelId, incoming, existing, context),
      relationships: {
        item_type: { data: { type: 'item_type', id: modelId } },
      },
      meta: existing ? clone(existing.meta) : newBlockMeta(),
    };
  }

  function resolveBlockList(
    field: RawField,
    value: unknown,
    context: ApplyContext,
  ): StoredItem[] {
    if (value === null) return [];
    if (!Array.isArray(value)) {
      throw blockFieldError(field, 'VALIDATION_INVALID_FORMAT');
    }
    return value.map((block) => resolveBlock(field, block, context));
  }

  function resolveStructuredText(
    field: RawField,
    value: unknown,
    context: ApplyContext,
  ): unknown {
    if (value === null) return null;
    if (!isRecord(value) || !isRecord(value.document)) {
      throw blockFieldError(field, 'VALIDATION_INVALID_FORMAT');
    }
    return mapStructuredTextNodes(
      value,
      (item) => resolveBlock(field, item, context),
      relationshipId,
    );
  }

  function resolveValue(
    field: RawField,
    value: unknown,
    context: ApplyContext,
  ): unknown {
    switch (field.attributes.field_type) {
      case 'rich_text':
        return resolveBlockList(field, value, context);
      case 'single_block':
        return value === null ? null : resolveBlock(field, value, context);
      case 'structured_text':
        return resolveStructuredText(field, value, context);
      default:
        return clone(value);
    }
  }

  function resolveField(
    field: RawField,
    value: unknown,
    context: ApplyContext,
  ): unknown {
    if (!field.attributes.localized || value === null) {
      return resolveValue(field, value, context);
    }
    if (!isRecord(value)) {
      throw blockFieldError(field, 'VALIDATION_INVALID_FORMAT');
    }
    const entries = Object.entries(value);
    if (entries.some(([locale]) => !locales.includes(locale))) {
      throw blockFieldError(field, 'VALIDATION_INVALID_LOCALE');
    }
    return Object.fromEntries(
      entries.map(([locale, entry]) => [
        locale,
        resolveValue(field, entry, context),
      ]),
    );
  }

  function readRequestData(body: unknown): UnknownRecord {
    const data = isRecord(body) ? body.data : null;
    if (!isRecord(data) || data.type !== 'item') {
      throw apiError(422, 'INVALID_FORMAT', {
        message:
          'The body must be { data: { type: "item", attributes, meta } }',
      });
    }
    return data;
  }

  /** Optimistic locking: `meta.current_version`, when sent, must be the stored one. */
  function assertCurrentVersion(
    current: StoredItem,
    data: UnknownRecord,
  ): void {
    const meta = isRecord(data.meta) ? data.meta : {};
    if (
      typeof meta.current_version === 'string' &&
      meta.current_version !== current.meta.current_version
    ) {
      throw apiError(422, 'STALE_ITEM_VERSION', {});
    }
    const requestedModel = modelIdOf(data);
    if (requestedModel && requestedModel !== modelIdOf(current)) {
      throw apiError(422, 'INVALID_FORMAT', {
        message: 'item_type cannot change',
      });
    }
  }

  function requestFields(
    modelId: string | null,
    data: UnknownRecord,
  ): Array<[RawField, unknown]> {
    const incoming = isRecord(data.attributes) ? data.attributes : {};
    const fieldsByKey = new Map(
      fieldsOf(modelId).map((field) => [field.attributes.api_key, field]),
    );
    const unknownKeys = Object.keys(incoming).filter(
      (key) => !fieldsByKey.has(key),
    );
    if (unknownKeys.length > 0) {
      throw apiError(422, 'INVALID_ATTRIBUTES', {
        extraneous_attributes: unknownKeys,
      });
    }
    return Object.entries(incoming).flatMap(([key, value]) => {
      const field = fieldsByKey.get(key);
      return field ? [[field, value] as [RawField, unknown]] : [];
    });
  }

  function applyBody(current: StoredItem, body: unknown): StoredItem {
    const data = readRequestData(body);
    assertCurrentVersion(current, data);

    const modelId = modelIdOf(current);
    const fields = requestFields(modelId, data);
    const context: ApplyContext = { blocks: new Map() };
    collectBlocks(modelId, current.attributes, context.blocks);

    const next = clone(current);
    for (const [field, value] of fields) {
      next.attributes[field.attributes.api_key] = resolveField(
        field,
        value,
        context,
      );
    }
    return next;
  }

  function ownerFailures(
    modelId: string | null,
    attributes: UnknownRecord,
  ): Failure[] {
    const failures: Failure[] = [];
    for (const field of fieldsOf(modelId)) {
      for (const [locale, value] of localeEntries(
        field,
        attributes[field.attributes.api_key],
      )) {
        failures.push(...valueFailures(field, locale, value));
        for (const block of blocksInValue(field, value)) {
          failures.push(...ownerFailures(modelIdOf(block), block.attributes));
        }
      }
    }
    return failures;
  }

  function uniqueFailures(item: StoredItem): Failure[] {
    const modelId = modelIdOf(item);
    const failures: Failure[] = [];
    for (const field of fieldsOf(modelId)) {
      if (!readValidator(field, 'unique') || field.attributes.localized)
        continue;
      const key = field.attributes.api_key;
      const value = item.attributes[key];
      const taken = [...records.values()].some(
        (other) =>
          other.id !== item.id &&
          modelIdOf(other) === modelId &&
          other.attributes[key] === value,
      );
      if (taken && value !== null && value !== '') {
        failures.push({ field, locale: null, code: 'VALIDATION_UNIQUE' });
      }
    }
    return failures;
  }

  function assertValid(item: StoredItem): void {
    const failures = [
      ...ownerFailures(modelIdOf(item), item.attributes),
      ...uniqueFailures(item),
    ];
    if (failures.length > 0) throw invalidFieldError(failures);
  }

  function saved(item: StoredItem): StoredItem {
    const now = new Date().toISOString();
    const draftMode = isDraftModel(modelIdOf(item));
    const meta: RawApiTypes.ItemMeta = {
      ...item.meta,
      current_version: nextVersion(),
      updated_at: now,
    };
    if (!draftMode) {
      meta.status = 'published';
      meta.published_at = now;
      meta.first_published_at = meta.first_published_at ?? now;
    } else if (meta.status === 'published') {
      meta.status = 'updated';
    }
    const next = { ...item, meta };
    records.set(item.id, next);
    return next;
  }

  /**
   * The current version becomes the published one, so `current_version` stays
   * as it is. Like the CMA, an invalid record can't be published.
   */
  function published(item: StoredItem): StoredItem {
    assertValid(item);
    const now = new Date().toISOString();
    const next: StoredItem = {
      ...item,
      meta: {
        ...item.meta,
        status: 'published',
        published_at: now,
        first_published_at: item.meta.first_published_at ?? now,
        is_valid: true,
        is_current_version_valid: true,
        is_published_version_valid: true,
      },
    };
    records.set(item.id, next);
    return next;
  }

  function requireRecord(id: string): StoredItem {
    const record = records.get(id);
    if (!record) throw apiError(404, 'NOT_FOUND', { id });
    return record;
  }

  function list(query: ListQuery): { data: StoredItem[]; totalCount: number } {
    let items = [...records.values()];
    if (query.ids) {
      const ids = new Set(query.ids);
      items = items.filter((item) => ids.has(item.id));
    }
    if (query.types) {
      const typeIds = new Set(query.types.map(resolveModelId));
      items = items.filter((item) => typeIds.has(modelIdOf(item)));
    }
    if (query.statuses) {
      const statuses = query.statuses;
      items = items.filter((item) =>
        statuses.includes(String(item.meta.status)),
      );
    }
    if (query.text) {
      const needle = query.text.toLowerCase();
      items = items.filter((item) => {
        const texts: string[] = [];
        textLeaves(item.attributes, texts);
        return texts.some((text) => text.toLowerCase().includes(needle));
      });
    }
    const sorted = sortItems(items, query.orderBy);
    const limit = Math.min(Math.max(query.limit, 1), MAX_PAGE_LIMIT);
    const offset = Math.max(query.offset, 0);
    return {
      data: sorted
        .slice(offset, offset + limit)
        .map((item) => render(item, query.nested)),
      totalCount: sorted.length,
    };
  }

  return {
    schema,
    site,
    locales,
    records: () => [...records.values()],
    find: (id) => records.get(id),
    render,
    list,
    update(id, body) {
      const next = applyBody(requireRecord(id), body);
      assertValid(next);
      return render(saved(next), true);
    },
    validate(id, body) {
      assertValid(applyBody(requireRecord(id), body));
    },
    publish(id) {
      return published(requireRecord(id));
    },
    edit(id, change) {
      const next = clone(requireRecord(id));
      change(next.attributes);
      saved(next);
    },
    touch(id) {
      saved(clone(requireRecord(id)));
    },
    remove(id) {
      records.delete(id);
    },
  };
}

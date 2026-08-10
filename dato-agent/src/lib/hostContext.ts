import type { Field, ItemType } from 'datocms-plugin-sdk';
import {
  buildModelContextManifest,
  buildStandaloneFieldDirectory,
  buildStandaloneProjectMap,
  type ManifestBuildOptions,
  type ModelContextManifest,
  renderModelContextManifest,
} from './contextManifest';

export const DEFAULT_RECORD_HOST_CONTEXT_CHARACTER_LIMIT = 10_000;
export const DEFAULT_STANDALONE_HOST_CONTEXT_CHARACTER_LIMIT = 14_000;
export const DEFAULT_MODEL_SCHEMA_CHARACTER_LIMIT = 8_000;
export const DEFAULT_LIVE_VALUE_CHARACTER_LIMIT = 320;
export const DEFAULT_LIVE_VALUE_FIELD_LIMIT = 40;
export const MAX_CURRENT_RECORD_FORM_FIELDS = 10;
export const MAX_CURRENT_RECORD_FORM_STATE_CHARACTERS = 24_000;
export const CURRENT_RECORD_FORM_STATE_CAVEAT =
  'This data comes from the current browser form. It may include unsaved edits and does not prove what is saved or published in DatoCMS.';

const MINIMUM_HOST_CONTEXT_CHARACTER_LIMIT = 384;
const MINIMUM_MODEL_SCHEMA_CHARACTER_LIMIT = 256;
const MAX_LOCATION_CHARACTER_LIMIT = 500;
const MAX_IDENTITY_CHARACTER_LIMIT = 200;
const MAX_LIST_VALUES = 12;
const MAX_RICH_NODES = 500;
const CURRENT_FORM_VALUE_CHARACTER_LIMIT = 1_200;

export type HostContextSnapshot = {
  text: string;
  fingerprint: string;
};

export type HostCoordinatesInput = {
  siteId: string;
  siteName?: string;
  environment: string;
  isEnvironmentPrimary: boolean;
  locales: readonly string[];
  uiLocale?: string;
  timezone?: string;
};

export type RecordBlockCounts = {
  total: number;
  nonLocalized: number;
  perLocale: Readonly<Record<string, number>>;
  maximumPerItem: number;
};

export type BuildRecordHostContextInput = HostCoordinatesInput &
  ManifestBuildOptions & {
    model: ItemType;
    itemTypes: readonly ItemType[];
    fields: readonly Field[];
    formValues: Readonly<Record<string, unknown>>;
    activeLocale: string;
    status: 'new' | 'draft' | 'updated' | 'published';
    dirty: boolean;
    submitting: boolean;
    recordId?: string | null;
    blockCounts?: RecordBlockCounts;
    maxCharacters?: number;
    maxValueCharacters?: number;
    maxValueFields?: number;
  };

export type HostLocation = {
  pathname: string;
  search: string;
  hash: string;
};

export type BuildStandaloneHostContextInput = HostCoordinatesInput &
  ManifestBuildOptions & {
    itemTypes: readonly ItemType[];
    loadedFields: readonly Field[];
    highlightedItemId?: string;
    location?: HostLocation;
    maxCharacters?: number;
  };

export type CreateModelSchemaResolverInput = ManifestBuildOptions & {
  itemTypes: readonly ItemType[];
  loadedFields: readonly Field[];
  loadItemTypeFields: (itemTypeId: string) => Promise<readonly Field[]>;
  maxCharacters?: number;
};

export type ModelSchemaResolver = (
  exactIdApiKeyOrName: string,
  cursor?: number,
) => Promise<HostContextSnapshot>;

export type CurrentRecordFormFieldRequest = {
  fieldPath: string;
  locale?: string | null;
};

export type CurrentRecordFormFieldState = {
  fieldPath: string;
  label: string;
  fieldType: Field['attributes']['field_type'];
  localized: boolean;
  locale: string | null;
  state: 'value' | 'empty' | 'null' | 'missing';
  summary: string;
  truncated?: true;
};

export type ReadCurrentRecordFormStateInput = {
  model: ItemType;
  fields: readonly Field[];
  formValues: Readonly<Record<string, unknown>>;
  activeLocale: string;
  locales: readonly string[];
  dirty: boolean;
  recordId?: string | null;
  requests: readonly CurrentRecordFormFieldRequest[];
  maxValueCharacters?: number;
};

export type CurrentRecordFormStateResult = {
  source: 'current_record_browser_form_state';
  persistence: 'may_be_unsaved';
  savedOrPublishedStateVerified: false;
  caveat: typeof CURRENT_RECORD_FORM_STATE_CAVEAT;
  record: {
    id: string | null;
    modelId: string;
    modelApiKey: string;
  };
  form: {
    dirty: boolean;
  };
  fields: CurrentRecordFormFieldState[];
  truncated: boolean;
};

type ValueSummary = {
  text: string;
  truncated?: boolean;
};

type RichValueSummary = {
  text: string;
  textTruncated: boolean;
  nodes: number;
  blocks: number;
  linkedRecords: number;
};

function normalizeIntegerLimit(
  value: number | undefined,
  fallback: number,
  minimum: number,
  label: string,
): number {
  const normalized = value ?? fallback;

  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw new RangeError(`${label} must be an integer of at least ${minimum}.`);
  }

  return normalized;
}

function normalizeNonNegativeInteger(value: number, fallback = 0): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capText(value: string, maxCharacters: number): ValueSummary {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);

  if (characters.length <= maxCharacters) {
    return { text: normalized };
  }

  if (maxCharacters === 0) {
    return { text: '', truncated: true };
  }

  const suffix = maxCharacters === 1 ? '' : '…';
  const keptCharacters = maxCharacters - suffix.length;

  return {
    text: `${characters.slice(0, keptCharacters).join('')}${suffix}`,
    truncated: true,
  };
}

function boundedIdentity(value: string): string {
  return capText(value, MAX_IDENTITY_CHARACTER_LIMIT).text;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `hostctx-v1-${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}

function snapshot(text: string): HostContextSnapshot {
  return { text, fingerprint: fingerprint(text) };
}

function renderCoordinates(
  input: HostCoordinatesInput,
  surface: 'record' | 'standalone',
): string {
  return [
    'host_context',
    'version=1',
    `surface=${surface}`,
    `site_id=${JSON.stringify(boundedIdentity(input.siteId))}`,
    ...(input.siteName
      ? [`site_name=${JSON.stringify(capText(input.siteName, 160).text)}`]
      : []),
    `environment=${JSON.stringify(boundedIdentity(input.environment))}`,
    `environment_primary=${input.isEnvironmentPrimary}`,
    `locales=${JSON.stringify(uniqueStrings(input.locales))}`,
    `ui_locale=${JSON.stringify(input.uiLocale?.trim() || null)}`,
    `timezone=${JSON.stringify(input.timezone?.trim() || null)}`,
  ].join('|');
}

function fieldIdsForModel(itemType: ItemType): string[] {
  return itemType.relationships.fields.data.map((field) => field.id);
}

function fieldsForModel(itemType: ItemType, fields: readonly Field[]): Field[] {
  const expectedIds = new Set(fieldIdsForModel(itemType));

  return fields.filter(
    (field) =>
      expectedIds.has(field.id) &&
      field.relationships.item_type.data.id === itemType.id,
  );
}

function hasCompleteFields(
  itemType: ItemType,
  fields: readonly Field[],
): boolean {
  const availableIds = new Set(
    fieldsForModel(itemType, fields).map((field) => field.id),
  );

  return fieldIdsForModel(itemType).every((fieldId) =>
    availableIds.has(fieldId),
  );
}

function selectedLocalizedValue(
  value: unknown,
  localized: boolean,
  activeLocale: string,
): unknown {
  if (!localized || !isRecord(value)) {
    return value;
  }

  return value[activeLocale];
}

function recordIdentifier(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ['id', 'upload_id', 'uploadId', 'itemId']) {
    if (typeof value[key] === 'string') {
      return value[key];
    }
  }

  return undefined;
}

function summarizeIdList(value: unknown): ValueSummary {
  if (!Array.isArray(value)) {
    return { text: 'invalid_list' };
  }

  const ids = value
    .map(recordIdentifier)
    .filter((candidate): candidate is string => Boolean(candidate));
  const included = ids.slice(0, MAX_LIST_VALUES);
  const omitted = Math.max(0, ids.length - included.length);

  return {
    text: `count=${value.length}|ids=${JSON.stringify(included)}${
      omitted > 0 ? `|omitted=${omitted}` : ''
    }`,
    ...(omitted > 0 ? { truncated: true } : {}),
  };
}

function summarizeObjectShape(value: unknown): ValueSummary {
  if (Array.isArray(value)) {
    return { text: `array(count=${value.length})` };
  }

  if (isRecord(value)) {
    return {
      text: `object(keys=${Object.keys(value).length})`,
    };
  }

  return { text: JSON.stringify(value) ?? 'undefined' };
}

function scanRichValue(
  value: unknown,
  maxTextCharacters: number,
): RichValueSummary {
  const textParts: string[] = [];
  const seen = new Set<object>();
  let currentTextCharacters = 0;
  let textTruncated = false;
  let nodes = 0;
  let blocks = 0;
  let linkedRecords = 0;

  const appendText = (text: string) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return;
    }

    const remaining = maxTextCharacters - currentTextCharacters;
    if (remaining <= 0) {
      textTruncated = true;
      return;
    }

    const capped = capText(normalized, remaining);
    textParts.push(capped.text);
    currentTextCharacters += Array.from(capped.text).length + 1;
    textTruncated ||= Boolean(capped.truncated);
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: A single bounded recursive visitor keeps cycle, depth, node, text, block, and link accounting consistent.
  const visit = (candidate: unknown, depth: number) => {
    if (nodes >= MAX_RICH_NODES || depth > 24) {
      textTruncated = true;
      return;
    }

    if (typeof candidate === 'string') {
      appendText(candidate);
      return;
    }

    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    nodes += 1;

    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry, depth + 1);
        if (nodes >= MAX_RICH_NODES) {
          break;
        }
      }
      return;
    }

    const record = candidate as Record<string, unknown>;
    const nodeType = typeof record.type === 'string' ? record.type : undefined;

    if (
      nodeType === 'block' ||
      typeof record.blockModelId === 'string' ||
      typeof record.itemTypeId === 'string'
    ) {
      blocks += 1;
    }

    if (
      nodeType === 'itemLink' ||
      nodeType === 'inlineItem' ||
      typeof record.item === 'string'
    ) {
      linkedRecords += 1;
    }

    if (typeof record.text === 'string') {
      appendText(record.text);
    } else if (
      typeof record.value === 'string' &&
      (nodeType === 'span' || nodeType === undefined)
    ) {
      appendText(record.value);
    }

    for (const key of ['children', 'document', 'content']) {
      if (key in record) {
        visit(record[key], depth + 1);
      }
    }
  };

  visit(value, 0);

  return {
    text: textParts.join(' ').trim(),
    textTruncated,
    nodes,
    blocks,
    linkedRecords,
  };
}

function summarizeRichValue(
  value: unknown,
  maxTextCharacters: number,
): ValueSummary {
  const summary = scanRichValue(value, maxTextCharacters);

  return {
    text: [
      `nodes=${summary.nodes}`,
      `blocks=${summary.blocks}`,
      `linked_records=${summary.linkedRecords}`,
      `text=${JSON.stringify(summary.text)}`,
    ].join('|'),
    ...(summary.textTruncated ? { truncated: true } : {}),
  };
}

function summarizeSeoValue(
  value: unknown,
  maxTextCharacters: number,
): ValueSummary {
  if (!isRecord(value)) {
    return summarizeObjectShape(value);
  }

  const details: string[] = [];

  for (const key of ['title', 'description']) {
    if (typeof value[key] === 'string') {
      const capped = capText(value[key], maxTextCharacters);
      details.push(`${key}=${JSON.stringify(capped.text)}`);
      if (capped.truncated) {
        details.push(`${key}_truncated=true`);
      }
    }
  }

  const imageId = recordIdentifier(value.image);
  if (imageId) {
    details.push(`image_id=${JSON.stringify(imageId)}`);
  }

  return {
    text:
      details.length > 0 ? details.join('|') : summarizeObjectShape(value).text,
  };
}

function summarizeLatLon(value: unknown): ValueSummary {
  if (!isRecord(value)) {
    return summarizeObjectShape(value);
  }

  const latitude = value.latitude ?? value.lat;
  const longitude = value.longitude ?? value.lng ?? value.lon;

  return {
    text: `latitude=${JSON.stringify(latitude ?? null)}|longitude=${JSON.stringify(longitude ?? null)}`,
  };
}

function summarizeColor(value: unknown): ValueSummary {
  if (typeof value === 'string') {
    return { text: JSON.stringify(value) };
  }

  if (!isRecord(value)) {
    return summarizeObjectShape(value);
  }

  const channels = ['red', 'green', 'blue', 'alpha']
    .filter((key) => typeof value[key] === 'number')
    .map((key) => `${key}=${String(value[key])}`);

  return {
    text:
      channels.length > 0
        ? channels.join('|')
        : summarizeObjectShape(value).text,
  };
}

function summarizeFile(value: unknown, multiple: boolean): ValueSummary {
  if (multiple) {
    return summarizeIdList(value);
  }

  const id = recordIdentifier(value);
  return {
    text: id
      ? `id=${JSON.stringify(id)}`
      : value === null
        ? 'null'
        : 'unresolved_file',
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Exhaustively mapping DatoCMS field types in one switch makes every value-shape policy explicit.
function summarizeLiveValue(
  fieldType: Field['attributes']['field_type'],
  value: unknown,
  maxTextCharacters: number,
): ValueSummary {
  if (value === null) {
    return { text: 'null' };
  }

  if (value === undefined) {
    return { text: 'undefined' };
  }

  switch (fieldType) {
    case 'boolean':
    case 'float':
    case 'integer':
      return {
        text:
          typeof value === 'boolean' || typeof value === 'number'
            ? String(value)
            : `invalid_${fieldType}`,
      };
    case 'date':
    case 'date_time':
    case 'slug':
    case 'string':
    case 'text':
      if (typeof value !== 'string') {
        return { text: `invalid_${fieldType}` };
      }
      {
        const capped = capText(value, maxTextCharacters);
        return {
          text: JSON.stringify(capped.text),
          ...(capped.truncated ? { truncated: true } : {}),
        };
      }
    case 'link': {
      const id = recordIdentifier(value);
      return { text: id ? `id=${JSON.stringify(id)}` : 'null' };
    }
    case 'links':
      return summarizeIdList(value);
    case 'file':
      return summarizeFile(value, false);
    case 'gallery':
      return summarizeFile(value, true);
    case 'structured_text':
    case 'rich_text':
    case 'single_block':
      return summarizeRichValue(value, maxTextCharacters);
    case 'seo':
      return summarizeSeoValue(value, maxTextCharacters);
    case 'lat_lon':
      return summarizeLatLon(value);
    case 'color':
      return summarizeColor(value);
    case 'json': {
      if (typeof value === 'string') {
        const capped = capText(value, maxTextCharacters);
        return {
          text: JSON.stringify(capped.text),
          ...(capped.truncated ? { truncated: true } : {}),
        };
      }
      return summarizeObjectShape(value);
    }
    case 'video':
      if (!isRecord(value)) {
        return summarizeObjectShape(value);
      }
      return {
        text:
          [
            ...(typeof value.provider === 'string'
              ? [`provider=${JSON.stringify(value.provider)}`]
              : []),
            ...(typeof value.provider_uid === 'string'
              ? [`provider_uid=${JSON.stringify(value.provider_uid)}`]
              : []),
            ...(typeof value.url === 'string'
              ? [
                  `url=${JSON.stringify(
                    capText(value.url, maxTextCharacters).text,
                  )}`,
                ]
              : []),
          ].join('|') || summarizeObjectShape(value).text,
      };
  }
}

function classifyCurrentFormValue(
  fieldType: Field['attributes']['field_type'],
  value: unknown,
  exists: boolean,
): CurrentRecordFormFieldState['state'] {
  if (!exists || value === undefined) {
    return 'missing';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return 'empty';
  }

  if (Array.isArray(value) && value.length === 0) {
    return 'empty';
  }

  if (
    fieldType === 'structured_text' ||
    fieldType === 'rich_text' ||
    fieldType === 'single_block'
  ) {
    const richSummary = scanRichValue(value, 1);

    if (
      !richSummary.text &&
      richSummary.blocks === 0 &&
      richSummary.linkedRecords === 0
    ) {
      return 'empty';
    }
  }

  return 'value';
}

function summarizeCurrentFormValue(
  fieldType: Field['attributes']['field_type'],
  value: unknown,
  maxTextCharacters: number,
): ValueSummary {
  if (fieldType !== 'json') {
    return summarizeLiveValue(fieldType, value, maxTextCharacters);
  }

  if (typeof value === 'string') {
    return {
      text: `string(characters=${Array.from(value).length})`,
    };
  }

  return summarizeObjectShape(value);
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(record, key);
}

function resolveCurrentFormField(
  fieldsByApiKey: ReadonlyMap<string, readonly Field[]>,
  fieldPath: string,
): Field {
  if (
    typeof fieldPath !== 'string' ||
    !fieldPath ||
    fieldPath.length > MAX_IDENTITY_CHARACTER_LIMIT
  ) {
    throw new Error(
      `Current record form field paths must be exact top-level API keys no longer than ${MAX_IDENTITY_CHARACTER_LIMIT} characters.`,
    );
  }

  const matches = fieldsByApiKey.get(fieldPath) ?? [];

  if (matches.length === 0) {
    throw new Error(
      `No exact top-level field API key ${JSON.stringify(fieldPath)} exists on the current model.`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `The top-level field API key ${JSON.stringify(fieldPath)} is ambiguous on the current model.`,
    );
  }

  return matches[0];
}

function resolveCurrentFormLocale(
  currentField: Field,
  requestedLocale: string | null | undefined,
  activeLocale: string,
  validLocales: ReadonlySet<string>,
): string | null {
  const fieldPath = currentField.attributes.api_key;

  if (!currentField.attributes.localized) {
    if (requestedLocale !== undefined && requestedLocale !== null) {
      throw new Error(
        `Field ${JSON.stringify(fieldPath)} is not localized, so a locale cannot be supplied.`,
      );
    }

    return null;
  }

  const locale = requestedLocale ?? activeLocale;

  if (typeof locale !== 'string' || !validLocales.has(locale)) {
    throw new Error(
      `Locale ${JSON.stringify(locale)} is not available for localized field ${JSON.stringify(fieldPath)}.`,
    );
  }

  return locale;
}

function selectCurrentFormValue(
  formValues: Readonly<Record<string, unknown>>,
  fieldPath: string,
  localized: boolean,
  locale: string | null,
): { exists: boolean; value: unknown } {
  const hasFieldValue = hasOwn(formValues, fieldPath);
  const rawValue = hasFieldValue ? formValues[fieldPath] : undefined;

  if (!localized) {
    return { exists: hasFieldValue, value: rawValue };
  }

  const localizedValues = isRecord(rawValue) ? rawValue : undefined;
  const exists = Boolean(
    locale && localizedValues && hasOwn(localizedValues, locale),
  );

  return {
    exists,
    value: locale ? localizedValues?.[locale] : undefined,
  };
}

function buildCurrentRecordFormFieldState(
  request: CurrentRecordFormFieldRequest,
  currentField: Field,
  locale: string | null,
  formValues: Readonly<Record<string, unknown>>,
  maxValueCharacters: number,
): CurrentRecordFormFieldState {
  const fieldType = currentField.attributes.field_type;
  const localized = currentField.attributes.localized;
  const { exists, value } = selectCurrentFormValue(
    formValues,
    request.fieldPath,
    localized,
    locale,
  );
  const summary = summarizeCurrentFormValue(
    fieldType,
    value,
    maxValueCharacters,
  );

  return {
    fieldPath: request.fieldPath,
    label: capText(currentField.attributes.label, 160).text,
    fieldType,
    localized,
    locale,
    state: classifyCurrentFormValue(fieldType, value, exists),
    summary: summary.text,
    ...(summary.truncated ? { truncated: true as const } : {}),
  };
}

/**
 * Reads a bounded, type-aware projection of selected fields from the live
 * browser form. It deliberately does not claim that any returned value is
 * saved or published in DatoCMS.
 */
export function readCurrentRecordFormState(
  input: ReadCurrentRecordFormStateInput,
): CurrentRecordFormStateResult {
  if (
    input.requests.length === 0 ||
    input.requests.length > MAX_CURRENT_RECORD_FORM_FIELDS
  ) {
    throw new RangeError(
      `Current record form reads require between 1 and ${MAX_CURRENT_RECORD_FORM_FIELDS} fields.`,
    );
  }

  if (!hasCompleteFields(input.model, input.fields)) {
    throw new Error(
      'Cannot read the current record form until the current model fields are complete.',
    );
  }

  const maxValueCharacters = normalizeIntegerLimit(
    input.maxValueCharacters,
    CURRENT_FORM_VALUE_CHARACTER_LIMIT,
    0,
    'Current record form maxValueCharacters',
  );

  if (maxValueCharacters > CURRENT_FORM_VALUE_CHARACTER_LIMIT) {
    throw new RangeError(
      `Current record form maxValueCharacters cannot exceed ${CURRENT_FORM_VALUE_CHARACTER_LIMIT}.`,
    );
  }

  const modelFields = fieldsForModel(input.model, input.fields);
  const fieldsByApiKey = new Map<string, Field[]>();

  for (const currentField of modelFields) {
    const apiKey = currentField.attributes.api_key;
    fieldsByApiKey.set(apiKey, [
      ...(fieldsByApiKey.get(apiKey) ?? []),
      currentField,
    ]);
  }

  const validLocales = new Set(uniqueStrings(input.locales));
  const seenRequests = new Set<string>();
  const resultFields = input.requests.map((request) => {
    const currentField = resolveCurrentFormField(
      fieldsByApiKey,
      request.fieldPath,
    );
    const locale = resolveCurrentFormLocale(
      currentField,
      request.locale,
      input.activeLocale,
      validLocales,
    );
    const requestKey = `${request.fieldPath}\u0000${locale ?? ''}`;
    if (seenRequests.has(requestKey)) {
      throw new Error(
        `Field ${JSON.stringify(request.fieldPath)}${
          locale ? ` in locale ${JSON.stringify(locale)}` : ''
        } was requested more than once.`,
      );
    }
    seenRequests.add(requestKey);

    return buildCurrentRecordFormFieldState(
      request,
      currentField,
      locale,
      input.formValues,
      maxValueCharacters,
    );
  });
  const result: CurrentRecordFormStateResult = {
    source: 'current_record_browser_form_state',
    persistence: 'may_be_unsaved',
    savedOrPublishedStateVerified: false,
    caveat: CURRENT_RECORD_FORM_STATE_CAVEAT,
    record: {
      id: input.recordId?.trim() || null,
      modelId: boundedIdentity(input.model.id),
      modelApiKey: boundedIdentity(input.model.attributes.api_key),
    },
    form: {
      dirty: input.dirty,
    },
    fields: resultFields,
    truncated: resultFields.some((field) => Boolean(field.truncated)),
  };

  if (
    JSON.stringify(result).length > MAX_CURRENT_RECORD_FORM_STATE_CHARACTERS
  ) {
    throw new Error(
      `Current record form state exceeded the ${MAX_CURRENT_RECORD_FORM_STATE_CHARACTERS}-character safety limit.`,
    );
  }

  return result;
}

function renderCompactModelManifest(manifest: ModelContextManifest): string {
  const header = [
    'current_model',
    `id=${JSON.stringify(manifest.id)}`,
    `api_key=${JSON.stringify(manifest.apiKey)}`,
    `name=${JSON.stringify(capText(manifest.name, 160).text)}`,
    `kind=${manifest.kind}`,
    `fields_complete=${manifest.fieldsComplete}`,
    `fields=${manifest.fields.length}`,
    `omitted_fields=${manifest.omittedFieldIds.length}`,
    `singleton=${manifest.singleton}`,
    `all_locales_required=${manifest.allLocalesRequired}`,
    `draft_mode=${manifest.draftModeActive}`,
    `draft_saving=${manifest.draftSavingActive}`,
    `tree=${manifest.tree}`,
    `workflow_id=${JSON.stringify(manifest.workflowId ?? null)}`,
  ].join('|');
  const fieldLines = manifest.fields.map((field) => {
    const targets = field.targets
      ? Object.entries(field.targets)
          .map(([kind, target]) => {
            const values = [
              ...target.apiKeys,
              ...target.unresolvedIds.map((id) => `id:${id}`),
            ];
            return `${kind}=${JSON.stringify(values)}`;
          })
          .join(';')
      : undefined;

    return [
      'field_signature',
      `api_key=${JSON.stringify(field.apiKey)}`,
      `type=${field.fieldType}`,
      ...(field.localized ? ['localized=true'] : []),
      ...(field.required ? ['required=true'] : []),
      ...(field.unique ? ['unique=true'] : []),
      ...(field.roles.length > 0
        ? [`roles=${JSON.stringify(field.roles)}`]
        : []),
      ...(targets ? [`targets=${targets}`] : []),
    ].join('|');
  });

  return [
    header,
    ...(manifest.omittedFieldIds.length > 0
      ? [`missing_field_ids=${manifest.omittedFieldIds.join(',')}`]
      : []),
    ...fieldLines,
  ].join('\n');
}

function renderMinimalModelManifest(manifest: ModelContextManifest): string {
  return [
    'current_model',
    `id=${JSON.stringify(manifest.id)}`,
    `api_key=${JSON.stringify(manifest.apiKey)}`,
    `name=${JSON.stringify(capText(manifest.name, 120).text)}`,
    `kind=${manifest.kind}`,
    `fields=${manifest.fields.length + manifest.omittedFieldIds.length}`,
    `singleton=${manifest.singleton}`,
    `draft_mode=${manifest.draftModeActive}`,
    `workflow_id=${JSON.stringify(manifest.workflowId ?? null)}`,
    'schema_detail=on_demand',
  ].join('|');
}

function renderBlockCounts(blockCounts: RecordBlockCounts | undefined): string {
  if (!blockCounts) {
    return 'blocks|available=false';
  }

  const perLocale = Object.fromEntries(
    Object.entries(blockCounts.perLocale)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([locale, count]) => [locale, normalizeNonNegativeInteger(count)]),
  );

  return [
    'blocks',
    'available=true',
    `total=${normalizeNonNegativeInteger(blockCounts.total)}`,
    `non_localized=${normalizeNonNegativeInteger(blockCounts.nonLocalized)}`,
    `per_locale=${JSON.stringify(perLocale)}`,
    `maximum_per_item=${normalizeNonNegativeInteger(
      blockCounts.maximumPerItem,
    )}`,
  ].join('|');
}

function prioritizeManifestFields(
  manifest: ModelContextManifest,
): ModelContextManifest['fields'] {
  return manifest.fields
    .map((field, index) => ({ field, index }))
    .sort(
      (left, right) =>
        Number(right.field.roles.length > 0) -
          Number(left.field.roles.length > 0) || left.index - right.index,
    )
    .map(({ field }) => field);
}

function buildLiveValueLines(
  manifest: ModelContextManifest,
  formValues: Readonly<Record<string, unknown>>,
  activeLocale: string,
  maxTextCharacters: number,
  maxFields: number,
): { lines: string[]; availableCount: number } {
  const available = prioritizeManifestFields(manifest).filter(
    (field) => formValues[field.apiKey] !== undefined,
  );
  const lines = available.slice(0, maxFields).map((field) => {
    const value = selectedLocalizedValue(
      formValues[field.apiKey],
      field.localized,
      activeLocale,
    );
    const summary = summarizeLiveValue(
      field.fieldType,
      value,
      maxTextCharacters,
    );

    return [
      'live_value',
      `field=${JSON.stringify(field.apiKey)}`,
      `type=${field.fieldType}`,
      ...(field.localized ? [`locale=${JSON.stringify(activeLocale)}`] : []),
      summary.text,
      ...(summary.truncated ? ['truncated=true'] : []),
    ].join('|');
  });

  return { lines, availableCount: available.length };
}

function appendBoundedOptionalLines(
  requiredText: string,
  optionalLines: readonly string[],
  availableCount: number,
  maxCharacters: number,
): string {
  let includedCount = 0;
  let result = `${requiredText}\nlive_values|included=0/${availableCount}|omitted=${availableCount}`;

  for (let index = 0; index < optionalLines.length; index += 1) {
    const candidateCount = includedCount + 1;
    const header = `live_values|included=${candidateCount}/${availableCount}|omitted=${Math.max(
      0,
      availableCount - candidateCount,
    )}`;
    const includedLines = optionalLines.slice(0, candidateCount);
    const candidate = [requiredText, header, ...includedLines].join('\n');

    if (candidate.length > maxCharacters) {
      break;
    }

    includedCount = candidateCount;
    result = candidate;
  }

  return result;
}

export function buildRecordHostContext(
  input: BuildRecordHostContextInput,
): HostContextSnapshot {
  const maxCharacters = normalizeIntegerLimit(
    input.maxCharacters,
    DEFAULT_RECORD_HOST_CONTEXT_CHARACTER_LIMIT,
    MINIMUM_HOST_CONTEXT_CHARACTER_LIMIT,
    'Record host context maxCharacters',
  );
  const maxValueCharacters = normalizeIntegerLimit(
    input.maxValueCharacters,
    DEFAULT_LIVE_VALUE_CHARACTER_LIMIT,
    0,
    'Record live value maxValueCharacters',
  );
  const maxValueFields = normalizeIntegerLimit(
    input.maxValueFields,
    DEFAULT_LIVE_VALUE_FIELD_LIMIT,
    0,
    'Record live value maxValueFields',
  );
  const manifest = buildModelContextManifest({
    itemType: input.model,
    itemTypes: input.itemTypes,
    fields: input.fields,
    maxHintCharacters: input.maxHintCharacters,
    maxOptionValues: input.maxOptionValues,
  });
  const fixedLines = [
    renderCoordinates(input, 'record'),
    [
      'record',
      `id=${JSON.stringify(input.recordId?.trim() || null)}`,
      `model_id=${JSON.stringify(input.model.id)}`,
      `model_api_key=${JSON.stringify(input.model.attributes.api_key)}`,
      `active_locale=${JSON.stringify(input.activeLocale)}`,
      `status=${input.status}`,
      `dirty=${input.dirty}`,
      `submitting=${input.submitting}`,
    ].join('|'),
    renderBlockCounts(input.blockCounts),
  ];
  const detailedManifest = renderModelContextManifest(manifest);
  const compactManifest = renderCompactModelManifest(manifest);
  const minimalManifest = renderMinimalModelManifest(manifest);
  const liveValues = buildLiveValueLines(
    manifest,
    input.formValues,
    input.activeLocale,
    maxValueCharacters,
    maxValueFields,
  );
  const schemaCandidates = [
    `schema_mode=detailed\n${detailedManifest}`,
    `schema_mode=compact\n${compactManifest}`,
    `schema_mode=on_demand\n${minimalManifest}`,
  ];

  for (const schema of schemaCandidates) {
    const required = [...fixedLines, schema].join('\n');
    const withEmptyValues = `${required}\nlive_values|included=0/${liveValues.availableCount}|omitted=${liveValues.availableCount}`;

    if (withEmptyValues.length > maxCharacters) {
      continue;
    }

    const text = appendBoundedOptionalLines(
      required,
      liveValues.lines,
      liveValues.availableCount,
      maxCharacters,
    );
    return snapshot(text);
  }

  throw new RangeError(
    'Record host context maxCharacters is too small for required record and model metadata.',
  );
}

function sortedItemTypes(itemTypes: readonly ItemType[]): ItemType[] {
  return [...itemTypes].sort(
    (left, right) =>
      Number(left.attributes.modular_block) -
        Number(right.attributes.modular_block) ||
      left.attributes.api_key.localeCompare(right.attributes.api_key) ||
      left.id.localeCompare(right.id),
  );
}

function renderLocation(
  highlightedItemId: string | undefined,
  location: HostLocation | undefined,
): string {
  const boundedLocation = location
    ? {
        pathname: capText(location.pathname, MAX_LOCATION_CHARACTER_LIMIT).text,
        search: capText(location.search, MAX_LOCATION_CHARACTER_LIMIT).text,
        hash: capText(location.hash, MAX_LOCATION_CHARACTER_LIMIT).text,
      }
    : null;

  return [
    'standalone_state',
    `highlighted_item_id=${JSON.stringify(
      highlightedItemId ? boundedIdentity(highlightedItemId) : null,
    )}`,
    `location=${JSON.stringify(boundedLocation)}`,
  ].join('|');
}

function renderCompactModelDirectory(itemTypes: readonly ItemType[]): string {
  const models = sortedItemTypes(itemTypes);
  const lines = models.map((itemType) =>
    [
      'model_directory_entry',
      `id=${JSON.stringify(itemType.id)}`,
      `api_key=${JSON.stringify(itemType.attributes.api_key)}`,
      `name=${JSON.stringify(capText(itemType.attributes.name, 160).text)}`,
      `kind=${itemType.attributes.modular_block ? 'block' : 'model'}`,
      `fields=${itemType.relationships.fields.data.length}`,
      `singleton=${itemType.attributes.singleton}`,
      `draft_mode=${itemType.attributes.draft_mode_active}`,
      `tree=${itemType.attributes.tree}`,
      `workflow_id=${JSON.stringify(
        itemType.relationships.workflow.data?.id ?? null,
      )}`,
    ].join('|'),
  );

  return [
    `model_directory|complete=true|models=${models.length}`,
    'schema_on_demand=Use get_model_schema with one exact model ID, API key, or name only for field-specific semantics or validation; never use it as the first step of project-wide text search or enumerate models with it.',
    ...lines,
  ].join('\n');
}

export function buildStandaloneHostContext(
  input: BuildStandaloneHostContextInput,
): HostContextSnapshot {
  const maxCharacters = normalizeIntegerLimit(
    input.maxCharacters,
    DEFAULT_STANDALONE_HOST_CONTEXT_CHARACTER_LIMIT,
    MINIMUM_HOST_CONTEXT_CHARACTER_LIMIT,
    'Standalone host context maxCharacters',
  );
  const fixed = [
    renderCoordinates(input, 'standalone'),
    renderLocation(input.highlightedItemId, input.location),
  ];
  const detailedPrefix = [...fixed, 'schema_mode=detailed_complete'].join('\n');
  const detailedBudget = maxCharacters - detailedPrefix.length - 1;

  if (detailedBudget >= 96) {
    const projectMap = buildStandaloneProjectMap({
      itemTypes: input.itemTypes,
      fields: input.loadedFields,
      maxCharacters: detailedBudget,
      maxHintCharacters: input.maxHintCharacters,
      maxOptionValues: input.maxOptionValues,
    });

    if (projectMap.complete) {
      const text = `${detailedPrefix}\n${projectMap.text}`;
      if (text.length <= maxCharacters) {
        return snapshot(text);
      }
    }
  }

  const fieldDirectoryPrefix = [
    ...fixed,
    'schema_mode=field_directory_complete',
    'field_directory_usage=Use these complete model and field API keys/types to plan broad reads and searches without calling get_model_schema for every model. Call get_model_schema only when exact validation, editor, or write semantics are needed.',
  ].join('\n');
  const fieldDirectoryBudget = maxCharacters - fieldDirectoryPrefix.length - 1;

  if (fieldDirectoryBudget >= 96) {
    const fieldDirectory = buildStandaloneFieldDirectory({
      itemTypes: input.itemTypes,
      fields: input.loadedFields,
      maxCharacters: fieldDirectoryBudget,
      maxHintCharacters: input.maxHintCharacters,
      maxOptionValues: input.maxOptionValues,
    });

    if (fieldDirectory.complete) {
      const fieldDirectoryText = `${fieldDirectoryPrefix}\n${fieldDirectory.text}`;

      if (fieldDirectoryText.length <= maxCharacters) {
        return snapshot(fieldDirectoryText);
      }
    }
  }

  const directory = renderCompactModelDirectory(input.itemTypes);
  const text = [...fixed, 'schema_mode=directory_complete', directory].join(
    '\n',
  );

  if (text.length <= maxCharacters) {
    return snapshot(text);
  }

  const omittedDirectoryLines = [
    'schema_mode=directory_omitted_due_to_size',
    `model_directory|complete=false|models=${input.itemTypes.length}|omitted=${input.itemTypes.length}|reason=max_characters`,
    'schema_on_demand=Use get_model_schema with one exact model ID, API key, or name only for field-specific semantics or validation; never use it as the first step of project-wide text search or enumerate models with it.',
  ];
  const omittedWithCoordinates = [...fixed, ...omittedDirectoryLines].join(
    '\n',
  );

  if (omittedWithCoordinates.length <= maxCharacters) {
    return snapshot(omittedWithCoordinates);
  }

  const minimal = [
    'host_context|version=1|surface=standalone',
    ...omittedDirectoryLines,
  ].join('\n');

  if (minimal.length > maxCharacters) {
    throw new RangeError(
      'Standalone host context maxCharacters is too small for the schema-on-demand fallback.',
    );
  }

  return snapshot(minimal);
}

function matchingModels(
  itemTypes: readonly ItemType[],
  identifier: string,
): ItemType[] {
  const matches = new Map<string, ItemType>();

  for (const itemType of itemTypes) {
    if (
      itemType.id === identifier ||
      itemType.attributes.api_key === identifier ||
      itemType.attributes.name === identifier
    ) {
      matches.set(itemType.id, itemType);
    }
  }

  return [...matches.values()].sort(
    (left, right) =>
      left.attributes.api_key.localeCompare(right.attributes.api_key) ||
      left.id.localeCompare(right.id),
  );
}

function renderBoundedModelSchema(
  manifest: ModelContextManifest,
  maxCharacters: number,
  cursor: number,
): string {
  const fullManifest = renderModelContextManifest(manifest);
  const fullLines = fullManifest.split('\n');
  const detailedRequiredLines = fullLines.filter(
    (line) => !line.startsWith('field '),
  );
  const detailedFieldLines = fullLines.filter((line) =>
    line.startsWith('field '),
  );
  const compactLines = renderCompactModelManifest(manifest).split('\n');
  const compactRequiredLines = compactLines.filter(
    (line) => !line.startsWith('field_signature|'),
  );
  const compactFieldLines = compactLines.filter((line) =>
    line.startsWith('field_signature|'),
  );
  const totalFields = manifest.fields.length;

  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > totalFields) {
    throw new RangeError(
      `Model schema cursor must be an integer between 0 and ${totalFields}.`,
    );
  }

  const renderPage = (
    requiredLines: readonly string[],
    fieldLines: readonly string[],
  ): string | undefined => {
    let best: string | undefined;

    for (let count = 0; cursor + count <= fieldLines.length; count += 1) {
      const nextCursor = cursor + count < totalFields ? cursor + count : null;
      const complete = nextCursor === null && manifest.fieldsComplete;
      const header = `model_schema|render_complete=${complete}|schema_complete=${manifest.fieldsComplete}|cursor=${cursor}|included_fields=${count}/${totalFields}|omitted_rendered_fields=${Math.max(
        0,
        totalFields - cursor - count,
      )}|next_cursor=${nextCursor ?? 'null'}`;
      const candidate = [
        header,
        ...requiredLines,
        ...fieldLines.slice(cursor, cursor + count),
      ].join('\n');

      if (candidate.length > maxCharacters) {
        break;
      }

      best = candidate;
    }

    return best;
  };

  const detailed = renderPage(detailedRequiredLines, detailedFieldLines);
  if (detailed) {
    const included = Number(
      detailed.match(/\|included_fields=(\d+)\//)?.[1] ?? 0,
    );
    if (included > 0 || cursor === totalFields) {
      return detailed;
    }
  }

  const compact = renderPage(compactRequiredLines, compactFieldLines);
  if (compact) {
    const included = Number(
      compact.match(/\|included_fields=(\d+)\//)?.[1] ?? 0,
    );
    if (included > 0 || cursor === totalFields) {
      return compact;
    }
  }

  const remainingFields = Math.max(0, totalFields - cursor);
  const minimal = [
    'model_schema',
    'render_complete=false',
    `schema_complete=${manifest.fieldsComplete}`,
    `cursor=${cursor}`,
    `included_fields=0/${totalFields}`,
    `omitted_rendered_fields=${remainingFields}`,
    'next_cursor=null',
    ...(remainingFields > 0 ? ['pagination_stopped=field_too_large'] : []),
    renderMinimalModelManifest(manifest),
  ].join('\n');

  if (minimal.length <= maxCharacters) {
    return minimal;
  }

  throw new RangeError(
    `Model schema maxCharacters is too small for required metadata for ${manifest.apiKey}.`,
  );
}

function normalizedSchemaCursor(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Model schema cursor must be a non-negative integer.');
  }

  return value;
}

export function createModelSchemaResolver(
  input: CreateModelSchemaResolverInput,
): ModelSchemaResolver {
  const maxCharacters = normalizeIntegerLimit(
    input.maxCharacters,
    DEFAULT_MODEL_SCHEMA_CHARACTER_LIMIT,
    MINIMUM_MODEL_SCHEMA_CHARACTER_LIMIT,
    'Model schema maxCharacters',
  );
  const itemTypes = sortedItemTypes(input.itemTypes);
  const manifestByModelId = new Map<string, Promise<ModelContextManifest>>();
  const pageByModelAndCursor = new Map<string, Promise<HostContextSnapshot>>();

  return (rawIdentifier: string, rawCursor?: number) => {
    const identifier = rawIdentifier.trim();

    if (!identifier) {
      return Promise.reject(
        new Error('An exact DatoCMS model ID, API key, or name is required.'),
      );
    }

    const matches = matchingModels(itemTypes, identifier);

    if (matches.length === 0) {
      return Promise.reject(
        new Error(
          `No DatoCMS model exactly matches ${JSON.stringify(identifier)}.`,
        ),
      );
    }

    if (matches.length > 1) {
      const choices = matches
        .map(
          (itemType) =>
            `${itemType.attributes.api_key} (${itemType.id}, ${itemType.attributes.name})`,
        )
        .join('; ');
      return Promise.reject(
        new Error(
          `DatoCMS model identifier ${JSON.stringify(
            identifier,
          )} is ambiguous: ${capText(choices, 800).text}. Use the exact model ID.`,
        ),
      );
    }

    const itemType = matches[0];
    if (!itemType) {
      return Promise.reject(
        new Error('The DatoCMS model could not be resolved.'),
      );
    }

    let cursor: number;
    try {
      cursor = normalizedSchemaCursor(rawCursor);
    } catch (error) {
      return Promise.reject(error);
    }

    const pageKey = `${itemType.id}:${cursor}`;
    const existingPage = pageByModelAndCursor.get(pageKey);
    if (existingPage) {
      return existingPage;
    }

    let manifestPromise = manifestByModelId.get(itemType.id);
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const initialFields = fieldsForModel(itemType, input.loadedFields);
        const fields = hasCompleteFields(itemType, initialFields)
          ? initialFields
          : [...(await input.loadItemTypeFields(itemType.id))];
        return buildModelContextManifest({
          itemType,
          itemTypes,
          fields,
          maxHintCharacters: input.maxHintCharacters,
          maxOptionValues: input.maxOptionValues,
        });
      })();
      manifestByModelId.set(itemType.id, manifestPromise);
      void manifestPromise.catch(() => {
        if (manifestByModelId.get(itemType.id) === manifestPromise) {
          manifestByModelId.delete(itemType.id);
        }
      });
    }

    const resolvePage = manifestPromise.then((manifest) => {
      const requestLine = `model_schema_context|requested=${JSON.stringify(
        boundedIdentity(identifier),
      )}|cursor=${cursor}`;
      const remaining = maxCharacters - requestLine.length - 1;
      const rendered = renderBoundedModelSchema(manifest, remaining, cursor);
      return snapshot(`${requestLine}\n${rendered}`);
    });

    pageByModelAndCursor.set(pageKey, resolvePage);
    void resolvePage.catch(() => {
      if (pageByModelAndCursor.get(pageKey) === resolvePage) {
        pageByModelAndCursor.delete(pageKey);
      }
    });

    return resolvePage;
  };
}

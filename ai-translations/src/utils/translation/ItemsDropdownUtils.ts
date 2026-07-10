/**
 * Utilities for handling DatoCMS record translations via dropdown actions
 */
import type { buildClient } from '@datocms/cma-client-browser';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import {
  buildFieldTypeDictionaryFromRepo,
  type SchemaRepository,
} from '../schemaRepository';
import { formatLocaleWithCode } from '../localeUtils';
import { isFieldIncludedInSelection } from './BulkTranslationHelpers';
import {
  formatErrorForUser,
  type NormalizedProviderError,
  normalizeProviderError,
} from './ProviderErrors';
import { checkFieldLength } from './qc/validatorChecks';
import type { QcFlag } from './qc/types';
import {
  type FieldTypeDictionary,
  type FieldValidators,
  findExactLocaleKey,
  getExactSourceValue,
  hasMinItemsValidator,
  isFieldRequired,
  isReferenceField,
  prepareFieldTypePrompt,
} from './SharedFieldUtils';
// no specific ctx type required here; we accept a minimal ctx shape
import { generateRecordContext, translateFieldValue } from './TranslateField';
import {
  hasTranslatableSourceValue,
  shouldProcessField,
} from './TranslationCore';
import type { FieldOutcome, TranslationProvider } from './types';
import { type WriteClaim, verifyPersistedWrite } from './verifyPersistedWrite';

/**
 * Optional per-model allowlist of field api_keys that the user explicitly
 * selected for translation. When provided, only listed fields are translated;
 * when `undefined`, every translatable field is processed (legacy behaviour).
 */
export type SelectedFieldsByModel = Record<string, string[]>;

/**
 * Defines a DatoCMS record structure with common fields
 */
export type DatoCMSRecordFromAPI = {
  id: string;
  item_type: { id: string };
  [key: string]: unknown;
};

/** Candidate field names used to derive a human-readable record label. */
const RECORD_LABEL_CANDIDATES = [
  'title',
  'name',
  'headline',
  'heading',
  'label',
  'internal_name',
  'internalName',
  'slug',
] as const;

/**
 * Extracts a string from a localized value map by first trying the preferred locale,
 * then falling back to any non-empty string value in the map.
 *
 * @param localized - An object keyed by locale codes.
 * @param preferredLocale - The locale to try first.
 * @returns The first usable string, or null if none found.
 */
function extractStringFromLocalizedMap(
  localized: Record<string, unknown>,
  preferredLocale: string,
): string | null {
  const exact = getExactSourceValue(localized, preferredLocale);
  if (typeof exact === 'string' && exact.trim()) return exact;
  for (const v of Object.values(localized)) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * Converts an arbitrary field value to a string for use in a record label.
 * Handles strings, numbers, arrays, and localized maps.
 *
 * @param val - The raw field value.
 * @param preferredLocale - Locale code to prefer for localized values.
 * @returns A string representation, or null if no usable value is found.
 */
function coerceFieldValueToString(
  val: unknown,
  preferredLocale: string,
): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    return val.filter((x) => typeof x === 'string')[0] ?? null;
  }
  if (typeof val === 'object') {
    return extractStringFromLocalizedMap(
      val as Record<string, unknown>,
      preferredLocale,
    );
  }
  return null;
}

/**
 * Derives a short human-friendly label for a record using common title-like
 * fields (e.g., `title`, `name`, `headline`). It attempts localized values
 * first using the provided `preferredLocale`, then falls back to any string
 * value present, and finally to the record id.
 *
 * @param record - DatoCMS record object retrieved from the CMA.
 * @param preferredLocale - Locale code to prefer when selecting a localized value.
 * @returns A concise label usable in progress messages and alerts.
 */
function deriveRecordLabel(
  record: DatoCMSRecordFromAPI,
  preferredLocale: string,
): string {
  for (const key of RECORD_LABEL_CANDIDATES) {
    if (record[key] !== undefined) {
      const s = coerceFieldValueToString(record[key], preferredLocale);
      if (s?.trim()) {
        const trimmed = s.trim();
        return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
      }
    }
  }
  return `Record ${record.id}`;
}

/**
 * Parses an items action ID into its source/target locales.
 * Properly handles hyphenated locales like "pt-BR".
 *
 * @param actionId - The action identifier (e.g. `translateRecord-en-pt-BR`).
 * @returns Object with fromLocale and toLocale.
 */
export function parseActionId(actionId: string): {
  fromLocale: string;
  toLocale: string;
} {
  // Action ID format is: "translateRecord-${fromLocale}-${toLocale}"
  const prefix = 'translateRecord-';
  const localesString = actionId.startsWith(prefix)
    ? actionId.substring(prefix.length)
    : actionId;

  // Split into components and attempt to rebuild both locale segments.
  const parts = localesString.split('-');
  if (parts.length < 2) {
    console.error(`Invalid action ID format: ${actionId}`);
    return { fromLocale: 'en', toLocale: 'en' };
  }

  const isLikelyLocale = (candidate: string) => {
    const [language, ...rest] = candidate.split('-');
    if (!language || !/^[a-z]{2,3}$/.test(language)) {
      return false;
    }
    return rest.every((segment) => /^[A-Za-z0-9]{2,8}$/.test(segment));
  };

  for (let splitIndex = 1; splitIndex < parts.length; splitIndex++) {
    const fromCandidate = parts.slice(0, splitIndex).join('-');
    const toCandidate = parts.slice(splitIndex).join('-');

    if (isLikelyLocale(fromCandidate) && isLikelyLocale(toCandidate)) {
      return { fromLocale: fromCandidate, toLocale: toCandidate };
    }
  }

  // Fallback: assume the first segment is the source; rest is the target.
  const fallbackFrom = parts[0];
  const fallbackTo = parts.slice(1).join('-') || fallbackFrom;
  return { fromLocale: fallbackFrom, toLocale: fallbackTo };
}

/**
 * Fetches records with pagination based on item IDs.
 * Always retrieves the most recent draft state.
 *
 * @param client - CMA client instance.
 * @param itemIds - Array of record IDs to fetch.
 * @returns An array of CMA records.
 */
export async function fetchRecordsWithPagination(
  client: ReturnType<typeof buildClient>,
  itemIds: string[],
): Promise<DatoCMSRecordFromAPI[]> {
  const allRecords: DatoCMSRecordFromAPI[] = [];
  const pageSize = 30;
  const idsParam = itemIds.join(',');

  /**
   * Recursively fetches pages of records and appends them to allRecords.
   * Recursive approach avoids await-in-loop lint errors while preserving
   * sequential pagination behaviour.
   */
  async function fetchPage(page: number): Promise<void> {
    const response: DatoCMSRecordFromAPI[] = await client.items.list({
      filter: { ids: idsParam },
      nested: true,
      version: 'current',
      page: {
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
    });

    allRecords.push(...response);

    if (response.length === pageSize) {
      await fetchPage(page + 1);
    }
  }

  await fetchPage(1);
  return allRecords;
}

/*
 * Checks if an object has a specific key (including in nested objects).
 * Supports both regular locale codes and hyphenated locales (e.g., "pt-br").
 */
function hasKeyDeep(obj: Record<string, unknown>, targetKey: string): boolean {
  if (!obj || typeof obj !== 'object') return false;

  // Normalize targetKey to handle hyphenated locales like "pt-br"
  const normalizedTargetKey = targetKey.toLowerCase();

  // Direct match check (case-insensitive to handle inconsistencies)
  for (const key in obj) {
    if (key.toLowerCase() === normalizedTargetKey) {
      return true;
    }
  }

  // Recursive check in nested objects
  return Object.values(obj).some((value) => {
    if (typeof value === 'object' && value !== null) {
      return hasKeyDeep(value as Record<string, unknown>, targetKey);
    }
    return false;
  });
}

/**
 * Status flags for batch translation steps.
 */
export type ProgressStatus =
  | 'processing'
  | 'completed'
  | 'completed-with-warnings'
  | 'error';

/**
 * Progress event payload describing the per-record state.
 */
export type ProgressUpdate = {
  recordIndex: number;
  recordId: string;
  status: ProgressStatus;
  message?: string;
  /**
   * Label-free status phrase for the row (e.g. "Translated", "Saving…"), so the
   * UI can render the record label as a separate link without parsing `message`.
   */
  statusText?: string;
  /** Human-readable record label, so the UI can render rows/links without parsing `message`. */
  recordLabel?: string;
  /** Item type id of the record, used to build a link to its editor. */
  itemTypeId?: string;
  /** CMA `updated_at` of the record after the write (for the CSV report). */
  updatedAt?: string;
  /** API keys of fields that were AI-translated on this record. */
  translatedFieldApiKeys?: string[];
  /** Field ids (UUIDs) of fields that were AI-translated on this record. */
  translatedFieldIds?: string[];
  /** API keys of link/links fields whose references were copied without translation. */
  copiedLinkFieldApiKeys?: string[];
  /** Field ids (UUIDs) of link/links fields whose references were copied without translation. */
  copiedLinkFieldIds?: string[];
  /**
   * Structured per-record warnings, one consolidated line per concern. Surfaced
   * separately from `message` so the UI can flag the record (icon + tooltip)
   * instead of concatenating everything into the status line.
   */
  warnings?: string[];
  /**
   * Structured QC flags raised while translating this record, retained
   * alongside the human `message`/`warnings` so the bulk report can group by
   * field/locale/check and export machine-readable rows (not just a flattened
   * string).
   */
  qcFlags?: QcFlag[];
};

/**
 * A single record-reference copy event: a link/links field whose source
 * references were carried into `toLocale` by the locale-sync fallback.
 */
export type ReferenceCopy = { field: string; toLocale: string };

/**
 * Consolidates reference-copy events into a single human-readable warning line
 * per record, deduplicating fields and locales. Returns null when empty.
 *
 * @param copies - The reference-copy events for one record.
 * @returns A one-line summary, or null when there is nothing to report.
 */
export function summarizeReferenceCopies(
  copies: ReferenceCopy[],
): string | null {
  if (copies.length === 0) return null;
  const fields: string[] = [];
  const locales: string[] = [];
  for (const { field, toLocale } of copies) {
    if (!fields.includes(field)) fields.push(field);
    if (!locales.includes(toLocale)) locales.push(toLocale);
  }
  const fieldList = fields.map((f) => `"${f}"`).join(', ');
  const localeList = locales.map((l) => formatLocaleWithCode(l)).join(', ');
  return `Copied linked records in ${fieldList} into ${localeList} — these are shared references and weren't translated; review whether they should differ per locale.`;
}

/**
 * Options for batch translation flow, including progress and cancellation.
 * Uses CancellationOptions naming convention for consistency across the codebase.
 */
export type TranslateBatchOptions = {
  onProgress?: (update: ProgressUpdate) => void;
  /** Returns true if user has requested cancellation. Matches CancellationOptions convention. */
  checkCancellation?: () => boolean;
  abortSignal?: AbortSignal;
  /**
   * Optional per-model allowlist of field api_keys. When set, fields whose
   * api_key is not listed for the record's model are skipped (their target
   * locale falls back to the standard locale-sync rules below). When omitted,
   * every translatable field on each record is processed.
   */
  selectedFieldsByModel?: SelectedFieldsByModel;
};

/**
 * Result of building a translated update payload for a record. Each top-level
 * key is a field's `api_key`; each value is the field's locale-keyed value map
 * (e.g. `{ en: 'Hello', fr: 'Bonjour' }`).
 */
export interface BuildTranslatedUpdatePayloadResult {
  payload: Record<string, Record<string, unknown>>;
  translatedFieldCount: number;
  /**
   * Count of localized reference (link/links) fields whose source references
   * were carried into the target locale by the locale-sync fallback. Used so a
   * record that only had references copied is not misreported as "no fields
   * updated".
   */
  referenceFieldsCopied: number;
  /** API keys of the fields that were AI-translated (for the CSV report). */
  translatedFields: string[];
  /**
   * Structured record-reference copy events. Consolidated into one per-record
   * warning line by `summarizeReferenceCopies` rather than emitted as one
   * sentence per field/locale.
   */
  referenceCopies: ReferenceCopy[];
  /**
   * Human-readable per-field notices: genuine translation failures plus QC flag
   * lines (truncation, placeholder loss, length/structure mismatch). Not
   * reference-copy notices — those live in `referenceCopies`.
   */
  warnings: string[];
  /**
   * Count of `error`-severity QC flags raised while translating this record's
   * fields (truncation, placeholder loss, length/structure mismatch). A record
   * with `errorCount > 0` is NOT a clean success even when fields were written —
   * `reportTranslationResult` escalates it to `status: 'error'` so degraded
   * content is surfaced for manual vetting (design §6b), never silently counted
   * as done.
   */
  errorCount: number;
  /**
   * Raw QC flags raised for this record's fields, retained (in addition to the
   * flattened `warnings` strings) so the end-of-run report can group by
   * field/locale/check and export structured rows.
   */
  qcFlags: QcFlag[];
  /**
   * Fields whose provider call FAILED (as opposed to being untranslatable).
   * A failed field is deliberately left out of `payload` so the target locale
   * is never overwritten with `null`; per-locale accounting uses this to fail
   * the record instead of masking the loss behind a healthy sibling locale.
   */
  failedFields: { field: string; error: NormalizedProviderError }[];
}

/** Per-locale roll-up of what a record's translation actually achieved. */
export type LocaleOutcome = {
  locale: string;
  translated: string[];
  failed: { field: string; error: NormalizedProviderError }[];
};

/**
 * Rolls per-locale outcomes into a record-level verdict.
 *
 * Any locale with a failure marks the record as failed. Summing translated
 * counts across locales — as the old per-record accounting did — lets a healthy
 * locale mask a wholly-dead sibling.
 *
 * @param outcomes - One entry per target locale.
 * @returns Whether to fail the record, and a status line naming the locales.
 */
export const summarizeLocaleOutcomes = (
  outcomes: LocaleOutcome[],
): { hasDeadLocale: boolean; statusText: string | undefined } => {
  const damaged = outcomes.filter((o) => o.failed.length > 0);
  if (damaged.length === 0) {
    return { hasDeadLocale: false, statusText: undefined };
  }

  const statusText = damaged
    .map((o) => {
      const total = o.translated.length + o.failed.length;
      return `${formatLocaleWithCode(o.locale)}: ${o.translated.length}/${total} fields translated`;
    })
    .join('; ');

  return { hasDeadLocale: true, statusText };
};

/**
 * Per-record outcome aggregated across all target locales, with field lists
 * resolved to both api_keys and ids and the CMA write timestamp captured.
 */
export interface RecordTranslationOutcome
  extends BuildTranslatedUpdatePayloadResult {
  translatedFieldApiKeys: string[];
  translatedFieldIds: string[];
  copiedLinkFieldApiKeys: string[];
  copiedLinkFieldIds: string[];
  updatedAt?: string;
  /**
   * Per-locale roll-up of what actually translated versus failed. Consumed by
   * `summarizeLocaleOutcomes` so one dead locale fails the record instead of
   * being masked by a healthy sibling's field count.
   */
  localeOutcomes: LocaleOutcome[];
}

/**
 * Picks the completion message and status label for a record that finished
 * without failures: AI-translated fields, only copied references, or nothing
 * eligible to translate at all.
 *
 * @param outcome - The record's aggregated outcome.
 * @param recordLabel - Human-readable record label.
 * @param recordId - Record identifier.
 * @returns The completion `message` and `statusText` copy.
 */
const resolveCompletionCopy = (
  outcome: RecordTranslationOutcome,
  recordLabel: string,
  recordId: string,
): { completionMessage: string; statusText: string } => {
  if (outcome.translatedFieldCount > 0) {
    return {
      completionMessage: `Translated "${recordLabel}" (#${recordId}).`,
      statusText: 'Translated',
    };
  }
  if (outcome.referenceFieldsCopied > 0) {
    return {
      completionMessage: `Copied linked records into new locales for "${recordLabel}" (#${recordId}).`,
      statusText: 'Copied linked records into new locales',
    };
  }
  return {
    completionMessage: `No eligible fields to translate for "${recordLabel}" (#${recordId}).`,
    statusText: 'No eligible fields to translate',
  };
};

/**
 * Safely extracts error candidates from various error object shapes.
 *
 * @param error - The error object to extract from.
 * @returns An array of error objects if found, otherwise undefined.
 */
function extractErrorCandidates(error: unknown): unknown[] | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const obj = error as Record<string, unknown>;

  // Check various nested locations where errors might be stored
  const candidates =
    getNestedArray(obj, ['response', 'data', 'errors']) ||
    getNestedArray(obj, ['response', 'errors']) ||
    getNestedArray(obj, ['data', 'errors']) ||
    (Array.isArray(obj.errors) ? obj.errors : undefined);

  return candidates;
}

/**
 * Helper to safely navigate nested properties and return an array.
 *
 * @param obj - The object to navigate.
 * @param path - Array of property keys to follow.
 * @returns The array at the path, or undefined if not found or not an array.
 */
function getNestedArray(
  obj: Record<string, unknown>,
  path: string[],
): unknown[] | undefined {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : undefined;
}

/**
 * Safely extracts error code from an error entry.
 *
 * @param e - An error entry object.
 * @returns The error code if present, otherwise null.
 */
function extractErrorCode(e: unknown): string | null {
  if (e === null || typeof e !== 'object') return null;
  const obj = e as Record<string, unknown>;
  // Check attributes.code first, then code directly
  if (obj.attributes && typeof obj.attributes === 'object') {
    const attrs = obj.attributes as Record<string, unknown>;
    if (typeof attrs.code === 'string') return attrs.code;
  }
  if (typeof obj.code === 'string') return obj.code;
  return null;
}

/**
 * Safely extracts error message from an error object.
 *
 * @param error - The error object.
 * @returns The message if present and is a string, otherwise undefined.
 */
function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
  }
  return undefined;
}

/**
 * Returns a user-friendly message for known DatoCMS API errors.
 * Specifically maps ITEM_LOCKED (422) to clear guidance that no one can be
 * editing the record to apply the translation.
 *
 * @param error - The error thrown during the CMA request.
 * @param recordId - Identifier of the record that failed to update.
 * @returns A user-friendly message or null when no mapping matches.
 */
function getFriendlyDatoErrorMessage(
  error: unknown,
  recordId: string,
): string | null {
  try {
    const candidates = extractErrorCandidates(error);
    if (Array.isArray(candidates)) {
      const codes = candidates.map(extractErrorCode);
      if (codes.includes('ITEM_LOCKED')) {
        return `DatoCMS error: Cannot save translations for record ${recordId}: the record is locked because it is being edited. Please ensure no one (including you in another tab) is editing the record in DatoCMS, then try again.`;
      }
    }

    const msg = extractErrorMessage(error);
    if (msg?.includes('ITEM_LOCKED')) {
      return `DatoCMS error: Cannot save translations for record ${recordId}: the record is locked because it is being edited. Please ensure no one is editing the record, then try again.`;
    }
  } catch {
    // Ignore parsing errors; fall through to null
  }

  return null;
}

/**
 * Translates and updates a list of records using CMA, reporting progress
 * via callbacks and supporting cancellation.
 *
 * Each record is processed atomically: every target locale is translated
 * first, then a single `client.items.update` call writes them all at once.
 * This minimises CMA round-trips and avoids partial writes mid-record.
 *
 * @param records - Records to translate.
 * @param client - CMA client.
 * @param provider - TranslationProvider for field translation.
 * @param fromLocale - Source locale key.
 * @param toLocales - Target locale keys (one or more).
 * @param getFieldTypeDictionary - Async getter that returns a FieldTypeDictionary per item type.
 * @param pluginParams - Plugin configuration parameters.
 * @param ctx - Minimal context for alerts and environment.
 * @param accessToken - Current user API token for DatoCMS.
 * @param options - Optional callbacks and AbortSignal for cancellation.
 * @param schemaRepository - Optional SchemaRepository for cached schema lookups.
 */
export async function translateAndUpdateRecords(
  records: DatoCMSRecordFromAPI[],
  client: ReturnType<typeof buildClient>,
  provider: TranslationProvider,
  fromLocale: string,
  toLocales: string[],
  getFieldTypeDictionary: (itemTypeId: string) => Promise<FieldTypeDictionary>,
  pluginParams: ctxParamsType,
  ctx: {
    alert: (msg: string) => void;
    environment: string;
    cmaBaseUrl?: string;
  },
  accessToken: string,
  options: TranslateBatchOptions = {},
  schemaRepository?: SchemaRepository,
): Promise<void> {
  const updateProgress = (u: ProgressUpdate) => {
    // Normalize legacy in-progress message that included the word "fields"
    if (u.status === 'processing' && typeof u.message === 'string') {
      u = { ...u, message: u.message.replace(/\s*fields…$/, '…') };
    }
    options.onProgress?.(u);
  };

  /**
   * Merges a per-locale field payload into the running accumulator. Each
   * locale's payload only writes its own locale key, so the merge is a
   * shallow object spread per field — no cross-locale conflicts.
   */
  function mergeLocalePayloadInto(
    target: Record<string, Record<string, unknown>>,
    source: Record<string, Record<string, unknown>>,
  ): void {
    for (const [field, fieldValue] of Object.entries(source)) {
      target[field] = { ...(target[field] ?? {}), ...fieldValue };
    }
  }

  /**
   * Translates all fields of a record into every target locale, emitting a
   * progress update for each locale ("Translating X to en…", "Translating X
   * to es…"). Once every locale has been processed it writes the merged
   * payload back with a single CMA update so each record is touched at
   * most once.
   */
  async function translateAndSaveRecord(
    record: DatoCMSRecordFromAPI,
    recordIndex: number,
    recordLabel: string,
  ): Promise<RecordTranslationOutcome> {
    const fieldTypeDictionary = await getFieldTypeDictionary(
      record.item_type.id,
    );
    const itemTypeId = record.item_type.id;
    const toFieldIds = (apiKeys: string[]): string[] =>
      apiKeys
        .map((key) => fieldTypeDictionary[key]?.id)
        .filter((id): id is string => Boolean(id));

    const mergedPayload: Record<string, Record<string, unknown>> = {};
    const aggregatedWarnings: string[] = [];
    const aggregatedReferenceCopies: ReferenceCopy[] = [];
    const aggregatedTranslatedFields: string[] = [];
    const aggregatedQcFlags: QcFlag[] = [];
    const aggregatedFailedFields: {
      field: string;
      error: NormalizedProviderError;
    }[] = [];
    const localeOutcomes: LocaleOutcome[] = [];
    let totalTranslatedFields = 0;
    let totalReferenceFieldsCopied = 0;
    let totalErrorCount = 0;

    /**
     * Translates the record into one target locale and merges the result.
     * Extracted so the per-locale `.reduce` chain stays lint-clean.
     */
    async function translateForLocale(toLocale: string): Promise<void> {
      updateProgress({
        recordIndex,
        recordId: record.id,
        status: 'processing',
        message: `Translating "${recordLabel}" (#${record.id}) to ${formatLocaleWithCode(toLocale)}…`,
        statusText: `Translating to ${formatLocaleWithCode(toLocale)}…`,
        recordLabel,
        itemTypeId,
      });

      const localeResult = await buildTranslatedUpdatePayload(
        record,
        fromLocale,
        toLocale,
        fieldTypeDictionary,
        provider,
        pluginParams,
        accessToken,
        ctx.environment,
        {
          abortSignal: options.abortSignal,
          checkCancellation: options.checkCancellation,
          selectedFieldsByModel: options.selectedFieldsByModel,
        },
        schemaRepository,
        ctx.cmaBaseUrl,
      );

      mergeLocalePayloadInto(mergedPayload, localeResult.payload);
      aggregatedWarnings.push(...localeResult.warnings);
      aggregatedReferenceCopies.push(...localeResult.referenceCopies);
      aggregatedTranslatedFields.push(...localeResult.translatedFields);
      aggregatedQcFlags.push(...localeResult.qcFlags);
      aggregatedFailedFields.push(...localeResult.failedFields);
      localeOutcomes.push({
        locale: toLocale,
        translated: localeResult.translatedFields,
        failed: localeResult.failedFields,
      });
      totalTranslatedFields += localeResult.translatedFieldCount;
      totalReferenceFieldsCopied += localeResult.referenceFieldsCopied;
      totalErrorCount += localeResult.errorCount;
    }

    // Sequential per-locale to keep within provider rate-limit budgets and
    // surface progress in the order the user picked.
    await toLocales.reduce(
      (chain, toLocale) => chain.then(() => translateForLocale(toLocale)),
      Promise.resolve(),
    );

    // Timestamp for the CSV report: the write's fresh `updated_at` when we
    // touched the record, otherwise the record's existing timestamp.
    const recordMeta = (record as { meta?: { updated_at?: string } }).meta;
    let updatedAt = recordMeta?.updated_at;
    if (Object.keys(mergedPayload).length > 0) {
      updateProgress({
        recordIndex,
        recordId: record.id,
        status: 'processing',
        message: `Saving "${recordLabel}" (#${record.id})…`,
        statusText: 'Saving…',
        recordLabel,
        itemTypeId,
      });
      const updated = (await client.items.update(
        record.id,
        mergedPayload,
      )) as Record<string, unknown> & { meta?: { updated_at?: string } };
      updatedAt = updated?.meta?.updated_at ?? updatedAt;

      // Structural read-back: every field we marked `translated` must come back
      // present, non-null, and non-empty. A claim the CMA silently dropped is
      // demoted from `translated` to `failed` so the record fails the run.
      const claims: WriteClaim[] = localeOutcomes.flatMap((outcome) =>
        outcome.translated.map((field) => ({ field, locale: outcome.locale })),
      );
      for (const mismatch of verifyPersistedWrite(updated, claims)) {
        const message = `Field "${mismatch.field}" to ${formatLocaleWithCode(
          mismatch.locale,
        )} was reported translated but came back ${mismatch.reason} from the CMA.`;
        aggregatedWarnings.push(message);
        const outcome = localeOutcomes.find((o) => o.locale === mismatch.locale);
        if (!outcome) continue;
        outcome.translated = outcome.translated.filter(
          (field) => field !== mismatch.field,
        );
        outcome.failed.push({
          field: mismatch.field,
          error: { code: 'datocms', source: 'datocms', message },
        });
      }
    }

    const translatedFieldApiKeys = [...new Set(aggregatedTranslatedFields)];
    const copiedLinkFieldApiKeys = [
      ...new Set(aggregatedReferenceCopies.map((copy) => copy.field)),
    ];

    return {
      payload: mergedPayload,
      translatedFieldCount: totalTranslatedFields,
      referenceFieldsCopied: totalReferenceFieldsCopied,
      translatedFields: aggregatedTranslatedFields,
      referenceCopies: aggregatedReferenceCopies,
      warnings: aggregatedWarnings,
      errorCount: totalErrorCount,
      qcFlags: aggregatedQcFlags,
      failedFields: aggregatedFailedFields,
      localeOutcomes,
      translatedFieldApiKeys,
      translatedFieldIds: toFieldIds(translatedFieldApiKeys),
      copiedLinkFieldApiKeys,
      copiedLinkFieldIds: toFieldIds(copiedLinkFieldApiKeys),
      updatedAt,
    };
  }

  /**
   * Reports the completion status of a translation result, returning the appropriate
   * outcome code ('done' or 'continue').
   */
  function reportTranslationResult(
    outcome: RecordTranslationOutcome,
    recordIndex: number,
    recordId: string,
    recordLabel: string,
    itemTypeId: string,
  ): 'continue' | 'done' {
    // Structured, consolidated per-record warnings: a single reference-copy
    // summary line (if any) followed by any genuine per-field failures and QC
    // notes. These ride on the progress update separately from `message`, so the
    // UI can flag the record (icon + tooltip) instead of concatenating a wall of
    // text.
    const referenceSummary = summarizeReferenceCopies(outcome.referenceCopies);
    const recordWarnings = [
      ...(referenceSummary ? [referenceSummary] : []),
      ...outcome.warnings,
    ];
    const warnings = recordWarnings.length > 0 ? recordWarnings : undefined;
    const hasWarnings = recordWarnings.length > 0;
    // `error`-severity QC flags mean a written value is content-corrupting
    // (truncation / placeholder loss / length or structure mismatch).
    const hasErrors = outcome.errorCount > 0;

    // The per-record fields shared by every finished update (drive the row link,
    // the retained QC review list and the CSV report).
    const reportFields = {
      recordLabel,
      itemTypeId,
      updatedAt: outcome.updatedAt,
      translatedFieldApiKeys: outcome.translatedFieldApiKeys,
      translatedFieldIds: outcome.translatedFieldIds,
      copiedLinkFieldApiKeys: outcome.copiedLinkFieldApiKeys,
      copiedLinkFieldIds: outcome.copiedLinkFieldIds,
      warnings,
      qcFlags: outcome.qcFlags,
    };

    // Copied references count as a real update: the record was written even
    // when no field was AI-translated. Only treat it as an error when nothing
    // at all was written yet failures were raised (i.e. every field failed).
    const updatedFieldCount =
      outcome.translatedFieldCount + outcome.referenceFieldsCopied;

    // Per-(record, locale) accounting: a locale with any failed field fails the
    // whole record, so a healthy sibling locale can no longer mask a wholly-dead
    // one behind a summed field count. Content-scoped failures land here too,
    // since every failed field is recorded in some locale's `failed[]`.
    const { hasDeadLocale, statusText: localeStatus } = summarizeLocaleOutcomes(
      outcome.localeOutcomes,
    );
    if (hasDeadLocale) {
      updateProgress({
        recordIndex,
        recordId,
        status: 'error',
        message: `Translated "${recordLabel}" (#${recordId}) with failures — ${localeStatus}.`,
        statusText: localeStatus,
        ...reportFields,
      });
      return 'continue';
    }

    if (updatedFieldCount === 0 && outcome.warnings.length > 0) {
      updateProgress({
        recordIndex,
        recordId,
        status: 'error',
        message: `No fields were updated for "${recordLabel}" (#${recordId}).`,
        statusText: 'No fields were updated',
        ...reportFields,
      });
      return 'continue';
    }

    // Fields were written but at least one carries a content-corrupting QC error.
    // The CMA write already happened, but this is NOT a clean success — surface
    // it as a real failure so the counters and the retained review list treat it
    // as one (design §6b), never silently counting degraded content as done.
    if (hasErrors) {
      updateProgress({
        recordIndex,
        recordId,
        status: 'error',
        message: `Translated "${recordLabel}" (#${recordId}) but ${outcome.errorCount} field/locale value(s) may be incomplete.`,
        statusText: 'Translated with issues',
        ...reportFields,
      });
      return 'continue';
    }

    const { completionMessage, statusText } = resolveCompletionCopy(
      outcome,
      recordLabel,
      recordId,
    );
    updateProgress({
      recordIndex,
      recordId,
      // A written record that raised warning-severity flags (or copied linked
      // references) is a success worth flagging — distinct from both a clean
      // success and a failure (design §6b).
      status: hasWarnings ? 'completed-with-warnings' : 'completed',
      message: completionMessage,
      statusText,
      ...reportFields,
    });
    return 'done';
  }

  /**
   * Translates and saves a single record.
   * Returns `'cancelled'` when cancellation was detected, `'continue'` to skip
   * to the next record, or `'done'` on success.
   * Extracted to avoid await-in-loop lint errors.
   */
  async function processRecord(
    record: DatoCMSRecordFromAPI,
    recordIndex: number,
  ): Promise<'cancelled' | 'continue' | 'done'> {
    const recordLabel = deriveRecordLabel(record, fromLocale);

    const itemTypeId = record.item_type.id;
    const recordUpdatedAt = (record as { meta?: { updated_at?: string } }).meta
      ?.updated_at;

    if (options.checkCancellation?.()) {
      updateProgress({
        recordIndex,
        recordId: record.id,
        status: 'error',
        message: `Translation cancelled for "${recordLabel}" (#${record.id}).`,
        statusText: 'Cancelled',
        recordLabel,
        itemTypeId,
      });
      return 'cancelled';
    }

    updateProgress({
      recordIndex,
      recordId: record.id,
      status: 'processing',
      message: `Translating "${recordLabel}" (#${record.id})…`,
      statusText: 'Translating…',
      recordLabel,
      itemTypeId,
    });

    try {
      if (!hasKeyDeep(record as Record<string, unknown>, fromLocale)) {
        const errorMsg = `Record "${recordLabel}" (#${record.id}) does not have the source locale ${formatLocaleWithCode(fromLocale)}`;
        console.error(`Record ${record.id} ${errorMsg}`);
        ctx.alert(`Error: Record ID ${record.id} ${errorMsg}`);
        updateProgress({
          recordIndex,
          recordId: record.id,
          status: 'error',
          message: errorMsg,
          statusText: 'Missing source locale',
          recordLabel,
          itemTypeId,
          updatedAt: recordUpdatedAt,
          warnings: [errorMsg],
        });
        return 'continue';
      }

      const outcome = await translateAndSaveRecord(
        record,
        recordIndex,
        recordLabel,
      );

      return reportTranslationResult(
        outcome,
        recordIndex,
        record.id,
        recordLabel,
        itemTypeId,
      );
    } catch (error) {
      const friendlyMessage = getFriendlyDatoErrorMessage(error, record.id);
      const norm = normalizeProviderError(error, provider.vendor);
      const formattedMessage = formatErrorForUser(norm);
      const rawMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error translating record ${record.id}:`, rawMessage);
      updateProgress({
        recordIndex,
        recordId: record.id,
        status: 'error',
        message:
          friendlyMessage ??
          `Failed "${recordLabel}" (#${record.id}): ${formattedMessage}`,
        statusText: 'Failed',
        recordLabel,
        itemTypeId,
        updatedAt: recordUpdatedAt,
        warnings: [friendlyMessage ?? formattedMessage],
      });
      return 'continue';
    }
  }

  // Process records sequentially using reduce to avoid await-in-loop
  await records.reduce(async (previousRecord, record, i) => {
    const previousOutcome = await previousRecord;
    if (previousOutcome === 'cancelled') return 'cancelled';
    return processRecord(record, i);
  }, Promise.resolve<'cancelled' | 'continue' | 'done'>('done'));
}

/**
 * Recursively strips `id` from DatoCMS block objects so the value can be
 * copied to a new locale without creating duplicate-ID references.
 *
 * A DatoCMS block in nested response format looks like:
 *   { type: "item", id: "abc123", attributes: { ... }, relationships: { ... } }
 *
 * Stripping the `id` tells the CMA to create a fresh block instance.
 * Non-block values (strings, numbers, file references, etc.) pass through
 * unchanged. Arrays and nested objects are recursed into so that deeply
 * nested blocks (e.g., modular content inside a block) are also handled.
 */
export function stripBlockIds(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(stripBlockIds);
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Detect a DatoCMS block: { type: "item", id: "..." }
    const isBlock = obj.type === 'item' && typeof obj.id === 'string';

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (isBlock && key === 'id') continue;
      result[key] = stripBlockIds(val);
    }
    return result;
  }

  return value;
}

/**
 * Editor types whose values contain DatoCMS blocks. When copying source-locale
 * blocks into a new locale as a locale-sync fallback we strip block ids so the
 * CMA creates fresh block instances per locale.
 */
const BLOCK_EDITOR_TYPES = new Set([
  'rich_text',
  'structured_text',
  'framed_single_block',
  'frameless_single_block',
]);

/**
 * Counts how many record references a locale-sync value holds: array length for
 * multiple-links fields, 1 for a populated single link, 0 when empty.
 */
function countReferences(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value != null ? 1 : 0;
}

/**
 * Resolves the locale-sync fallback for a single untranslated localized field.
 *
 * Every localized field must carry a value for the new locale or the CMA
 * rejects the update. For fields the plugin cannot translate we copy the source
 * value when the field mandates one — a `required` constraint, a min-count
 * `size` validator (links/gallery have no `required`), or a record reference
 * (shared across locales) — otherwise we leave the locale empty so
 * untranslatable content is not duplicated. Required block fields get their
 * source blocks with ids stripped so the CMA creates fresh instances.
 *
 * @param meta - Field metadata (editor + validators) from the dictionary.
 * @param sourceValue - The source-locale value for the field.
 * @returns The value to write into the target locale and whether it carried
 *   record references over (used to warn the editor and count updates).
 */
/**
 * Decides whether a field may receive a locale-sync fallback value.
 *
 * A field whose provider call FAILED must be left out of the payload entirely,
 * so the target locale keeps whatever it had. Only fields we genuinely cannot
 * translate (or never attempted) get filled.
 *
 * @param outcome - The field's outcome, or `undefined` if it was never attempted.
 * @returns True when the fallback may write a value.
 */
export const shouldApplyLocaleSyncFallback = (
  outcome: FieldOutcome | undefined,
): boolean => outcome === undefined || outcome.status === 'untranslatable';

function resolveLocaleSyncFallback(
  meta: FieldTypeDictionary[string],
  sourceValue: unknown,
): { value: unknown; referenceCopied: boolean } {
  const isReference = isReferenceField(meta.validators);
  const shouldCopySource =
    sourceValue != null &&
    (isFieldRequired(meta.validators) ||
      hasMinItemsValidator(meta.validators) ||
      isReference);

  if (!shouldCopySource) {
    return { value: null, referenceCopied: false };
  }

  const value = BLOCK_EDITOR_TYPES.has(meta.editor)
    ? stripBlockIds(sourceValue)
    : sourceValue;

  return { value, referenceCopied: isReference && countReferences(value) > 0 };
}

/**
 * Builds an update payload that translates a record from `fromLocale` into a
 * single `toLocale`. Caller-side orchestration is responsible for looping
 * across multiple target locales and merging the per-locale payloads so a
 * single `client.items.update(recordId, mergedPayload)` runs per record.
 *
 * After translation, every localized field that lacks the target locale gets
 * a locale-sync fallback (null for optional, source value for required,
 * source blocks with stripped ids for required block fields) so the CMA
 * accepts the update.
 *
 * Context: table/bulk actions using CMA records (client.items.*).
 *
 * See also: `translateRecordFields` in `src/utils/translateRecordFields.ts`,
 * which runs in the item form context and writes via `ctx.setFieldValue(...)`.
 *
 * @param record - CMA record to read source values from.
 * @param fromLocale - Source locale key.
 * @param toLocale - Target locale key.
 * @param fieldTypeDictionary - Map of field API keys to editor type/IDs/localized flags.
 * @param provider - TranslationProvider instance.
 * @param pluginParams - Plugin configuration parameters.
 * @param accessToken - Current user API token for DatoCMS.
 * @param environment - Dato environment slug.
 * @param opts - Optional AbortSignal, cancellation, field allowlist.
 * @param schemaRepository - Optional SchemaRepository for cached schema lookups.
 * @returns Partial payload for client.items.update.
 */
export async function buildTranslatedUpdatePayload(
  record: DatoCMSRecordFromAPI,
  fromLocale: string,
  toLocale: string,
  fieldTypeDictionary: FieldTypeDictionary,
  provider: TranslationProvider,
  pluginParams: ctxParamsType,
  accessToken: string,
  environment: string,
  opts: {
    abortSignal?: AbortSignal;
    checkCancellation?: () => boolean;
    selectedFieldsByModel?: SelectedFieldsByModel;
  } = {},
  schemaRepository?: SchemaRepository,
  cmaBaseUrl?: string,
): Promise<BuildTranslatedUpdatePayloadResult> {
  const updatePayload: Record<string, Record<string, unknown>> = {};
  const warnings: string[] = [];
  const referenceCopies: ReferenceCopy[] = [];
  const translatedFields: string[] = [];
  const qcFlags: QcFlag[] = [];
  let translatedFieldCount = 0;
  let referenceFieldsCopied = 0;
  let errorCount = 0;

  const recordContext = generateRecordContext(record, fromLocale);

  /**
   * Routes a QC flag into the per-record accumulators: error-severity flags
   * bump `errorCount` (which escalates the record to a failure in the report),
   * every flag is retained (with field/locale stamped) for the structured
   * report, and a human-readable line is pushed into `warnings` for the live
   * progress message.
   */
  function recordQcFlag(flag: QcFlag, field: string): void {
    if (flag.severity === 'error') errorCount += 1;
    qcFlags.push({
      ...flag,
      fieldPath: flag.fieldPath ?? field,
      locale: flag.locale ?? toLocale,
    });
    warnings.push(
      `${flag.severity === 'error' ? 'Translation issue' : 'Note'} — "${flag.fieldPath ?? field}" → ${formatLocaleWithCode(
        flag.locale ?? toLocale,
      )}: ${flag.message}`,
    );
  }

  // Collect the fields that need translation before the async loop
  const translatableFields = Object.keys(record).filter((field) => {
    const fieldMeta = fieldTypeDictionary[field];
    return (
      fieldMeta?.isLocalized &&
      shouldTranslateField(
        field,
        record,
        fromLocale,
        fieldTypeDictionary,
        pluginParams,
        opts.selectedFieldsByModel,
      )
    );
  });

  /**
   * Translates one field and reports its {@link FieldOutcome}. It deliberately
   * does NOT mutate the payload: a `failed` field must stay out of the payload
   * so its target locale is never overwritten with `null`, and only the caller
   * can tell `failed` from `untranslatable`. Length QC still runs on success.
   */
  async function translateField(field: string): Promise<FieldOutcome> {
    const sourceValue = getExactSourceValue(
      record[field] as Record<string, unknown>,
      fromLocale,
    );

    const fieldType = fieldTypeDictionary[field].editor;
    const fieldTypePrompt = prepareFieldTypePrompt(fieldType);

    if (!hasTranslatableSourceValue(fieldType, sourceValue)) {
      return { status: 'untranslatable' };
    }

    try {
      const translatedValue = await translateFieldValue(
        sourceValue,
        pluginParams,
        toLocale,
        fromLocale,
        fieldType,
        provider,
        fieldTypePrompt,
        accessToken,
        fieldTypeDictionary[field].id,
        environment,
        {
          abortSignal: opts.abortSignal,
          checkCancellation: opts.checkCancellation,
        },
        recordContext,
        schemaRepository,
        {
          fieldApiKey: field,
          ...(cmaBaseUrl ? { cmaBaseUrl } : {}),
          onQcFlag: (flag) => recordQcFlag(flag, field),
        },
      );

      // Schema-aware guard: a value over the field's length validator WILL be
      // rejected by the CMA. Flag it (error-tier) so the record surfaces as a
      // failure naming the field, instead of the save 422-ing opaquely.
      const lengthFlag = checkFieldLength({
        value: translatedValue,
        validators: fieldTypeDictionary[field].validators,
        fieldPath: field,
        locale: toLocale,
      });
      if (lengthFlag) recordQcFlag(lengthFlag, field);

      return { status: 'translated', value: translatedValue };
    } catch (error) {
      const norm = normalizeProviderError(error, provider.vendor);
      console.error(
        `Error translating field ${field} → ${toLocale} for record ${record.id}: ${formatErrorForUser(norm)}`,
      );
      return { status: 'failed', error: norm };
    }
  }

  // Process fields sequentially using reduce to avoid await-in-loop. Only a
  // `translated` outcome writes the payload; a `failed` outcome records a
  // warning but leaves the field absent, so the target locale is untouched.
  const outcomes = new Map<string, FieldOutcome>();
  await translatableFields.reduce(
    (chain, field) =>
      chain.then(async () => {
        const outcome = await translateField(field);
        outcomes.set(field, outcome);

        if (outcome.status === 'translated') {
          updatePayload[field] = {
            ...((record[field] as Record<string, unknown>) || {}),
            [toLocale]: outcome.value,
          };
          translatedFieldCount += 1;
          translatedFields.push(field);
          return;
        }

        if (outcome.status === 'failed') {
          const formattedMessage = formatErrorForUser(outcome.error);
          const suffix = formattedMessage.endsWith('.') ? '' : '.';
          warnings.push(
            `Field "${field}" to ${formatLocaleWithCode(toLocale)} was skipped: ${formattedMessage}${suffix}`,
          );
        }
      }),
    Promise.resolve(),
  );

  // Locale-sync rule: every localized field must carry a value for the
  // target locale. For fields we didn't translate, fill the gap from the
  // source value (or null for optional non-required fields). For required
  // block fields, copy source blocks with their ids stripped so the CMA
  // creates fresh block instances.
  for (const [field, meta] of Object.entries(fieldTypeDictionary)) {
    if (!meta.isLocalized) continue;
    // A `failed` field is excluded here so its target locale keeps whatever it
    // had; a `translated` field is already in the payload. Only untranslatable
    // or never-attempted fields fall through to the fallback.
    if (!shouldApplyLocaleSyncFallback(outcomes.get(field))) continue;

    const fieldData = (record[field] as Record<string, unknown>) ?? {};
    const existingTargetKey = findExactLocaleKey(fieldData, toLocale);
    if (existingTargetKey !== undefined) continue;

    const sourceValue = getExactSourceValue(fieldData, fromLocale);
    const { value: fallbackValue, referenceCopied } = resolveLocaleSyncFallback(
      meta,
      sourceValue,
    );

    // When we carry record references into the new locale, record it as a
    // structured event: the linked records themselves are NOT followed or
    // translated (this deliberately avoids deep/recursive traversal of the
    // reference graph), so the editor is later warned that they may still need
    // localizing. These are consolidated into one per-record line downstream.
    if (referenceCopied) {
      referenceFieldsCopied += 1;
      referenceCopies.push({ field, toLocale });
    }

    updatePayload[field] = {
      ...fieldData,
      [toLocale]: fallbackValue,
    };
  }

  const failedFields = [...outcomes].flatMap(([field, outcome]) =>
    outcome.status === 'failed' ? [{ field, error: outcome.error }] : [],
  );

  return {
    payload: updatePayload,
    translatedFieldCount,
    referenceFieldsCopied,
    translatedFields,
    referenceCopies,
    warnings,
    errorCount,
    qcFlags,
    failedFields,
  };
}

/**
 * Determines if a field should be translated for a specific record,
 * properly handling hyphenated locales.
 *
 * @param field - Field API key.
 * @param record - CMA record object.
 * @param fromLocale - Source locale key.
 * @param fieldTypeDictionary - Field dictionary for the item type.
 * @returns True when the field is localized and has a source value.
 */
export function shouldTranslateField(
  field: string,
  record: DatoCMSRecordFromAPI,
  fromLocale: string,
  fieldTypeDictionary: FieldTypeDictionary,
  pluginParams: ctxParamsType,
  selectedFieldsByModel?: SelectedFieldsByModel,
): boolean {
  // Skip system fields that shouldn't be translated
  if (
    ['id', 'creator', 'meta', 'type', 'item_type'].includes(field) ||
    !record[field] ||
    !fieldTypeDictionary[field]?.isLocalized
  ) {
    return false;
  }

  const fieldMeta = fieldTypeDictionary[field];
  if (
    !shouldProcessField(fieldMeta.editor, fieldMeta.id, pluginParams, field)
  ) {
    return false;
  }

  // When the caller (e.g., the bulk page) passes an explicit per-model
  // allowlist, gate the field on it. The helper returns true for an
  // undefined map, preserving legacy behavior for callers that don't
  // care about field-level filtering.
  if (
    !isFieldIncludedInSelection(
      record.item_type.id,
      field,
      selectedFieldsByModel,
    )
  ) {
    return false;
  }

  // Check for the source locale in the field data with proper hyphenated locale support
  const sourceVal = getExactSourceValue(
    record[field] as Record<string, unknown>,
    fromLocale,
  );
  if (!hasTranslatableSourceValue(fieldMeta.editor, sourceVal)) {
    return false;
  }

  return true;
}

/**
 * Prepares the field-specific prompt based on field type
 */
// prepareFieldTypePrompt now shared in SharedFieldUtils.ts

// Using findExactLocaleKey imported from TranslateField.ts

/**
 * Builds a dictionary of field metadata for a given item type.
 *
 * @param client - CMA client.
 * @param itemTypeId - Item type ID.
 * @returns FieldTypeDictionary with editor, id and localized flags.
 */
export async function buildFieldTypeDictionary(
  client: ReturnType<typeof buildClient>,
  itemTypeId: string,
) {
  const fields = await client.fields.list(itemTypeId);
  return fields.reduce(
    (
      acc: FieldTypeDictionary,
      field: {
        api_key: string;
        appearance: { editor: string };
        id: string;
        localized: boolean;
        validators: FieldValidators;
      },
    ) => {
      acc[field.api_key] = {
        editor: field.appearance.editor,
        id: field.id,
        isLocalized: field.localized,
        validators: field.validators,
      };
      return acc;
    },
    {},
  );
}

/**
 * Builds a dictionary of field metadata using SchemaRepository for caching.
 *
 * This is the preferred method when SchemaRepository is available, as it uses
 * cached schema data instead of making new API calls.
 *
 * @param schemaRepository - SchemaRepository instance with cached data.
 * @param itemTypeId - Item type ID.
 * @returns FieldTypeDictionary with editor, id and localized flags.
 */
export async function buildFieldTypeDictionaryWithRepo(
  schemaRepository: SchemaRepository,
  itemTypeId: string,
): Promise<FieldTypeDictionary> {
  return buildFieldTypeDictionaryFromRepo(schemaRepository, itemTypeId);
}

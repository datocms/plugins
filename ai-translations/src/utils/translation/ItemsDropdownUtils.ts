/**
 * Utilities for handling DatoCMS record translations via dropdown actions
 */
import type { buildClient } from '@datocms/cma-client-browser';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import {
  QC_WARNING_ERROR_LABEL,
  QC_WARNING_NOTE_LABEL,
  RUN_CANCELLED,
  buildTranslatedUpdatePayload,
  mergeLocalePayloadInto,
} from '../../engine';
import { createSlotScheduler } from '../../engine/slotScheduler';
import {
  buildFieldTypeDictionaryFromRepo,
  type SchemaRepository,
} from '../schemaRepository';
import { segmentGraphemes } from '../graphemes';
import { formatLocaleWithCode } from '../localeUtils';
import {
  formatErrorForUser,
  type NormalizedProviderError,
  normalizeProviderError,
} from './ProviderErrors';
import type { QcFlag } from './qc/types';
import {
  type FieldTypeDictionary,
  type FieldValidators,
  getExactSourceValue,
} from './SharedFieldUtils';
import {
  createPacer,
  getMaxConcurrency,
  getRequestSpacingMs,
} from './TranslationCore';
import type { RunGate, SystemicHandler, TranslationProvider } from './types';
import { type WriteClaim, verifyPersistedWrite } from './verifyPersistedWrite';

/**
 * Payload-build machinery (extracted to `src/engine` — pure move, Task 1 of
 * the v4 "one engine" plan). Re-exported here so existing imports of
 * `ItemsDropdownUtils` keep resolving unchanged.
 */
// biome-ignore lint/performance/noBarrelFile: intentional re-export shim so existing callers/tests of ItemsDropdownUtils keep resolving after the pure move to src/engine (Task 1 of the v4 refactor).
export {
  RUN_CANCELLED,
  buildTranslatedUpdatePayload,
  shouldApplyLocaleSyncFallback,
  shouldTranslateField,
  stripBlockIds,
  translateWithSystemicRetry,
} from '../../engine';

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

/**
 * Prefixes of the mirrored QC warning lines above. The bulk report already emits
 * a structured `qcFlags` row for each of these, so it drops the free-text mirror
 * to avoid reporting (and counting) the same defect twice.
 */
export const QC_WARNING_PREFIXES = [
  `${QC_WARNING_ERROR_LABEL} —`,
  `${QC_WARNING_NOTE_LABEL} —`,
];

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
export function deriveRecordLabel(
  record: DatoCMSRecordFromAPI,
  preferredLocale: string,
): string {
  for (const key of RECORD_LABEL_CANDIDATES) {
    if (record[key] !== undefined) {
      const s = coerceFieldValueToString(record[key], preferredLocale);
      if (s?.trim()) {
        const trimmed = s.trim();
        // Truncate by GRAPHEME CLUSTER, not UTF-16 units or bare code points: a
        // raw `slice(0, 77)` can cut an emoji mid-surrogate (a lone surrogate) or
        // split a ZWJ/flag cluster mid-glyph in every progress message, modal row,
        // and CSV title cell.
        const chars = segmentGraphemes(trimmed);
        return chars.length > 80 ? `${chars.slice(0, 77).join('')}…` : trimmed;
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
  /**
   * Awaited between records, locales, and fields. Resolving `'cancelled'`
   * unwinds the run; resolving `'continue'` (or being omitted) proceeds. Async
   * so a paused run can block here until the user resumes or stops.
   */
  gate?: RunGate;
  /**
   * Invoked when a systemic provider error is hit (rate limit, auth, quota,
   * network). Pauses the run and resolves once it may resume, or cancels.
   * When omitted, systemic errors fail the field like any other error.
   */
  onSystemic?: SystemicHandler;
  abortSignal?: AbortSignal;
  /**
   * Waits `ms` before each provider call, driving the adaptive pacer. Defaults
   * to a real `setTimeout`-based delay; injected only so tests never wait on
   * real time while still exercising the run's pacing.
   */
  sleep?: (ms: number) => Promise<void>;
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
  // One adaptive pacer for the whole run: a shared inter-request gap that
  // widens on each rate limit and relaxes after a healthy streak, so one
  // throttled locale cannot drag every subsequent locale and record into the
  // same limit. Seeded from the vendor's baseline spacing.
  const pacer = createPacer(getRequestSpacingMs(pluginParams));

  // One AIMD scheduler for the whole run, created next to the pacer and shared
  // across every (record, locale) unit. Sharing it caps field-level concurrency
  // per unit — bulk translation processes records/locales sequentially, so the
  // cap can never be multiplied by the record count (spec §2.3-3). The scheduler
  // owns field-launch spacing and concurrency adaptation; the pacer stays the
  // sole owner of adaptive per-call backoff (it widens on rate limits and decays
  // on success — a role the scheduler does not replicate), so the two are not in
  // conflict.
  const scheduler = createSlotScheduler({
    maxConcurrency: getMaxConcurrency(pluginParams),
    spacingMs: getRequestSpacingMs(pluginParams),
    sleep: options.sleep,
  });

  const updateProgress = (u: ProgressUpdate) => {
    // Normalize legacy in-progress message that included the word "fields"
    if (u.status === 'processing' && typeof u.message === 'string') {
      u = { ...u, message: u.message.replace(/\s*fields…$/, '…') };
    }
    options.onProgress?.(u);
  };

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
    const aggregatedQcFlags: QcFlag[] = [];
    const aggregatedFailedFields: {
      field: string;
      error: NormalizedProviderError;
    }[] = [];
    const localeOutcomes: LocaleOutcome[] = [];
    let totalReferenceFieldsCopied = 0;
    let totalErrorCount = 0;

    /**
     * Translates the record into one target locale and merges the result.
     * Extracted so the per-locale `.reduce` chain stays lint-clean.
     */
    async function translateForLocale(toLocale: string): Promise<void> {
      // Between-locale gate: a cancel (or a still-paused run) unwinds here via
      // RUN_CANCELLED, caught by processRecord and reported as 'cancelled'.
      if ((await options.gate?.()) === 'cancelled') throw RUN_CANCELLED;

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
          gate: options.gate,
          onSystemic: options.onSystemic,
          pacer,
          scheduler,
          sleep: options.sleep,
          selectedFieldsByModel: options.selectedFieldsByModel,
        },
        schemaRepository,
        ctx.cmaBaseUrl,
      );

      mergeLocalePayloadInto(mergedPayload, localeResult.payload);
      aggregatedWarnings.push(...localeResult.warnings);
      aggregatedReferenceCopies.push(...localeResult.referenceCopies);
      aggregatedQcFlags.push(...localeResult.qcFlags);
      aggregatedFailedFields.push(...localeResult.failedFields);
      localeOutcomes.push({
        locale: toLocale,
        translated: [...localeResult.translatedFields],
        failed: [...localeResult.failedFields],
      });
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
      // Final gate before the write: the between-field/locale gates cannot fire
      // after the last field of the last locale, so a cancel that landed mid-way
      // through that field (stopping its block translations early, leaving a
      // partial value) would otherwise be persisted here. Unwind instead of
      // saving partial content.
      if ((await options.gate?.()) === 'cancelled') throw RUN_CANCELLED;

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
        const demotion = {
          field: mismatch.field,
          error: {
            code: 'datocms',
            source: 'datocms',
            message,
          } satisfies NormalizedProviderError,
        };
        outcome.failed.push(demotion);
        aggregatedFailedFields.push(demotion);
      }
    }

    // Derived AFTER the read-back demotion, never from a running tally: a field
    // the CMA silently dropped must not survive in the report as `translated`,
    // nor count toward the record's updated-field total. Tallying during the
    // locale loop would freeze the pre-demotion answer.
    const survivingTranslatedFields = localeOutcomes.flatMap((o) => o.translated);
    const totalTranslatedFields = survivingTranslatedFields.length;
    const translatedFieldApiKeys = [...new Set(survivingTranslatedFields)];
    const copiedLinkFieldApiKeys = [
      ...new Set(aggregatedReferenceCopies.map((copy) => copy.field)),
    ];

    return {
      payload: mergedPayload,
      translatedFieldCount: totalTranslatedFields,
      referenceFieldsCopied: totalReferenceFieldsCopied,
      translatedFields: survivingTranslatedFields,
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

    if ((await options.gate?.()) === 'cancelled') {
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
      // A mid-record cancel (from any between-unit gate or a cancelled pause)
      // unwinds as RUN_CANCELLED. Report it as a cancellation and stop the run
      // rather than mislabelling it a translation failure.
      if (error === RUN_CANCELLED) {
        updateProgress({
          recordIndex,
          recordId: record.id,
          status: 'error',
          message: `Translation cancelled for "${recordLabel}" (#${record.id}).`,
          statusText: 'Cancelled',
          recordLabel,
          itemTypeId,
          updatedAt: recordUpdatedAt,
        });
        return 'cancelled';
      }

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

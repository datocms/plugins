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
} from '../../engine';
import { createSlotScheduler } from '../../engine/slotScheduler';
import {
  buildFieldTypeDictionaryFromRepo,
  type SchemaRepository,
} from '../schemaRepository';
import { getStableDeviceId } from '../deviceId';
import { segmentGraphemes } from '../graphemes';
import { formatLocaleWithCode } from '../localeUtils';
import {
  NormalizedError,
  formatErrorForUser,
  type NormalizedProviderError,
  isFatalProviderError,
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
import {
  type ApiRecord,
  buildPlan,
  orchestrateRecordOutcome,
  toPlanInput,
  toPlanRecord,
} from '../../engine/plan';
import {
  bumpCheckpoint,
  createRunState,
  foldOutcome,
  policyDigest,
  type ResumeTarget,
  type RunState,
} from '../../engine/report';

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
 * Aborts the whole run when an accumulated field failure is a fatal provider
 * configuration error (bad key, wrong endpoint, unverified model, invalid
 * Yandex Folder ID) — one that would recur for every remaining record. The
 * thrown `NormalizedError` is re-thrown by `translateAndSaveRecord`'s catch
 * (which treats fatal errors as non-recoverable), unwinding the record reduce
 * and rejecting the run before any write. Systemic errors still pause instead.
 */
const abortRunOnFatalFailure = (
  provider: TranslationProvider,
  failedFields: { field: string; error: NormalizedProviderError }[],
): void => {
  const fatalError = failedFields.find((f) =>
    isFatalProviderError(provider.vendor, f.error),
  )?.error;
  if (fatalError) {
    throw new NormalizedError(fatalError, { cause: fatalError });
  }
};

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
  /** CMA `updated_at` of the record after the write. */
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
  /**
   * Invoked once at the end of the run with the accumulated {@link RunState} —
   * the plan/apply report shape (per (record,locale) outcome). Additive shadow
   * (integration spec §6 Step 1): the write/report path is unchanged; this
   * surfaces the new report model so downstream UI can adopt it.
   */
  onRunState?: (runState: RunState) => void;
  /**
   * Invoked with the accumulated {@link RunState} after EACH record is folded,
   * with a bumped checkpoint — the incremental persistence hook for cross-session
   * resume (persistence spec §8, step 3). Best-effort: a rejection is swallowed so
   * a failed checkpoint never breaks the run. Distinct from {@link onRunState},
   * which fires once at the end for the shadow report.
   */
  persist?: (runState: RunState) => void | Promise<void>;
  /**
   * Resume a prior run (persistence spec §8, step 6b): re-run only the `targets`
   * (unfinished units) and continue folding onto `priorState` instead of starting
   * a fresh RunState. The caller loads `priorState` from the store and computes
   * `targets` via `unitsToResume`.
   */
  resume?: { priorState: RunState; targets: ResumeTarget[] };
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
  /**
   * Count of localized top-level fields written verbatim from the source locale
   * by the copy-from-source fate (spec §4.2/§4.3). Like {@link referenceFieldsCopied}
   * it counts a real write that did NOT go through translation, so the record's
   * updated-field total must include it — otherwise a record whose only write is
   * a copy field is misreported as "No fields were updated".
   */
  copiedFieldCount: number;
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
  /**
   * Locales this build newly wrote into each field's payload entry — the
   * translated `toLocale` and (when it fired) the locale-sync fallback
   * `toLocale`, keyed by field `api_key`. Threaded out rather than
   * reconstructed by diffing values so the form adapter's
   * `payloadToFormWrites` (spec §2.1) can tell a newly-written locale from a
   * spread-in original one without guessing. Both the translated write
   * (§2.1's main loop) and the locale-sync fallback write land here
   * undistinguished — see `formAdapter.ts` for the form-sink caveat this
   * implies.
   */
  writtenLocales: Record<string, string[]>;
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
  if (outcome.copiedFieldCount > 0) {
    return {
      completionMessage: `Copied fields from source for "${recordLabel}" (#${recordId}).`,
      statusText: 'Copied from source',
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
 * DatoCMS's optimistic-locking rejection code (spec §7.2): the CMA returns this
 * on a `PUT /items/:id` when the submitted `meta.current_version` no longer
 * matches the record's current version on the server — i.e. someone else
 * edited the record after this run fetched it.
 */
const STALE_ITEM_VERSION_CODE = 'STALE_ITEM_VERSION';

/**
 * Detects a DatoCMS `STALE_ITEM_VERSION` 422 by walking the same
 * `response.body.data[].attributes.code` shape the CMA client's `ApiError`
 * exposes (see `@datocms/rest-client-utils`'s `ApiError#errors`), rather than
 * string-matching the error message.
 *
 * @param error - The error thrown by `client.items.update`.
 * @returns Whether the error is a stale-version optimistic-locking conflict.
 */
function isStaleItemVersionError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const data = (error as { response?: { body?: { data?: unknown } } }).response
    ?.body?.data;
  if (!Array.isArray(data)) return false;
  return data.some((entry) => {
    if (entry === null || typeof entry !== 'object') return false;
    const attributes = (entry as { attributes?: { code?: unknown } })
      .attributes;
    return attributes?.code === STALE_ITEM_VERSION_CODE;
  });
}

/**
 * Builds the `client.items.update` request body: the translated field payload,
 * plus `meta.current_version` when the fetched record carries one — enabling
 * DatoCMS's optimistic-locking guard (spec §7.2) so a concurrent edit landing
 * mid-run 422s instead of being silently overwritten.
 *
 * @param mergedPayload - The translated field values keyed by api_key.
 * @param currentVersion - The record's `current_version` at fetch time, if known.
 * @returns The request body to pass to `client.items.update`.
 */
function buildRecordUpdateBody(
  mergedPayload: Record<string, Record<string, unknown>>,
  currentVersion: string | undefined,
): Record<string, unknown> {
  return currentVersion
    ? { ...mergedPayload, meta: { current_version: currentVersion } }
    : { ...mergedPayload };
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

  // Plan/apply report shape, accumulated in shadow (integration spec §6 Step 1):
  // built alongside the existing write/report with NO behavioral change, and
  // surfaced via options.onRunState at the end of the run.
  const uuid = (): string =>
    globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${records.length}`;
  const runPolicy = {
    excludedTokens: pluginParams.apiKeysToBeExcludedFromThisPlugin ?? [],
    copyTokens: pluginParams.fieldsToCopyFromSource ?? [],
  };

  // Resume (step 6b): when a prior run is handed in, re-run ONLY its unfinished
  // (record, locale) units and continue folding onto its RunState. `localesFor`
  // narrows each record to its resumable locales; a normal run gets every locale.
  const resumeSet = options.resume
    ? new Set(options.resume.targets.map((t) => `${t.recordId}::${t.toLocale}`))
    : null;
  const localesFor = (recordId: string): string[] =>
    resumeSet
      ? toLocales.filter((loc) => resumeSet.has(`${recordId}::${loc}`))
      : toLocales;

  let runState = options.resume
    ? options.resume.priorState
    : createRunState({
        runId: uuid(),
        deviceId: getStableDeviceId(),
        startedAt: Date.now(),
        operation: 'translate',
        policyDigest: policyDigest(runPolicy),
        fromLocale,
        toLocales,
      });

  // Seed every intended unit as not-attempted so an interrupted run can resume the
  // records it never reached — not just ones that completed with a defect. Only a
  // fresh run needs this (a resumed run already carries its prior units); as each
  // record completes, foldOutcome upserts its units by the same recordId+locale key.
  if (!options.resume) {
    for (const record of records) {
      for (const toLocale of localesFor(record.id)) {
        runState = foldOutcome(
          runState,
          {
            recordId: record.id,
            toLocale,
            bucket: 'not-attempted',
            reasons: [],
            flags: [],
          },
          { now: Date.now() },
        );
      }
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
    // Resume-aware: the locales still to run for THIS record (all of them on a
    // normal run). Drives both the per-locale loop and the plan build, so the
    // write body carries only the (re-)translated locales — already-done locales
    // are neither retranslated nor overwritten.
    const recordToLocales = localesFor(record.id);
    const toFieldIds = (apiKeys: string[]): string[] =>
      apiKeys
        .map((key) => fieldTypeDictionary[key]?.id)
        .filter((id): id is string => Boolean(id));

    const aggregatedWarnings: string[] = [];
    const aggregatedReferenceCopies: ReferenceCopy[] = [];
    const aggregatedQcFlags: QcFlag[] = [];
    const aggregatedFailedFields: {
      field: string;
      error: NormalizedProviderError;
    }[] = [];
    const localeOutcomes: LocaleOutcome[] = [];
    const aggregatedWrittenLocales: Record<string, string[]> = {};
    // Per-locale engine results, kept for the plan/apply orchestration (§3): the
    // conform gate + assembleRecordPayload decide the final write body.
    const localeResults = new Map<
      string,
      {
        payload: Record<string, Record<string, unknown>>;
        qcFlags: QcFlag[];
        translatedFields: string[];
        failedFields: { field: string; error: NormalizedProviderError }[];
      }
    >();
    let totalReferenceFieldsCopied = 0;
    let totalCopiedFieldCount = 0;
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

      aggregatedWarnings.push(...localeResult.warnings);
      aggregatedReferenceCopies.push(...localeResult.referenceCopies);
      aggregatedQcFlags.push(...localeResult.qcFlags);
      aggregatedFailedFields.push(...localeResult.failedFields);
      // localeOutcomes are rebuilt from the conform verdicts after the loop (§3),
      // so a Blocked locale reports its reasons as failures.
      totalReferenceFieldsCopied += localeResult.referenceFieldsCopied;
      totalCopiedFieldCount += localeResult.copiedFieldCount;
      totalErrorCount += localeResult.errorCount;
      for (const [field, locales] of Object.entries(
        localeResult.writtenLocales,
      )) {
        aggregatedWrittenLocales[field] = [
          ...(aggregatedWrittenLocales[field] ?? []),
          ...locales,
        ];
      }

      localeResults.set(toLocale, {
        payload: localeResult.payload,
        qcFlags: localeResult.qcFlags,
        translatedFields: localeResult.translatedFields,
        failedFields: localeResult.failedFields,
      });
    }

    // Sequential per-locale to keep within provider rate-limit budgets and
    // surface progress in the order the user picked.
    await recordToLocales.reduce(
      (chain, toLocale) => chain.then(() => translateForLocale(toLocale)),
      Promise.resolve(),
    );

    // A fatal provider-configuration error (bad key, wrong endpoint, unverified
    // model, invalid Yandex Folder ID) recurs for every remaining field and
    // record, so grinding on would just report the same failure N times. Abort
    // the whole run: the record-level catch re-throws a fatal error, unwinding
    // the record reduce and rejecting the run before any write. Systemic errors
    // still pause via onSystemic; this is the hard-stop for unrecoverable config.
    abortRunOnFatalFailure(provider, aggregatedFailedFields);

    // Timestamp for the CSV report: the write's fresh `updated_at` when we
    // touched the record, otherwise the record's existing timestamp.
    const recordMeta = (
      record as { meta?: { updated_at?: string; current_version?: string } }
    ).meta;
    let updatedAt = recordMeta?.updated_at;

    // Plan/apply gate (§3): conform the per-locale engine results into the final
    // write body. A locale carrying an error-tier defect is BLOCKED — omitted
    // from the body (its existing value preserved, never overwritten with bad
    // content), and reported as a failure. Written locales are merged into one
    // items.update body via assembleRecordPayload.
    const plan = buildPlan(
      toPlanInput({
        record: record as unknown as ApiRecord,
        dictionary: fieldTypeDictionary,
        allLocalesRequired: false,
        policy: runPolicy,
        policyDigest: runState.policyDigest,
        fromLocale,
        toLocales: recordToLocales,
      }),
    );
    const { body, outcomes } = orchestrateRecordOutcome({
      plan,
      record: toPlanRecord(record as unknown as ApiRecord),
      fromLocale,
      localeResults,
    });
    const recordPlan = plan.records[0];

    // Rebuild per-locale report outcomes from the conform verdicts. A Written
    // locale reports its translated fields — AND any provider-failed fields, so a
    // record with a failed field still surfaces as an error (the failure isn't a
    // QC flag, so conform can't see it). A Blocked locale reports its reasons as
    // failures. RunState is folded AFTER the write (below), never here, so a
    // thrown write can't leave a phantom `written` unit in the canonical report.
    for (const outcome of outcomes) {
      if (outcome.bucket === 'written') {
        const lr = localeResults.get(outcome.toLocale);
        localeOutcomes.push({
          locale: outcome.toLocale,
          translated: [...(lr?.translatedFields ?? [])],
          // failedFields are already in aggregatedFailedFields (translateForLocale);
          // carrying them here drives summarizeLocaleOutcomes → hasDeadLocale.
          failed: [...(lr?.failedFields ?? [])],
        });
      } else {
        const failed = outcome.reasons.map((reason) => ({
          field: reason.fieldPath || outcome.toLocale,
          error: {
            code: 'datocms',
            source: 'datocms',
            message: reason.message,
          } satisfies NormalizedProviderError,
        }));
        localeOutcomes.push({ locale: outcome.toLocale, translated: [], failed });
        aggregatedFailedFields.push(...failed);
        for (const reason of outcome.reasons) {
          aggregatedWarnings.push(`${formatLocaleWithCode(outcome.toLocale)}: ${reason.message}`);
        }
        totalErrorCount += 1;
      }
    }

    const demotedLocales = new Set<string>();
    if (Object.keys(body).length > 0) {
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
        buildRecordUpdateBody(body, recordPlan.sourceVersion),
      )) as Record<string, unknown> & { meta?: { updated_at?: string } };
      updatedAt = updated?.meta?.updated_at ?? updatedAt;

      // Structural read-back: every field we marked `translated` (Written only)
      // must come back present. A claim the CMA silently dropped is demoted to
      // `failed` (written-unverified) so the record fails the run.
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
        demotedLocales.add(mismatch.locale);
      }
    }

    // Fold the canonical RunState AFTER the write + verify demotions, so it
    // reflects what actually persisted (integration review): a written locale
    // the CMA silently dropped a field from becomes `written-unverified`. A write
    // that threw never reaches here, so the record is simply absent from RunState
    // rather than falsely `written`.
    for (const outcome of outcomes) {
      const projected =
        outcome.bucket === 'written' && demotedLocales.has(outcome.toLocale)
          ? { ...outcome, bucket: 'written-unverified' as const }
          : outcome;
      runState = foldOutcome(runState, projected, { now: Date.now() });
    }

    // Persist an incremental checkpoint after each record so a later session can
    // resume the run (persistence spec §8, step 3). Best-effort and isolated: a
    // storage failure must degrade resume to off, never fail the record or run.
    runState = bumpCheckpoint(runState);
    try {
      await options.persist?.(runState);
    } catch {
      // Swallow: resume persistence is a nice-to-have, never load-bearing.
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
      payload: body,
      translatedFieldCount: totalTranslatedFields,
      referenceFieldsCopied: totalReferenceFieldsCopied,
      copiedFieldCount: totalCopiedFieldCount,
      translatedFields: survivingTranslatedFields,
      referenceCopies: aggregatedReferenceCopies,
      warnings: aggregatedWarnings,
      errorCount: totalErrorCount,
      qcFlags: aggregatedQcFlags,
      failedFields: aggregatedFailedFields,
      writtenLocales: aggregatedWrittenLocales,
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

    // Copied references AND copy-from-source fields count as real updates: the
    // record was written even when no field was AI-translated. Only treat it as
    // an error when nothing at all was written yet failures were raised (i.e.
    // every field failed).
    const updatedFieldCount =
      outcome.translatedFieldCount +
      outcome.referenceFieldsCopied +
      outcome.copiedFieldCount;

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
   * Reports a `STALE_ITEM_VERSION` optimistic-locking conflict (spec §7.2): a
   * concurrent edit changed the record after this run fetched it, so DatoCMS
   * rejected the write rather than it being silently reverted. Marks the
   * record `error` and lets the run continue to the next one.
   */
  function reportStaleItemVersionConflict(
    recordIndex: number,
    recordId: string,
    recordLabel: string,
    itemTypeId: string,
    recordUpdatedAt: string | undefined,
  ): 'continue' {
    const message = `Record "${recordLabel}" (#${recordId}) changed while translating — re-run it.`;
    console.error(`Error translating record ${recordId}:`, message);
    updateProgress({
      recordIndex,
      recordId,
      status: 'error',
      message,
      statusText: 'Record changed while translating — re-run it',
      recordLabel,
      itemTypeId,
      updatedAt: recordUpdatedAt,
      warnings: [message],
    });
    return 'continue';
  }

  /**
   * Reports a `processRecord` failure (anything but a `RUN_CANCELLED` unwind,
   * which the caller handles separately before the translate/save even starts).
   * Distinguishes a `STALE_ITEM_VERSION` optimistic-locking conflict (spec
   * §7.2) from every other error, which keeps its existing generic handling.
   * Always returns `'continue'` so the run proceeds to the next record.
   */
  function reportRecordFailure(
    error: unknown,
    recordIndex: number,
    record: DatoCMSRecordFromAPI,
    recordLabel: string,
    itemTypeId: string,
    recordUpdatedAt: string | undefined,
  ): 'continue' {
    if (isStaleItemVersionError(error)) {
      return reportStaleItemVersionConflict(
        recordIndex,
        record.id,
        recordLabel,
        itemTypeId,
        recordUpdatedAt,
      );
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

      // A fatal provider-configuration error (bad key, wrong endpoint, unverified
      // model) repeats for every remaining record — rethrow to abort the whole
      // run instead of reporting the same failure N times.
      const norm = normalizeProviderError(error, provider.vendor);
      if (isFatalProviderError(provider.vendor, norm)) throw error;

      return reportRecordFailure(
        error,
        recordIndex,
        record,
        recordLabel,
        itemTypeId,
        recordUpdatedAt,
      );
    }
  }

  // Process records sequentially using reduce to avoid await-in-loop
  // Resume (step 6b): skip records with no unfinished units entirely.
  const recordsToRun = resumeSet
    ? records.filter((record) => localesFor(record.id).length > 0)
    : records;
  await recordsToRun.reduce(async (previousRecord, record, i) => {
    const previousOutcome = await previousRecord;
    if (previousOutcome === 'cancelled') return 'cancelled';
    return processRecord(record, i);
  }, Promise.resolve<'cancelled' | 'continue' | 'done'>('done'));

  // Surface the accumulated plan/apply report (shadow; §6 Step 1).
  options.onRunState?.(runState);
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

/**
 * Payload-build engine: translates one record's fields into a target locale
 * and resolves the DatoCMS locale-sync fallback for everything that wasn't
 * translated.
 *
 * Extracted from `src/utils/translation/ItemsDropdownUtils.ts` as a pure move
 * (Task 1 of the v4 "one engine" plan) — the old path re-exports everything
 * here so existing callers and tests keep resolving unchanged. Later tasks
 * add a parallel scheduler, a stall guard, and field-fate logic around this
 * core; `translateAndUpdateRecords` (the bulk orchestrator) still lives in
 * `ItemsDropdownUtils.ts` and calls back into this module per locale.
 */
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { FIELD_TRANSLATION_TIMEOUT_MS } from '../utils/constants';
import { formatLocaleWithCode } from '../utils/localeUtils';
import { isFieldIncludedInSelection } from '../utils/translation/BulkTranslationHelpers';
import type {
  BuildTranslatedUpdatePayloadResult,
  DatoCMSRecordFromAPI,
  ReferenceCopy,
  SelectedFieldsByModel,
} from '../utils/translation/ItemsDropdownUtils';
import {
  formatErrorForUser,
  isSystemicError,
  type NormalizedProviderError,
  normalizeProviderError,
} from '../utils/translation/ProviderErrors';
import type { QcFlag } from '../utils/translation/qc/types';
import { checkFieldLength } from '../utils/translation/qc/validatorChecks';
import {
  type FieldTypeDictionary,
  findExactLocaleKey,
  getExactSourceValue,
  hasMinItemsValidator,
  isFieldRequired,
  isReferenceField,
  prepareFieldTypePrompt,
} from '../utils/translation/SharedFieldUtils';
import {
  generateRecordContext,
  translateFieldValue,
} from '../utils/translation/TranslateField';
import {
  type Pacer,
  createPacer,
  delay,
  getMaxConcurrency,
  getRequestSpacingMs,
  hasTranslatableSourceValue,
  isRateLimitError,
  shouldProcessField,
} from '../utils/translation/TranslationCore';
import type {
  FieldOutcome,
  RunGate,
  SystemicHandler,
  TranslationProvider,
} from '../utils/translation/types';
import type { SchemaRepository } from '../utils/schemaRepository';
import { type SlotScheduler, createSlotScheduler } from './slotScheduler';
import { withStallGuard } from './stallGuard';

/**
 * Human label prefixing each QC flag that {@link buildTranslatedUpdatePayload}
 * mirrors into the per-record `warnings` list for the live progress tooltip.
 * `error`-severity flags read "Translation issue"; the rest read "Note".
 */
export const QC_WARNING_ERROR_LABEL = 'Translation issue';
export const QC_WARNING_NOTE_LABEL = 'Note';

/** Sentinel thrown to unwind the run when the user cancels from a pause. */
export const RUN_CANCELLED = { cancelled: true } as const;

/** Retries a content-scoped failure this many times before giving up. */
const CONTENT_RETRY_LIMIT = 2;

/**
 * Runs one translation attempt, handling systemic errors by pausing the whole
 * run and content errors by retrying the field a bounded number of times.
 *
 * Stays deliberately pure about the pause UI: the rate-limit retry budget and
 * the backoff countdown live in the pause handler (the modal owns them). This
 * helper simply retries whenever the handler resolves `'retry'`.
 *
 * When a {@link Pacer} is supplied it is consulted before every provider call —
 * awaiting its current gap, widening it on each rate limit, and relaxing it
 * after a run of healthy calls. That proactive spacing is what stops a single
 * throttled locale from dragging every subsequent call into the same limit;
 * the reactive pause only kicks in once a 429 has already landed.
 *
 * @param attempt - Performs one translation; must reject with a normalized error.
 * @param handlers - Run-control callbacks and the optional adaptive pacer.
 * @param handlers.onSystemic - Pauses the run; resolves when it may resume.
 * @param handlers.pacer - Run-scoped inter-request pacer; omitted disables spacing.
 * @param handlers.sleep - Waits `ms`; injected so tests never wait on real time.
 * @returns The translated value.
 * @throws The normalized error once content retries are exhausted.
 * @throws {typeof RUN_CANCELLED} When the user cancels from the pause screen.
 */
/**
 * Awaits the pacer's current inter-request gap before a provider call. A gap of
 * zero (or no pacer) is a no-op. Extracted so the retry loop stays lint-clean.
 */
const awaitPacerGap = async (
  pacer: Pacer | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<void> => {
  if (!pacer) return;
  const gap = pacer.gapMs();
  if (gap > 0) await sleep(gap);
};

/**
 * Widens the steady-state gap after a rate limit so the retry — and every later
 * call — backs off, rather than hammering the same limit at the old cadence.
 * Only `rate_limit` widens: waiting out an `auth`/`quota` error never clears it.
 */
const widenPacerOnRateLimit = (
  pacer: Pacer | undefined,
  err: NormalizedProviderError,
): void => {
  if (pacer && err.code === 'rate_limit') pacer.onRateLimit();
};

export const translateWithSystemicRetry = async <T>(
  attempt: () => Promise<T>,
  handlers: {
    onSystemic: SystemicHandler;
    pacer?: Pacer;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> => {
  const { onSystemic, pacer, sleep = delay } = handlers;
  let contentRetries = 0;

  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: pacing is inherently sequential — each call must be spaced from the previous one.
    await awaitPacerGap(pacer, sleep);

    try {
      const value = await attempt();
      pacer?.onSuccess();
      return value;
    } catch (raw) {
      const err = raw as NormalizedProviderError;

      if (isSystemicError(err)) {
        widenPacerOnRateLimit(pacer, err);
        if ((await onSystemic(err)) === 'cancelled') throw RUN_CANCELLED;
        continue; // the handler already waited; try the same field again
      }

      if (contentRetries >= CONTENT_RETRY_LIMIT) throw err;
      contentRetries += 1;
    }
  }
};

/**
 * Merges a per-locale field payload into the running accumulator. Each
 * locale's payload only writes its own locale key, so the merge is a
 * shallow object spread per field — no cross-locale conflicts.
 */
export function mergeLocalePayloadInto(
  target: Record<string, Record<string, unknown>>,
  source: Record<string, Record<string, unknown>>,
): void {
  for (const [field, fieldValue] of Object.entries(source)) {
    target[field] = { ...(target[field] ?? {}), ...fieldValue };
  }
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
 * Decides whether a localized field is a CANDIDATE for the locale-sync fallback
 * — i.e. anything that was not successfully translated (a `translated` field is
 * already in the payload).
 *
 * This intentionally INCLUDES `failed` fields. DatoCMS's Locale Sync Rule
 * requires every localized field to carry a newly-added locale, or the whole
 * `items.update` is rejected with `VALIDATION_INVALID_LOCALES` — losing the
 * record's successfully-translated siblings too. So a failed field must still be
 * filled when the target locale is NEW. The null-guard (never overwrite an
 * EXISTING target value with null because a provider errored) is preserved by
 * the caller's `existingTargetKey` check, which skips any field whose target
 * locale already holds a value.
 *
 * @param outcome - The field's outcome, or `undefined` if it was never attempted.
 * @returns True when the field may receive a fallback for a not-yet-present locale.
 */
export const shouldApplyLocaleSyncFallback = (
  outcome: FieldOutcome | undefined,
): boolean => outcome?.status !== 'translated';

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
 * See also: `translateRecordUnits` (below) with the form sink
 * (`src/engine/formSink.ts`), the record (sidebar) path that reuses this same
 * builder but stages values via `ctx.setFieldValue(...)` (locale-sync off).
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
/**
 * Runs the per-field jobs for one `(record, locale)` unit. With a scheduler it
 * parallelizes the fields under the run's shared adaptive concurrency cap;
 * without one it falls back to a sequential chain, preserving the pre-scheduler
 * behavior that direct callers (and the existing unit tests) rely on.
 *
 * A cancelled gate makes a job throw `RUN_CANCELLED`. The sequential chain
 * propagates it directly; the scheduler captures it as a settled rejection, so
 * it is re-surfaced here — either way the run unwinds identically and
 * `processRecord` reports the cancellation.
 */
const dispatchFieldJobs = async (
  fields: string[],
  runField: (field: string) => Promise<void>,
  opts: { scheduler?: SlotScheduler; abortSignal?: AbortSignal },
): Promise<void> => {
  if (!opts.scheduler) {
    await fields.reduce(
      (chain, field) => chain.then(() => runField(field)),
      Promise.resolve(),
    );
    return;
  }

  const settled = await opts.scheduler.run(
    fields.map((field) => () => runField(field)),
    {
      isRateLimitError,
      checkCancellation: () => opts.abortSignal?.aborted ?? false,
    },
  );
  for (const result of settled) {
    if (result.status === 'rejected' && result.reason === RUN_CANCELLED) {
      throw RUN_CANCELLED;
    }
  }
};

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
    /** Awaited before each field; resolving `'cancelled'` unwinds via RUN_CANCELLED. */
    gate?: RunGate;
    /** Pauses the run on a systemic error; when omitted, systemic errors fail the field. */
    onSystemic?: SystemicHandler;
    /** Run-scoped adaptive pacer; spaces and throttles provider calls. */
    pacer?: Pacer;
    /**
     * Run-scoped AIMD scheduler that parallelizes this record-locale's fields
     * under an adaptive concurrency cap. When omitted the fields run
     * sequentially (preserving the pre-scheduler behavior direct callers rely on).
     */
    scheduler?: SlotScheduler;
    /** Waits `ms` before each provider call; injected for deterministic tests. */
    sleep?: (ms: number) => Promise<void>;
    selectedFieldsByModel?: SelectedFieldsByModel;
    /**
     * Runs the DatoCMS locale-sync fallback pass (spec §2.3-7). Defaults to
     * `true` for the CMA/bulk path, where every localized field of a newly
     * added locale MUST carry a value or `items.update` 422s. The form (sidebar)
     * path passes `false`: it stages values into an OPEN form with no CMA write,
     * so a fallback would only re-stage untouched/fallback-null locales the user
     * never asked to translate.
     */
    applyLocaleSync?: boolean;
  } = {},
  schemaRepository?: SchemaRepository,
  cmaBaseUrl?: string,
): Promise<BuildTranslatedUpdatePayloadResult> {
  const updatePayload: Record<string, Record<string, unknown>> = {};
  const warnings: string[] = [];
  const referenceCopies: ReferenceCopy[] = [];
  const translatedFields: string[] = [];
  const qcFlags: QcFlag[] = [];
  const writtenLocales: Record<string, string[]> = {};
  let translatedFieldCount = 0;
  let referenceFieldsCopied = 0;
  let errorCount = 0;

  /**
   * Records that `field` got a new value for `locale` this build (translated
   * or locale-sync fallback) — the raw material `payloadToFormWrites` (§2.1)
   * uses to tell a newly-written locale from a spread-in original one.
   */
  function recordWrittenLocale(field: string, locale: string): void {
    writtenLocales[field] = [...(writtenLocales[field] ?? []), locale];
  }

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
      `${flag.severity === 'error' ? QC_WARNING_ERROR_LABEL : QC_WARNING_NOTE_LABEL} — "${flag.fieldPath ?? field}" → ${formatLocaleWithCode(
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
   * does NOT mutate the payload — the caller decides what to write from the
   * outcome: a `translated` value is written; a `failed` field is never written
   * OVER an existing target value (the null-guard), but is still filled with the
   * locale-sync fallback for a NEW locale so DatoCMS's Locale Sync Rule holds
   * (see the locale-sync loop below). Length QC still runs on success.
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

    // One provider call for this field, normalizing on failure so the retry
    // helper (and this function's catch) always see a NormalizedProviderError.
    // The between-unit gate only fires between whole fields/locales/records, so
    // a `checkCancellation` derived from the guard's own signal is also threaded
    // here: it is what lets the block-level concurrency runner (runWithConcurrency)
    // stop launching further block translations mid-field when the user cancels
    // OR when the stall guard below aborts. runWithConcurrency cancels on a THROW
    // (it ignores the boolean return), so this throws when aborted and otherwise
    // reports "not cancelled".
    const attemptWith = async (signal: AbortSignal): Promise<unknown> => {
      try {
        return await translateFieldValue(
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
            abortSignal: signal,
            // Throws on EITHER a stall (the guard aborts its own `signal`) or a
            // user cancel. The user-cancel check reads `opts.abortSignal`
            // directly rather than relying on it having propagated into `signal`:
            // the guard detaches its parent-abort listener once the call settles,
            // so the durable parent signal is the source of truth for cancellation.
            checkCancellation: () => {
              if (signal.aborted || opts.abortSignal?.aborted) {
                throw new Error('Bulk translation cancelled');
              }
              return false;
            },
          },
          recordContext,
          schemaRepository,
          {
            fieldApiKey: field,
            ...(cmaBaseUrl ? { cmaBaseUrl } : {}),
            onQcFlag: (flag) => recordQcFlag(flag, field),
          },
        );
      } catch (error) {
        throw normalizeProviderError(error, provider.vendor);
      }
    };

    // Guards every provider attempt with a per-call stall timeout: a hung call
    // aborts its own signal (chained from `opts.abortSignal`) so the underlying
    // fetch actually dies and this field's slot frees up, instead of blocking
    // the run forever. Both call paths below — the systemic-retry loop and the
    // bare fallback — call `attempt`, so both are guarded. A stall normalizes to
    // `code: 'unknown'`, which `isSystemicError` does not treat as systemic, so
    // it's retried as a content-tier failure under `CONTENT_RETRY_LIMIT` like
    // any other field-scoped error rather than pausing the whole run.
    //
    // Every rejection the guard can surface is normalized here, not just the
    // `StallError`: when `opts.abortSignal` wins the guard's race the raw reason
    // is a bare `DOMException`, which must go through the same normalizer so the
    // retry loop and `formatErrorForUser` always see a `NormalizedProviderError`
    // (as they did pre-guard, when the abort surfaced through `attemptWith`'s own
    // try/catch). `normalizeProviderError` short-circuits an existing
    // `NormalizedError` instance, so re-normalizing here is a safe no-op for the
    // errors `attemptWith` already normalized.
    const attempt = (): Promise<unknown> =>
      withStallGuard((signal) => attemptWith(signal), {
        timeoutMs: FIELD_TRANSLATION_TIMEOUT_MS,
        parentSignal: opts.abortSignal,
      }).catch((error) => {
        throw normalizeProviderError(error, provider.vendor);
      });

    try {
      // With a systemic handler, systemic errors pause the whole run and content
      // errors retry a bounded number of times; without one (until the pause
      // machine is wired in), a failed call falls straight through to `failed`.
      const translatedValue = opts.onSystemic
        ? await translateWithSystemicRetry(attempt, {
            onSystemic: opts.onSystemic,
            pacer: opts.pacer,
            sleep: opts.sleep,
          })
        : await attempt();

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
      // A cancelled pause unwinds the whole run — never a per-field failure.
      if (error === RUN_CANCELLED) throw error;
      // `attempt` already normalized; the retry helper rethrows that same shape.
      const norm = error as NormalizedProviderError;
      console.error(
        `Error translating field ${field} → ${toLocale} for record ${record.id}: ${formatErrorForUser(norm)}`,
      );
      return { status: 'failed', error: norm };
    }
  }

  // Only a `translated` outcome writes the payload; a `failed` outcome records a
  // warning but leaves the field absent, so the target locale is untouched. Each
  // field's payload/counter writes happen inside its own completion — they touch
  // disjoint `payload[field]` keys and the accounting is push-only (array pushes
  // and synchronous counter bumps with no await gap), so running fields in
  // parallel introduces no shared-state race.
  const outcomes = new Map<string, FieldOutcome>();

  const runField = async (field: string): Promise<void> => {
    // Between-field gate: a cancel unwinds via RUN_CANCELLED, caught by
    // processRecord and reported as a cancellation. Preserved per field exactly
    // as the sequential reduce had it, so a parallel batch honors cancellation
    // at every field boundary too.
    if ((await opts.gate?.()) === 'cancelled') throw RUN_CANCELLED;

    const outcome = await translateField(field);
    outcomes.set(field, outcome);

    if (outcome.status === 'translated') {
      updatePayload[field] = {
        ...((record[field] as Record<string, unknown>) || {}),
        [toLocale]: outcome.value,
      };
      recordWrittenLocale(field, toLocale);
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
  };

  await dispatchFieldJobs(translatableFields, runField, opts);

  // DatoCMS Locale Sync Rule: when a locale is ADDED to a record, EVERY
  // localized field must carry it, or the whole items.update is rejected with
  // VALIDATION_INVALID_LOCALES (losing the translated siblings too). So every
  // localized field that isn't already translated is filled here from the source
  // (or null for optional non-required fields; required block fields copy source
  // blocks with ids stripped so the CMA creates fresh instances).
  //
  // The form (sidebar) path opts out (§2.3-7): it stages into an open form, not
  // a CMA update, so there is no Locale Sync Rule to satisfy and a fallback
  // would only push fallback nulls/originals into locales the user never touched.
  for (const [field, meta] of opts.applyLocaleSync === false
    ? []
    : Object.entries(fieldTypeDictionary)) {
    if (!meta.isLocalized) continue;
    // A `translated` field is already in the payload. `failed`, `untranslatable`,
    // and never-attempted fields fall through — INCLUDING `failed`, so a new
    // locale stays consistent (Locale Sync Rule).
    if (!shouldApplyLocaleSyncFallback(outcomes.get(field))) continue;

    const fieldData = (record[field] as Record<string, unknown>) ?? {};
    // The null-guard: if the target locale ALREADY has a value, never touch it —
    // a failed re-translation must not overwrite existing content with null. Only
    // a NEW (not-yet-present) target locale receives the fallback below.
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
    recordWrittenLocale(field, toLocale);
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
    writtenLocales,
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

/** Per-locale options accepted by {@link buildTranslatedUpdatePayload}. */
type BuildPayloadOptions = NonNullable<
  Parameters<typeof buildTranslatedUpdatePayload>[8]
>;

/**
 * Run-control options for {@link translateRecordUnits} (the sidebar's
 * single-record run).
 *
 * `onSystemic` is REQUIRED here — deliberately stricter than
 * {@link BuildPayloadOptions}, where it is optional (§2.3-1). Omitting it does
 * not fail loudly; it silently collapses the whole reliability layer to a bare
 * provider attempt: no adaptive pacer gap, no 429 auto-retry, no systemic
 * pause/resume, no content retries. Making it a compile error to leave out is
 * the type-level half of that acceptance criterion; the caller wires it to a
 * `PauseController`.
 */
export type TranslateRecordUnitsOptions = Omit<
  BuildPayloadOptions,
  'onSystemic'
> & {
  onSystemic: SystemicHandler;
};

/**
 * Deps threaded through {@link translateRecordUnits}. Mirrors the exact
 * parameters {@link buildTranslatedUpdatePayload} already takes per locale —
 * grouped into one object. `options` is required (not optional) so `onSystemic`
 * cannot be dropped; a scheduler/pacer are created per call when absent so a
 * single record run still gets bounded parallelism (§2.3-3).
 */
export type TranslateRecordUnitsDeps = {
  provider: TranslationProvider;
  pluginParams: ctxParamsType;
  fieldDictionary: FieldTypeDictionary;
  /** Source locale key, shared across every target locale in `toLocales`. */
  fromLocale: string;
  accessToken: string;
  environment: string;
  options: TranslateRecordUnitsOptions;
  schemaRepository?: SchemaRepository;
  cmaBaseUrl?: string;
};

/**
 * Aggregate outcome of translating one record into every locale in
 * `toLocales`, merged the same way the bulk orchestrator merges its per-locale
 * payloads (one `client.items.update`-ready payload for the whole record).
 */
export type RecordUnitsResult = BuildTranslatedUpdatePayloadResult;

/**
 * Translates a single record into every target locale and merges the
 * per-locale payloads into one, using the same `buildTranslatedUpdatePayload`
 * + `mergeLocalePayloadInto` machinery the bulk orchestrator runs per record.
 *
 * This is a thin wrapper introduced ahead of its caller: later tasks widen
 * `deps` (scheduler, stall guard, field fates) and wire a form/CMA adapter in
 * front of it. It has no caller yet — `translateAndUpdateRecords` still runs
 * its own per-locale loop inline.
 *
 * @param record - CMA record to read source values from.
 * @param toLocales - Target locale keys, processed sequentially.
 * @param deps - Provider, plugin config, field dictionary, and per-call options.
 * @returns The merged payload and aggregated counters across all locales.
 */
export const translateRecordUnits = async (
  record: DatoCMSRecordFromAPI,
  toLocales: string[],
  deps: TranslateRecordUnitsDeps,
): Promise<RecordUnitsResult> => {
  const payload: Record<string, Record<string, unknown>> = {};
  const warnings: string[] = [];
  const referenceCopies: ReferenceCopy[] = [];
  const translatedFields: string[] = [];
  const qcFlags: QcFlag[] = [];
  const failedFields: { field: string; error: NormalizedProviderError }[] = [];
  const writtenLocales: Record<string, string[]> = {};
  let translatedFieldCount = 0;
  let referenceFieldsCopied = 0;
  let errorCount = 0;

  // One scheduler + pacer for the whole record run. A single record maps to a
  // single scheduler (§2.3-3), so field-level concurrency is bounded per
  // (record, locale) unit and never multiplied. Both are reused across every
  // target locale below. Callers may inject their own (tests do); otherwise we
  // derive the caps from the vendor tier exactly as the bulk orchestrator does.
  const scheduler =
    deps.options.scheduler ??
    createSlotScheduler({
      maxConcurrency: getMaxConcurrency(deps.pluginParams),
      spacingMs: getRequestSpacingMs(deps.pluginParams),
      sleep: deps.options.sleep,
    });
  const pacer =
    deps.options.pacer ?? createPacer(getRequestSpacingMs(deps.pluginParams));
  const options: BuildPayloadOptions = { ...deps.options, scheduler, pacer };

  for (const toLocale of toLocales) {
    // Per-locale gate check (Task 1 carry-forward): a locale with zero
    // translatable fields still honors cancellation, matching how the bulk
    // orchestrator's `translateForLocale` gates before each locale. Without it,
    // cancelling during an all-skipped locale would go unobserved until the
    // between-field gate of the next non-empty locale.
    // biome-ignore lint/performance/noAwaitInLoops: per-locale work is sequential — the gate must resolve and each locale's payload must merge before the next starts.
    if ((await deps.options.gate?.()) === 'cancelled') throw RUN_CANCELLED;

    const localeResult = await buildTranslatedUpdatePayload(
      record,
      deps.fromLocale,
      toLocale,
      deps.fieldDictionary,
      deps.provider,
      deps.pluginParams,
      deps.accessToken,
      deps.environment,
      options,
      deps.schemaRepository,
      deps.cmaBaseUrl,
    );

    mergeLocalePayloadInto(payload, localeResult.payload);
    warnings.push(...localeResult.warnings);
    referenceCopies.push(...localeResult.referenceCopies);
    qcFlags.push(...localeResult.qcFlags);
    failedFields.push(...localeResult.failedFields);
    translatedFields.push(...localeResult.translatedFields);
    translatedFieldCount += localeResult.translatedFieldCount;
    referenceFieldsCopied += localeResult.referenceFieldsCopied;
    errorCount += localeResult.errorCount;
    for (const [field, locales] of Object.entries(
      localeResult.writtenLocales,
    )) {
      writtenLocales[field] = [...(writtenLocales[field] ?? []), ...locales];
    }
  }

  return {
    payload,
    translatedFieldCount,
    referenceFieldsCopied,
    translatedFields,
    referenceCopies,
    warnings,
    errorCount,
    qcFlags,
    failedFields,
    writtenLocales,
  };
};

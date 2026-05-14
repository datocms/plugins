/**
 * translateRecordFields.ts
 * ------------------------------------------------------
 * This module provides functionality for batch translating all localizable fields
 * in a DatoCMS record from a source locale to multiple target locales.
 *
 * The module orchestrates the translation process by:
 * 1. Filtering fields to identify which ones are localizable and translatable
 * 2. Managing the translation workflow for each field-locale combination
 * 3. Providing real-time progress updates via callbacks
 * 4. Supporting cancellation of in-progress translations
 * 5. Automatically updating form values with translated content
 *
 * This serves as the foundation for the record-level translation features in the plugin.
 *
 * See also: `buildTranslatedUpdatePayload` in
 * `src/utils/translation/ItemsDropdownUtils.ts` for the table/bulk flow that
 * operates on CMA records and returns an update payload instead of writing to
 * the form via `ctx.setFieldValue(...)`.
 */

import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import {
  FIELD_TRANSLATION_TIMEOUT_MS,
  RATE_LIMIT_MAX_RETRIES,
  STREAM_THROTTLE_MS,
} from './constants';
import { createLogger } from './logging/Logger';
import {
  formatErrorForUser,
  normalizeProviderError,
} from './translation/ProviderErrors';
import { getProvider } from './translation/ProviderFactory';
import {
  getExactSourceValue,
  prepareFieldTypePrompt,
} from './translation/SharedFieldUtils';
import {
  generateRecordContext,
  translateFieldValue,
} from './translation/TranslateField';
import {
  calculateRateLimitBackoff,
  delay,
  getMaxConcurrency,
  getRequestSpacingMs,
  hasTranslatableSourceValue,
  isAbortError,
  isRateLimitError,
  shouldProcessField,
} from './translation/TranslationCore';
import type { TranslationProvider } from './translation/types';

// Options for the translation process. Provides callback hooks that allow the
// UI to respond to translation events and enables cancellation support for
// long-running translations.
// Uses the same CancellationOptions naming convention as TranslateBatchOptions
// in ItemsDropdownUtils.ts and StreamCallbacks in types.ts.
type TranslateOptions = {
  onStart?: (
    fieldLabel: string,
    locale: string,
    fieldPath: string,
    baseFieldPath: string,
  ) => void;
  onComplete?: (
    fieldLabel: string,
    locale: string,
    fieldPath: string,
    baseFieldPath: string,
  ) => void;
  onError?: (
    fieldLabel: string,
    locale: string,
    fieldPath: string,
    baseFieldPath: string,
    errorMessage: string,
  ) => void;
  onStream?: (
    fieldLabel: string,
    locale: string,
    fieldPath: string,
    baseFieldPath: string,
    content: string,
  ) => void;
  checkCancellation?: () => boolean;
  abortSignal?: AbortSignal;
};

/**
 * Determines whether a translation error is fatal for a given provider,
 * meaning further translation requests should not be attempted.
 *
 * @param vendor - The provider vendor identifier.
 * @param errorMessage - The normalized error message to check.
 * @returns True if the error is a known fatal error for the given vendor.
 */
function isFatalProviderError(vendor: string, errorMessage: string): boolean {
  if (vendor === 'deepl' && /wrong endpoint/i.test(errorMessage)) return true;
  if (vendor === 'openai' && /verified to stream/i.test(errorMessage))
    return true;
  return false;
}

/**
 * Parameters required to execute a single field-locale translation job.
 * Groups the mutable scheduler state and context alongside job-specific values
 * so they can be passed cleanly to `runFieldLocaleJob`.
 */
type RunJobParams = {
  fieldLabel: string;
  locale: string;
  fieldPath: string;
  baseFieldPath: string;
  sourceLocaleValue: unknown;
  fieldType: string;
  fieldId: string;
  fieldApiKey: string;
  fieldTypePrompt: string;
  pluginParams: ctxParamsType;
  sourceLocale: string;
  provider: TranslationProvider;
  accessToken: string;
  environment: string;
  cmaBaseUrl?: string;
  recordContext: string;
  options: TranslateOptions;
  lastStreamAt: Map<string, number>;
  nextFrame: () => Promise<void>;
  logger: ReturnType<typeof createLogger>;
  getFatalAbort: () => boolean;
  setFatalAbort: (value: boolean) => void;
  setFatalError: (err: Error) => void;
  setFieldValue: (path: string, value: unknown) => Promise<void>;
};

/**
 * Executes a single field-locale translation job: translates the source value
 * and writes the result back to the form via `setFieldValue`.
 * Handles streaming throttle, cancellation guards, abort errors, and fatal-error detection.
 *
 * @param params - All inputs and shared state required to run the job.
 */
async function runFieldLocaleJob(params: RunJobParams): Promise<void> {
  const {
    fieldLabel,
    locale,
    fieldPath,
    baseFieldPath,
    sourceLocaleValue,
    fieldType,
    fieldId,
    fieldApiKey,
    fieldTypePrompt,
    pluginParams,
    sourceLocale,
    provider,
    accessToken,
    environment,
    cmaBaseUrl,
    recordContext,
    options,
    lastStreamAt,
    nextFrame,
    logger,
    getFatalAbort,
    setFatalAbort,
    setFatalError,
    setFieldValue,
  } = params;

  if (getFatalAbort() || options.checkCancellation?.()) return;

  const start = performance.now?.() ?? Date.now();
  options.onStart?.(fieldLabel, locale, fieldPath, baseFieldPath);

  const streamCallbacks = {
    onStream: (chunk: string) => {
      const now = Date.now();
      const last = lastStreamAt.get(fieldPath) ?? 0;
      const isThrottled = now - last >= STREAM_THROTTLE_MS;
      if (isThrottled) {
        lastStreamAt.set(fieldPath, now);
        options.onStream?.(fieldLabel, locale, fieldPath, baseFieldPath, chunk);
      }
    },
    checkCancellation: options.checkCancellation,
    abortSignal: options.abortSignal,
  };

  try {
    const translatedFieldValue = await translateFieldWithTimeout(
      sourceLocaleValue,
      pluginParams,
      locale,
      sourceLocale,
      fieldType,
      provider,
      fieldTypePrompt,
      accessToken,
      fieldId,
      environment,
      cmaBaseUrl,
      streamCallbacks,
      recordContext,
      fieldApiKey,
    );

    if (getFatalAbort() || options.checkCancellation?.()) return;
    await nextFrame();
    if (getFatalAbort() || options.checkCancellation?.()) return;

    await setFieldValue(fieldPath, translatedFieldValue);
    options.onComplete?.(fieldLabel, locale, fieldPath, baseFieldPath);
    const end = performance.now?.() ?? Date.now();
    logger.info('Task finished', {
      fieldPath,
      ms: Math.round(end - start),
    });
  } catch (e) {
    if (isAbortError(e)) return;
    const norm = normalizeProviderError(e, provider.vendor);
    if (isFatalProviderError(provider.vendor, norm.message)) {
      const fatalErr = new Error(formatErrorForUser(norm));
      setFatalAbort(true);
      setFatalError(fatalErr);
      throw fatalErr;
    }
    throw e;
  }
}

/**
 * Type guard for DatoCMS single_block_blocks validator structure.
 *
 * @param validators - The validators object from a field's attributes.
 * @returns True if validators has the expected single_block_blocks structure.
 */
function hasSingleBlockBlocks(
  validators: unknown,
): validators is { single_block_blocks: { item_types: string[] } } {
  if (validators === null || typeof validators !== 'object') return false;
  const obj = validators as Record<string, unknown>;
  if (!obj.single_block_blocks || typeof obj.single_block_blocks !== 'object')
    return false;
  const sbb = obj.single_block_blocks as Record<string, unknown>;
  return Array.isArray(sbb.item_types);
}

/**
 * Translates a single field value with a timeout guard.
 * Wraps `translateFieldValue` in a `Promise.race` against a timeout promise so
 * a stalled API call does not block the scheduler indefinitely.
 *
 * @param sourceLocaleValue - The source field value to translate.
 * @param pluginParams - Plugin configuration parameters.
 * @param locale - Target locale code.
 * @param sourceLocale - Source locale code.
 * @param fieldType - DatoCMS field type editor identifier.
 * @param provider - Translation provider instance.
 * @param fieldTypePrompt - Prompt suffix for the field type.
 * @param accessToken - DatoCMS API access token.
 * @param fieldId - Field definition ID (for exclusion checking).
 * @param environment - Dato environment slug.
 * @param streamCallbacks - Streaming progress callbacks.
 * @param recordContext - Context string about the record.
 * @param fieldApiKey - Field API key (for exclusion checking).
 * @returns The translated field value.
 */
async function translateFieldWithTimeout(
  sourceLocaleValue: unknown,
  pluginParams: import('../entrypoints/Config/ConfigScreen').ctxParamsType,
  locale: string,
  sourceLocale: string,
  fieldType: string,
  provider: TranslationProvider,
  fieldTypePrompt: string,
  accessToken: string,
  fieldId: string,
  environment: string,
  cmaBaseUrl: string | undefined,
  streamCallbacks: Parameters<typeof translateFieldValue>[10],
  recordContext: string,
  fieldApiKey: string,
): Promise<unknown> {
  const translationPromise = translateFieldValue(
    sourceLocaleValue,
    pluginParams,
    locale,
    sourceLocale,
    fieldType,
    provider,
    fieldTypePrompt,
    accessToken,
    fieldId,
    environment,
    streamCallbacks,
    recordContext,
    undefined,
    {
      fieldApiKey,
      ...(cmaBaseUrl ? { cmaBaseUrl } : {}),
    },
  );

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `Field translation timed out after ${FIELD_TRANSLATION_TIMEOUT_MS / 1000} seconds`,
        ),
      );
    }, FIELD_TRANSLATION_TIMEOUT_MS);
  });

  return Promise.race([translationPromise, timeoutPromise]);
}

/**
 * Return type for findFieldValueAndPathImpl.
 */
type FieldValueAndPath = {
  value: unknown;
  basePath: string;
  isFramelessField?: boolean;
  framelessParentKey?: string;
};

/**
 * Searches for a nested field value inside a localized frameless block.
 * Iterates over locale keys in the parent object and extracts the nested field values.
 *
 * @param parentObj - The localized parent object (keyed by locale codes).
 * @param fieldApiKey - The API key of the nested field to find.
 * @param parentKey - The key under which the parent object lives in formValues.
 * @returns FieldValueAndPath if the nested field is found, or null.
 */
function searchNestedInLocaleBlock(
  parentObj: Record<string, unknown>,
  fieldApiKey: string,
  parentKey: string,
): FieldValueAndPath | null {
  const localeValues: Record<string, unknown> = {};
  let foundNested = false;

  for (const locale of Object.keys(parentObj)) {
    const localeContent = parentObj[locale];
    if (
      localeContent &&
      typeof localeContent === 'object' &&
      !Array.isArray(localeContent)
    ) {
      const nested = (localeContent as Record<string, unknown>)[fieldApiKey];
      if (nested !== undefined) {
        localeValues[locale] = nested;
        foundNested = true;
      }
    }
  }

  if (foundNested && Object.keys(localeValues).length > 0) {
    return {
      value: localeValues,
      basePath: fieldApiKey,
      isFramelessField: true,
      framelessParentKey: parentKey,
    };
  }
  return null;
}

/**
 * Searches candidate parent keys in formValues for a localized block containing the field.
 *
 * @param formValues - Current form values to search within.
 * @param candidateParents - Parent keys to check.
 * @param fieldApiKey - The field API key to search for.
 * @param localeSet - Set of known locale codes for fast lookup.
 * @returns FieldValueAndPath if the field is found nested inside a frameless block, or null.
 */
function searchFramelessParents(
  formValues: Record<string, unknown>,
  candidateParents: string[],
  fieldApiKey: string,
  localeSet: Set<string>,
): FieldValueAndPath | null {
  for (const parentKey of candidateParents) {
    const parentValue = formValues[parentKey];
    if (
      !parentValue ||
      typeof parentValue !== 'object' ||
      Array.isArray(parentValue)
    )
      continue;

    const parentObj = parentValue as Record<string, unknown>;
    const hasLocaleKeys = Object.keys(parentObj).some((k) => localeSet.has(k));
    if (!hasLocaleKeys) continue;

    const found = searchNestedInLocaleBlock(parentObj, fieldApiKey, parentKey);
    if (found) return found;
  }
  return null;
}

/**
 * Finds the value and path for a field, handling both top-level and nested frameless block fields.
 *
 * @param field - The field definition from ctx.fields.
 * @param formValues - Current form values to search within.
 * @param itemTypeId - The current record's item type ID (used to detect nested fields).
 * @param framelessParentsByItemType - Map of item type IDs to their parent frameless field keys.
 * @param localeSet - Set of known locale codes for fast lookup.
 * @returns Field value info or null if not found.
 */
function findFieldValueAndPathImpl(
  field: {
    attributes: { api_key: string };
    relationships?: { item_type?: { data?: { id?: string } } };
  },
  formValues: Record<string, unknown>,
  itemTypeId: string,
  framelessParentsByItemType: Map<string, string[]>,
  localeSet: Set<string>,
): FieldValueAndPath | null {
  const fieldApiKey = field.attributes.api_key;
  const fieldItemTypeId = field.relationships?.item_type?.data?.id;
  const isNestedBlockField = fieldItemTypeId && fieldItemTypeId !== itemTypeId;

  // First try: direct access (top-level fields)
  if (!isNestedBlockField) {
    const fieldValue = formValues[fieldApiKey];
    if (
      fieldValue &&
      typeof fieldValue === 'object' &&
      !Array.isArray(fieldValue)
    ) {
      return {
        value: fieldValue,
        basePath: fieldApiKey,
        isFramelessField: false,
      };
    }
  }

  // Second try: search inside frameless blocks
  const candidateParents =
    isNestedBlockField && fieldItemTypeId
      ? (framelessParentsByItemType.get(fieldItemTypeId) ?? [])
      : Object.keys(formValues);

  return searchFramelessParents(
    formValues,
    candidateParents,
    fieldApiKey,
    localeSet,
  );
}

/**
 * Builds the map from block item type ID to the list of localized frameless_single_block
 * field API keys that reference it. This is precomputed once per run to avoid O(n²)
 * lookups in the field-processing loop.
 *
 * @param fields - All field definitions from the DatoCMS sidebar context.
 * @returns Map from item type ID to array of frameless parent field api_keys.
 */
function buildFramelessParentsByItemType(
  fields: RenderItemFormSidebarPanelCtx['fields'],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const field of Object.values(fields)) {
    if (!field?.attributes) continue;
    const isFrameless =
      field.attributes.appearance.editor === 'frameless_single_block';
    if (!isFrameless || !field.attributes.localized) continue;
    const validators = field.attributes.validators;
    if (!hasSingleBlockBlocks(validators)) continue;
    for (const itemTypeId of validators.single_block_blocks.item_types) {
      const existing = result.get(itemTypeId) ?? [];
      existing.push(field.attributes.api_key);
      result.set(itemTypeId, existing);
    }
  }
  return result;
}

/**
 * Determines whether a field (which may belong to a different item type due to
 * frameless block nesting) should be treated as localized for translation purposes.
 *
 * @param field - The field definition to check.
 * @param currentItemTypeId - The item type ID of the record being translated.
 * @param allFields - All field definitions from the sidebar context.
 * @returns True if the field should be treated as localized.
 */
function resolveIsFieldLocalized(
  field: NonNullable<RenderItemFormSidebarPanelCtx['fields'][string]>,
  currentItemTypeId: string,
  allFields: RenderItemFormSidebarPanelCtx['fields'],
): boolean {
  if (field.attributes.localized) return true;

  const fieldItemTypeId = field.relationships?.item_type?.data?.id;
  if (!fieldItemTypeId || fieldItemTypeId === currentItemTypeId) return false;

  // Field belongs to a different item type (frameless block). Check if any
  // localized frameless_single_block field in the current item type references it.
  for (const framelessField of Object.values(allFields)) {
    if (!framelessField) continue;
    const isLocalized =
      framelessField.attributes?.appearance?.editor ===
        'frameless_single_block' && framelessField.attributes.localized;
    if (!isLocalized) continue;
    const validators = framelessField.attributes.validators;
    if (
      hasSingleBlockBlocks(validators) &&
      validators.single_block_blocks.item_types.includes(fieldItemTypeId)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Translates all eligible fields in a record to multiple target locales
 *
 * This function is the main entry point for batch translating record fields. It:
 * 1. Identifies which fields are localizable and configured for translation
 * 2. Extracts values from the source locale
 * 3. Translates each field to each target locale using the appropriate specialized translator
 * 4. Updates the form values with the translated content
 * 5. Provides progress feedback through the supplied callback functions
 *
 * Translation can be cancelled at any point using the checkCancellation callback
 * or the abortSignal.
 *
 * @param ctx - DatoCMS sidebar context providing access to form values and fields
 * @param pluginParams - Plugin configuration parameters
 * @param targetLocales - Array of locale codes to translate into
 * @param sourceLocale - Source locale code to translate from
 * @param options - Optional callbacks and cancellation controls
 * @returns Resolves when all translations are complete or cancelled
 */
export async function translateRecordFields(
  ctx: RenderItemFormSidebarPanelCtx,
  pluginParams: ctxParamsType,
  targetLocales: string[],
  sourceLocale: string,
  options: TranslateOptions = {},
): Promise<void> {
  const logger = createLogger(pluginParams, 'translateRecordFields');
  const provider: TranslationProvider = getProvider(pluginParams);
  const currentFormValues = ctx.formValues;
  const recordContext = generateRecordContext(currentFormValues, sourceLocale);

  // PERF: Convert locale array to Set for O(1) lookup instead of O(n)
  const localeSet = new Set<string>(
    (ctx.formValues.internalLocales as string[]) ?? [],
  );

  // Throttle streaming UI updates to ~30fps per fieldPath (uses constant from constants.ts)
  const lastStreamAt = new Map<string, number>();

  const framelessParentsByItemType = buildFramelessParentsByItemType(
    ctx.fields,
  );

  // Small helper to yield to the UI thread
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  // Build job list
  type Job = {
    id: string;
    fieldLabel: string;
    locale: string;
    baseFieldPath: string;
    run: () => Promise<void>;
    retries: number;
  };
  const jobs: Job[] = [];
  let fatalAbort = false;
  let fatalError: Error | null = null;

  /**
   * Creates a job that translates one field-locale combination and writes it back
   * to the form via ctx.setFieldValue.
   */
  function buildFieldLocaleJob(
    fieldLabel: string,
    locale: string,
    fieldPath: string,
    baseFieldPath: string,
    sourceLocaleValue: unknown,
    fieldType: string,
    fieldId: string,
    fieldApiKey: string,
    fieldTypePrompt: string,
  ): Job {
    return {
      id: fieldPath,
      fieldLabel,
      locale,
      baseFieldPath,
      retries: 0,
      run: () =>
        runFieldLocaleJob({
          fieldLabel,
          locale,
          fieldPath,
          baseFieldPath,
          sourceLocaleValue,
          fieldType,
          fieldId,
          fieldApiKey,
          fieldTypePrompt,
          pluginParams,
          sourceLocale,
          provider,
          accessToken: ctx.currentUserAccessToken as string,
          environment: ctx.environment,
          cmaBaseUrl: ctx.cmaBaseUrl,
          recordContext,
          options,
          lastStreamAt,
          nextFrame,
          logger,
          getFatalAbort: () => fatalAbort,
          setFatalAbort: (value) => {
            fatalAbort = value;
          },
          setFatalError: (err) => {
            fatalError = err;
          },
          setFieldValue: (path, value) => ctx.setFieldValue(path, value),
        }),
    };
  }

  /**
   * Data resolved for a field that is eligible for translation.
   * Returned by `resolveTranslatableFieldData` when all eligibility checks pass.
   */
  type TranslatableFieldData = {
    fieldType: string;
    fieldApiKey: string;
    fieldLabel: string;
    fieldId: string;
    basePath: string;
    isFramelessField: boolean | undefined;
    framelessParentKey: string | undefined;
    sourceLocaleValue: unknown;
  };

  /**
   * Validates a field against all eligibility criteria and extracts the data
   * needed to create translation jobs for it. Returns null if the field should
   * be skipped.
   */
  function resolveTranslatableFieldData(
    field: NonNullable<(typeof ctx.fields)[string]>,
  ): TranslatableFieldData | null {
    const fieldType = field.attributes.appearance.editor;
    const fieldApiKey = field.attributes.api_key;

    if (fieldType === 'frameless_single_block') return null;

    const isFieldLocalized = resolveIsFieldLocalized(
      field,
      ctx.itemType.id,
      ctx.fields,
    );
    const shouldTranslate = shouldProcessField(
      fieldType,
      field.id,
      pluginParams,
      fieldApiKey,
    );
    if (!isFieldLocalized || !shouldTranslate) return null;

    const fieldInfo = findFieldValueAndPathImpl(
      field,
      currentFormValues,
      ctx.itemType.id,
      framelessParentsByItemType,
      localeSet,
    );
    if (!fieldInfo) return null;

    const {
      value: fieldValue,
      basePath,
      isFramelessField,
      framelessParentKey,
    } = fieldInfo;
    const isValidObject =
      fieldValue &&
      typeof fieldValue === 'object' &&
      !Array.isArray(fieldValue);
    if (!isValidObject) return null;

    const sourceLocaleValue = getExactSourceValue(
      fieldValue as Record<string, unknown>,
      sourceLocale,
    );
    if (!hasTranslatableSourceValue(fieldType, sourceLocaleValue)) return null;

    return {
      fieldType,
      fieldApiKey,
      fieldLabel: field.attributes.label || fieldApiKey,
      fieldId: field.id,
      basePath,
      isFramelessField,
      framelessParentKey,
      sourceLocaleValue,
    };
  }

  /**
   * Appends one translation job per target locale for the given field data.
   */
  function appendLocaleJobs(data: TranslatableFieldData): void {
    const {
      fieldType,
      fieldApiKey,
      fieldLabel,
      fieldId,
      basePath,
      isFramelessField,
      framelessParentKey,
      sourceLocaleValue,
    } = data;
    const fieldTypePrompt = prepareFieldTypePrompt(fieldType);
    const hasFramelessParent = isFramelessField && framelessParentKey;

    for (const locale of targetLocales) {
      const fieldPath = hasFramelessParent
        ? `${framelessParentKey}.${locale}.${basePath}`
        : `${basePath}.${locale}`;
      const baseFieldPath = hasFramelessParent
        ? `${framelessParentKey}.${basePath}`
        : basePath;
      jobs.push(
        buildFieldLocaleJob(
          fieldLabel,
          locale,
          fieldPath,
          baseFieldPath,
          sourceLocaleValue,
          fieldType,
          fieldId,
          fieldApiKey,
          fieldTypePrompt,
        ),
      );
    }
  }

  /**
   * Processes a single field definition and appends locale-specific translation
   * jobs to the jobs array. Skips fields that are not eligible for translation.
   * Returns true if cancelled.
   */
  function buildJobsForField(
    field: NonNullable<(typeof ctx.fields)[string]>,
  ): boolean {
    if (options.checkCancellation?.()) return true;
    const data = resolveTranslatableFieldData(field);
    if (data) appendLocaleJobs(data);
    return false;
  }

  // Process all fields in the context and build the job list
  for (const field of Object.values(ctx.fields)) {
    if (!field?.attributes) continue;
    const cancelled = buildJobsForField(field);
    if (cancelled) return;
  }

  // Adaptive concurrency scheduler with simple AIMD (additive-increase, multiplicative-decrease)
  // Derive a sensible cap from the chosen model; scheduler auto-tunes under this
  const MAX_CAP = getMaxConcurrency(pluginParams);
  const REQUEST_SPACING = getRequestSpacingMs(pluginParams);
  let currentConcurrency = MAX_CAP; // start at configured cap
  let active = 0;
  let nextIndex = 0;
  let successStreak = 0;
  let lastRequestTime = 0; // Track last request time for spacing

  const isCancelled = () => !!options.checkCancellation?.();

  let resolveDone: () => void;
  let rejectDone: (err: Error) => void;
  const done = new Promise<void>((r, j) => {
    resolveDone = r;
    rejectDone = j;
  });

  /**
   * Runs one scheduling iteration: applies the configured request-spacing delay,
   * then dispatches the next job and wires up its completion callbacks.
   * Deliberately a standalone async function so there is no await inside
   * a loop — callers invoke this once per slot without looping over awaits.
   * The job index is captured synchronously before any await to avoid races.
   */
  const launchNextJob = async (idx: number) => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < REQUEST_SPACING && lastRequestTime > 0) {
      await delay(REQUEST_SPACING - timeSinceLastRequest);
    }
    lastRequestTime = Date.now();

    const job = jobs[idx];
    // active was already incremented by the schedule() caller before this
    // function was fired, so we do NOT increment it here again.
    job
      .run()
      .then(() => {
        successStreak += 1;
        if (successStreak >= 3 && currentConcurrency < MAX_CAP) {
          currentConcurrency += 1;
          successStreak = 0;
          logger.info('Increased concurrency', { currentConcurrency });
        }
      })
      .catch(async (err) => {
        successStreak = 0;
        if (fatalAbort) {
          // Stop scheduling further jobs
          nextIndex = jobs.length;
        } else if (
          isRateLimitError(err) &&
          job.retries < RATE_LIMIT_MAX_RETRIES
        ) {
          job.retries += 1;
          // Reduce concurrency aggressively on rate limit
          currentConcurrency = Math.max(1, Math.ceil(currentConcurrency / 2));
          // Calculate exponential backoff delay
          const backoffDelay = calculateRateLimitBackoff(job.retries);
          logger.warning('Rate limit detected; backing off', {
            job: job.id,
            retries: job.retries,
            maxRetries: RATE_LIMIT_MAX_RETRIES,
            backoffMs: backoffDelay,
            currentConcurrency,
          });
          // Wait with exponential backoff before requeueing
          await delay(backoffDelay);
          jobs.push(job);
        } else {
          // Job failed permanently - notify UI
          const norm = normalizeProviderError(err, provider.vendor);
          const errorMessage = formatErrorForUser(norm);
          logger.error('Job failed', { job: job.id, err, errorMessage });
          options.onError?.(
            job.fieldLabel,
            job.locale,
            job.id,
            job.baseFieldPath,
            errorMessage,
          );
        }
      })
      .finally(() => {
        active--;
        if (nextIndex >= jobs.length && active === 0) {
          if (fatalAbort && fatalError) rejectDone(fatalError);
          else resolveDone();
        } else {
          schedule();
        }
      });
  };

  /**
   * Fills available concurrency slots by firing launchNextJob for each empty
   * slot. Each invocation of launchNextJob is fire-and-forget — it increments
   * `active` itself, so counting slots before we fire is sufficient to avoid
   * over-committing without awaiting inside a loop.
   */
  const schedule = () => {
    if (isCancelled()) {
      if (active === 0) resolveDone();
      return;
    }
    const slotsAvailable = currentConcurrency - active;
    const jobsRemaining = jobs.length - nextIndex;
    const slotsToFill = Math.min(slotsAvailable, jobsRemaining);
    for (let s = 0; s < slotsToFill; s++) {
      active++;
      void launchNextJob(nextIndex++);
    }
  };

  schedule();
  await done;
}

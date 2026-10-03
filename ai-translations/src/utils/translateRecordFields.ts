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
import { buildDatoCMSClient } from './clients';
import { createSchemaRepository, type SchemaRepository } from './schemaRepository';
import { STREAM_THROTTLE_MS } from './constants';
import { createLogger } from './logging/Logger';
import {
  formatErrorForUser,
  isFatalProviderError,
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
  getMaxConcurrency,
  hasTranslatableSourceValue,
  isAbortError,
  shouldProcessField,
} from './translation/TranslationCore';
import {
  isProviderError,
  ProviderError,
  type TranslationProvider,
} from './translation/types';

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
 * Adds user-facing context to a fatal error without dropping provider metadata.
 */
function createFatalProviderError(
  error: unknown,
  message: string,
  provider: TranslationProvider,
): Error {
  if (isProviderError(error)) {
    return new ProviderError(
      message,
      error.status,
      error.vendor ?? provider.vendor,
      { cause: error },
    );
  }
  return new Error(message, { cause: error });
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
  schemaRepository: SchemaRepository;
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
    schemaRepository,
    options,
    lastStreamAt,
    nextFrame,
    logger,
    getFatalAbort,
    setFatalAbort,
    setFatalError,
    setFieldValue,
  } = params;

  if (getFatalAbort() || options.abortSignal?.aborted || options.checkCancellation?.()) return;

  const start = performance.now?.() ?? Date.now();
  options.onStart?.(fieldLabel, locale, fieldPath, baseFieldPath);

  const streamCallbacks = {
    onStream: (chunk: string) => {
      if (getFatalAbort() || options.abortSignal?.aborted || options.checkCancellation?.()) return;
      const now = Date.now();
      const last = lastStreamAt.get(fieldPath) ?? 0;
      const isThrottled = now - last >= STREAM_THROTTLE_MS;
      if (isThrottled) {
        lastStreamAt.set(fieldPath, now);
        options.onStream?.(fieldLabel, locale, fieldPath, baseFieldPath, chunk);
      }
    },
    checkCancellation: () => getFatalAbort() || !!options.checkCancellation?.(),
    abortSignal: options.abortSignal,
  };

  try {
    logger.info('Source field payload', {
      flow: 'sidebar',
      fieldPath,
      baseFieldPath,
      fieldLabel,
      fieldId,
      fieldApiKey,
      fieldType,
      sourceLocale,
      targetLocale: locale,
      value: sourceLocaleValue,
    });
    const translatedFieldValue = await translateFieldValue(
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
      schemaRepository,
      { fieldApiKey, cmaBaseUrl },
    );

    if (getFatalAbort() || options.abortSignal?.aborted || options.checkCancellation?.()) return;
    await nextFrame();
    if (getFatalAbort() || options.abortSignal?.aborted || options.checkCancellation?.()) return;

    logger.info('Translated field payload', {
      flow: 'sidebar',
      fieldPath,
      baseFieldPath,
      fieldLabel,
      fieldId,
      fieldApiKey,
      fieldType,
      sourceLocale,
      targetLocale: locale,
      value: translatedFieldValue,
    });
    logger.info('Form write payload', {
      flow: 'sidebar',
      fieldPath,
      baseFieldPath,
      fieldLabel,
      fieldId,
      fieldApiKey,
      fieldType,
      sourceLocale,
      targetLocale: locale,
      value: translatedFieldValue,
    });
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
    if (isFatalProviderError(provider.vendor, norm)) {
      const message = formatErrorForUser(norm);
      const fatalErr = createFatalProviderError(e, message, provider);
      setFatalAbort(true);
      setFatalError(fatalErr);
      throw fatalErr;
    }
    throw e;
  } finally {
    lastStreamAt.delete(fieldPath);
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
  currentItemTypeId: string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const field of Object.values(fields)) {
    if (!field?.attributes) continue;
    const owner = field.relationships?.item_type?.data?.id;
    if (owner && owner !== currentItemTypeId) continue;
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
  framelessParentsByItemType: Map<string, string[]>,
): boolean {
  if (field.attributes.localized) return true;
  const fieldItemTypeId = field.relationships?.item_type?.data?.id;
  return !!fieldItemTypeId && fieldItemTypeId !== currentItemTypeId && framelessParentsByItemType.has(fieldItemTypeId);

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
    ctx.itemType.id,
  );

  // Small helper to yield to the UI thread
  const nextFrame = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  const locales = Array.from(new Set(targetLocales)).filter(
    (locale) => locale.toLowerCase() !== sourceLocale.toLowerCase(),
  );
  const isCancelled = () => !!(options.abortSignal?.aborted || options.checkCancellation?.());
  if (locales.length === 0 || isCancelled()) return;
  const schemaRepository = createSchemaRepository(buildDatoCMSClient(
    ctx.currentUserAccessToken as string, ctx.environment, ctx.cmaBaseUrl,
  ));

  // Build only field snapshots; locale jobs are created as workers pull them.
  type Job = {
    id: string;
    fieldLabel: string;
    locale: string;
    baseFieldPath: string;
    run: () => Promise<void>;
  };
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
          schemaRepository,
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
      framelessParentsByItemType,
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

  const fieldsToTranslate: TranslatableFieldData[] = [];
  for (const field of Object.values(ctx.fields)) {
    if (isCancelled()) return;
    if (!field?.attributes) continue;
    const data = resolveTranslatableFieldData(field);
    if (data) fieldsToTranslate.push(data);
  }
  const totalJobs = fieldsToTranslate.length * locales.length;
  if (totalJobs === 0) return;
  let nextJobIndex = 0;

  function pullJob(): Job | undefined {
    if (fatalAbort || isCancelled() || nextJobIndex >= totalJobs) return undefined;
    const index = nextJobIndex++;
    const data = fieldsToTranslate[Math.floor(index / locales.length)];
    const locale = locales[index % locales.length];
    const hasFramelessParent = data.isFramelessField && data.framelessParentKey;
    const fieldPath = hasFramelessParent
      ? `${data.framelessParentKey}.${locale}.${data.basePath}`
      : `${data.basePath}.${locale}`;
    const baseFieldPath = hasFramelessParent
      ? `${data.framelessParentKey}.${data.basePath}`
      : data.basePath;
    return buildFieldLocaleJob(
      data.fieldLabel, locale, fieldPath, baseFieldPath, data.sourceLocaleValue,
      data.fieldType, data.fieldId, data.fieldApiKey,
      prepareFieldTypePrompt(data.fieldType),
    );
  }

  async function worker(): Promise<void> {
    let job = pullJob();
    while (job) {
      try {
        // Retries belong to individual provider requests. Replaying this job
        // would bill successful chunks of a large field a second time.
        // biome-ignore lint/performance/noAwaitInLoops: workers keep queued field/locale work bounded.
        await job.run();
      } catch (error) {
        if (!fatalAbort && !isCancelled() && !isAbortError(error)) {
          const message = formatErrorForUser(normalizeProviderError(error, provider.vendor));
          logger.error('Job failed', { job: job.id, error, errorMessage: message });
          options.onError?.(job.fieldLabel, job.locale, job.id, job.baseFieldPath, message);
        }
      }
      job = pullJob();
    }
  }

  // Every started worker settles before returning, including cancellation and
  // fatal errors, so callers cannot observe late form writes after completion.
  await Promise.all(Array.from({ length: Math.min(getMaxConcurrency(pluginParams), totalJobs) }, () => worker()));
  if (fatalError) throw fatalError;
}

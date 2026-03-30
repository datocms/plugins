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
import type { TranslationProvider } from './translation/types';
import { getProvider } from './translation/ProviderFactory';
import {
  type ctxParamsType,
} from '../entrypoints/Config/ConfigScreen';
import { prepareFieldTypePrompt, getExactSourceValue } from './translation/SharedFieldUtils';
import { translateFieldValue, generateRecordContext } from './translation/TranslateField';
import { createLogger } from './logging/Logger';
import { normalizeProviderError, formatErrorForUser } from './translation/ProviderErrors';
import {
  getMaxConcurrency,
  getRequestSpacingMs,
  calculateRateLimitBackoff,
  hasTranslatableSourceValue,
  isAbortError,
  isRateLimitError,
  shouldProcessField,
  delay,
} from './translation/TranslationCore';
import { FIELD_TRANSLATION_TIMEOUT_MS, STREAM_THROTTLE_MS, RATE_LIMIT_MAX_RETRIES } from './constants';

// Options for the translation process. Provides callback hooks that allow the
// UI to respond to translation events and enables cancellation support for
// long-running translations.
// Uses the same CancellationOptions naming convention as TranslateBatchOptions
// in ItemsDropdownUtils.ts and StreamCallbacks in types.ts.
type TranslateOptions = {
  onStart?: (fieldLabel: string, locale: string, fieldPath: string, baseFieldPath: string) => void;
  onComplete?: (fieldLabel: string, locale: string, fieldPath: string, baseFieldPath: string) => void;
  onError?: (fieldLabel: string, locale: string, fieldPath: string, baseFieldPath: string, errorMessage: string) => void;
  onStream?: (
    fieldLabel: string,
    locale: string,
    fieldPath: string,
    baseFieldPath: string,
    content: string
  ) => void;
  checkCancellation?: () => boolean;
  abortSignal?: AbortSignal;
};

/**
 * Type guard for DatoCMS single_block_blocks validator structure.
 *
 * @param validators - The validators object from a field's attributes.
 * @returns True if validators has the expected single_block_blocks structure.
 */
function hasSingleBlockBlocks(
  validators: unknown
): validators is { single_block_blocks: { item_types: string[] } } {
  if (validators === null || typeof validators !== 'object') return false;
  const obj = validators as Record<string, unknown>;
  if (!obj.single_block_blocks || typeof obj.single_block_blocks !== 'object') return false;
  const sbb = obj.single_block_blocks as Record<string, unknown>;
  return Array.isArray(sbb.item_types);
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
  options: TranslateOptions = {}
): Promise<void> {
  const logger = createLogger(pluginParams, 'translateRecordFields');
  // Resolve provider (OpenAI for now)
  const provider: TranslationProvider = getProvider(pluginParams);

  const currentFormValues = ctx.formValues;

  // Precompute record context once per run (was recomputed per field-locale)
  const recordContext = generateRecordContext(currentFormValues, sourceLocale);

  // PERF: Convert locale array to Set for O(1) lookup instead of O(n)
  const localeSet = new Set<string>(ctx.formValues.internalLocales as string[] ?? []);

  // Throttle streaming UI updates to ~30fps per fieldPath (uses constant from constants.ts)
  const lastStreamAt = new Map<string, number>();

  // Map block item type ID -> array of frameless_single_block field api_keys that reference it
  const framelessParentsByItemType = new Map<string, string[]>();
  for (const field of Object.values(ctx.fields)) {
    if (!field?.attributes) continue;
    if (field.attributes.appearance.editor !== 'frameless_single_block') continue;
    if (!field.attributes.localized) continue;
    const validators = field.attributes.validators;
    if (!hasSingleBlockBlocks(validators)) continue;
    for (const itemTypeId of validators.single_block_blocks.item_types) {
      const existing = framelessParentsByItemType.get(itemTypeId) ?? [];
      existing.push(field.attributes.api_key);
      framelessParentsByItemType.set(itemTypeId, existing);
    }
  }

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
   * Finds the value and path for a field, handling both top-level and nested frameless block fields.
   *
   * This helper is intentionally kept inline because it requires access to ctx.formValues.internalLocales
   * and the specific form structure. Extracting it would require passing many parameters without
   * improving testability, since it's inherently coupled to DatoCMS form value shapes.
   *
   * @param field - The field definition from ctx.fields.
   * @param formValues - Current form values to search within.
   * @returns Field value info or null if not found.
   */
  const findFieldValueAndPath = (
    field: NonNullable<typeof ctx.fields[string]>,
    formValues: Record<string, unknown>
  ): { value: unknown; basePath: string; isFramelessField?: boolean; framelessParentKey?: string } | null => {
    const fieldApiKey = field.attributes.api_key;
    const fieldItemTypeId = field.relationships?.item_type?.data?.id;
    const isNestedBlockField = fieldItemTypeId && fieldItemTypeId !== ctx.itemType.id;
    
    // First try: direct access (top-level fields)
    if (!isNestedBlockField) {
      const fieldValue = formValues[fieldApiKey];
      if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
        return { value: fieldValue, basePath: fieldApiKey, isFramelessField: false };
      }
    }
    
    // Second try: search inside frameless blocks
    const candidateParents = isNestedBlockField && fieldItemTypeId
      ? framelessParentsByItemType.get(fieldItemTypeId) ?? []
      : Object.keys(formValues);

    for (const parentKey of candidateParents) {
      const parentValue = formValues[parentKey];
      if (parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)) {
        const parentObj = parentValue as Record<string, unknown>;
        
        // Check if this might be a frameless block (has locale keys)
        // Uses localeSet (defined at function start) for O(1) lookup
        const hasLocaleKeys = Object.keys(parentObj).some(k => localeSet.has(k));
        
        if (hasLocaleKeys) {
          // This looks like a localized field, check if it contains our nested field
          // Structure: { en: { nestedField: value }, it: { nestedField: value } }
          const localeValues: Record<string, unknown> = {};
          let foundNested = false;
          
          for (const locale of Object.keys(parentObj)) {
            const localeContent = parentObj[locale];
            if (localeContent && typeof localeContent === 'object' && !Array.isArray(localeContent)) {
              const nested = (localeContent as Record<string, unknown>)[fieldApiKey];
              if (nested !== undefined) {
                localeValues[locale] = nested;
                foundNested = true;
              }
            }
          }
          
          if (foundNested && Object.keys(localeValues).length > 0) {
            // Found the field nested inside a frameless block
            // Return the parentKey as basePath and mark it as a frameless field
            return { 
              value: localeValues, 
              basePath: fieldApiKey,
              isFramelessField: true,
              framelessParentKey: parentKey
            };
          }
        }
      }
    }
    
    return null;
  };

  // Process all fields in the context
  for (const field of Object.values(ctx.fields)) {
    if (!field || !field.attributes) {
      continue;
    }
    
    // Check for user-initiated cancellation
    if (options.checkCancellation?.()) {
      return;
    }
    
    const fieldType = field.attributes.appearance.editor;
    const fieldApiKey = field.attributes.api_key;
    const fieldLabel = field.attributes.label || fieldApiKey;
    
    // Skip frameless_single_block fields themselves (we translate their nested fields instead)
    if (fieldType === 'frameless_single_block') {
      continue;
    }

    // Check if this field is part of a frameless block
    // If so, check if any frameless block field in the form is localized
    let isFieldLocalized = field.attributes.localized;
    if (!isFieldLocalized) {
      // Check if this field belongs to a frameless block model
      const fieldItemTypeId = field.relationships?.item_type?.data?.id;
      if (fieldItemTypeId && fieldItemTypeId !== ctx.itemType.id) {
        // This field belongs to a different item type, likely a frameless block
        // Check if there's a frameless_single_block field in the current item type that references this model
        const framelessFields = Object.values(ctx.fields).filter(
          f => f?.attributes?.appearance?.editor === 'frameless_single_block' && f.attributes.localized
        );
        for (const framelessField of framelessFields) {
          if (!framelessField) continue;
          // Check if this frameless field's validations reference our field's item type
          const validators = framelessField.attributes.validators;
          if (hasSingleBlockBlocks(validators) && validators.single_block_blocks.item_types.includes(fieldItemTypeId)) {
            isFieldLocalized = true;
            break;
          }
        }
      }
    }
    
    // Skip fields that are not translatable, not localized, or explicitly excluded
    if (
      !isFieldLocalized ||
      !shouldProcessField(fieldType, field.id, pluginParams, fieldApiKey)
    ) {
      continue;
    }

    // Find the field value (handles both top-level and nested frameless fields)
    const fieldInfo = findFieldValueAndPath(field, currentFormValues);
    if (!fieldInfo) {
      continue;
    }

    const { value: fieldValue, basePath, isFramelessField, framelessParentKey } = fieldInfo;

    // Skip if field is not an object of localized values
    if (!(fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue))) {
      continue;
    }

    // Resolve exact-cased locale key and pull its value
    const sourceLocaleValue = getExactSourceValue(
      fieldValue as Record<string, unknown>,
      sourceLocale
    );

    if (!hasTranslatableSourceValue(fieldType, sourceLocaleValue)) {
      continue;
    }

    // Process each target locale for this field
    for (const locale of targetLocales) {
      // Construct the correct path based on whether this is a frameless field or not
      // For frameless fields: framelessParentKey.locale.fieldApiKey (e.g., details.it.subtitle)
      // For regular fields: fieldApiKey.locale (e.g., name.it)
      const fieldPath = isFramelessField && framelessParentKey
        ? `${framelessParentKey}.${locale}.${basePath}`
        : `${basePath}.${locale}`;
      const baseFieldPath = isFramelessField && framelessParentKey
        ? `${framelessParentKey}.${basePath}`
        : basePath;
      const fieldTypePrompt = prepareFieldTypePrompt(fieldType);

      jobs.push({ id: fieldPath, fieldLabel, locale, baseFieldPath, retries: 0, run: async () => {
        // Cancellation check before starting
        if (fatalAbort || options.checkCancellation?.()) return;

        const start = performance.now?.() ?? Date.now();
        options.onStart?.(fieldLabel, locale, fieldPath, baseFieldPath);

        // Set up streaming callbacks
        const streamCallbacks = {
          onStream: (chunk: string) => {
            const now = Date.now();
            const last = lastStreamAt.get(fieldPath) ?? 0;
            if (now - last >= STREAM_THROTTLE_MS) {
              lastStreamAt.set(fieldPath, now);
              options.onStream?.(fieldLabel, locale, fieldPath, baseFieldPath, chunk);
            }
          },
          checkCancellation: options.checkCancellation,
          abortSignal: options.abortSignal,
        };

        // Perform translation with timeout protection
        try {
          // Wrap translation in a timeout Promise to prevent indefinite hangs
          // Note: timeoutMs is passed to providers via StreamOptions internally,
          // but the overall field timeout is handled by Promise.race below
          const translationPromise = translateFieldValue(
            sourceLocaleValue,
            pluginParams,
            locale,
            sourceLocale,
            fieldType,
            provider,
            fieldTypePrompt,
            ctx.currentUserAccessToken as string,
            field.id,
            ctx.environment,
            streamCallbacks,
            recordContext,
            undefined,
            {
              fieldApiKey,
            }
          );

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Field translation timed out after ${FIELD_TRANSLATION_TIMEOUT_MS / 1000} seconds`));
            }, FIELD_TRANSLATION_TIMEOUT_MS);
          });

          const translatedFieldValue = await Promise.race([translationPromise, timeoutPromise]);

          // Check cancellation before writing
          if (fatalAbort || options.checkCancellation?.()) return;
          await nextFrame();
          if (fatalAbort || options.checkCancellation?.()) return;
          
          await ctx.setFieldValue(fieldPath, translatedFieldValue);
          options.onComplete?.(fieldLabel, locale, fieldPath, baseFieldPath);
          const end = performance.now?.() ?? Date.now();
          logger.info('Task finished', { fieldPath, ms: Math.round(end - start) });
        } catch (e) {
          if (isAbortError(e)) {
            return;
          }
          const norm = normalizeProviderError(e, provider.vendor);
          if (provider.vendor === 'deepl' && /wrong endpoint/i.test(norm.message)) {
            fatalAbort = true;
            fatalError = new Error(formatErrorForUser(norm));
            throw fatalError;
          }
          if (provider.vendor === 'openai' && /verified to stream/i.test(norm.message)) {
            fatalAbort = true;
            fatalError = new Error(formatErrorForUser(norm));
            throw fatalError;
          }
          throw e;
        }
      }});
    }
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
  let rejectDone: (e: any) => void;
  const done = new Promise<void>((r, j) => { resolveDone = r; rejectDone = j; });

  const schedule = async () => {
    if (isCancelled()) {
      if (active === 0) resolveDone();
      return;
    }
    while (active < currentConcurrency && nextIndex < jobs.length) {
      // Add request spacing to prevent rate limit bursts
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      if (timeSinceLastRequest < REQUEST_SPACING && lastRequestTime > 0) {
        // Wait before starting the next request
        await delay(REQUEST_SPACING - timeSinceLastRequest);
      }
      lastRequestTime = Date.now();

      const idx = nextIndex++;
      const job = jobs[idx];
      active++;
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
          } else if (isRateLimitError(err) && job.retries < RATE_LIMIT_MAX_RETRIES) {
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
            options.onError?.(job.fieldLabel, job.locale, job.id, job.baseFieldPath, errorMessage);
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
    }
  };

  schedule();
  await done;
}

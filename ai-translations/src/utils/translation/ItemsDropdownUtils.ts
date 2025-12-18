/**
 * Utilities for handling DatoCMS record translations via dropdown actions
 */
import type { buildClient } from '@datocms/cma-client-browser';
import type { TranslationProvider } from './types';
import { normalizeProviderError } from './ProviderErrors';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
// no specific ctx type required here; we accept a minimal ctx shape
import { translateFieldValue, generateRecordContext } from './TranslateField';
import { prepareFieldTypePrompt, getExactSourceValue, type FieldTypeDictionary } from './SharedFieldUtils';

/**
 * Defines a DatoCMS record structure with common fields
 */
export type DatoCMSRecordFromAPI = {
  id: string;
  item_type: { id: string };
  [key: string]: unknown;
};

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
function deriveRecordLabel(record: DatoCMSRecordFromAPI, preferredLocale: string): string {
  const candidates = [
    'title',
    'name',
    'headline',
    'heading',
    'label',
    'internal_name',
    'internalName',
    'slug',
  ];

  const coerceToString = (val: unknown): string | null => {
    if (val == null) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val)) return val.filter((x) => typeof x === 'string')[0] || null;
    // Objects may be localized maps; try locale or any string value
    if (typeof val === 'object') {
      const localized = val as Record<string, unknown>;
      const exact = getExactSourceValue(localized, preferredLocale);
      if (typeof exact === 'string' && exact.trim()) return exact;
      for (const v of Object.values(localized)) {
        if (typeof v === 'string' && v.trim()) return v;
      }
    }
    return null;
  };

  for (const key of candidates) {
    if (record[key] !== undefined) {
      const s = coerceToString(record[key]);
      if (s && s.trim()) {
        const trimmed = s.trim();
        return trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed;
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
export function parseActionId(actionId: string): { fromLocale: string; toLocale: string } {
  // Action ID format is: "translateRecord-${fromLocale}-${toLocale}"
  const prefix = 'translateRecord-';
  const localesString = actionId.startsWith(prefix) ? actionId.substring(prefix.length) : actionId;

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
  itemIds: string[]
): Promise<DatoCMSRecordFromAPI[]> {
  const allRecords: DatoCMSRecordFromAPI[] = [];
  let page = 1;
  const pageSize = 30;
  let hasMorePages = true;
  
  while (hasMorePages) {
    const response: DatoCMSRecordFromAPI[] = await client.items.list({
      filter: {
        ids: itemIds.join(',')
      },
      nested: true,
      version: 'current', // Explicitly request the draft/current version
      page: {
        offset: (page - 1) * pageSize,
        limit: pageSize
      }
    });
    
    allRecords.push(...response);
    hasMorePages = response.length === pageSize;
    page++;
  }
  
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
  return Object.values(obj).some(value => {
    if (typeof value === 'object' && value !== null) {
      return hasKeyDeep(value as Record<string, unknown>, targetKey);
    }
    return false;
  });
}

/**
 * Status flags for batch translation steps.
 */
export type ProgressStatus = 'processing' | 'completed' | 'error';

/**
 * Progress event payload describing the per-record state.
 */
export type ProgressUpdate = {
  recordIndex: number;
  recordId: string;
  status: ProgressStatus;
  message?: string;
};

/**
 * Options for batch translation flow, including progress and cancellation.
 */
export type TranslateBatchOptions = {
  onProgress?: (update: ProgressUpdate) => void;
  checkCancelled?: () => boolean;
  abortSignal?: AbortSignal;
};


/**
 * Returns a user-friendly message for known DatoCMS API errors.
 * Specifically maps ITEM_LOCKED (422) to clear guidance that no one can be
 * editing the record to apply the translation.
 *
 * @param error - The error thrown during the CMA request.
 * @param recordId - Identifier of the record that failed to update.
 * @returns A user-friendly message or null when no mapping matches.
 */
function getFriendlyDatoErrorMessage(error: unknown, recordId: string): string | null {
  const anyErr = error as any;
  const candidates =
    anyErr?.response?.data?.errors ||
    anyErr?.response?.errors ||
    anyErr?.data?.errors ||
    anyErr?.errors;

  const extractCode = (e: any) => e?.attributes?.code || e?.code || null;

  try {
    if (Array.isArray(candidates)) {
      const codes: Array<string | null> = candidates.map(extractCode);
      if (codes.includes('ITEM_LOCKED')) {
        return `Cannot save translations for record ${recordId}: the record is locked because it is being edited. Please ensure no one (including you in another tab) is editing the record in DatoCMS, then try again.`;
      }
    }

    const msg: string | undefined =
      typeof anyErr?.message === 'string' ? anyErr.message : undefined;
    if (msg && msg.includes('ITEM_LOCKED')) {
      return `Cannot save translations for record ${recordId}: the record is locked because it is being edited. Please ensure no one is editing the record, then try again.`;
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
 * @param records - Records to translate.
 * @param client - CMA client.
 * @param provider - TranslationProvider for field translation.
 * @param fromLocale - Source locale key.
 * @param toLocale - Target locale key.
 * @param getFieldTypeDictionary - Async getter that returns a FieldTypeDictionary per item type.
 * @param pluginParams - Plugin configuration parameters.
 * @param ctx - Minimal context for alerts and environment.
 * @param accessToken - Current user API token for DatoCMS.
 * @param options - Optional callbacks and AbortSignal for cancellation.
 */
export async function translateAndUpdateRecords(
  records: DatoCMSRecordFromAPI[],
  client: ReturnType<typeof buildClient>,
  provider: TranslationProvider,
  fromLocale: string,
  toLocale: string,
  getFieldTypeDictionary: (itemTypeId: string) => Promise<FieldTypeDictionary>,
  pluginParams: ctxParamsType,
  ctx: { alert: (msg: string) => void; environment: string },
  accessToken: string,
  options: TranslateBatchOptions = {}
): Promise<void> {
  const updateProgress = (u: ProgressUpdate) => {
    // Normalize legacy in-progress message that included the word "fields"
    if (u.status === 'processing' && typeof u.message === 'string') {
      u = { ...u, message: u.message.replace(/\s*fields…$/, '…') };
    }
    options.onProgress?.(u);
  };

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const recordLabel = deriveRecordLabel(record, fromLocale);

    // Cooperative cancellation
    if (options.checkCancelled?.()) {
      updateProgress({ recordIndex: i, recordId: record.id, status: 'error', message: `Translation cancelled for "${recordLabel}" (#${record.id}).` });
      return;
    }

    updateProgress({ recordIndex: i, recordId: record.id, status: 'processing', message: `Translating "${recordLabel}" (#${record.id})…` });

    try {
      // Check if the record has the fromLocale key
      if (!hasKeyDeep(record as Record<string, unknown>, fromLocale)) {
        const errorMsg = `Record "${recordLabel}" (#${record.id}) does not have the source locale '${fromLocale}'`;
        console.error(`Record ${record.id} ${errorMsg}`);
        ctx.alert(`Error: Record ID ${record.id} ${errorMsg}`);
        updateProgress({ recordIndex: i, recordId: record.id, status: 'error', message: errorMsg });
        continue;
      }

      updateProgress({ recordIndex: i, recordId: record.id, status: 'processing', message: `Translating "${recordLabel}" (#${record.id}) fields…` });

      const fieldTypeDictionary = await getFieldTypeDictionary(record.item_type.id);

      const translatedFields = await buildTranslatedUpdatePayload(
        record,
        fromLocale,
        toLocale,
        fieldTypeDictionary,
        provider,
        pluginParams,
        accessToken,
        ctx.environment,
        { abortSignal: options.abortSignal, checkCancelled: options.checkCancelled }
      );

      updateProgress({ recordIndex: i, recordId: record.id, status: 'processing', message: `Saving "${recordLabel}" (#${record.id})…` });

      await client.items.update(record.id, {
        ...translatedFields
      });

      // Provide a message including the record label so the UI shows useful text
      updateProgress({ 
        recordIndex: i, 
        recordId: record.id, 
        status: 'completed', 
        message: `Translated "${recordLabel}" (#${record.id}).`
      });
    } catch (error) {
      // Try to detect DatoCMS-specific error codes for clearer UX
      const friendlyMessage = getFriendlyDatoErrorMessage(error, record.id);
      const rawMessage = error instanceof Error ? error.message : String(error);

      console.error(`Error translating record ${record.id}:`, rawMessage);
      updateProgress({
        recordIndex: i,
        recordId: record.id,
        status: 'error',
        message: friendlyMessage ?? `Failed "${recordLabel}" (#${record.id}): ${rawMessage}`,
      });
    }
  }
}

/**
 * Builds an update payload with translated values for an API-fetched record.
 *
 * Context: table/bulk actions using CMA records (client.items.*). Returns a
 * payload suitable for `client.items.update(recordId, payload)`.
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
 * @param opts - Optional AbortSignal and cancellation function.
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
  opts: { abortSignal?: AbortSignal; checkCancelled?: () => boolean } = {}
): Promise<Record<string, unknown>> {
  const updatePayload: Record<string, Record<string, unknown>> = {};
  const excludedFieldIds = new Set(pluginParams.apiKeysToBeExcludedFromThisPlugin ?? []);

  // Initialize payload with all localized fields from the record's schema
  // to ensure they are all considered.
  for (const fieldApiKey in fieldTypeDictionary) {
    if (fieldTypeDictionary[fieldApiKey].isLocalized) {
      // Start with existing localized data for this field from the record, or empty object.
      updatePayload[fieldApiKey] = (record[fieldApiKey] as Record<string, unknown>) || {};
    }
  }

  // Process fields that are present on the record and should be translated
  for (const field in record) {
    const fieldMeta = fieldTypeDictionary[field];

    if (!fieldMeta?.isLocalized) {
      // Skip non-localized fields or fields not in the current item type's schema dictionary
      continue;
    }

    // Ensure the field is initialized in updatePayload if it wasn't caught by the first loop
    // (e.g. fieldTypeDictionary might be from a slightly different source than live record keys)
    if (!updatePayload[field]) {
      updatePayload[field] = (record[field] as Record<string, unknown>) || {};
    }

    // Respect field exclusion list configured in the plugin settings
    if (excludedFieldIds.has(fieldMeta.id)) {
      // Preserve existing target locale value when present and skip translation
      const existing = (record[field] as Record<string, unknown>) || {};
      if (existing && toLocale in existing) {
        updatePayload[field][toLocale] = existing[toLocale];
      }
      continue;
    }

    if (!shouldTranslateField(field, record, fromLocale, fieldTypeDictionary)) {
      // If not translatable (e.g., source empty), but is localized, ensure toLocale: null is set
      // if it's not already present.
      if (!(toLocale in updatePayload[field])) {
         updatePayload[field][toLocale] = null;
      }
      continue;
    }

    // At this point, field is localized and should be translated.
    // updatePayload[field] already contains other locales from the initialization loop or record.

    // Handle hyphenated locales by finding the exact field key that matches the fromLocale
    const sourceValue = getExactSourceValue(record[field] as Record<string, unknown>, fromLocale);

    const fieldType = fieldTypeDictionary[field].editor;
    const fieldTypePrompt = prepareFieldTypePrompt(fieldType);

    try {
      if (sourceValue === null || sourceValue === undefined || sourceValue === '') {
        updatePayload[field][toLocale] = null;
      } else {
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
          { abortSignal: opts.abortSignal, checkCancellation: opts.checkCancelled },
          generateRecordContext(record, fromLocale)
        );
        // Ensure we use the exact case-sensitive toLocale key as expected by DatoCMS
        updatePayload[field][toLocale] = translatedValue;
      }
    } catch (error) {
      // On error during translation for this specific field, set its target locale to null.
      updatePayload[field][toLocale] = null;
      const norm = normalizeProviderError(error, provider.vendor);
      console.error(`Error translating field ${field} for record ${record.id}: ${norm.message}`);
      // Depending on desired behavior, you might want to collect these errors
      // or re-throw if one field error should stop the whole batch.
      // For now, it just sets to null and continues.
    }
  }
  
  // Final check: Ensure all localized fields defined in the schema have the toLocale key.
  // This catches localized fields that might not have been on the original `record` object
  // or were not processed in the loop above for any reason.
  for (const fieldApiKey in fieldTypeDictionary) {
    const fieldMeta = fieldTypeDictionary[fieldApiKey];
    if (fieldMeta.isLocalized) {
      if (!updatePayload[fieldApiKey]) {
        // Localized field from schema not yet in payload (e.g., was not on 'record' object)
        updatePayload[fieldApiKey] = {}; // Initialize as empty object
      }
      // If toLocale is still not set for this localized field, default it to null.
      if (
        !excludedFieldIds.has(fieldMeta.id) &&
        !(toLocale in updatePayload[fieldApiKey])
      ) {
        updatePayload[fieldApiKey][toLocale] = null;
      }
    }
  }
  
  return updatePayload;
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
  fieldTypeDictionary: FieldTypeDictionary
): boolean {
  // Skip system fields that shouldn't be translated
  if (
    ['id', 'creator', 'meta', 'type', 'item_type'].includes(field) ||
    !record[field] ||
    !fieldTypeDictionary[field]?.isLocalized
  ) {
    return false;
  }

  // Check for the source locale in the field data with proper hyphenated locale support
  const sourceVal = getExactSourceValue(record[field] as Record<string, unknown>, fromLocale);
  if (sourceVal === undefined || sourceVal === null || sourceVal === '') {
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
  itemTypeId: string
) {
  const fields = await client.fields.list(itemTypeId);
  return fields.reduce((acc: FieldTypeDictionary, field: {
    api_key: string;
    appearance: { editor: string };
    id: string;
    localized: boolean;
  }) => {
    acc[field.api_key] = {
      editor: field.appearance.editor,
      id: field.id,
      isLocalized: field.localized
    };
    return acc;
  }, {});
}

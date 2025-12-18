/**
 * SharedFieldUtils.ts
 * Small, side-effect-free helpers shared by form and CMA flows.
 */

import { fieldPrompt } from '../../prompts/FieldPrompts';

/**
 * Field metadata dictionary keyed by field API key.
 */
export type FieldTypeDictionary = Record<string, { editor: string; id: string; isLocalized: boolean }>;

/**
 * Helper function to find the exact case-sensitive locale key in an object.
 * This is essential for properly handling hyphenated locales (e.g., "pt-BR", "pt-br")
 * as DatoCMS requires exact case matches for locale keys.
 *
 * @param obj - The object containing locale keys
 * @param localeCode - The locale code to search for (case-insensitive)
 * @returns The exact locale key as it appears in the object, or undefined if not found
 */
export function findExactLocaleKey(obj: Record<string, unknown>, localeCode: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;

  const normalizedLocale = localeCode.toLowerCase();

  for (const key in obj) {
    if (key.toLowerCase() === normalizedLocale) {
      return key; // Return the exact key with original casing
    }
  }

  return undefined;
}

/**
 * Determines if a field type is translatable based on the plugin configuration.
 * Handles special cases for modular content variations and gallery fields.
 *
 * @param fieldType - The DatoCMS editor identifier for the field.
 * @param translationFields - List of field types enabled for translation in plugin settings.
 * @param modularContentVariations - List of modular content editor types (e.g., framed_single_block).
 * @returns True if the field type should be translated.
 */
export function isFieldTranslatable(
  fieldType: string,
  translationFields: string[],
  modularContentVariations: string[]
): boolean {
  let isTranslatable = translationFields.includes(fieldType);

  // Handle special cases: modular content variations count as rich_text,
  // and gallery fields count as file fields
  if (
    (translationFields.includes('rich_text') && modularContentVariations.includes(fieldType)) ||
    (translationFields.includes('file') && fieldType === 'gallery')
  ) {
    isTranslatable = true;
  }

  return isTranslatable;
}

/**
 * Builds the field-type specific prompt snippet used to instruct the model
 * on the expected return format.
 *
 * Structured and rich text fields use specialized translators, so they
 * intentionally skip the fieldPrompt mapping.
 *
 * @param fieldType - The DatoCMS editor identifier for the field.
 * @returns The prompt suffix describing the desired return format.
 */
export function prepareFieldTypePrompt(fieldType: string): string {
  let fieldTypePrompt = 'Return the response in the format of ';
  if (fieldType !== 'structured_text' && fieldType !== 'rich_text') {
    fieldTypePrompt += fieldPrompt[fieldType as keyof typeof fieldPrompt] || '';
  }
  return fieldTypePrompt;
}

/**
 * Resolves the exact-cased locale key inside a localized value object and
 * returns its corresponding value.
 *
 * @param fieldData - A localized value object, e.g. `{ en: 'Hello', 'pt-BR': 'Olá' }`.
 * @param fromLocale - The desired source locale (case-insensitive).
 * @returns The value for the exact-matching locale key, or undefined if absent.
 */
export function getExactSourceValue(
  fieldData: Record<string, unknown> | undefined,
  fromLocale: string
): unknown {
  if (!fieldData || typeof fieldData !== 'object') return undefined;
  const exact = findExactLocaleKey(fieldData as Record<string, unknown>, fromLocale);
  return exact ? (fieldData as Record<string, unknown>)[exact] : undefined;
}

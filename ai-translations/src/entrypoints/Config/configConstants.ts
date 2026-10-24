/**
 * configConstants.ts
 * Shared constants for ConfigScreen and related hooks.
 */

import { defaultPrompt } from '../../prompts/DefaultPrompt';
import type { VendorId } from '../../utils/translation/types';

/**
 * A mapping from field editor types to their user-friendly labels.
 * Used to present a friendly multi-select of possible translatable fields.
 * The keys are stored in the `translationFields` plugin parameter.
 */
export const translateFieldTypes = {
  single_line: 'Single-line string',
  markdown: 'Markdown',
  wysiwyg: 'HTML editor',
  textarea: 'Textarea',
  slug: 'Slug',
  json: 'JSON',
  seo: 'SEO',
  structured_text: 'Structured text',
  rich_text: 'Modular content',
  file: 'Media fields',
};

export const modularContentVariations = [
  'framed_single_block',
  'frameless_single_block',
];

/** The translation vendors, in the order the settings list them. */
export const VENDORS: readonly VendorId[] = [
  'openai',
  'google',
  'anthropic',
  'deepl',
  'yandex',
];

const VENDOR_LABELS: Record<VendorId, string> = {
  openai: 'OpenAI (ChatGPT)',
  google: 'Google (Gemini)',
  anthropic: 'Anthropic (Claude)',
  deepl: 'DeepL',
  yandex: 'Yandex Translate',
};

/**
 * Returns the display label for a given vendor identifier.
 *
 * @param vendor - The vendor identifier string.
 * @returns The human-readable vendor label.
 */
export function getVendorLabel(vendor: VendorId): string {
  return VENDOR_LABELS[vendor] ?? VENDOR_LABELS.yandex;
}

/**
 * The title of the settings group of a vendor ("DeepL settings").
 *
 * @param vendor - The vendor identifier string.
 * @returns The group title.
 */
export function vendorSettingsTitle(vendor: VendorId): string {
  return `${getVendorLabel(vendor)} settings`;
}

/**
 * Re-export defaultPrompt for convenience.
 */
export const defaultPromptValue = defaultPrompt;

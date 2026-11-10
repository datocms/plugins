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
  openai: 'OpenAI',
  google: 'Google Gemini',
  anthropic: 'Anthropic',
  deepl: 'DeepL',
  yandex: 'Yandex',
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

/** Where to get the API key of each vendor: the `docs` of its key field. */
const API_KEY_DOCS: Record<VendorId, { label: string; to: string }> = {
  openai: {
    label: 'Get an OpenAI API key',
    to: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'Get a Google Gemini API key',
    to: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    label: 'Get an Anthropic API key',
    to: 'https://console.anthropic.com/settings/keys',
  },
  deepl: {
    label: 'Get a DeepL API key',
    to: 'https://www.deepl.com/your-account/keys',
  },
  yandex: {
    label: 'Get a Yandex API key',
    to: 'https://aistudio.yandex.ru/docs/en/translate/quickstart.html',
  },
};

/**
 * The `docs` link of the API key field of a vendor.
 *
 * @param vendor - The vendor identifier string.
 */
export function apiKeyDocs(vendor: VendorId): { label: string; to: string } {
  return API_KEY_DOCS[vendor];
}

/**
 * The hint of the API key field of a vendor: where the key is kept and where
 * it goes. DeepL and Yandex don't accept requests from a browser, so their
 * requests go through the DatoCMS CORS proxy.
 *
 * @param vendor - The vendor identifier string.
 */
export function apiKeyHint(vendor: VendorId): string {
  const label = getVendorLabel(vendor);
  return vendor === 'deepl' || vendor === 'yandex'
    ? `Saved in the plugin settings. This browser sends it to ${label} through the DatoCMS CORS proxy.`
    : `Saved in the plugin settings. This browser sends it straight to ${label}.`;
}

/**
 * Re-export defaultPrompt for convenience.
 */
export const defaultPromptValue = defaultPrompt;

/**
 * configConstants.ts
 * Shared constants for ConfigScreen and related hooks.
 */

import { defaultPrompt } from '../../prompts/DefaultPrompt';

/**
 * A mapping from field editor types to their user-friendly labels.
 * Used to present a friendly multi-select of possible translatable fields.
 */
export const translateFieldTypes = {
  single_line: 'Single line string',
  markdown: 'Markdown',
  wysiwyg: 'HTML Editor',
  textarea: 'Textarea',
  slug: 'Slug',
  json: 'JSON',
  seo: 'SEO',
  structured_text: 'Structured Text',
  rich_text: 'Modular Content',
  file: 'Media Fields',
};

export const modularContentVariations = [
  'framed_single_block',
  'frameless_single_block',
];

/**
 * Re-export defaultPrompt for convenience.
 */
export const defaultPromptValue = defaultPrompt;

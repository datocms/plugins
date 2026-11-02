/**
 * texts.ts
 * --------
 * The plugin's own texts, by key, for the `texts` of the Canvas around every
 * frame. A component gives one as a `{ id }` message where it needs a key
 * rather than a string: the error of a TableList cell is one, since the list
 * builds the DOM id of the message from it, and a text with spaces would not
 * make a valid id. The texts use the ICU syntax.
 */

/** The error of a glossary pair cell whose locale the project doesn't have. */
export const GLOSSARY_LOCALE_ERROR_ID = 'aiTranslations.glossaryLocaleError';

/** The error of a glossary pair cell whose glossary the account doesn't have. */
export const GLOSSARY_ERROR_ID = 'aiTranslations.glossaryError';

/** Every text of the plugin, a constant so the Canvas never renders again. */
export const PLUGIN_TEXTS: Record<string, string> = {
  [GLOSSARY_LOCALE_ERROR_ID]:
    'This project has no such locale. Pick another one.',
  [GLOSSARY_ERROR_ID]:
    "This glossary isn't in your DeepL account. Pick another one.",
};

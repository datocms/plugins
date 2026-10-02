/**
 * DeepLSettings.ts
 * ------------------------------------------------------
 * Defaults and parsers that turn the DeepL plugin settings (formality and the
 * tag lists under "Tag Settings") into DeepL `/v2/translate` request values.
 * The config screen and the translation layer share these so the saved
 * defaults and the values sent to DeepL can't drift apart.
 */

/** Formality values the plugin settings can store. */
export type DeepLFormalitySetting = 'default' | 'more' | 'less';

/** Default for the "Ignore tags (CSV)" setting. */
export const DEEPL_DEFAULT_IGNORE_TAGS = 'notranslate,ph';

/** Default for the "Non-splitting tags (CSV)" setting. */
export const DEEPL_DEFAULT_NON_SPLITTING_TAGS =
  'a,code,pre,strong,em,ph,notranslate';

/** Default for the "Splitting tags (CSV)" setting. */
export const DEEPL_DEFAULT_SPLITTING_TAGS = '';

/**
 * Parses a comma-separated tag list from the plugin settings.
 * Accepts commas, whitespace or new lines as separators, tolerates tags typed
 * with angle brackets (e.g. `<code>`), and drops empties and duplicates.
 *
 * @param value - Saved setting value, or undefined when never saved.
 * @param fallback - Default list used when the setting was never saved.
 * @returns Tag names to send to DeepL.
 */
export function parseDeepLTagList(
  value: string | undefined,
  fallback: string,
): string[] {
  const tags = (value ?? fallback)
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/[<>/]/g, '').trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

/**
 * Converts the formality setting into the value sent to DeepL.
 * Uses DeepL's `prefer_*` variants so target languages without formality
 * support fall back to the default tone instead of failing the request.
 *
 * @param formality - Saved formality setting.
 * @returns The DeepL `formality` value, or undefined to omit it.
 */
export function toDeepLFormality(
  formality: DeepLFormalitySetting | undefined,
): 'prefer_more' | 'prefer_less' | undefined {
  if (formality === 'more') return 'prefer_more';
  if (formality === 'less') return 'prefer_less';
  return undefined;
}

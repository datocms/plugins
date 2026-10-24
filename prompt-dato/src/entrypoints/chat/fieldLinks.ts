import { defaultUrlTransform, type UrlTransform } from 'react-markdown';
import type { FieldInfo } from '../../lib/recordContext';

/**
 * Parses a `field:` pseudo-URL (e.g. `field:title`, `field:title.en`,
 * `field://title.en`) into the current record editor field target.
 */
export type FieldNavigationTarget = {
  fieldPath: string;
  localized: boolean;
  locale: string | null;
};

/** The target of a path that starts with this field, or null */
function matchField(
  raw: string,
  field: FieldInfo,
  locales: string[],
): FieldNavigationTarget | null {
  if (raw === field.apiKey) {
    return {
      fieldPath: raw,
      localized: field.localized,
      locale: null,
    };
  }

  if (!field.localized) return null;

  for (const locale of locales) {
    if (raw === `${field.apiKey}.${locale}`) {
      return {
        fieldPath: field.apiKey,
        localized: true,
        locale,
      };
    }

    if (raw.startsWith(`${field.apiKey}.${locale}.`)) {
      return {
        fieldPath: raw,
        localized: true,
        locale,
      };
    }
  }

  return null;
}

export function parseFieldHref(
  href: string,
  fields: FieldInfo[],
  locales: string[],
): FieldNavigationTarget | null {
  if (!href.startsWith('field:')) return null;
  const encoded = href.slice('field:'.length).replace(/^\/+/, '');
  const raw = safeDecodeURIComponent(encoded);
  if (raw.length === 0) return null;

  for (const field of fields) {
    const target = matchField(raw, field, locales);
    if (target) return target;
  }

  const [topLevelApiKey] = raw.split('.');
  const topLevelField = fields.find((field) => field.apiKey === topLevelApiKey);
  const locale = getLocaleFromFieldPath(raw, locales);

  return {
    fieldPath: raw,
    localized: Boolean(topLevelField?.localized || locale),
    locale,
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getLocaleFromFieldPath(
  fieldPath: string,
  locales: string[],
): string | null {
  return fieldPath.split('.').find((part) => locales.includes(part)) ?? null;
}

function fieldPathIncludesLocale(fieldPath: string, locale: string): boolean {
  return fieldPath.split('.').includes(locale);
}

export function getHashFieldPath(target: FieldNavigationTarget): string {
  if (!target.localized || !target.locale) return target.fieldPath;
  return fieldPathIncludesLocale(target.fieldPath, target.locale)
    ? target.fieldPath
    : `${target.fieldPath}.${target.locale}`;
}

/** Keeps the `field:` links of a reply, and makes every other URL safe */
export const fieldUrlTransform: UrlTransform = (url) =>
  url.startsWith('field:') ? url : defaultUrlTransform(url);

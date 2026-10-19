/**
 * Reads the `disabledLocales` list from the add-on's per-field parameters.
 * Fields configured before this option existed have no list, so they get [].
 */
export const normalizeDisabledLocales = (
  parameters: Record<string, unknown>,
): string[] => {
  const { disabledLocales } = parameters;

  return Array.isArray(disabledLocales)
    ? disabledLocales.filter(
        (locale): locale is string => typeof locale === 'string',
      )
    : [];
};

type FieldInstance = {
  /** Locale currently rendered by the form (`ctx.locale`). */
  locale: string;
  /** Whether the field itself is localized. */
  isLocalized: boolean;
  /** Dot-separated path of the field instance (`ctx.fieldPath`). */
  fieldPath: string;
  /** All project locales (`ctx.site.attributes.locales`). */
  siteLocales: string[];
};

/**
 * Finds the locale a field instance belongs to. Block fields always report
 * `localized: false`, but inherit a locale from a localized parent field,
 * which shows up as a path segment (e.g. `content.it.0.title`).
 */
export const resolveFieldLocale = ({
  locale,
  isLocalized,
  fieldPath,
  siteLocales,
}: FieldInstance): string | undefined =>
  isLocalized
    ? locale
    : fieldPath.split('.').find((segment) => siteLocales.includes(segment));

/**
 * Decides whether to disable a field instance. An empty list means
 * "all locales"; fields with no locale share one value, so we always disable them.
 */
export const shouldDisableField = (
  disabledLocales: string[],
  instance: FieldInstance,
): boolean => {
  if (disabledLocales.length === 0) {
    return true;
  }

  const fieldLocale = resolveFieldLocale(instance);

  return fieldLocale === undefined || disabledLocales.includes(fieldLocale);
};

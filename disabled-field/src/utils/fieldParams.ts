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

/**
 * Decides whether to disable a field instance. An empty list means
 * "all locales"; non-localized fields share one value, so we always disable them.
 */
export const shouldDisableField = (
  disabledLocales: string[],
  locale: string,
  isLocalized: boolean,
): boolean =>
  !isLocalized ||
  disabledLocales.length === 0 ||
  disabledLocales.includes(locale);

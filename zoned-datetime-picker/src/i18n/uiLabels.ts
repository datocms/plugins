/**
 * Localized labels for the time zone editor UI.
 * Add languages here as needed. Fallback is English.
 */

export type UILabels = {
  suggested: string;
  browser: string;
  site: string;
  dateTime: string;
  timeZone: string;
};

const UILABELS_BY_COUNTRY: Record<string, UILabels> = {
  en: {
    suggested: "Suggested",
    browser: "Your browser",
    site: "This project",
    dateTime: "Date & time",
    timeZone: "Time zone",
  },
  it: {
    suggested: "Suggeriti",
    browser: "Il tuo browser",
    site: "Questo progetto",
    dateTime: "Data e ora",
    timeZone: "Fuso orario",
  },
  fr: {
    suggested: "Suggérés",
    browser: "Votre navigateur",
    site: "Ce projet",
    dateTime: "Date et heure",
    timeZone: "Fuseau horaire",
  },
  de: {
    suggested: "Vorgeschlagen",
    browser: "Ihr Browser",
    site: "Dieses Projekt",
    dateTime: "Datum & Uhrzeit",
    timeZone: "Zeitzone",
  },
  pt: {
    suggested: "Sugeridos",
    browser: "Seu navegador",
    site: "Este projeto",
    dateTime: "Data e hora",
    timeZone: "Fuso horário",
  },
  cs: {
    suggested: "Doporučené",
    browser: "Váš prohlížeč",
    site: "Tento projekt",
    dateTime: "Datum a čas",
    timeZone: "Časové pásmo",
  },
  nl: {
    suggested: "Aanbevolen",
    browser: "Uw browser",
    site: "Dit project",
    dateTime: "Datum en tijd",
    timeZone: "Tijdzone",
  },
};

/**
 * Return localized UI labels for the given user-preferred locale.
 *
 * @param userPreferredLocale - Two-letter ISO country code, like `en` or `it`
 * @returns Translated labels, defaulting to English if unknown
 * @example
 * ```ts
 * getUiLabels('it');
 * // { suggested: 'Suggeriti', browser: 'Il tuo browser', ... }
 * ```
 */
export function getUiLabels(
  userPreferredLocale: string | undefined
): UILabels {
  const key = (userPreferredLocale || "en").split("-")[0].toLowerCase();
  return UILABELS_BY_COUNTRY[key] || UILABELS_BY_COUNTRY.en;
}

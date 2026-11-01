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
  parseErrorTitle: string;
  parseErrorText: string;
};

/**
 * Locales the editor must always ship translations for (the DatoCMS interface
 * languages). The map may include more, but omitting any of these is a
 * compile-time error.
 */
export type RequiredLocale =
  | 'cs'
  | 'de'
  | 'en'
  | 'es'
  | 'fr'
  | 'it'
  | 'nl'
  | 'pt';

const UILABELS_BY_COUNTRY: Record<RequiredLocale, UILabels> &
  Record<string, UILabels> = {
  en: {
    suggested: 'Suggested',
    browser: 'Your browser',
    site: 'This project',
    dateTime: 'Date & time',
    timeZone: 'Time zone',
    parseErrorTitle: 'The stored value of this field could not be read',
    parseErrorText:
      'This should never happen — please contact support and include a screenshot of this screen.',
  },
  es: {
    suggested: 'Sugeridos',
    browser: 'Tu navegador',
    site: 'Este proyecto',
    dateTime: 'Fecha y hora',
    timeZone: 'Zona horaria',
    parseErrorTitle: 'No se pudo leer el valor almacenado de este campo',
    parseErrorText:
      'Esto no debería ocurrir nunca: ponte en contacto con el soporte e incluye una captura de pantalla de esta pantalla.',
  },
  it: {
    suggested: 'Suggeriti',
    browser: 'Il tuo browser',
    site: 'Questo progetto',
    dateTime: 'Data e ora',
    timeZone: 'Fuso orario',
    parseErrorTitle:
      'Impossibile leggere il valore memorizzato di questo campo',
    parseErrorText:
      "Non dovrebbe mai succedere: contatta l'assistenza e allega uno screenshot di questa schermata.",
  },
  fr: {
    suggested: 'Suggérés',
    browser: 'Votre navigateur',
    site: 'Ce projet',
    dateTime: 'Date et heure',
    timeZone: 'Fuseau horaire',
    parseErrorTitle: "La valeur enregistrée de ce champ n'a pas pu être lue",
    parseErrorText:
      "Cela ne devrait jamais arriver : veuillez contacter l'assistance en joignant une capture d'écran de cet écran.",
  },
  de: {
    suggested: 'Vorgeschlagen',
    browser: 'Ihr Browser',
    site: 'Dieses Projekt',
    dateTime: 'Datum & Uhrzeit',
    timeZone: 'Zeitzone',
    parseErrorTitle:
      'Der gespeicherte Wert dieses Feldes konnte nicht gelesen werden',
    parseErrorText:
      'Das sollte niemals passieren – bitte kontaktieren Sie den Support und fügen Sie einen Screenshot dieses Bildschirms bei.',
  },
  pt: {
    suggested: 'Sugeridos',
    browser: 'Seu navegador',
    site: 'Este projeto',
    dateTime: 'Data e hora',
    timeZone: 'Fuso horário',
    parseErrorTitle: 'Não foi possível ler o valor armazenado deste campo',
    parseErrorText:
      'Isto nunca deveria acontecer: entre em contato com o suporte e inclua uma captura de tela desta tela.',
  },
  cs: {
    suggested: 'Doporučené',
    browser: 'Váš prohlížeč',
    site: 'Tento projekt',
    dateTime: 'Datum a čas',
    timeZone: 'Časové pásmo',
    parseErrorTitle: 'Uloženou hodnotu tohoto pole se nepodařilo načíst',
    parseErrorText:
      'Toto by se nikdy nemělo stát – kontaktujte prosím podporu a přiložte snímek obrazovky této stránky.',
  },
  nl: {
    suggested: 'Aanbevolen',
    browser: 'Uw browser',
    site: 'Dit project',
    dateTime: 'Datum en tijd',
    timeZone: 'Tijdzone',
    parseErrorTitle:
      'De opgeslagen waarde van dit veld kon niet worden gelezen',
    parseErrorText:
      'Dit zou nooit mogen gebeuren – neem contact op met support en voeg een schermafbeelding van dit scherm toe.',
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
export function getUiLabels(userPreferredLocale: string | undefined): UILabels {
  const key = (userPreferredLocale || 'en').split('-')[0].toLowerCase();
  return UILABELS_BY_COUNTRY[key] || UILABELS_BY_COUNTRY.en;
}

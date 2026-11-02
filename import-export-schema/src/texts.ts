import { useCtx } from 'datocms-react-ui/Canvas';
import { useMemo } from 'react';

// The texts of the plugin for the Message props of the components ({ id,
// values }), in ICU: `#` in a plural gets the separators of the locale.
export const TEXTS = {
  'importExportSchema.exportOptionsCapped':
    'The list shows the first 100 of {total, number} matches. Type a name or API key to narrow it.',
};

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string) {
  let format = numberFormats.get(locale);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale);
    } catch {
      format = new Intl.NumberFormat('en');
    }
    numberFormats.set(locale, format);
  }
  return format;
}

export type Formatters = {
  /** A number with the separators of the locale: "1,234" */
  number: (value: number) => string;
  /** A count with the English plural: "1 element", "1,234 elements" */
  count: (value: number, one: string, other: string) => string;
};

/**
 * Canvas formats only the Message props. The subtitles, the pills and the
 * lines of the progress dialog take plain nodes: these format their numbers
 * with the locale of the nearest Canvas.
 */
export function useFormatters(): Formatters {
  const { locale } = useCtx().ui;

  return useMemo(() => {
    const format = numberFormat(locale);
    return {
      number: (value) => format.format(value),
      count: (value, one, other) =>
        `${format.format(value)} ${value === 1 ? one : other}`,
    };
  }, [locale]);
}

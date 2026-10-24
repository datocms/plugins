import { useCtx } from 'datocms-react-ui/Canvas';
import { useMemo } from 'react';

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options?: Intl.NumberFormatOptions) {
  const key = `${locale}|${options?.style ?? 'decimal'}`;
  let format = numberFormats.get(key);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, options);
    } catch {
      format = new Intl.NumberFormat('en', options);
    }
    numberFormats.set(key, format);
  }
  return format;
}

export type Formatters = {
  /** A number with the separators of the locale: "1,234" */
  count: (value: number) => string;
  /** A share from 0 to 100, rounded: "25%" */
  percent: (value: number) => string;
  /** A count with its noun, with the English plural: "1 entry", "1,234 entries" */
  plural: (value: number, one: string, other: string) => string;
};

// Canvas formats only Message props ({ id, values }). These format the
// numbers in the slots that take plain text or nodes, with the same locale.
export function formatters(locale: string): Formatters {
  const decimal = numberFormat(locale);
  const percent = numberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  return {
    count: (value) => decimal.format(value),
    percent: (value) => percent.format(value / 100),
    plural: (value, one, other) =>
      `${decimal.format(value)} ${value === 1 ? one : other}`,
  };
}

/** The formatters for the locale of the nearest Canvas */
export function useFormatters() {
  const { locale } = useCtx().ui;
  return useMemo(() => formatters(locale), [locale]);
}

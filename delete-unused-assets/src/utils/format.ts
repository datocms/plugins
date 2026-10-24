import { useCtx } from 'datocms-react-ui/Canvas';
import { useMemo } from 'react';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// The dashboard's byte format: base 1024, two decimals without ".00", no space.
export function formatBytes(bytes: number) {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const amount = unit === 0 ? String(value) : value.toFixed(2);
  return `${amount.replace(/\.00$/, '')}${BYTE_UNITS[unit]}`;
}

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
  /** A count of assets, with the English plural: "1 asset", "1,234 assets" */
  assets: (value: number) => string;
  /** A share from 0 to 100, rounded down: "25%" */
  percent: (value: number) => string;
};

// Canvas formats only Message props ({ id, values }). These format the
// counts in the slots that take plain text or nodes, with the same locale.
export function formatters(locale: string): Formatters {
  const decimal = numberFormat(locale);
  const percent = numberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  return {
    count: (value) => decimal.format(value),
    assets: (value) =>
      `${decimal.format(value)} ${value === 1 ? 'asset' : 'assets'}`,
    percent: (value) => percent.format(Math.floor(value) / 100),
  };
}

/** The formatters for the locale of the nearest Canvas */
export function useFormatters() {
  const { locale } = useCtx().ui;
  return useMemo(() => formatters(locale), [locale]);
}

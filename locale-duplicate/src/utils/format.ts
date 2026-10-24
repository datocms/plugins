/**
 * Number formatting for the duplication page, in the language of the CMS
 * (ctx.ui.locale). The words are English; the separators follow the locale.
 */

export type Formatters = {
  /** 1234 → "1,234" */
  count: (value: number) => string;
  /** 1 → "1 record", 1234 → "1,234 records" */
  records: (value: number) => string;
  models: (value: number) => string;
  operations: (value: number) => string;
  errors: (value: number) => string;
  /** A share from 0 to 100, rounded down: 42.7 → "42%" */
  percent: (value: number) => string;
  /** Milliseconds as minutes and seconds: 83000 → "1m 23s" */
  duration: (milliseconds: number) => string;
};

const cache = new Map<string, Formatters>();

function numberFormat(
  locale: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function formatters(locale: string): Formatters {
  const cached = cache.get(locale);
  if (cached) return cached;

  const integer = numberFormat(locale, { maximumFractionDigits: 0 });
  const share = numberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  });

  const count = (value: number) => integer.format(finite(value));
  const noun = (singular: string, plural: string) => (value: number) =>
    `${count(value)} ${value === 1 ? singular : plural}`;

  const result: Formatters = {
    count,
    records: noun('record', 'records'),
    models: noun('model', 'models'),
    operations: noun('operation', 'operations'),
    errors: noun('error', 'errors'),
    percent: (value) =>
      share.format(Math.floor(Math.max(0, finite(value))) / 100),
    duration: (milliseconds) => {
      const total = Math.max(0, finite(milliseconds));
      const minutes = Math.floor(total / 60000);
      const seconds = Math.floor((total % 60000) / 1000);
      return `${count(minutes)}m ${seconds}s`;
    },
  };

  cache.set(locale, result);
  return result;
}

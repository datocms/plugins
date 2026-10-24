import { useCtx } from 'datocms-react-ui/Canvas';
import { useMemo } from 'react';

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
  count: (value: number) => string;
  /** A count of chats, with the English plural: "1 chat", "3 chats" */
  chats: (value: number) => string;
  /** A count of steps, with the English plural: "1 step", "5 steps" */
  steps: (value: number) => string;
};

// Canvas formats only Message props ({ id, values }). These format the
// counts in the slots that take plain text or nodes, with the same locale.
export function formatters(locale: string): Formatters {
  const decimal = numberFormat(locale);
  return {
    count: (value) => decimal.format(value),
    chats: (value) =>
      `${decimal.format(value)} ${value === 1 ? 'chat' : 'chats'}`,
    steps: (value) =>
      `${decimal.format(value)} ${value === 1 ? 'step' : 'steps'}`,
  };
}

/** The formatters for the locale of the nearest Canvas */
export function useFormatters() {
  const { locale } = useCtx().ui;
  return useMemo(() => formatters(locale), [locale]);
}

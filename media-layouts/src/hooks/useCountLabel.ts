import { useCtx } from 'datocms-react-ui/Canvas';
import { useCallback } from 'react';
import { countLabel } from '../utils/options';

/**
 * countLabel with the locale of the nearest Canvas (ctx.ui.locale): '1 slot',
 * '1,234 slots'.
 */
export function useCountLabel(): (
  count: number,
  one: string,
  other: string,
) => string {
  const { locale } = useCtx().ui;
  return useCallback(
    (count: number, one: string, other: string) =>
      countLabel(locale, count, one, other),
    [locale],
  );
}

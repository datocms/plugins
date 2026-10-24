/** A number in the separators of the locale: "1,204". */
export function formatNumber(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value);
}

// The texts are English, thus they take the English plural: other locales
// put other numbers in "one" (0 in French, 21 in Russian).
const englishPlural = new Intl.PluralRules('en');

/**
 * A count that names the thing counted, with the number in the separators of
 * the locale: formatCount(1, 'comment', 'comments') is "1 comment",
 * formatCount(1204, 'comment', 'comments') is "1,204 comments".
 */
export function formatCount(
  count: number,
  one: string,
  other: string,
  locale = 'en',
): string {
  const noun = englishPlural.select(count) === 'one' ? one : other;
  return `${formatNumber(count, locale)} ${noun}`;
}

// The texts of the plugin, and the texts of react-ui that it changes, for the
// `texts` of every Canvas. A module constant: a new object on each render
// would render the whole plugin again.
export const TEXTS = {
  'allRecords.selected':
    '{count, plural, one {# record selected} other {# records selected}}',
  'allRecords.selectAll':
    '{count, plural, one {Select # record} other {Select all # records}}',
  'allRecords.selectAllMatching':
    '{count, plural, one {Select # matching record} other {Select all # matching records}}',
  'allRecords.moveHint':
    '{count, plural, one {The selected record moves to this stage.} other {The # selected records move to this stage.}}',
  'a11y.table.selectAll': 'Select all records on this page',
} as const;

// A number with the separators of the locale of the user ("1,234"), as the
// `#` of the texts above, for the texts that the plugin writes itself
export function formatNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

// A count of records ("1,234 records"), with the separators and the plural
// rules of the locale of the user, as the texts above
export function formatRecordCount(locale: string, count: number): string {
  const number = formatNumber(locale, count);
  return new Intl.PluralRules(locale).select(count) === 'one'
    ? `${number} record`
    : `${number} records`;
}

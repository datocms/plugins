/**
 * The plugin's texts for the Message props of the kit, in ICU: `#` in a
 * plural gets the separators of the editor's locale. A constant, so the
 * Canvas that takes it doesn't render again. A count that ends up in a plain
 * string (a line of facts, a live region) can't be a text: `countLabel`
 * builds those.
 */
export const TEXTS = {
  'brokenLinkChecker.showMoreFields':
    '{count, plural, one {Show # more field} other {Show # more fields}}',
  'brokenLinkChecker.browseMoreFields':
    '{count, plural, one {Browse # more field} other {Browse # more fields}}',
  'brokenLinkChecker.browsePlaces':
    '{count, plural, one {Browse # place} other {Browse # places}}',
  'brokenLinkChecker.showMorePlaces':
    '{count, plural, one {Show # more place} other {Show # more places}}',
  'brokenLinkChecker.showMoreLinks':
    '{count, plural, one {Show # more link} other {Show # more links}}',
  'brokenLinkChecker.showMoreRecords':
    '{count, plural, one {Show # more record} other {Show # more records}}',
};

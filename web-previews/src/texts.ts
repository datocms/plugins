// The texts of the plugin for the Message props of the components, in ICU
// syntax. Every Canvas gets this constant, so the object stays the same
// between renders.
export const TEXTS = {
  // The errors of the cells of the viewports and of the custom headers
  'webPreviews.errors.enterName': 'Enter a name',
  'webPreviews.errors.enterWidth': 'Enter a width',
  'webPreviews.errors.enterHeight': 'Enter a height',
  'webPreviews.errors.chooseIcon': 'Choose an icon',
  'webPreviews.errors.chooseListedIcon': 'Choose an icon from the list',
  'webPreviews.errors.enterHeaderName': 'Enter a header name',
  'webPreviews.errors.repeatedHeaderName': 'Use each header name once',
  'webPreviews.errors.enterValue': 'Enter a value',
} satisfies Record<string, string>;

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string): Intl.NumberFormat {
  let format = numberFormats.get(locale);

  if (!format) {
    try {
      format = new Intl.NumberFormat(locale);
    } catch {
      // A locale that the browser doesn't know
      format = new Intl.NumberFormat('en');
    }
    numberFormats.set(locale, format);
  }

  return format;
}

/**
 * How many icons match a search, as a plain string with the number separators
 * of the locale. Canvas formats only the Message props: the title of a group
 * of a select menu takes a string, thus this text is not in TEXTS.
 */
export function iconCountText({
  count,
  limit,
  locale,
}: {
  /** The icons that match the search */
  count: number;
  /** The icons that the list shows at most */
  limit: number;
  locale: string;
}): string {
  const format = numberFormat(locale);
  const icons = `${format.format(count)} ${count === 1 ? 'icon' : 'icons'}`;

  return count > limit
    ? `${icons}. Type to narrow the list: the first ${format.format(limit)} show.`
    : icons;
}

import type { IntlMessage } from 'datocms-react-ui/Message';
import type { LimitsCounter } from './lib/fieldValue';

// The texts of the plugin for the Message props of the components, in ICU:
// `#` in a plural gets the separators of the editor's locale. `note` is the
// sentence that follows the count on its line ("none" when there is none).
// The counts in slots that take a node or plain text (pills, toolbar parts,
// live announcements) go through `formatCount` in `lib/format.ts` instead.
export const TEXTS = {
  // "3 of 10 products"; the noun follows the maximum ("0 of 1 product").
  'shopifyProduct.counterOfMax':
    '{count, number} of {max, plural, one {# {one}} other {# {many}}}{note, select, none {} other {. {note}}}',
};

/**
 * The counter line of a multiple field: the counter, then the sentence that
 * explains it, if any ("3 of 3 products. The field is full.").
 */
export function counterMessage(
  counter: LimitsCounter,
  note: string | null,
): IntlMessage {
  return {
    id: 'shopifyProduct.counterOfMax',
    values: {
      count: counter.count,
      max: counter.max,
      one: counter.one,
      many: counter.many,
      note: note ?? 'none',
    },
  };
}

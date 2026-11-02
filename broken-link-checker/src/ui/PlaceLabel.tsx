import EntityRow from 'datocms-react-ui/EntityRow';
import type { ReactNode } from 'react';
import { countLabel, joinFacts, locationParts } from '../report/format';
import type { LinkOccurrence } from '../types';

type PlaceLabelProps = {
  occurrence: LinkOccurrence;
  uiLocale: string;
  showLocale: boolean;
  /** How many times the link is in this place, when it's more than once. */
  count?: number;
  /** The end of the row, for example the chevron of a row that goes to the field. */
  trailing?: ReactNode;
};

/**
 * Where a link sits, as the content of a row: the field, with its locale as
 * the note beside it (multi-locale sites only), then the fields and blocks
 * around it on the details line ("in Sections > Hero 1"), one line that ends
 * with an ellipsis when it's longer, with the times the link is there. A
 * field at the top level of the record has no path.
 */
export function PlaceLabel({
  occurrence,
  uiLocale,
  showLocale,
  count = 1,
  trailing,
}: PlaceLabelProps) {
  const { field, parents, locale } = locationParts(
    occurrence,
    uiLocale,
    showLocale,
  );
  return (
    <EntityRow
      layout="row"
      multilineTitle
      title={field}
      aside={locale}
      trailing={trailing}
    >
      {joinFacts([
        parents && `in ${parents}`,
        count > 1 && countLabel(count, '1 time', '{n} times', uiLocale),
      ])}
    </EntityRow>
  );
}

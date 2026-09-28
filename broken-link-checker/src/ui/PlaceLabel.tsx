import { locationParts } from '../report/format';
import type { LinkOccurrence } from '../types';

type PlaceLabelProps = {
  occurrence: LinkOccurrence;
  uiLocale: string;
  showLocale: boolean;
};

/**
 * A link's location on two lines: the field and its locale first, then the
 * fields and blocks around it. Deep block paths stay readable because the
 * field name never gets lost in the middle of them.
 */
export function PlaceLabel({
  occurrence,
  uiLocale,
  showLocale,
}: PlaceLabelProps) {
  const { field, parents, locale } = locationParts(
    occurrence,
    uiLocale,
    showLocale,
  );
  return (
    <span className="blc-place-label">
      <span className="blc-place-label__head">
        <span className="blc-place-label__field">{field}</span>
        {locale && <span className="blc-place-label__locale">{locale}</span>}
      </span>
      {parents && <span className="blc-place-label__path">{parents}</span>}
    </span>
  );
}

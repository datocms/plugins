import { useState } from 'react';
import { faFileMagnifyingGlass, Icon } from '../../ui/icons';
import type { NoResultsView } from '../contract';
import type { Copy } from './copy';

type NoResultsProps = {
  view: NoResultsView;
  /** What is in Find now. */
  pattern: string;
  /** A new search is scheduled: the body still shows the previous one. */
  pending: boolean;
  copy: Copy;
};

/**
 * A settled search with nothing to show, in the idle state's quiet style: the
 * title quotes what was searched, the line names only what narrows it.
 */
export function NoResults({ view, pattern, pending, copy }: NoResultsProps) {
  // While the next search is pending the title keeps the searched pattern.
  const [searched, setSearched] = useState(pattern);
  if (!pending && searched !== pattern) {
    setSearched(pattern);
  }

  return (
    <div className="dl-list-empty fr-no-results">
      <div className="dl-list-empty__body">
        <div className="dl-list-empty__icon">
          <Icon glyph={faFileMagnifyingGlass} />
        </div>
        <div className="dl-list-empty__title">
          {copy.noResultsTitle(view, pending ? searched : pattern)}
        </div>
        <div>{copy.noResultsLine(view)}</div>
      </div>
    </div>
  );
}

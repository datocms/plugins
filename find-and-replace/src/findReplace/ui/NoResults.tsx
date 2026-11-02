import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useState } from 'react';
import { SearchIcon } from '../../icons';
import type { NoResultsView } from '../contract';
import { type Copy, hiddenByFilter, STRINGS } from './copy';

type NoResultsProps = {
  view: NoResultsView;
  /** What is in Find now. */
  pattern: string;
  /** A new search is scheduled: the body still shows the previous one. */
  pending: boolean;
  /** Callouts or a note sit above it, in the flow of the list area. */
  belowNotices: boolean;
  copy: Copy;
  /** Turns the model filter off. */
  onShowAllModels: () => void;
};

/**
 * A settled search with nothing to show: the title quotes what was searched,
 * and a line shows only when something on screen narrows it. When the model
 * filter hides the matches of other models, it leads back to them.
 */
export function NoResults({
  view,
  pattern,
  pending,
  belowNotices,
  copy,
  onShowAllModels,
}: NoResultsProps) {
  // While the next search is pending the title keeps the searched pattern.
  const [searched, setSearched] = useState(pattern);
  if (!pending && searched !== pattern) {
    setSearched(pattern);
  }

  return (
    <BlankSlate
      placement={belowNotices ? 'section' : 'area'}
      icon={<SearchIcon />}
      title={copy.noResultsTitle(view, pending ? searched : pattern)}
      description={copy.noResultsLine(view) ?? undefined}
      actions={
        hiddenByFilter(view) ? (
          <Button label={STRINGS.showAllModels} onClick={onShowAllModels} />
        ) : undefined
      }
    />
  );
}

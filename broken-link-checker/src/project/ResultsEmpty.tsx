import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { DOCS_URL } from '../constants';
import { LinkIcon, SearchIcon } from '../icons';

export type ResultsEmptyKind =
  | 'noLinks'
  | 'clean'
  | 'cleanChecked'
  | 'cleanSoFar'
  | 'noMatch';

type ResultsEmptyProps = {
  kind: ResultsEmptyKind;
  /** Links found so far. */
  total: number;
  /** Some content couldn't be read. */
  partial: boolean;
  /** The view already shows every link. */
  showingAll: boolean;
  /** Switches the view to all links, keeping the filter. */
  onShowAll: () => void;
};

/** The summary above already counts the links. */
function cleanSentence(total: number, partial: boolean) {
  const scope = partial ? ' in the content that could be read' : '';
  return total === 1
    ? `The only link found is not broken, invalid or unverified${scope}.`
    : `None of the links found is broken, invalid or unverified${scope}.`;
}

/**
 * Takes the place of the table when the view has no rows to show, under the
 * progress or the summary that always sits above it.
 */
export function ResultsEmpty({
  kind,
  total,
  partial,
  showingAll,
  onShowAll,
}: ResultsEmptyProps) {
  switch (kind) {
    case 'noLinks':
      return (
        <BlankSlate
          placement="section"
          icon={<LinkIcon />}
          title="No links found"
          description="The scanned records don't contain any website links. Links are read from text fields, including those inside blocks."
          // One link: the kit names its button "Documentation".
          docs={[{ href: DOCS_URL }]}
        />
      );
    case 'clean':
      return (
        <BlankSlate
          placement="section"
          icon={<LinkIcon />}
          title="Nothing needs attention"
          description={cleanSentence(total, partial)}
          actions={<Button label="Show all links" onClick={onShowAll} />}
        />
      );
    case 'cleanChecked':
      // Some links weren't checked: the summary above counts them.
      return (
        <BlankSlate
          placement="section"
          icon={<LinkIcon />}
          title="No problems found"
          description="None of the checked links is broken, invalid or unverified."
          actions={<Button label="Show all links" onClick={onShowAll} />}
        />
      );
    case 'cleanSoFar':
      return (
        <BlankSlate
          placement="section"
          icon={<LinkIcon />}
          title="Nothing needs attention yet"
          description="Links that need attention appear here as they're checked."
          actions={<Button label="Show all links" onClick={onShowAll} />}
        />
      );
    case 'noMatch':
      // The kit's no-results state (Pane.FilterBlankSlate) centers in the
      // area and would cover the notice above, so the same state sits in the
      // flow. The filter only searched the current view: the same filter can
      // find the link among all of them.
      return (
        <BlankSlate
          placement="section"
          small
          icon={<SearchIcon />}
          title={{ id: 'listFilter.noResults.title' }}
          description={{ id: 'listFilter.noResults.description' }}
          actions={
            showingAll ? undefined : (
              <Button label="Show all links" onClick={onShowAll} />
            )
          }
        />
      );
  }
}

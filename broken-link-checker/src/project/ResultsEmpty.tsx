import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { DOCS_URL } from '../constants';
import { LinkIcon, SearchIcon } from '../icons';
import { countLabel } from '../report/format';

export type ResultsEmptyKind = 'noLinks' | 'clean' | 'cleanSoFar' | 'noMatch';

type ResultsEmptyProps = {
  kind: ResultsEmptyKind;
  /** URLs found so far. */
  total: number;
  /** Some content couldn't be read. */
  partial: boolean;
  /** Switches the view to all URLs. */
  onShowAll: () => void;
  uiLocale: string;
};

function cleanSentence(total: number, partial: boolean, uiLocale: string) {
  const scope = partial ? ' in the content that could be read' : '';
  return countLabel(
    total,
    `The only URL found is not broken, invalid or unverified${scope}.`,
    `None of the {n} URLs found is broken, invalid or unverified${scope}.`,
    uiLocale,
  );
}

/**
 * Takes the place of the table when the view has no rows to show, under the
 * progress or the summary that always sits above it.
 */
export function ResultsEmpty({
  kind,
  total,
  partial,
  onShowAll,
  uiLocale,
}: ResultsEmptyProps) {
  switch (kind) {
    case 'noLinks':
      return (
        <BlankSlate
          placement="section"
          icon={<LinkIcon />}
          title="No links found"
          description="The scanned records don't contain any website links. Links are read from Single-line String, Multiple-paragraph Text and Structured Text fields, including those inside blocks."
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
          description={cleanSentence(total, partial, uiLocale)}
          actions={<Button label="Show all URLs" onClick={onShowAll} />}
        />
      );
    case 'cleanSoFar':
      return (
        <BlankSlate
          placement="section"
          icon={<LinkIcon />}
          title="Nothing needs attention yet"
          description="URLs that need attention appear here as they're checked."
          actions={<Button label="Show all URLs" onClick={onShowAll} />}
        />
      );
    case 'noMatch':
      // The kit's no-results state (Pane.FilterBlankSlate) centers in the
      // area and would cover the notice above, so the same state sits in the
      // flow.
      return (
        <BlankSlate
          placement="section"
          small
          icon={<SearchIcon />}
          title={{ id: 'listFilter.noResults.title' }}
          description={{ id: 'listFilter.noResults.description' }}
        />
      );
  }
}

import { DOCS_URL } from '../constants';
import { BlankSlate } from '../ui/BlankSlate';
import { LinkButton } from '../ui/LinkButton';

export type ResultsEmptyKind = 'noLinks' | 'clean' | 'cleanSoFar' | 'noMatch';

type ResultsEmptyProps = {
  kind: ResultsEmptyKind;
  /** URLs found so far. */
  total: number;
  /** Some content couldn't be read. */
  partial: boolean;
  onShowAll: () => void;
  uiLocale: string;
};

function cleanSentence(total: number, partial: boolean, uiLocale: string) {
  const scope = partial ? ' in the content that could be read' : '';
  return total === 1
    ? `The only URL found is not broken, invalid or unverified${scope}.`
    : `None of the ${total.toLocaleString(uiLocale)} URLs found is broken, invalid or unverified${scope}.`;
}

/** Replaces the table, header included, when there are no rows to show. */
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
        <BlankSlate title="No links found">
          <p>The scanned records don't contain any website links.</p>
          <p>
            Links are read from Single-line String, Multiple-paragraph Text and
            Structured Text fields, including those inside blocks.{' '}
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              Read more about how links are checked.
            </a>
          </p>
        </BlankSlate>
      );
    case 'clean':
      return (
        <BlankSlate title="Nothing needs attention">
          <p>{cleanSentence(total, partial, uiLocale)}</p>
          <p>
            <LinkButton onClick={onShowAll}>Show all URLs</LinkButton>
          </p>
        </BlankSlate>
      );
    case 'cleanSoFar':
      return (
        <BlankSlate title="Nothing needs attention yet">
          <p>URLs that need attention appear here as they're checked.</p>
          <p>
            <LinkButton onClick={onShowAll}>Show all URLs</LinkButton>
          </p>
        </BlankSlate>
      );
    case 'noMatch':
      return (
        <BlankSlate title="No results found">
          <p>
            Consider broadening your search parameters or exploring different
            keywords to find what you are looking for.
          </p>
        </BlankSlate>
      );
  }
}

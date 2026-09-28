import { memo } from 'react';
import { InfoTip } from '../../ui/InfoTip';
import type { MatchView } from '../contract';
import { STRINGS } from './copy';
import { useResultsEnv } from './ResultsEnv';
import { Snippet } from './Snippet';

type MatchLineProps = {
  match: MatchView;
  /** "Title · en" on the field's first line; null on the lines after it. */
  where: string | null;
  /** The line's accessible name: "Body, en, match 2". */
  whereName: string;
  /** The "Changes the URL" tag under the where label (a slug, selection visible). */
  changesUrl: boolean;
  /** "Select this match in Title (en)", or "Select match 2 in Body (en)" in a field with 2+ matches. */
  checkboxLabel: string;
  /** The selection is visible (plan mode, or a stopped run). */
  selecting: boolean;
  /** The selection is drawn but locked (a run is going). */
  selectionDisabled: boolean;
};

/**
 * One match on one line: its checkbox (only in records with 2+ matches;
 * invisible at rest while checked, space reserved), the where-cell and the
 * snippet. Below 768px the where-cell stacks above the snippet.
 */
export const MatchLine = memo(function MatchLine({
  match,
  where,
  whereName,
  changesUrl,
  checkboxLabel,
  selecting,
  selectionDisabled,
}: MatchLineProps) {
  const { controller } = useResultsEnv();
  const selectable = selecting && match.selectable;

  return (
    <div className="fr-match">
      {selectable && (
        <input
          type="checkbox"
          className="dl-checkbox fr-match__check"
          checked={match.included}
          disabled={selectionDisabled}
          aria-label={checkboxLabel}
          onChange={() =>
            controller.setMatchIncluded(match.key, !match.included)
          }
        />
      )}
      <div
        className={
          where ? 'fr-match__where' : 'fr-match__where fr-match__where--empty'
        }
      >
        <span className="fr-sr-only">{whereName}</span>
        {where && (
          <span className="fr-where__label" aria-hidden="true">
            {where}
          </span>
        )}
        {changesUrl && (
          <div className="fr-where__tag">
            <InfoTip tip={STRINGS.changesUrlTip} className="dl-row-tag">
              {STRINGS.changesUrl}
            </InfoTip>
          </div>
        )}
      </div>
      <Snippet match={match} />
    </div>
  );
});

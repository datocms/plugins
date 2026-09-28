import type { FieldView, MatchView } from '../contract';
import { MatchLine } from './MatchLine';
import { useResultsEnv } from './ResultsEnv';

type FieldGroupProps = {
  field: FieldView;
  /** The field's matches that are currently shown (the first N of the record). */
  matches: ReadonlyArray<MatchView>;
  selecting: boolean;
  selectionDisabled: boolean;
};

/**
 * One field value: one line per match. Only the first line shows where the
 * matches are ("Title · en"); every line keeps it as its accessible name.
 */
export function FieldGroup({
  field,
  matches,
  selecting,
  selectionDisabled,
}: FieldGroupProps) {
  const { copy } = useResultsEnv();
  const label = copy.whereLabel(field.path, field.locale);
  const path = field.path.join(' › ');
  const total = field.matches.length;

  return (
    <div className="fr-field">
      {matches.map((match, index) => (
        <MatchLine
          key={match.key}
          match={match}
          where={index === 0 ? label : null}
          whereName={copy.whereName(field.path, field.locale, index, total)}
          changesUrl={index === 0 && field.changesUrl && selecting}
          checkboxLabel={copy.matchCheckbox(path, field.locale, index, total)}
          selecting={selecting}
          selectionDisabled={selectionDisabled}
        />
      ))}
    </div>
  );
}

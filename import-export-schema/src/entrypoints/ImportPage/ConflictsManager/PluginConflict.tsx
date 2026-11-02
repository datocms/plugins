import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Pill from 'datocms-react-ui/Pill';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import { memo, useMemo } from 'react';
import { Field } from 'react-final-form';
import { OverviewItem } from '@/components/SchemaOverview/OverviewItem';
import { isDefined } from '@/utils/isDefined';
import { useResolutionStatusForPlugin } from '../ResolutionsForm';
import s from '../review.module.css';
import { IdCollisionFallback, usePendingIdIssue } from './IdCollisionFallback';
import type { PluginEntry } from './useImportReview';

type Strategy = 'reuseExisting' | 'skip';

// Each hint tells what happens to the fields of the file that use it
const options: RadioGroupOption<Strategy>[] = [
  {
    value: 'reuseExisting',
    label: 'Use the installed plugin',
    hint: 'The fields of the file use the plugin of the project.',
  },
  {
    value: 'skip',
    label: 'Skip the plugin',
    hint: 'The fields that use it get the default editor.',
  },
];

type Props = {
  entry: PluginEntry;
  /** The conflict still needs a decision of the user */
  unresolved: boolean;
  /**
   * The list shows only the conflicts, as its title says: the row then
   * needs no "Conflict" pill
   */
  inConflictsView: boolean;
};

/** The state at the end of the row: the conflict, or the decision */
function statusPill(
  unresolved: boolean,
  strategy: Strategy | null | undefined,
  inConflictsView: boolean,
) {
  if (unresolved) {
    return inConflictsView ? null : <Pill tone="warning">Conflict</Pill>;
  }
  if (strategy === 'reuseExisting') {
    return <Pill>Uses installed</Pill>;
  }
  if (strategy === 'skip') {
    return <Pill>Skipped</Pill>;
  }
  return null;
}

/**
 * A plugin of the file in the overview. Its body tells whether the project
 * has it installed, and how to import it (reuse the installed one or skip
 * it), then lists the exported ID that the project can't take. Without a
 * conflict, it tells what the import does with it.
 *
 * Memoized, as CardList asks of the components that make its items: the
 * overview renders again on every change of the form.
 */
export const PluginConflict = memo(function PluginConflict({
  entry,
  unresolved,
  inConflictsView,
}: Props) {
  const { exportPlugin, projectPlugin, idCollision, legacyIdIssue } = entry;
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const resolution = useResolutionStatusForPlugin(exportPlugin.id);
  const strategy = resolution?.values?.strategy;

  const ownIssues = useMemo(
    () => [idCollision, legacyIdIssue].filter(isDefined),
    [idCollision, legacyIdIssue],
  );

  // A reused or skipped plugin creates nothing: its ID needs no decision.
  // An installed plugin has only these two choices, thus never its own ID.
  const needsNewIds =
    !projectPlugin &&
    ownIssues.length > 0 &&
    strategy !== 'reuseExisting' &&
    strategy !== 'skip';
  const idIssuePending = usePendingIdIssue(ownIssues);

  return (
    <OverviewItem
      entity={exportPlugin}
      status={statusPill(unresolved, strategy, inConflictsView)}
    >
      {projectPlugin ? (
        <>
          <p className={s.text}>
            {`The project already has the plugin “${projectPlugin.attributes.name}”.`}
          </p>
          <Field
            name={`${fieldPrefix}.strategy`}
            subscription={{ value: true, error: true, touched: true }}
          >
            {({ input, meta }) => (
              <FieldWrapper
                label="How to import it"
                error={meta.touched ? meta.error : undefined}
              >
                <RadioGroupInput<Strategy>
                  value={input.value || null}
                  onChange={input.onChange}
                  onBlur={() => input.onBlur()}
                  options={options}
                />
              </FieldWrapper>
            )}
          </Field>
        </>
      ) : needsNewIds && idIssuePending && ownIssues.length > 1 ? (
        // One switch tells its reason in its own hint
        <p className={s.text}>Its ID can't be used in this project.</p>
      ) : needsNewIds ? null : (
        <p className={s.text}>The import installs it.</p>
      )}
      {needsNewIds ? (
        <div className={s.idGroup}>
          <SwitchList>
            {ownIssues.map((collision) => (
              <IdCollisionFallback
                key={`${collision.reason}-${collision.exportId}`}
                collision={collision}
              />
            ))}
          </SwitchList>
        </div>
      ) : null}
    </OverviewItem>
  );
});

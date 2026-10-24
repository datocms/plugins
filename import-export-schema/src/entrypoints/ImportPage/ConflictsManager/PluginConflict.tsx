import Callout from 'datocms-react-ui/Callout';
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
import { IdCollisionFallback } from './IdCollisionFallback';
import type { PluginEntry } from './useImportReview';

type Strategy = 'reuseExisting' | 'skip';

const options: RadioGroupOption<Strategy>[] = [
  { value: 'reuseExisting', label: 'Use the installed plugin' },
  { value: 'skip', label: 'Skip the plugin' },
];

type Props = {
  entry: PluginEntry;
  /** The conflict still needs a decision of the user */
  unresolved: boolean;
};

/** The state at the end of the row: the conflict, or the decision */
function statusPill(
  unresolved: boolean,
  strategy: Strategy | null | undefined,
) {
  if (unresolved) {
    return <Pill tone="danger">Conflict</Pill>;
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
 * it), then lists the exported ID that the project can't take.
 *
 * Memoized, as CardList asks of the components that make its items: the
 * overview renders again on every change of the form.
 */
export const PluginConflict = memo(function PluginConflict({
  entry,
  unresolved,
}: Props) {
  const { exportPlugin, projectPlugin, idCollision, legacyIdIssue } = entry;
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const resolution = useResolutionStatusForPlugin(exportPlugin.id);
  const strategy = resolution?.values?.strategy;

  const ownIssues = useMemo(
    () => [idCollision, legacyIdIssue].filter(isDefined),
    [idCollision, legacyIdIssue],
  );

  // A reused or skipped plugin creates nothing: its ID needs no decision
  const pluginWillBeCreated =
    strategy !== 'reuseExisting' && strategy !== 'skip';

  return (
    <OverviewItem
      entity={exportPlugin}
      status={statusPill(unresolved, strategy)}
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
      ) : ownIssues.length > 0 && pluginWillBeCreated ? (
        <Callout tone="warning" className={s.text}>
          The plugin isn't installed, but its exported ID is already used.
        </Callout>
      ) : (
        <p className={s.text}>No installed plugin has the same name or URL.</p>
      )}
      {pluginWillBeCreated && ownIssues.length > 0 ? (
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

import type { SchemaTypes } from '@datocms/cma-client';
import ApiKey from 'datocms-react-ui/ApiKey';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Pill from 'datocms-react-ui/Pill';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import { memo, useMemo } from 'react';
import { Field } from 'react-final-form';
import { FieldList } from '@/components/FieldList';
import { OverviewItem } from '@/components/SchemaOverview/OverviewItem';
import {
  EntriesPagination,
  usePaginatedEntries,
} from '@/components/SchemaOverview/PaginatedEntries';
import { isDefined } from '@/utils/isDefined';
import { useResolutionStatusForItemType } from '../ResolutionsForm';
import s from '../review.module.css';
import type { IdReplacementIssue } from './buildConflicts';
import { IdCollisionFallback, usePendingIdIssue } from './IdCollisionFallback';
import type { ItemTypeEntry } from './useImportReview';

type Props = {
  entry: ItemTypeEntry;
  /** The conflict still needs a decision of the user */
  unresolved: boolean;
  /**
   * The list shows only the conflicts, as its title says: the row then
   * needs no "Conflict" pill
   */
  inConflictsView: boolean;
};

type Strategy = 'rename' | 'reuseExisting';

function kindOf(itemType: SchemaTypes.ItemType) {
  return itemType.attributes.modular_block ? 'block' : 'model';
}

/**
 * The IDs of the item type, of its fields and of its fieldsets that need a
 * new ID: a list of switches, 100 per page past 200.
 */
function IdReplacementList({ issues }: { issues: IdReplacementIssue[] }) {
  const pagination = usePaginatedEntries(issues);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className={s.idGroup}>
      <SwitchList>
        {pagination.entries.map((collision) => (
          <IdCollisionFallback
            key={`${collision.entityType}-${collision.reason}-${collision.exportId}`}
            collision={collision}
          />
        ))}
      </SwitchList>
      <EntriesPagination pagination={pagination} ariaLabel="New IDs" />
    </div>
  );
}

/** The state at the end of the row: the conflict, or the decision */
function statusPill(
  unresolved: boolean,
  strategy: Strategy | null | undefined,
  inConflictsView: boolean,
) {
  if (unresolved) {
    return inConflictsView ? null : <Pill tone="warning">Conflict</Pill>;
  }
  if (strategy === 'rename') {
    return <Pill>Renamed</Pill>;
  }
  if (strategy === 'reuseExisting') {
    return <Pill>Uses existing</Pill>;
  }
  return null;
}

/**
 * What the item type of the file shares with the one of the project: the
 * name, the API key, or both.
 */
function MatchSentence({
  exportItemType,
  projectItemType,
}: {
  exportItemType: SchemaTypes.ItemType;
  projectItemType: SchemaTypes.ItemType;
}) {
  const { name, api_key: apiKey } = projectItemType.attributes;
  const sameName = exportItemType.attributes.name === name;
  const sameApiKey = exportItemType.attributes.api_key === apiKey;
  const kind = kindOf(projectItemType);

  if (sameName && !sameApiKey) {
    return (
      <p className={s.text}>
        {`The project already has a ${kind} named “${name}”.`}
      </p>
    );
  }
  if (!sameName) {
    return (
      <p className={s.text}>
        {`“${name}” in the project already uses the API key `}
        <ApiKey>{apiKey}</ApiKey>.
      </p>
    );
  }
  // Both by name: after a rename, the row title shows the new ones
  return (
    <p className={s.text}>
      {`“${name}” already exists in the project, with the API key `}
      <ApiKey>{apiKey}</ApiKey>.
    </p>
  );
}

/** How to import an item type that exists in the project: a new name, or reuse */
function StrategyField({
  exportItemType,
  projectItemType,
}: {
  exportItemType: SchemaTypes.ItemType;
  projectItemType: SchemaTypes.ItemType;
}) {
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const exportKind = kindOf(exportItemType);
  const projectKind = kindOf(projectItemType);
  const projectName = projectItemType.attributes.name;

  // A block can't stand in for a model, and the reverse
  const options = useMemo<RadioGroupOption<Strategy>[]>(
    () => [
      { value: 'rename', label: 'Create it with another name' },
      {
        value: 'reuseExisting',
        label: `Use the existing ${projectKind}`,
        hint: 'The import creates nothing and links to it.',
        ...(exportKind === projectKind
          ? {}
          : {
              disabled: true,
              tooltip: `“${projectName}” is a ${projectKind}, so it can't stand in for this ${exportKind}.`,
            }),
      },
    ],
    [exportKind, projectKind, projectName],
  );

  return (
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
  );
}

/**
 * The new name and API key of a renamed item type. Their errors show at
 * once: the suggested names can collide with the project or the import.
 */
function RenameFields({ fieldPrefix }: { fieldPrefix: string }) {
  return (
    <div className="form__field form__row">
      <div className="form__row__cell">
        <Field
          name={`${fieldPrefix}.name`}
          subscription={{ value: true, error: true }}
        >
          {({ input, meta }) => (
            <FieldWrapper label="Name" required error={meta.error}>
              <StringInput
                name={input.name}
                value={input.value}
                onChange={input.onChange}
                onBlur={() => input.onBlur()}
                autoComplete="off"
              />
            </FieldWrapper>
          )}
        </Field>
      </div>
      <div className="form__row__cell">
        <Field
          name={`${fieldPrefix}.apiKey`}
          subscription={{ value: true, error: true }}
        >
          {({ input, meta }) => (
            <FieldWrapper label="API key" required error={meta.error}>
              <StringInput
                code
                name={input.name}
                value={input.value}
                onChange={input.onChange}
                onBlur={() => input.onBlur()}
                autoComplete="off"
                spellCheck={false}
              />
            </FieldWrapper>
          )}
        </Field>
      </div>
    </div>
  );
}

/**
 * A model or block of the file in the overview. Its body tells whether the
 * project has one with the same name or API key, and how to import it, then
 * lists the exported IDs that the project can't take, and last its fields
 * and fieldsets. Without a conflict, it shows only the fields.
 *
 * Memoized, as CardList asks of the components that make its items: the
 * overview renders again on every change of the form.
 */
export const ItemTypeConflict = memo(function ItemTypeConflict({
  entry,
  unresolved,
  inConflictsView,
}: Props) {
  const {
    exportItemType,
    projectItemType,
    idCollision,
    legacyIdIssue,
    fieldIdCollisions,
    fieldLegacyIdIssues,
    fieldsetIdCollisions,
    fieldsetLegacyIdIssues,
  } = entry;
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const resolution = useResolutionStatusForItemType(exportItemType.id);
  const strategy = resolution?.values.strategy;
  // A rename shows its new name and API key, as the node of the graph does
  const renamed = strategy === 'rename' ? resolution?.values : undefined;

  // Its own IDs, then the IDs of its fields and of its fieldsets
  const idIssues = useMemo(
    () => [
      ...[idCollision, legacyIdIssue].filter(isDefined),
      ...fieldIdCollisions,
      ...fieldLegacyIdIssues,
      ...fieldsetIdCollisions,
      ...fieldsetLegacyIdIssues,
    ],
    [
      idCollision,
      legacyIdIssue,
      fieldIdCollisions,
      fieldLegacyIdIssues,
      fieldsetIdCollisions,
      fieldsetLegacyIdIssues,
    ],
  );

  // A reused item type creates nothing: its IDs need no decision
  const itemTypeWillBeCreated = strategy !== 'reuseExisting';
  const idIssuePending = usePendingIdIssue(idIssues);

  return (
    <OverviewItem
      entity={exportItemType}
      name={renamed?.name}
      apiKey={renamed?.apiKey}
      status={statusPill(unresolved, strategy, inConflictsView)}
    >
      {projectItemType ? (
        <>
          <MatchSentence
            exportItemType={exportItemType}
            projectItemType={projectItemType}
          />
          <StrategyField
            exportItemType={exportItemType}
            projectItemType={projectItemType}
          />
          {strategy === 'rename' ? (
            <RenameFields fieldPrefix={fieldPrefix} />
          ) : null}
        </>
      ) : idIssuePending && idIssues.length > 1 ? (
        // One switch tells its reason in its own hint
        <p className={s.text}>Some of its IDs can't be used in this project.</p>
      ) : null}
      {itemTypeWillBeCreated ? <IdReplacementList issues={idIssues} /> : null}
      <FieldList fields={entry.fields} fieldsets={entry.fieldsets} />
    </OverviewItem>
  );
});

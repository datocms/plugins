import type { SchemaTypes } from '@datocms/cma-client';
import ApiKey from 'datocms-react-ui/ApiKey';
import Callout from 'datocms-react-ui/Callout';
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
import { IdCollisionFallback } from './IdCollisionFallback';
import type { ItemTypeEntry } from './useImportReview';

type Props = {
  entry: ItemTypeEntry;
  /** The conflict still needs a decision of the user */
  unresolved: boolean;
};

type Strategy = 'rename' | 'reuseExisting';

function kindOf(itemType: SchemaTypes.ItemType) {
  return itemType.attributes.modular_block ? 'block' : 'model';
}

/**
 * The IDs of the fields or of the fieldsets that need a new ID: a list of
 * switches under a small label, 100 per page past 200.
 */
function IdReplacementList({
  issues,
  title,
}: {
  issues: IdReplacementIssue[];
  title: string;
}) {
  const pagination = usePaginatedEntries(issues);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className={s.idGroup}>
      <span className={s.groupLabel}>{title}</span>
      <SwitchList>
        {pagination.entries.map((collision) => (
          <IdCollisionFallback
            key={`${collision.reason}-${collision.exportId}`}
            collision={collision}
          />
        ))}
      </SwitchList>
      <EntriesPagination pagination={pagination} ariaLabel={title} />
    </div>
  );
}

/** The state at the end of the row: the conflict, or the decision */
function statusPill(
  unresolved: boolean,
  strategy: Strategy | null | undefined,
) {
  if (unresolved) {
    return <Pill tone="danger">Conflict</Pill>;
  }
  if (strategy === 'rename') {
    return <Pill>Renamed</Pill>;
  }
  if (strategy === 'reuseExisting') {
    return <Pill>Uses existing</Pill>;
  }
  return null;
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
 * and fieldsets (the hover card of its node shows them only to a pointer).
 *
 * Memoized, as CardList asks of the components that make its items: the
 * overview renders again on every change of the form.
 */
export const ItemTypeConflict = memo(function ItemTypeConflict({
  entry,
  unresolved,
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

  const ownIssues = useMemo(
    () => [idCollision, legacyIdIssue].filter(isDefined),
    [idCollision, legacyIdIssue],
  );
  const fieldReplacements = useMemo(
    () => [...fieldIdCollisions, ...fieldLegacyIdIssues],
    [fieldIdCollisions, fieldLegacyIdIssues],
  );
  const fieldsetReplacements = useMemo(
    () => [...fieldsetIdCollisions, ...fieldsetLegacyIdIssues],
    [fieldsetIdCollisions, fieldsetLegacyIdIssues],
  );

  // A reused item type creates nothing: its IDs need no decision
  const itemTypeWillBeCreated = strategy !== 'reuseExisting';
  const hasIdIssue =
    ownIssues.length > 0 ||
    fieldReplacements.length > 0 ||
    fieldsetReplacements.length > 0;

  return (
    <OverviewItem
      entity={exportItemType}
      status={statusPill(unresolved, strategy)}
    >
      {projectItemType ? (
        <>
          <p className={s.text}>
            {`The project already has a ${kindOf(projectItemType)} named “${projectItemType.attributes.name}” `}
            <ApiKey>{projectItemType.attributes.api_key}</ApiKey>.
          </p>
          <StrategyField
            exportItemType={exportItemType}
            projectItemType={projectItemType}
          />
          {strategy === 'rename' ? (
            <RenameFields fieldPrefix={fieldPrefix} />
          ) : null}
        </>
      ) : hasIdIssue ? (
        <Callout tone="warning" className={s.text}>
          The name and API key are free, but some exported IDs are already used
          in the project.
        </Callout>
      ) : (
        <p className={s.text}>The name and API key are free in this project.</p>
      )}
      {itemTypeWillBeCreated && ownIssues.length > 0 ? (
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
      {itemTypeWillBeCreated ? (
        <IdReplacementList issues={fieldReplacements} title="Field IDs" />
      ) : null}
      {itemTypeWillBeCreated ? (
        <IdReplacementList issues={fieldsetReplacements} title="Fieldset IDs" />
      ) : null}
      <div className={s.fieldsGroup}>
        <span className={s.groupLabel}>Fields</span>
        <FieldList fields={entry.fields} fieldsets={entry.fieldsets} />
      </div>
    </OverviewItem>
  );
});

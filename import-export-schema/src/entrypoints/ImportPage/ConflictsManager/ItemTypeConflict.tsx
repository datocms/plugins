import type { SchemaTypes } from '@datocms/cma-client';
import { SelectField, TextField } from 'datocms-react-ui';
import { useId, useMemo } from 'react';
import { Field } from 'react-final-form';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import { PaginatedEntries } from '@/components/SchemaOverview/PaginatedEntries';
import { useResolutionStatusForItemType } from '../ResolutionsForm';
import type {
  FieldIdCollision,
  FieldLegacyIdIssue,
  FieldsetIdCollision,
  FieldsetLegacyIdIssue,
  IdReplacementIssue,
  ItemTypeIdCollision,
  ItemTypeLegacyIdIssue,
} from './buildConflicts';
import { IdCollisionFallback } from './IdCollisionFallback';

type Option = { label: string; value: string };
type SelectGroup<OptionType> = {
  label?: string;
  options: readonly OptionType[];
};

type Props = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType?: SchemaTypes.ItemType;
  idCollision?: ItemTypeIdCollision;
  legacyIdIssue?: ItemTypeLegacyIdIssue;
  fieldIdCollisions: FieldIdCollision[];
  fieldLegacyIdIssues: FieldLegacyIdIssue[];
  fieldsetIdCollisions: FieldsetIdCollision[];
  fieldsetLegacyIdIssues: FieldsetLegacyIdIssue[];
  hasUnresolvedIdCollision: boolean;
};

function IdReplacementList({
  issues,
  title,
}: {
  issues: IdReplacementIssue[];
  title: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="form__item">
      <div style={{ fontWeight: 600 }}>{title}</div>
      <PaginatedEntries entries={issues}>
        {(collision) => (
          <IdCollisionFallback key={collision.exportId} collision={collision} />
        )}
      </PaginatedEntries>
    </div>
  );
}

function getConflictState(
  resolution: ReturnType<typeof useResolutionStatusForItemType>,
  projectItemType: SchemaTypes.ItemType | undefined,
  hasUnresolvedIdCollision: boolean,
  hasIdIssue: boolean,
) {
  const values = resolution?.values;
  const renameReady =
    values?.strategy === 'rename' &&
    Boolean(values.name && values.apiKey) &&
    !resolution?.invalid;
  const reuseReady =
    values?.strategy === 'reuseExisting' && !resolution?.invalid;
  const hasSemanticConflict =
    Boolean(projectItemType) && !(renameReady || reuseReady);
  const itemTypeWillBeCreated = values?.strategy !== 'reuseExisting';
  return {
    resolutionStrategyIsRename: values?.strategy === 'rename',
    itemTypeWillBeCreated,
    hasActiveIdCollision: itemTypeWillBeCreated && hasIdIssue,
    hasConflict: hasSemanticConflict || hasUnresolvedIdCollision,
    isInvalid:
      (hasSemanticConflict && Boolean(resolution?.invalid)) ||
      hasUnresolvedIdCollision,
  };
}

/**
 * Renders the resolution UI for a conflicting model/block, including rename inputs.
 */
export function ItemTypeConflict({
  exportItemType,
  projectItemType,
  idCollision,
  legacyIdIssue,
  fieldIdCollisions,
  fieldLegacyIdIssues,
  fieldsetIdCollisions,
  fieldsetLegacyIdIssues,
  hasUnresolvedIdCollision,
}: Props) {
  const selectId = useId();
  const nameId = useId();
  const apiKeyId = useId();
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const resolution = useResolutionStatusForItemType(exportItemType.id);
  const fieldReplacements = useMemo(
    () => [...fieldIdCollisions, ...fieldLegacyIdIssues],
    [fieldIdCollisions, fieldLegacyIdIssues],
  );
  const fieldsetReplacements = useMemo(
    () => [...fieldsetIdCollisions, ...fieldsetLegacyIdIssues],
    [fieldsetIdCollisions, fieldsetLegacyIdIssues],
  );

  const exportType = exportItemType.attributes.modular_block
    ? 'block'
    : 'model';
  const projectType = projectItemType?.attributes.modular_block
    ? 'block'
    : 'model';

  const {
    resolutionStrategyIsRename,
    itemTypeWillBeCreated,
    hasActiveIdCollision,
    hasConflict,
    isInvalid,
  } = getConflictState(
    resolution,
    projectItemType,
    hasUnresolvedIdCollision,
    [
      idCollision,
      legacyIdIssue,
      fieldReplacements.length,
      fieldsetReplacements.length,
    ].some(Boolean),
  );

  // Base strategy options; reuse is only valid for matching model/block types.
  const options: Option[] = [];

  if (projectItemType) {
    options.push({
      label: `Import ${exportType} using a different name`,
      value: 'rename',
    });

    if (
      exportItemType.attributes.modular_block ===
      projectItemType.attributes.modular_block
    ) {
      options.push({
        label: `Reuse the existing ${exportType}`,
        value: 'reuseExisting',
      });
    }
  }

  return (
    <Collapsible
      entity={exportItemType}
      invalid={isInvalid}
      hasConflict={hasConflict}
      title={exportItemType.attributes.name}
    >
      {projectItemType ? (
        <>
          <p>
            The project already has a {projectType} called{' '}
            <span className="no-text-wrap">
              <strong>{projectItemType.attributes.name}</strong>
            </span>{' '}
            (<code>{projectItemType.attributes.api_key}</code>).
          </p>
          <Field name={`${fieldPrefix}.strategy`}>
            {({ input, meta: { error } }) => (
              <SelectField<Option, false, SelectGroup<Option>>
                {...input}
                id={selectId}
                label="To resolve this conflict:"
                selectInputProps={{
                  options,
                }}
                value={
                  options.find((option) => input.value === option.value) ?? null
                }
                onChange={(option) =>
                  input.onChange(option ? option.value : null)
                }
                placeholder="Select..."
                error={error}
              />
            )}
          </Field>
          {resolutionStrategyIsRename && (
            <>
              <div className="form__item">
                <Field name={`${fieldPrefix}.name`}>
                  {({ input, meta: { error } }) => (
                    <TextField
                      id={nameId}
                      label="Name"
                      required
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </div>
              <div className="form__item">
                <Field name={`${fieldPrefix}.apiKey`}>
                  {({ input, meta: { error } }) => (
                    <TextField
                      id={apiKeyId}
                      label="API Identifier"
                      required
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </div>
            </>
          )}
        </>
      ) : hasActiveIdCollision ? (
        <p>
          No name or API key conflict was found for this {exportType}, but one
          or more exported IDs are already used in the project.
        </p>
      ) : (
        <p>No conflicts detected for this name and api key.</p>
      )}
      {idCollision && (
        <IdCollisionFallback
          collision={idCollision}
          active={itemTypeWillBeCreated}
        />
      )}
      {legacyIdIssue && (
        <IdCollisionFallback
          collision={legacyIdIssue}
          active={itemTypeWillBeCreated}
        />
      )}
      {itemTypeWillBeCreated && (
        <IdReplacementList
          issues={fieldReplacements}
          title="Field ID replacements"
        />
      )}
      {itemTypeWillBeCreated && (
        <IdReplacementList
          issues={fieldsetReplacements}
          title="Fieldset ID replacements"
        />
      )}
    </Collapsible>
  );
}

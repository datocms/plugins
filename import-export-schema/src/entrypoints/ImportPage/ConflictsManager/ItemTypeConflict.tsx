import type { SchemaTypes } from '@datocms/cma-client';
import { SelectField, TextField } from 'datocms-react-ui';
import { useId } from 'react';
import { Field } from 'react-final-form';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import { useResolutionStatusForItemType } from '../ResolutionsForm';
import { IdCollisionFallback } from './IdCollisionFallback';
import type {
  FieldIdCollision,
  FieldLegacyIdIssue,
  FieldsetIdCollision,
  FieldsetLegacyIdIssue,
  ItemTypeIdCollision,
  ItemTypeLegacyIdIssue,
} from './buildConflicts';

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

  const exportType = exportItemType.attributes.modular_block
    ? 'block'
    : 'model';
  const projectType = projectItemType?.attributes.modular_block
    ? 'block'
    : 'model';

  const resolutionValues = resolution?.values;
  const resolutionStrategy = resolutionValues?.strategy;

  const resolutionStrategyIsRename = resolutionStrategy === 'rename';
  const resolutionStrategyIsReuseExisting =
    resolutionStrategy === 'reuseExisting';

  const renameReady =
    resolutionStrategyIsRename &&
    !!resolutionValues?.name &&
    !!resolutionValues?.apiKey &&
    !resolution?.invalid;

  const reuseReady = resolutionStrategyIsReuseExisting && !resolution?.invalid;

  const semanticConflictResolved =
    Boolean(projectItemType) && (renameReady || reuseReady);

  const hasSemanticConflict =
    Boolean(projectItemType) && !semanticConflictResolved;

  const itemTypeWillBeCreated = !resolutionStrategyIsReuseExisting;
  const hasActiveIdCollision =
    itemTypeWillBeCreated &&
    Boolean(
      idCollision ||
        legacyIdIssue ||
        fieldIdCollisions.length > 0 ||
        fieldLegacyIdIssues.length > 0 ||
        fieldsetIdCollisions.length > 0 ||
        fieldsetLegacyIdIssues.length > 0,
    );

  const hasConflict = hasSemanticConflict || hasUnresolvedIdCollision;

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

  const isInvalid =
    (hasSemanticConflict && Boolean(resolution?.invalid)) ||
    hasUnresolvedIdCollision;

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
      {itemTypeWillBeCreated &&
        (fieldIdCollisions.length > 0 || fieldLegacyIdIssues.length > 0) && (
        <div className="form__item">
          <div style={{ fontWeight: 600 }}>Field ID replacements</div>
          {fieldIdCollisions.map((collision) => (
            <IdCollisionFallback
              key={collision.exportId}
              collision={collision}
            />
          ))}
          {fieldLegacyIdIssues.map((issue) => (
            <IdCollisionFallback key={issue.exportId} collision={issue} />
          ))}
        </div>
      )}
      {itemTypeWillBeCreated &&
        (fieldsetIdCollisions.length > 0 ||
          fieldsetLegacyIdIssues.length > 0) && (
        <div className="form__item">
          <div style={{ fontWeight: 600 }}>Fieldset ID replacements</div>
          {fieldsetIdCollisions.map((collision) => (
            <IdCollisionFallback
              key={collision.exportId}
              collision={collision}
            />
          ))}
          {fieldsetLegacyIdIssues.map((issue) => (
            <IdCollisionFallback key={issue.exportId} collision={issue} />
          ))}
        </div>
      )}
    </Collapsible>
  );
}

import type { SchemaTypes } from '@datocms/cma-client';
import { SelectField, TextField } from 'datocms-react-ui';
import { useContext, useId } from 'react';
import { Field } from 'react-final-form';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import { GraphEntitiesContext } from '../GraphEntitiesContext';
import { useResolutionStatusForItemType } from '../ResolutionsForm';

type Option = { label: string; value: string };
type SelectGroup<OptionType> = {
  label?: string;
  options: readonly OptionType[];
};

type Props = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType?: SchemaTypes.ItemType;
};

/**
 * Renders the resolution UI for a conflicting model/block, including rename inputs.
 */
export function ItemTypeConflict({ exportItemType, projectItemType }: Props) {
  const selectId = useId();
  const nameId = useId();
  const apiKeyId = useId();
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const resolution = useResolutionStatusForItemType(exportItemType.id);
  const { hasItemTypeNode } = useContext(GraphEntitiesContext);
  const nodeExists = hasItemTypeNode(exportItemType.id);

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

  const conflictResolved =
    Boolean(projectItemType) && (renameReady || reuseReady);

  const hasConflict = Boolean(projectItemType) && !conflictResolved;

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

  if (!nodeExists) {
    return null;
  }

  const isInvalid = hasConflict && Boolean(resolution?.invalid);

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
      ) : (
        <p>No conflicts detected for this name and api key.</p>
      )}
    </Collapsible>
  );
}

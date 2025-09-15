import type { SchemaTypes } from '@datocms/cma-client';
import { useReactFlow } from '@xyflow/react';
import { SelectField, TextField } from 'datocms-react-ui';
import { useId } from 'react';
import { Field } from 'react-final-form';
import type { GroupBase } from 'react-select';
import {
  useMassStrategies,
  useResolutionStatusForItemType,
} from '../ResolutionsForm';
import Collapsible from './Collapsible';

type Option = { label: string; value: string };

type Props = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType: SchemaTypes.ItemType;
};

export function ItemTypeConflict({ exportItemType, projectItemType }: Props) {
  const selectId = useId();
  const nameId = useId();
  const apiKeyId = useId();
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const resolution = useResolutionStatusForItemType(exportItemType.id)!;
  const node = useReactFlow().getNode(`itemType--${exportItemType.id}`);
  const mass = useMassStrategies();

  const exportType = exportItemType.attributes.modular_block
    ? 'block'
    : 'model';
  const projectType = projectItemType.attributes.modular_block
    ? 'block'
    : 'model';

  const options: Option[] = [
    { label: `Import ${exportType} using a different name`, value: 'rename' },
  ];

  if (
    exportItemType.attributes.modular_block ===
    projectItemType.attributes.modular_block
  ) {
    options.push({
      label: `Reuse the existing ${exportType}`,
      value: 'reuseExisting',
    });
  }

  if (!node) {
    return null;
  }

  const massStrategy = mass.itemTypesStrategy ?? null;
  const nameSuffix = mass.nameSuffix ?? ' (Import)';
  const apiKeySuffix = mass.apiKeySuffix ?? 'import';
  const matchesType =
    exportItemType.attributes.modular_block ===
    projectItemType.attributes.modular_block;

  let massSummary: JSX.Element | null = null;

  if (massStrategy === 'rename') {
    massSummary = (
      <div className="conflict__mass-rule">
        <strong>Global rename rule</strong>
        This {exportType} will be renamed automatically using the suffix{' '}
        <code>{nameSuffix}</code> and API key suffix <code>{apiKeySuffix}</code>.
      </div>
    );
  } else if (massStrategy === 'reuseExisting') {
    if (matchesType) {
      massSummary = (
        <div className="conflict__mass-rule">
          <strong>Global reuse rule</strong>
          This {exportType} will reuse the existing {projectType} in your
          project.
        </div>
      );
    } else {
      massSummary = (
        <div className="conflict__mass-rule">
          <strong>Global reuse rule</strong>
          This {exportType} can’t be reused because it conflicts with a{' '}
          {projectType} already in your project. A new copy will be created
          using the suffix <code>{nameSuffix}</code> and API key suffix{' '}
          <code>{apiKeySuffix}</code>.
        </div>
      );
    }
  }

  return (
    <Collapsible
      entity={exportItemType}
      invalid={resolution.invalid}
      title={exportItemType.attributes.name}
    >
      <p>
        The project already has a {projectType} called{' '}
        <span className="no-text-wrap">
          <strong>{projectItemType.attributes.name}</strong>
        </span>{' '}
        (<code>{projectItemType.attributes.api_key}</code>).
      </p>
      {massSummary ? (
        massSummary
      ) : (
        <>
          <Field name={`${fieldPrefix}.strategy`}>
            {({ input, meta: { error } }) => (
              <SelectField<Option, false, GroupBase<Option>>
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
          {resolution.values.strategy === 'rename' && (
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
      )}
    </Collapsible>
  );
}

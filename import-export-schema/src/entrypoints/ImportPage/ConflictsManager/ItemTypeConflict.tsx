import type { SchemaTypes } from '@datocms/cma-client';
import { useReactFlow } from '@xyflow/react';
import { SelectField, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import type { GroupBase } from 'react-select';
import { useResolutionStatusForItemType } from '../ResolutionsForm';
import Collapsible from './Collapsible';

type Option = { label: string; value: string };

type Props = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType: SchemaTypes.ItemType;
};

export function ItemTypeConflict({ exportItemType, projectItemType }: Props) {
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const resolution = useResolutionStatusForItemType(exportItemType.id)!;
  const node = useReactFlow().getNode(`itemType--${exportItemType.id}`);

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
      <Field name={`${fieldPrefix}.strategy`}>
        {({ input, meta: { error } }) => (
          <SelectField<Option, false, GroupBase<Option>>
            {...input}
            id="fieldTypes"
            label="To resolve this conflict:"
            selectInputProps={{
              options,
            }}
            value={options.find((ft) => input.value.includes(ft.value))}
            onChange={(option) => input.onChange(option ? option.value : null)}
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
                  id="name"
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
                  id="apiKey"
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
    </Collapsible>
  );
}

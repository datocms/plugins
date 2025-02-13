import type { SchemaTypes } from '@datocms/cma-client';
import { useReactFlow } from '@xyflow/react';
import { FieldGroup, SelectField, TextField } from 'datocms-react-ui';
import { get } from 'lodash-es';
import { useContext, useEffect, useRef } from 'react';
import { Field, useFormState } from 'react-final-form';
import type { GroupBase } from 'react-select';
import { SelectedEntityContext } from '../SelectedEntityContext';
import Collapsible from './Collapsible';

type Option = { label: string; value: string };

type Props = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType: SchemaTypes.ItemType;
};

export function ItemTypeConflict({ exportItemType, projectItemType }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const selectedEntityContext = useContext(SelectedEntityContext);
  const fieldPrefix = `itemType-${exportItemType.id}`;
  const formState = useFormState();
  const anyError = get(formState.errors, fieldPrefix);
  const strategy = get(formState.values, `${fieldPrefix}.strategy`);
  const node = useReactFlow().getNode(`itemType--${exportItemType.id}`);

  const isSelected = selectedEntityContext?.entity === exportItemType;

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

  useEffect(() => {
    if (isSelected) {
      elRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isSelected]);

  function handleSelect() {
    if (selectedEntityContext?.entity === exportItemType) {
      selectedEntityContext?.set(undefined, true);
    } else {
      selectedEntityContext?.set(exportItemType, true);
    }
  }

  if (!node) {
    return null;
  }

  return (
    <Collapsible
      open={isSelected}
      invalid={anyError}
      onToggle={handleSelect}
      ref={elRef}
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
      {strategy === 'rename' && (
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

import type { SchemaTypes } from '@datocms/cma-client';
import { useReactFlow } from '@xyflow/react';
import { Form, SelectField } from 'datocms-react-ui';
import { get } from 'lodash-es';
import { useContext, useEffect, useRef } from 'react';
import { Field, useFormState } from 'react-final-form';
import type { GroupBase } from 'react-select';
import { SelectedEntityContext } from '../SelectedEntityContext';
import Collapsible from './Collapsible';

type Option = { label: string; value: string };

const options: Option[] = [
  {
    label: 'Try to reuse the existing plugin',
    value: 'reuseExisting',
  },
  { label: 'Ignore the plugin', value: 'skip' },
];

type Props = {
  exportPlugin: SchemaTypes.Plugin;
  projectPlugin: SchemaTypes.Plugin;
};

export function PluginConflict({ exportPlugin, projectPlugin }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const selectedEntityContext = useContext(SelectedEntityContext);
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const anyError = get(useFormState().errors, fieldPrefix);
  const node = useReactFlow().getNode(`plugin--${exportPlugin.id}`);
  const isSelected = selectedEntityContext?.entity === exportPlugin;

  useEffect(() => {
    if (isSelected) {
      elRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isSelected]);

  function handleSelect() {
    if (selectedEntityContext?.entity === exportPlugin) {
      selectedEntityContext?.set(undefined, true);
    } else {
      selectedEntityContext?.set(exportPlugin, true);
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
      title={exportPlugin.attributes.name}
    >
      <p>
        The project already has the plugin{' '}
        <strong>{projectPlugin.attributes.name}</strong>.
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
    </Collapsible>
  );
}

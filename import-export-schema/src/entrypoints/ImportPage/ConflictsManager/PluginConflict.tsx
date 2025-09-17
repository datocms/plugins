import type { SchemaTypes } from '@datocms/cma-client';
import { useReactFlow } from '@xyflow/react';
import { SelectField } from 'datocms-react-ui';
import { useId } from 'react';
import { Field } from 'react-final-form';
import { useResolutionStatusForPlugin } from '../ResolutionsForm';
import Collapsible from './Collapsible';

type Option = { label: string; value: string };
type SelectGroup<OptionType> = {
  label?: string;
  options: readonly OptionType[];
};

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
  const selectId = useId();
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const resolution = useResolutionStatusForPlugin(exportPlugin.id)!;
  const node = useReactFlow().getNode(`plugin--${exportPlugin.id}`);

  if (!node) {
    return null;
  }

  return (
    <Collapsible
      entity={exportPlugin}
      invalid={resolution.invalid}
      title={exportPlugin.attributes.name}
    >
      <p>
        The project already has the plugin{' '}
        <strong>{projectPlugin.attributes.name}</strong>.
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
            onChange={(option) => input.onChange(option ? option.value : null)}
            placeholder="Select..."
            error={error}
          />
        )}
      </Field>
    </Collapsible>
  );
}

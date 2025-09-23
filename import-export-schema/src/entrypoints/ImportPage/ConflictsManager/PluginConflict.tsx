import type { SchemaTypes } from '@datocms/cma-client';
import { SelectField } from 'datocms-react-ui';
import { useContext, useId } from 'react';
import { Field } from 'react-final-form';
import { useResolutionStatusForPlugin } from '../ResolutionsForm';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import { GraphEntitiesContext } from '../GraphEntitiesContext';

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
  projectPlugin?: SchemaTypes.Plugin;
};

/** Presents resolution choices for plugin conflicts (reuse vs. skip). */
export function PluginConflict({ exportPlugin, projectPlugin }: Props) {
  const selectId = useId();
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const resolution = useResolutionStatusForPlugin(exportPlugin.id);
  const { hasPluginNode } = useContext(GraphEntitiesContext);
  const nodeExists = hasPluginNode(exportPlugin.id);

  const strategy = resolution?.values?.strategy;
  const hasValidResolution = Boolean(
    !resolution?.invalid &&
      (strategy === 'reuseExisting' || strategy === 'skip'),
  );

  const hasConflict = Boolean(projectPlugin) && !hasValidResolution;

  if (!nodeExists) {
    return null;
  }

  return (
    <Collapsible
      entity={exportPlugin}
      invalid={hasConflict && Boolean(resolution?.invalid)}
      hasConflict={hasConflict}
      title={exportPlugin.attributes.name}
    >
      {projectPlugin ? (
        <>
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
                onChange={(option) =>
                  input.onChange(option ? option.value : null)
                }
                placeholder="Select..."
                error={error}
              />
            )}
          </Field>
        </>
      ) : (
        <p>No conflicts detected for this name or URL.</p>
      )}
    </Collapsible>
  );
}

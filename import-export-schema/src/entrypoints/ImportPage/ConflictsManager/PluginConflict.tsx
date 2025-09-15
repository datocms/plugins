import type { SchemaTypes } from '@datocms/cma-client';
import { useReactFlow } from '@xyflow/react';
import { SelectField } from 'datocms-react-ui';
import { useId } from 'react';
import { Field } from 'react-final-form';
import type { GroupBase } from 'react-select';
import {
  useMassStrategies,
  useResolutionStatusForPlugin,
} from '../ResolutionsForm';
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
  const selectId = useId();
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const resolution = useResolutionStatusForPlugin(exportPlugin.id)!;
  const node = useReactFlow().getNode(`plugin--${exportPlugin.id}`);
  const mass = useMassStrategies();

  if (!node) {
    return null;
  }

  const massStrategy = mass.pluginsStrategy ?? null;
  let massSummary: JSX.Element | null = null;

  if (massStrategy === 'reuseExisting') {
    massSummary = (
      <div className="conflict__mass-rule">
        <strong>Global plugin rule</strong>
        This plugin will reuse the version already installed in this project.
      </div>
    );
  } else if (massStrategy === 'skip') {
    massSummary = (
      <div className="conflict__mass-rule">
        <strong>Global plugin rule</strong>
        This plugin will be skipped during import as per the global setting.
      </div>
    );
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
      {massSummary ? (
        massSummary
      ) : (
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
      )}
    </Collapsible>
  );
}

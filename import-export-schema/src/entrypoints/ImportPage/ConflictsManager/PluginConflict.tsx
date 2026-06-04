import type { SchemaTypes } from '@datocms/cma-client';
import { SelectField } from 'datocms-react-ui';
import { useId } from 'react';
import { Field } from 'react-final-form';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import { useResolutionStatusForPlugin } from '../ResolutionsForm';
import { IdCollisionFallback } from './IdCollisionFallback';
import type { PluginIdCollision, PluginLegacyIdIssue } from './buildConflicts';

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
  idCollision?: PluginIdCollision;
  legacyIdIssue?: PluginLegacyIdIssue;
  hasUnresolvedIdCollision: boolean;
};

/** Presents resolution choices for plugin conflicts (reuse vs. skip). */
export function PluginConflict({
  exportPlugin,
  projectPlugin,
  idCollision,
  legacyIdIssue,
  hasUnresolvedIdCollision,
}: Props) {
  const selectId = useId();
  const fieldPrefix = `plugin-${exportPlugin.id}`;
  const resolution = useResolutionStatusForPlugin(exportPlugin.id);

  const strategy = resolution?.values?.strategy;
  const hasValidResolution = Boolean(
    !resolution?.invalid &&
      (strategy === 'reuseExisting' || strategy === 'skip'),
  );

  const hasSemanticConflict = Boolean(projectPlugin) && !hasValidResolution;
  const pluginWillBeCreated =
    strategy !== 'reuseExisting' && strategy !== 'skip';
  const hasConflict = hasSemanticConflict || hasUnresolvedIdCollision;

  return (
    <Collapsible
      entity={exportPlugin}
      invalid={
        (hasSemanticConflict && Boolean(resolution?.invalid)) ||
        hasUnresolvedIdCollision
      }
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
      ) : (idCollision || legacyIdIssue) && pluginWillBeCreated ? (
        <p>
          No name or URL conflict was found for this plugin, but its exported ID
          needs a replacement before import.
        </p>
      ) : (
        <p>No conflicts detected for this name or URL.</p>
      )}
      {idCollision && (
        <IdCollisionFallback
          collision={idCollision}
          active={pluginWillBeCreated}
        />
      )}
      {legacyIdIssue && (
        <IdCollisionFallback
          collision={legacyIdIssue}
          active={pluginWillBeCreated}
        />
      )}
    </Collapsible>
  );
}

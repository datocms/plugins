import type { ProjectSchema } from '@/utils/ProjectSchema';
import { useNodes, useReactFlow } from '@xyflow/react';
import { get, keyBy, set } from 'lodash-es';
import { type ReactNode, useContext, useMemo } from 'react';
import { Form as FormHandler, useFormState } from 'react-final-form';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';

export type ItemTypeConflictResolutionRename = {
  strategy: 'rename';
  apiKey: string;
  name: string;
};

export type ItemTypeConflictResolution =
  | { strategy: 'reuseExisting' }
  | ItemTypeConflictResolutionRename;

export type PluginConflictResolution = {
  strategy: 'reuseExisting' | 'skip';
};

export type Resolutions = {
  itemTypes: Partial<Record<string, ItemTypeConflictResolution>>;
  plugins: Partial<Record<string, PluginConflictResolution>>;
};

type ItemTypeValues = {
  strategy: 'reuseExisting' | 'rename' | null;
  apiKey?: string;
  name?: string;
};
type PluginValues = { strategy: 'reuseExisting' | 'skip' | null };

type FormValues = Record<string, ItemTypeValues | PluginValues>;

type Props = {
  children: ReactNode;
  schema: ProjectSchema;
  onSubmit: (values: Resolutions) => void;
};

function isValidApiKey(apiKey: string) {
  if (!apiKey.match(/^[a-z](([a-z0-9]|_(?![_0-9]))*[a-z0-9])$/)) {
    return false;
  }

  if (
    [
      'id',
      'find',
      'site',
      'environment',
      'available_locales',
      'item_types',
      'single_instance_item_types',
      'collection_item_types',
      'items_of_type',
      'model',
    ].includes(apiKey)
  ) {
    return false;
  }

  return true;
}

export default function ResolutionsForm({ schema, children, onSubmit }: Props) {
  const conflicts = useContext(ConflictsContext);

  const { getNode } = useReactFlow();

  // we need this to re-render this component everytime the nodes change, and
  // revalidate the form!
  useNodes();

  const initialValues = useMemo<FormValues>(
    () =>
      conflicts
        ? {
            ...Object.fromEntries(
              Object.keys(conflicts.plugins).map((id) => [
                `plugin-${id}`,
                { strategy: null },
              ]),
            ),
            ...Object.fromEntries(
              Object.entries(conflicts.itemTypes).map(
                ([id, projectItemType]) => [
                  `itemType-${id}`,
                  {
                    strategy: null,
                    name: `${projectItemType.attributes.name} (Import)`,
                    apiKey: `${projectItemType.attributes.api_key}_import`,
                  },
                ],
              ),
            ),
          }
        : {},
    [conflicts],
  );

  function handleSubmit(values: FormValues) {
    const resolutions: Resolutions = { itemTypes: {}, plugins: {} };

    if (!conflicts) {
      return resolutions;
    }

    for (const pluginId of Object.keys(conflicts.plugins)) {
      if (!getNode(`plugin--${pluginId}`)) {
        continue;
      }

      const result = get(values, [`plugin-${pluginId}`]) as PluginValues;

      resolutions.plugins[pluginId] = {
        strategy: result.strategy as 'reuseExisting' | 'skip',
      };
    }

    for (const itemTypeId of Object.keys(conflicts.itemTypes)) {
      if (!getNode(`itemType--${itemTypeId}`)) {
        continue;
      }

      const fieldPrefix = `itemType-${itemTypeId}`;

      const result = get(values, fieldPrefix) as ItemTypeValues;

      if (result.strategy === 'reuseExisting') {
        resolutions.itemTypes[itemTypeId] = { strategy: 'reuseExisting' };
      } else {
        resolutions.itemTypes[itemTypeId] = {
          strategy: 'rename',
          apiKey: result.apiKey!,
          name: result.name!,
        };
      }
    }

    onSubmit(resolutions);
  }

  if (!conflicts) {
    return null;
  }

  return (
    <FormHandler<FormValues>
      initialValues={initialValues}
      validate={async (values) => {
        const errors: Record<string, string> = {};

        if (!conflicts) {
          return {};
        }

        const projectItemTypes = await schema.getAllItemTypes();
        const itemTypesByName = keyBy(projectItemTypes, 'attributes.name');
        const itemTypesByApiKey = keyBy(projectItemTypes, 'attributes.api_key');

        for (const pluginId of Object.keys(conflicts.plugins)) {
          if (!getNode(`plugin--${pluginId}`)) {
            continue;
          }

          const fieldPrefix = `plugin-${pluginId}`;

          if (!get(values, [fieldPrefix, 'strategy'])) {
            set(errors, [fieldPrefix, 'strategy'], 'Required!');
          }
        }

        for (const itemTypeId of Object.keys(conflicts.itemTypes)) {
          if (!getNode(`itemType--${itemTypeId}`)) {
            continue;
          }

          const fieldPrefix = `itemType-${itemTypeId}`;

          const strategy = get(values, [fieldPrefix, 'strategy']);

          if (!strategy) {
            set(errors, [fieldPrefix, 'strategy'], 'Required!');
          }

          if (strategy === 'rename') {
            const name = get(values, [fieldPrefix, 'name']);

            if (!name) {
              set(errors, [fieldPrefix, 'name'], 'Required!');
            } else if (name in itemTypesByName) {
              set(errors, [fieldPrefix, 'name'], 'Already used in project!');
            }

            const apiKey = get(values, [fieldPrefix, 'apiKey']);

            if (!apiKey) {
              set(errors, [fieldPrefix, 'apiKey'], 'Required!');
            } else if (!isValidApiKey(apiKey)) {
              set(errors, [fieldPrefix, 'apiKey'], 'Invalid format');
            } else if (apiKey in itemTypesByApiKey) {
              set(errors, [fieldPrefix, 'apiKey'], 'Already used in project!');
            }
          }
        }

        return errors;
      }}
      onSubmit={handleSubmit}
    >
      {({ handleSubmit, errors }) => (
        <form onSubmit={handleSubmit}>{children}</form>
      )}
    </FormHandler>
  );
}

export function useResolutionStatusForItemType(itemTypeId: string) {
  const state = useFormState<FormValues>();

  const fieldPrefix = `itemType-${itemTypeId}`;

  const errors = get(state.errors, [fieldPrefix]);
  const values = get(state.values, [fieldPrefix]) as ItemTypeValues | undefined;

  if (!values) {
    return undefined;
  }

  return {
    invalid: Boolean(errors),
    values,
  };
}

export function useResolutionStatusForPlugin(pluginId: string) {
  const state = useFormState<FormValues>();

  const fieldPrefix = `plugin-${pluginId}`;

  const errors = get(state.errors, [fieldPrefix]);
  const values = get(state.values, [fieldPrefix]) as PluginValues | undefined;

  if (!values) {
    return undefined;
  }

  return {
    invalid: Boolean(errors),
    values,
  };
}

export function useSkippedItemsAndPluginIds() {
  const conflicts = useContext(ConflictsContext);
  const formState = useFormState<FormValues>();

  const skippedItemTypeIds = useMemo(
    () =>
      Object.keys(conflicts.itemTypes).filter(
        (itemTypeId) =>
          get(formState.values, [`itemType-${itemTypeId}`, 'strategy']) ===
          'reuseExisting',
      ),
    [formState, conflicts],
  );

  const skippedPluginIds = useMemo(
    () =>
      Object.keys(conflicts.plugins).filter(
        (pluginId) =>
          get(formState.values, [`plugin-${pluginId}`, 'strategy']) ===
          'reuseExisting',
      ),
    [formState, conflicts],
  );

  return { skippedItemTypeIds, skippedPluginIds };
}

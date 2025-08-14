import { useNodes, useReactFlow } from '@xyflow/react';
import { get, keyBy, set } from 'lodash-es';
import { type ReactNode, useContext, useMemo } from 'react';
import { Form as FormHandler, useFormState } from 'react-final-form';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { ProjectSchema } from '@/utils/ProjectSchema';
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

type MassValues = {
  itemTypesStrategy?: 'reuseExisting' | 'rename' | null;
  pluginsStrategy?: 'reuseExisting' | 'skip' | null;
  nameSuffix?: string;
  apiKeySuffix?: string;
};

type FormValues = Record<string, ItemTypeValues | PluginValues> & {
  mass?: MassValues;
};

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
            mass: {
              itemTypesStrategy: null,
              pluginsStrategy: null,
              nameSuffix: ' (Import)',
              apiKeySuffix: 'import',
            },
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

  async function handleSubmit(values: FormValues) {
    const resolutions: Resolutions = { itemTypes: {}, plugins: {} };

    if (!conflicts) {
      return resolutions;
    }

    const mass = values.mass;
    // Preload project names/apiKeys once to guarantee uniqueness for mass-renames
    const projectItemTypes = await schema.getAllItemTypes();
    const usedNames = new Set(projectItemTypes.map((it) => it.attributes.name));
    const usedApiKeys = new Set(
      projectItemTypes.map((it) => it.attributes.api_key),
    );

    function computeUniqueRename(
      baseName: string,
      baseApiKey: string,
      nameSuffix: string,
      apiKeySuffix: string,
      usedNames: Set<string>,
      usedApiKeys: Set<string>,
    ) {
      let name = `${baseName}${nameSuffix}`;
      let apiKey = `${baseApiKey}${apiKeySuffix}`;
      let i = 2;
      while (usedNames.has(name)) {
        name = `${baseName}${nameSuffix} ${i}`;
        i += 1;
      }
      i = 2;
      while (usedApiKeys.has(apiKey)) {
        apiKey = `${baseApiKey}${apiKeySuffix}${i}`;
        i += 1;
      }
      usedNames.add(name);
      usedApiKeys.add(apiKey);
      return { name, apiKey };
    }

    for (const pluginId of Object.keys(conflicts.plugins)) {
      if (!getNode(`plugin--${pluginId}`)) {
        continue;
      }

      // Apply mass plugin strategy if set; otherwise use per-plugin selection
      if (mass?.pluginsStrategy) {
        resolutions.plugins[pluginId] = { strategy: mass.pluginsStrategy };
      } else {
        const result = get(values, [`plugin-${pluginId}`]) as PluginValues;
        if (result?.strategy) {
          resolutions.plugins[pluginId] = {
            strategy: result.strategy as 'reuseExisting' | 'skip',
          };
        }
      }
    }

    for (const itemTypeId of Object.keys(conflicts.itemTypes)) {
      const node = getNode(`itemType--${itemTypeId}`);
      if (!node) {
        continue;
      }

      const exportItemType = (node.data as ItemTypeNode['data'])
        .itemType as import('@datocms/cma-client').SchemaTypes.ItemType;

      if (mass?.itemTypesStrategy) {
        if (mass.itemTypesStrategy === 'reuseExisting') {
          // Reuse only when modular_block matches; otherwise mass-rename fallback with suffixes
          const projectItemType = conflicts.itemTypes[itemTypeId];
          const compatible =
            exportItemType.attributes.modular_block ===
            projectItemType.attributes.modular_block;
          if (compatible) {
            resolutions.itemTypes[itemTypeId] = { strategy: 'reuseExisting' };
          } else {
            // Ensure unique names using suffixes
            const { name, apiKey } = computeUniqueRename(
              exportItemType.attributes.name,
              exportItemType.attributes.api_key,
              mass.nameSuffix || ' (Import)',
              mass.apiKeySuffix || 'import',
              usedNames,
              usedApiKeys,
            );
            resolutions.itemTypes[itemTypeId] = {
              strategy: 'rename',
              name,
              apiKey,
            };
          }
        } else if (mass.itemTypesStrategy === 'rename') {
          const { name, apiKey } = computeUniqueRename(
            exportItemType.attributes.name,
            exportItemType.attributes.api_key,
            mass.nameSuffix || ' (Import)',
            mass.apiKeySuffix || 'import',
            usedNames,
            usedApiKeys,
          );
          resolutions.itemTypes[itemTypeId] = {
            strategy: 'rename',
            name,
            apiKey,
          };
        }
      } else {
        const fieldPrefix = `itemType-${itemTypeId}`;
        const result = get(values, fieldPrefix) as ItemTypeValues;

        if (result?.strategy === 'reuseExisting') {
          resolutions.itemTypes[itemTypeId] = { strategy: 'reuseExisting' };
        } else if (result?.strategy === 'rename') {
          resolutions.itemTypes[itemTypeId] = {
            strategy: 'rename',
            apiKey: result.apiKey!,
            name: result.name!,
          };
        }
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

        const mass = values.mass;

        for (const pluginId of Object.keys(conflicts.plugins)) {
          if (!getNode(`plugin--${pluginId}`)) {
            continue;
          }

          const fieldPrefix = `plugin-${pluginId}`;
          if (!mass?.pluginsStrategy) {
            if (!get(values, [fieldPrefix, 'strategy'])) {
              set(errors, [fieldPrefix, 'strategy'], 'Required!');
            }
          }
        }

        for (const itemTypeId of Object.keys(conflicts.itemTypes)) {
          if (!getNode(`itemType--${itemTypeId}`)) {
            continue;
          }

          const fieldPrefix = `itemType-${itemTypeId}`;
          if (!mass?.itemTypesStrategy) {
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
                set(
                  errors,
                  [fieldPrefix, 'apiKey'],
                  'Already used in project!',
                );
              }
            }
          } else if (mass.itemTypesStrategy === 'rename') {
            // Validate mass suffixes
            const nameSuffix = mass.nameSuffix || ' (Import)';
            const apiKeySuffix = mass.apiKeySuffix || 'import';
            // Basic validation of apiKeySuffix
            if (
              !/^[a-z0-9_]+$/.test(apiKeySuffix) ||
              !/^[a-z]/.test(apiKeySuffix) ||
              !/[a-z0-9]$/.test(apiKeySuffix)
            ) {
              set(errors, ['mass', 'apiKeySuffix'], 'Invalid API key suffix');
            }
            if (nameSuffix === undefined) {
              set(errors, ['mass', 'nameSuffix'], 'Name suffix required');
            }
          }
        }

        return errors;
      }}
      onSubmit={handleSubmit}
    >
      {({ handleSubmit }) => <form onSubmit={handleSubmit}>{children}</form>}
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

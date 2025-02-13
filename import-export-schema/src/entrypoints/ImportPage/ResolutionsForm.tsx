import { get, keyBy, set } from 'lodash-es';
import { type ReactNode, useContext, useMemo } from 'react';
import { Form as FormHandler } from 'react-final-form';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeManager } from '@/utils/itemTypeManager';
import { useReactFlow } from '@xyflow/react';

type ItemTypeConflictResolution = {
  strategy: 'rename' | 'reuseExisting' | null;
};

type PluginConflictResolution = {
  strategy: 'reuseExisting' | 'skip' | null;
};

type FormValues = {
  itemTypes: Record<string, ItemTypeConflictResolution>;
  plugins: Record<string, PluginConflictResolution>;
};

type Props = {
  children: ReactNode;
  schema: ItemTypeManager;
  onSubmit: (values: FormValues) => void;
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

  const initialValues = useMemo(
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

          if (!get(values, `plugin-${pluginId}.strategy`)) {
            set(errors, `plugin-${pluginId}.strategy`, 'Required!');
          }
        }

        for (const itemTypeId of Object.keys(conflicts.itemTypes)) {
          if (!getNode(`itemType--${itemTypeId}`)) {
            continue;
          }

          const strategy = get(values, `itemType-${itemTypeId}.strategy`);
          if (!strategy) {
            set(errors, `itemType-${itemTypeId}.strategy`, 'Required!');
          }

          if (strategy === 'rename') {
            const name = get(values, `itemType-${itemTypeId}.name`) as
              | string
              | undefined;

            if (!name) {
              set(errors, `itemType-${itemTypeId}.name`, 'Required!');
            } else if (name in itemTypesByName) {
              set(
                errors,
                `itemType-${itemTypeId}.name`,
                'Already used in project!',
              );
            }

            const apiKey = get(values, `itemType-${itemTypeId}.apiKey`) as
              | string
              | undefined;

            if (!apiKey) {
              set(errors, `itemType-${itemTypeId}.apiKey`, 'Required!');
            } else if (!isValidApiKey(apiKey)) {
              set(errors, `itemType-${itemTypeId}.apiKey`, 'Invalid format');
            } else if (apiKey in itemTypesByApiKey) {
              set(
                errors,
                `itemType-${itemTypeId}.apiKey`,
                'Already used in project!',
              );
            }
          }
        }

        return errors;
      }}
      onSubmit={onSubmit}
    >
      {({ handleSubmit }) => <form onSubmit={handleSubmit}>{children}</form>}
    </FormHandler>
  );
}

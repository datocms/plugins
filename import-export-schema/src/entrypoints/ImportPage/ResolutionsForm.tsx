import get from 'lodash-es/get';
import keyBy from 'lodash-es/keyBy';
import set from 'lodash-es/set';
import { type ReactNode, useContext, useMemo } from 'react';
import { Form as FormHandler, useFormState } from 'react-final-form';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';
import type {
  Conflicts,
  IdCollisionEntityType,
} from './ConflictsManager/buildConflicts';

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

export type IdCollisionResolution = {
  strategy: 'generateReplacement';
};

export type Resolutions = {
  itemTypes: Partial<Record<string, ItemTypeConflictResolution>>;
  plugins: Partial<Record<string, PluginConflictResolution>>;
  idCollisions: Partial<Record<string, IdCollisionResolution>>;
};

type ItemTypeValues = {
  strategy: 'reuseExisting' | 'rename' | null;
  apiKey?: string;
  name?: string;
};
type PluginValues = { strategy: 'reuseExisting' | 'skip' | null };
type IdCollisionValues = { strategy: 'generateReplacement' | null };

type FormValues = Record<
  string,
  ItemTypeValues | PluginValues | IdCollisionValues
>;

type Props = {
  children: ReactNode;
  schema: ProjectSchema;
  onSubmit: (values: Resolutions) => void;
};

export function idCollisionResolutionKey(
  entityType: IdCollisionEntityType,
  id: string,
) {
  return `${entityType}-${id}`;
}

export function idCollisionFieldPrefix(
  entityType: IdCollisionEntityType,
  id: string,
) {
  return `idCollision-${idCollisionResolutionKey(entityType, id)}`;
}

function getIdCollisionCount(conflicts: Conflicts) {
  return (
    Object.keys(conflicts.ids.itemTypes).length +
    Object.keys(conflicts.ids.fields).length +
    Object.keys(conflicts.ids.fieldsets).length +
    Object.keys(conflicts.ids.plugins).length +
    Object.keys(conflicts.legacyIds.itemTypes).length +
    Object.keys(conflicts.legacyIds.fields).length +
    Object.keys(conflicts.legacyIds.fieldsets).length +
    Object.keys(conflicts.legacyIds.plugins).length
  );
}

// Mirrors the platform validation rules plus common reserved identifiers.
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

/**
 * Validate all plugin conflict fields, returning errors for missing strategies.
 */
function validatePluginFields(
  values: FormValues,
  pluginIds: string[],
  errors: Record<string, string>,
) {
  for (const pluginId of pluginIds) {
    const fieldPrefix = `plugin-${pluginId}`;
    if (!get(values, [fieldPrefix, 'strategy'])) {
      set(errors, [fieldPrefix, 'strategy'], 'Required!');
    }
  }
}

function validateIdCollisionField(
  values: FormValues,
  errors: Record<string, string>,
  entityType: IdCollisionEntityType,
  id: string,
) {
  const fieldPrefix = idCollisionFieldPrefix(entityType, id);
  const strategy = get(values, [fieldPrefix, 'strategy']);

  if (strategy !== 'generateReplacement') {
    set(errors, [fieldPrefix, 'strategy'], 'Required!');
  }
}

function validateIdCollisionFields(
  conflicts: Conflicts,
  values: FormValues,
  errors: Record<string, string>,
) {
  for (const itemTypeId of Object.keys(conflicts.ids.itemTypes)) {
    const itemTypeStrategy = get(values, [
      `itemType-${itemTypeId}`,
      'strategy',
    ]);
    if (itemTypeStrategy !== 'reuseExisting') {
      validateIdCollisionField(values, errors, 'itemType', itemTypeId);
    }
  }

  for (const itemTypeId of Object.keys(conflicts.legacyIds.itemTypes)) {
    const itemTypeStrategy = get(values, [
      `itemType-${itemTypeId}`,
      'strategy',
    ]);
    if (itemTypeStrategy !== 'reuseExisting') {
      validateIdCollisionField(values, errors, 'itemType', itemTypeId);
    }
  }

  for (const field of Object.values(conflicts.ids.fields)) {
    const parentStrategy = get(values, [
      `itemType-${field.exportParentItemType.id}`,
      'strategy',
    ]);
    if (parentStrategy !== 'reuseExisting') {
      validateIdCollisionField(values, errors, 'field', field.exportId);
    }
  }

  for (const field of Object.values(conflicts.legacyIds.fields)) {
    const parentStrategy = get(values, [
      `itemType-${field.exportParentItemType.id}`,
      'strategy',
    ]);
    if (parentStrategy !== 'reuseExisting') {
      validateIdCollisionField(values, errors, 'field', field.exportId);
    }
  }

  for (const fieldset of Object.values(conflicts.ids.fieldsets)) {
    const parentStrategy = get(values, [
      `itemType-${fieldset.exportParentItemType.id}`,
      'strategy',
    ]);
    if (parentStrategy !== 'reuseExisting') {
      validateIdCollisionField(values, errors, 'fieldset', fieldset.exportId);
    }
  }

  for (const fieldset of Object.values(conflicts.legacyIds.fieldsets)) {
    const parentStrategy = get(values, [
      `itemType-${fieldset.exportParentItemType.id}`,
      'strategy',
    ]);
    if (parentStrategy !== 'reuseExisting') {
      validateIdCollisionField(values, errors, 'fieldset', fieldset.exportId);
    }
  }

  for (const pluginId of Object.keys(conflicts.ids.plugins)) {
    const pluginStrategy = get(values, [`plugin-${pluginId}`, 'strategy']);
    if (pluginStrategy !== 'reuseExisting' && pluginStrategy !== 'skip') {
      validateIdCollisionField(values, errors, 'plugin', pluginId);
    }
  }

  for (const pluginId of Object.keys(conflicts.legacyIds.plugins)) {
    const pluginStrategy = get(values, [`plugin-${pluginId}`, 'strategy']);
    if (pluginStrategy !== 'reuseExisting' && pluginStrategy !== 'skip') {
      validateIdCollisionField(values, errors, 'plugin', pluginId);
    }
  }
}

/**
 * Validate item type conflict fields synchronously. Returns true if any item type
 * uses the 'rename' strategy (requiring an async collision check).
 */
function validateItemTypeFieldsSync(
  values: FormValues,
  itemTypeIds: string[],
  errors: Record<string, string>,
): boolean {
  let hasRename = false;
  for (const itemTypeId of itemTypeIds) {
    const fieldPrefix = `itemType-${itemTypeId}`;
    const strategy = get(values, [fieldPrefix, 'strategy']);
    if (!strategy) {
      set(errors, [fieldPrefix, 'strategy'], 'Required!');
    }
    if (strategy === 'rename') {
      hasRename = true;
      const name = get(values, [fieldPrefix, 'name']);
      if (!name) {
        set(errors, [fieldPrefix, 'name'], 'Required!');
      }
      const apiKey = get(values, [fieldPrefix, 'apiKey']);
      if (!apiKey) {
        set(errors, [fieldPrefix, 'apiKey'], 'Required!');
      } else if (!isValidApiKey(apiKey)) {
        set(errors, [fieldPrefix, 'apiKey'], 'Invalid format');
      }
    }
  }
  return hasRename;
}

/**
 * Check renamed item types against existing project names and api_keys.
 */
async function checkRenameCollisions(
  schema: ProjectSchema,
  values: FormValues,
  itemTypeIds: string[],
  errors: Record<string, string>,
) {
  const projectItemTypes = await schema.getAllItemTypes();
  const itemTypesByName = keyBy(projectItemTypes, 'attributes.name');
  const itemTypesByApiKey = keyBy(projectItemTypes, 'attributes.api_key');

  for (const itemTypeId of itemTypeIds) {
    const fieldPrefix = `itemType-${itemTypeId}`;
    const strategy = get(values, [fieldPrefix, 'strategy']);
    if (strategy !== 'rename') continue;

    const name = get(values, [fieldPrefix, 'name']);
    if (name && name in itemTypesByName) {
      set(errors, [fieldPrefix, 'name'], 'Already used in project!');
    }
    const apiKey = get(values, [fieldPrefix, 'apiKey']);
    if (apiKey) {
      if (apiKey in itemTypesByApiKey) {
        set(errors, [fieldPrefix, 'apiKey'], 'Already used in project!');
      }
    }
  }
}

/**
 * Hosts the conflict resolution form and exposes helpers for components to read state.
 */
export default function ResolutionsForm({ schema, children, onSubmit }: Props) {
  const conflicts = useContext(ConflictsContext);

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
                    // Suggest sensible rename defaults to speed up resolution.
                    name: `${projectItemType.attributes.name} (Import)`,
                    apiKey: `${projectItemType.attributes.api_key}_import`,
                  },
                ],
              ),
            ),
            ...Object.fromEntries(
              [
                ...Object.keys(conflicts.ids.itemTypes).map((id) =>
                  idCollisionFieldPrefix('itemType', id),
                ),
                ...Object.keys(conflicts.ids.fields).map((id) =>
                  idCollisionFieldPrefix('field', id),
                ),
                ...Object.keys(conflicts.ids.fieldsets).map((id) =>
                  idCollisionFieldPrefix('fieldset', id),
                ),
                ...Object.keys(conflicts.ids.plugins).map((id) =>
                  idCollisionFieldPrefix('plugin', id),
                ),
                ...Object.keys(conflicts.legacyIds.itemTypes).map((id) =>
                  idCollisionFieldPrefix('itemType', id),
                ),
                ...Object.keys(conflicts.legacyIds.fields).map((id) =>
                  idCollisionFieldPrefix('field', id),
                ),
                ...Object.keys(conflicts.legacyIds.fieldsets).map((id) =>
                  idCollisionFieldPrefix('fieldset', id),
                ),
                ...Object.keys(conflicts.legacyIds.plugins).map((id) =>
                  idCollisionFieldPrefix('plugin', id),
                ),
              ].map((fieldPrefix) => [fieldPrefix, { strategy: null }]),
            ),
          }
        : {},
    [conflicts],
  );

  function resolvePlugins(values: FormValues): Resolutions['plugins'] {
    const plugins: Resolutions['plugins'] = {};
    if (!conflicts) return plugins;
    for (const pluginId of Object.keys(conflicts.plugins)) {
      const result = get(values, [`plugin-${pluginId}`]) as PluginValues;
      if (result?.strategy) {
        plugins[pluginId] = {
          strategy: result.strategy as 'reuseExisting' | 'skip',
        };
      }
    }
    return plugins;
  }

  function resolveItemTypes(values: FormValues): Resolutions['itemTypes'] {
    const itemTypes: Resolutions['itemTypes'] = {};
    if (!conflicts) return itemTypes;
    for (const itemTypeId of Object.keys(conflicts.itemTypes)) {
      const fieldPrefix = `itemType-${itemTypeId}`;
      const result = get(values, fieldPrefix) as ItemTypeValues;
      if (result?.strategy === 'reuseExisting') {
        itemTypes[itemTypeId] = { strategy: 'reuseExisting' };
      } else if (result?.strategy === 'rename') {
        itemTypes[itemTypeId] = {
          strategy: 'rename',
          apiKey: result.apiKey ?? '',
          name: result.name ?? '',
        };
      }
    }
    return itemTypes;
  }

  function resolveIdCollisions(values: FormValues): Resolutions['idCollisions'] {
    const idCollisions: Resolutions['idCollisions'] = {};
    if (!conflicts) return idCollisions;

    const entries: Array<[IdCollisionEntityType, string]> = [
      ...Object.keys(conflicts.ids.itemTypes).map(
        (id): [IdCollisionEntityType, string] => ['itemType', id],
      ),
      ...Object.keys(conflicts.ids.fields).map(
        (id): [IdCollisionEntityType, string] => ['field', id],
      ),
      ...Object.keys(conflicts.ids.fieldsets).map(
        (id): [IdCollisionEntityType, string] => ['fieldset', id],
      ),
      ...Object.keys(conflicts.ids.plugins).map(
        (id): [IdCollisionEntityType, string] => ['plugin', id],
      ),
      ...Object.keys(conflicts.legacyIds.itemTypes).map(
        (id): [IdCollisionEntityType, string] => ['itemType', id],
      ),
      ...Object.keys(conflicts.legacyIds.fields).map(
        (id): [IdCollisionEntityType, string] => ['field', id],
      ),
      ...Object.keys(conflicts.legacyIds.fieldsets).map(
        (id): [IdCollisionEntityType, string] => ['fieldset', id],
      ),
      ...Object.keys(conflicts.legacyIds.plugins).map(
        (id): [IdCollisionEntityType, string] => ['plugin', id],
      ),
    ];

    for (const [entityType, id] of entries) {
      const fieldPrefix = idCollisionFieldPrefix(entityType, id);
      const result = get(values, fieldPrefix) as IdCollisionValues | undefined;
      if (result?.strategy === 'generateReplacement') {
        idCollisions[idCollisionResolutionKey(entityType, id)] = {
          strategy: 'generateReplacement',
        };
      }
    }

    return idCollisions;
  }

  async function handleSubmit(values: FormValues) {
    if (!conflicts) {
      return { itemTypes: {}, plugins: {}, idCollisions: {} };
    }
    const resolutions: Resolutions = {
      plugins: resolvePlugins(values),
      itemTypes: resolveItemTypes(values),
      idCollisions: resolveIdCollisions(values),
    };
    await onSubmit(resolutions);
  }

  if (!conflicts) {
    return null;
  }

  return (
    <FormHandler<FormValues>
      initialValues={initialValues}
      validate={(values) => {
        const errors: Record<string, string> = {};

        if (!conflicts) {
          return {};
        }

        const pluginIds = Object.keys(conflicts.plugins);
        const itemTypeIds = Object.keys(conflicts.itemTypes);
        const idCollisionCount = getIdCollisionCount(conflicts);

        // No conflicts at all → nothing to validate; return synchronously.
        if (
          pluginIds.length === 0 &&
          itemTypeIds.length === 0 &&
          idCollisionCount === 0
        ) {
          return {};
        }

        // Synchronous required checks for strategies across plugins/item types.
        validatePluginFields(values, pluginIds, errors);
        validateIdCollisionFields(conflicts, values, errors);

        const hasRename = validateItemTypeFieldsSync(
          values,
          itemTypeIds,
          errors,
        );

        // If there are no rename validations to check against the project
        // (or there were only required/format errors), return synchronously to
        // avoid toggling Final Form's `validating` flag.
        if (!hasRename) {
          return errors;
        }

        // Only now perform the async lookup needed to check for collisions
        // against existing project item types.
        return checkRenameCollisions(schema, values, itemTypeIds, errors).then(
          () => errors,
        );
      }}
      onSubmit={handleSubmit}
    >
      {({ handleSubmit }) => <form onSubmit={handleSubmit}>{children}</form>}
    </FormHandler>
  );
}

/**
 * Convenience hook for grabbing validity + values for a specific item type row.
 */
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

/** Same as above but for plugin conflicts. */
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

export function useResolutionStatusForIdCollision(
  entityType: IdCollisionEntityType,
  id: string,
) {
  const state = useFormState<FormValues>();
  const fieldPrefix = idCollisionFieldPrefix(entityType, id);
  const errors = get(state.errors, [fieldPrefix]);
  const values = get(state.values, [fieldPrefix]) as
    | IdCollisionValues
    | undefined;

  if (!values) {
    return undefined;
  }

  return {
    invalid: Boolean(errors),
    values,
  };
}

/**
 * Derive which entities are being reused so the graph/list views can hide them.
 */
export function useSkippedItemsAndPluginIds() {
  const conflicts = useContext(ConflictsContext);
  const formState = useFormState<FormValues>({
    subscription: { values: true },
  });
  const formValues = formState.values;

  const skippedItemTypeIds = useMemo(
    () =>
      Object.keys(conflicts.itemTypes).filter(
        (itemTypeId) =>
          get(formValues, [`itemType-${itemTypeId}`, 'strategy']) ===
          'reuseExisting',
      ),
    [formValues, conflicts],
  );

  const skippedPluginIds = useMemo(
    () =>
      Object.keys(conflicts.plugins).filter(
        (pluginId) =>
          get(formValues, [`plugin-${pluginId}`, 'strategy']) ===
          'reuseExisting',
      ),
    [formValues, conflicts],
  );

  return { skippedItemTypeIds, skippedPluginIds };
}

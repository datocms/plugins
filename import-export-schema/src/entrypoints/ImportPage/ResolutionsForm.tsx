import type { SchemaTypes } from '@datocms/cma-client';
import type { Mutator } from 'final-form';
import get from 'lodash-es/get';
import set from 'lodash-es/set';
import { type ReactNode, useContext, useMemo } from 'react';
import { Form as FormHandler, useFormState } from 'react-final-form';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type {
  Conflicts,
  IdCollisionEntityType,
  IdReplacementIssue,
} from './ConflictsManager/buildConflicts';
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

export type FormValues = Record<
  string,
  ItemTypeValues | PluginValues | IdCollisionValues
>;

type Props = {
  children: ReactNode;
  schema: ProjectSchema;
  exportSchema?: ExportSchema;
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

function getIdReplacementIssues(conflicts: Conflicts): IdReplacementIssue[] {
  return [
    ...Object.values(conflicts.ids.itemTypes),
    ...Object.values(conflicts.ids.fields),
    ...Object.values(conflicts.ids.fieldsets),
    ...Object.values(conflicts.ids.plugins),
    ...Object.values(conflicts.legacyIds.itemTypes),
    ...Object.values(conflicts.legacyIds.fields),
    ...Object.values(conflicts.legacyIds.fieldsets),
    ...Object.values(conflicts.legacyIds.plugins),
  ];
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
    const strategy = get(values, [fieldPrefix, 'strategy']);
    if (strategy !== 'reuseExisting' && strategy !== 'skip') {
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
  issues: IdReplacementIssue[],
  values: FormValues,
  errors: Record<string, string>,
) {
  for (const issue of issues) {
    if (!isIdReplacementActive(issue, values)) continue;
    validateIdCollisionField(values, errors, issue.entityType, issue.exportId);
  }
}

function isIdReplacementActive(
  issue: IdReplacementIssue,
  values: Record<string, unknown>,
) {
  const strategyPrefix =
    issue.entityType === 'plugin'
      ? `plugin-${issue.exportId}`
      : `itemType-${'exportParentItemType' in issue ? issue.exportParentItemType.id : issue.exportId}`;
  const strategy = get(values, [strategyPrefix, 'strategy']);
  return (
    strategy !== 'reuseExisting' &&
    !(issue.entityType === 'plugin' && strategy === 'skip')
  );
}

export function getPendingIdReplacementKeys(
  conflicts: Conflicts,
  values: Record<string, unknown>,
) {
  const prefixes = new Set<string>();
  for (const issue of getIdReplacementIssues(conflicts)) {
    if (!isIdReplacementActive(issue, values)) continue;
    const prefix = idCollisionFieldPrefix(issue.entityType, issue.exportId);
    if (get(values, [prefix, 'strategy']) !== 'generateReplacement')
      prefixes.add(prefix);
  }
  return [...prefixes];
}

export function generateIdReplacements(
  values: FormValues,
  fieldPrefixes: readonly string[],
): FormValues {
  const nextValues = { ...values };
  for (const prefix of fieldPrefixes)
    nextValues[prefix] = { strategy: 'generateReplacement' };
  return nextValues;
}

// Mutators apply the whole values object before Final Form validates/notifies once.
export const generateReplacementIdsMutator: Mutator<FormValues> = (
  args,
  state,
) => {
  const fieldPrefixes = args[0] as string[];
  state.formState.values = generateIdReplacements(
    state.formState.values,
    fieldPrefixes,
  );
};

const resolutionMutators = {
  generateReplacementIds: generateReplacementIdsMutator,
};

function validateRenameFields(
  value: ItemTypeValues,
  fieldPrefix: string,
  errors: Record<string, string>,
) {
  if (!value.name) set(errors, [fieldPrefix, 'name'], 'Required!');
  if (!value.apiKey) {
    set(errors, [fieldPrefix, 'apiKey'], 'Required!');
  } else if (!isValidApiKey(value.apiKey)) {
    set(errors, [fieldPrefix, 'apiKey'], 'Invalid format');
  }
}

function validateItemTypeFieldsSync(
  values: FormValues,
  itemTypeIds: string[],
  errors: Record<string, string>,
) {
  for (const itemTypeId of itemTypeIds) {
    const fieldPrefix = `itemType-${itemTypeId}`;
    const value = values[fieldPrefix];
    if (value?.strategy === 'reuseExisting') continue;
    if (value?.strategy === 'rename') {
      validateRenameFields(value, fieldPrefix, errors);
    } else {
      set(errors, [fieldPrefix, 'strategy'], 'Required!');
    }
  }
}

type RenameCandidate = { fieldPrefix: string; name: string; apiKey: string };

function getRenameCandidates(values: FormValues, itemTypeIds: string[]) {
  const candidates: RenameCandidate[] = [];
  for (const itemTypeId of itemTypeIds) {
    const fieldPrefix = `itemType-${itemTypeId}`;
    const value = values[fieldPrefix];
    if (value?.strategy !== 'rename') continue;
    if (value.name && value.apiKey && isValidApiKey(value.apiKey)) {
      candidates.push({ fieldPrefix, name: value.name, apiKey: value.apiKey });
    }
  }
  return candidates;
}

type ProjectIndex = { names: Set<string>; apiKeys: Set<string> };

function validateLocalRenameCollisions(
  candidates: RenameCandidate[],
  unchanged: ProjectIndex,
  errors: Record<string, string>,
) {
  const names = new Map<string, string>();
  const apiKeys = new Map<string, string>();
  for (const candidate of candidates) {
    for (const [field, value, seen, reserved] of [
      ['name', candidate.name, names, unchanged.names],
      ['apiKey', candidate.apiKey, apiKeys, unchanged.apiKeys],
    ] as const) {
      const previousFieldPrefix = seen.get(value);
      if (reserved.has(value) || previousFieldPrefix) {
        set(
          errors,
          [candidate.fieldPrefix, field],
          'Already used in this import!',
        );
        if (previousFieldPrefix) {
          set(
            errors,
            [previousFieldPrefix, field],
            'Already used in this import!',
          );
        }
      }
      seen.set(value, candidate.fieldPrefix);
    }
  }
}

function validateProjectRenameCollisions(
  candidates: RenameCandidate[],
  project: ProjectIndex,
  errors: Record<string, string>,
) {
  for (const candidate of candidates) {
    if (project.names.has(candidate.name)) {
      set(errors, [candidate.fieldPrefix, 'name'], 'Already used in project!');
    }
    if (project.apiKeys.has(candidate.apiKey)) {
      set(
        errors,
        [candidate.fieldPrefix, 'apiKey'],
        'Already used in project!',
      );
    }
  }
  return errors;
}

/** Validate against the complete import, including rows outside the visible page. */
export function createResolutionValidator(
  schema: Pick<ProjectSchema, 'getAllItemTypes'>,
  conflicts: Conflicts,
  exportItemTypes: readonly SchemaTypes.ItemType[] = [],
) {
  const pluginIds = Object.keys(conflicts.plugins);
  const itemTypeIds = Object.keys(conflicts.itemTypes);
  const renamedIds = new Set(itemTypeIds);
  const unchangedNames = new Set<string>();
  const unchangedApiKeys = new Set<string>();
  for (const itemType of exportItemTypes) {
    if (renamedIds.has(itemType.id)) continue;
    unchangedNames.add(itemType.attributes.name);
    unchangedApiKeys.add(itemType.attributes.api_key);
  }

  const issues = getIdReplacementIssues(conflicts);
  let projectIndex: ProjectIndex | undefined;
  let projectIndexPromise: Promise<ProjectIndex> | undefined;
  function getProjectIndex() {
    if (!projectIndexPromise) {
      projectIndexPromise = schema
        .getAllItemTypes()
        .then((itemTypes) => {
          projectIndex = {
            names: new Set(
              itemTypes.map((itemType) => itemType.attributes.name),
            ),
            apiKeys: new Set(
              itemTypes.map((itemType) => itemType.attributes.api_key),
            ),
          };
          return projectIndex;
        })
        .catch((error: unknown) => {
          projectIndexPromise = undefined;
          throw error;
        });
    }
    return projectIndexPromise;
  }

  return (values: FormValues) => {
    const errors: Record<string, string> = {};
    validatePluginFields(values, pluginIds, errors);
    validateIdCollisionFields(issues, values, errors);
    validateItemTypeFieldsSync(values, itemTypeIds, errors);
    const candidates = getRenameCandidates(values, itemTypeIds);
    if (candidates.length === 0) return errors;
    validateLocalRenameCollisions(
      candidates,
      { names: unchangedNames, apiKeys: unchangedApiKeys },
      errors,
    );
    if (projectIndex)
      return validateProjectRenameCollisions(candidates, projectIndex, errors);

    return getProjectIndex()
      .then((index) =>
        validateProjectRenameCollisions(candidates, index, errors),
      )
      .catch(() => {
        for (const candidate of candidates) {
          set(
            errors,
            [candidate.fieldPrefix, 'apiKey'],
            'Could not verify project identifiers. Edit this value to retry.',
          );
        }
        return errors;
      });
  };
}

/**
 * Hosts the conflict resolution form and exposes helpers for components to read state.
 */
export default function ResolutionsForm({
  schema,
  exportSchema,
  children,
  onSubmit,
}: Props) {
  const conflicts = useContext(ConflictsContext);
  const validate = useMemo(
    () => createResolutionValidator(schema, conflicts, exportSchema?.itemTypes),
    [schema, conflicts, exportSchema],
  );

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

  function resolveIdCollisions(
    values: FormValues,
  ): Resolutions['idCollisions'] {
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
      destroyOnUnregister={false}
      mutators={resolutionMutators}
      subscription={{ submitting: true }}
      validate={validate}
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
  const state = useFormState<FormValues>({
    subscription: { errors: true, values: true },
  });

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
  const state = useFormState<FormValues>({
    subscription: { errors: true, values: true },
  });

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
  const state = useFormState<FormValues>({
    subscription: { errors: true, values: true },
  });
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

import type { SchemaTypes } from '@datocms/cma-client';
import keyBy from 'lodash-es/keyBy';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import type { ProjectSchema } from '@/utils/ProjectSchema';

export type IdCollisionEntityType =
  | 'itemType'
  | 'field'
  | 'fieldset'
  | 'plugin';

export type IdIssueReason = 'occupied' | 'legacy';

type IdCollisionBase<EntityType extends IdCollisionEntityType> = {
  entityType: EntityType;
  reason: IdIssueReason;
  exportId: string;
  exportLabel: string;
};

export type ItemTypeIdCollision = IdCollisionBase<'itemType'> & {
  reason: 'occupied';
  projectLabel: string;
  exportEntity: SchemaTypes.ItemType;
  projectEntity: SchemaTypes.ItemType;
};

export type FieldIdCollision = IdCollisionBase<'field'> & {
  reason: 'occupied';
  projectLabel: string;
  exportEntity: SchemaTypes.Field;
  projectEntity: SchemaTypes.Field;
  exportParentItemType: SchemaTypes.ItemType;
  projectParentItemType: SchemaTypes.ItemType;
};

export type FieldsetIdCollision = IdCollisionBase<'fieldset'> & {
  reason: 'occupied';
  projectLabel: string;
  exportEntity: SchemaTypes.Fieldset;
  projectEntity: SchemaTypes.Fieldset;
  exportParentItemType: SchemaTypes.ItemType;
  projectParentItemType: SchemaTypes.ItemType;
};

export type PluginIdCollision = IdCollisionBase<'plugin'> & {
  reason: 'occupied';
  projectLabel: string;
  exportEntity: SchemaTypes.Plugin;
  projectEntity: SchemaTypes.Plugin;
};

export type IdCollision =
  | ItemTypeIdCollision
  | FieldIdCollision
  | FieldsetIdCollision
  | PluginIdCollision;

export type IdConflicts = {
  itemTypes: Record<string, ItemTypeIdCollision>;
  fields: Record<string, FieldIdCollision>;
  fieldsets: Record<string, FieldsetIdCollision>;
  plugins: Record<string, PluginIdCollision>;
};

export type ItemTypeLegacyIdIssue = IdCollisionBase<'itemType'> & {
  reason: 'legacy';
  exportEntity: SchemaTypes.ItemType;
};

export type FieldLegacyIdIssue = IdCollisionBase<'field'> & {
  reason: 'legacy';
  exportEntity: SchemaTypes.Field;
  exportParentItemType: SchemaTypes.ItemType;
};

export type FieldsetLegacyIdIssue = IdCollisionBase<'fieldset'> & {
  reason: 'legacy';
  exportEntity: SchemaTypes.Fieldset;
  exportParentItemType: SchemaTypes.ItemType;
};

export type PluginLegacyIdIssue = IdCollisionBase<'plugin'> & {
  reason: 'legacy';
  exportEntity: SchemaTypes.Plugin;
};

export type LegacyIdIssue =
  | ItemTypeLegacyIdIssue
  | FieldLegacyIdIssue
  | FieldsetLegacyIdIssue
  | PluginLegacyIdIssue;

export type LegacyIdIssues = {
  itemTypes: Record<string, ItemTypeLegacyIdIssue>;
  fields: Record<string, FieldLegacyIdIssue>;
  fieldsets: Record<string, FieldsetLegacyIdIssue>;
  plugins: Record<string, PluginLegacyIdIssue>;
};

export type IdReplacementIssue = IdCollision | LegacyIdIssue;

export type Conflicts = {
  plugins: Record<string, SchemaTypes.Plugin>;
  itemTypes: Record<string, SchemaTypes.ItemType>;
  ids: IdConflicts;
  legacyIds: LegacyIdIssues;
};

type ProjectFieldEntry = {
  entity: SchemaTypes.Field;
  parentItemType: SchemaTypes.ItemType;
};

type ProjectFieldsetEntry = {
  entity: SchemaTypes.Fieldset;
  parentItemType: SchemaTypes.ItemType;
};

type ProjectChildEntityMaps = {
  fieldsById: Map<string, ProjectFieldEntry>;
  fieldsetsById: Map<string, ProjectFieldsetEntry>;
};

function getItemTypeLabel(itemType: SchemaTypes.ItemType) {
  return itemType.attributes.name || itemType.attributes.api_key || itemType.id;
}

function getFieldLabel(field: SchemaTypes.Field) {
  return field.attributes.label || field.attributes.api_key || field.id;
}

function getPluginLabel(plugin: SchemaTypes.Plugin) {
  return plugin.attributes.name || plugin.attributes.package_name || plugin.id;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function isValidConsistentEntityId(id: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return false;
  }

  const bytes = decodeBase64Url(id);
  if (!bytes || bytes.length !== 16) {
    return false;
  }

  const version = (bytes[6] & 0xf0) >> 4;
  const variant = bytes[8] & 0xc0;
  return version === 4 && variant === 0x80;
}

function findExportParentItemType(
  exportSchema: ExportSchema,
  entity: SchemaTypes.Field | SchemaTypes.Fieldset,
) {
  const itemTypeId = entity.relationships.item_type.data.id;
  return exportSchema.getItemTypeById(String(itemTypeId));
}

async function buildProjectChildEntityMaps(
  projectSchema: ProjectSchema,
  projectItemTypes: SchemaTypes.ItemType[],
  onProgress:
    | ((p: { done: number; total: number; label: string }) => void)
    | undefined,
  progress: { done: number; total: number },
): Promise<ProjectChildEntityMaps> {
  const fieldsById = new Map<string, ProjectFieldEntry>();
  const fieldsetsById = new Map<string, ProjectFieldsetEntry>();

  for (const itemType of projectItemTypes) {
    onProgress?.({
      done: progress.done,
      total: progress.total,
      label: `Scanning IDs: ${getItemTypeLabel(itemType)}`,
    });

    const [fields, fieldsets] =
      await projectSchema.getItemTypeFieldsAndFieldsets(itemType);

    for (const field of fields) {
      fieldsById.set(String(field.id), {
        entity: field,
        parentItemType: itemType,
      });
    }

    for (const fieldset of fieldsets) {
      fieldsetsById.set(String(fieldset.id), {
        entity: fieldset,
        parentItemType: itemType,
      });
    }

    progress.done += 1;
  }

  return { fieldsById, fieldsetsById };
}

function buildLegacyIdIssues(exportSchema: ExportSchema): LegacyIdIssues {
  const result: LegacyIdIssues = {
    itemTypes: {},
    fields: {},
    fieldsets: {},
    plugins: {},
  };

  for (const exportItemType of exportSchema.itemTypes) {
    if (!isValidConsistentEntityId(String(exportItemType.id))) {
      result.itemTypes[String(exportItemType.id)] = {
        entityType: 'itemType',
        reason: 'legacy',
        exportId: String(exportItemType.id),
        exportLabel: getItemTypeLabel(exportItemType),
        exportEntity: exportItemType,
      };
    }
  }

  for (const exportField of exportSchema.fields) {
    if (!isValidConsistentEntityId(String(exportField.id))) {
      result.fields[String(exportField.id)] = {
        entityType: 'field',
        reason: 'legacy',
        exportId: String(exportField.id),
        exportLabel: getFieldLabel(exportField),
        exportEntity: exportField,
        exportParentItemType: findExportParentItemType(
          exportSchema,
          exportField,
        ),
      };
    }
  }

  for (const exportFieldset of exportSchema.fieldsets) {
    if (!isValidConsistentEntityId(String(exportFieldset.id))) {
      result.fieldsets[String(exportFieldset.id)] = {
        entityType: 'fieldset',
        reason: 'legacy',
        exportId: String(exportFieldset.id),
        exportLabel: exportFieldset.attributes.title || exportFieldset.id,
        exportEntity: exportFieldset,
        exportParentItemType: findExportParentItemType(
          exportSchema,
          exportFieldset,
        ),
      };
    }
  }

  for (const exportPlugin of exportSchema.plugins) {
    if (!isValidConsistentEntityId(String(exportPlugin.id))) {
      result.plugins[String(exportPlugin.id)] = {
        entityType: 'plugin',
        reason: 'legacy',
        exportId: String(exportPlugin.id),
        exportLabel: getPluginLabel(exportPlugin),
        exportEntity: exportPlugin,
      };
    }
  }

  return result;
}

function buildIdConflicts({
  exportSchema,
  projectItemTypes,
  projectPlugins,
  projectChildren,
}: {
  exportSchema: ExportSchema;
  projectItemTypes: SchemaTypes.ItemType[];
  projectPlugins: SchemaTypes.Plugin[];
  projectChildren: ProjectChildEntityMaps;
}): IdConflicts {
  const itemTypesById = keyBy(projectItemTypes, 'id');
  const pluginsById = keyBy(projectPlugins, 'id');

  const result: IdConflicts = {
    itemTypes: {},
    fields: {},
    fieldsets: {},
    plugins: {},
  };

  for (const exportItemType of exportSchema.itemTypes) {
    const projectItemType = itemTypesById[String(exportItemType.id)];
    if (projectItemType) {
      result.itemTypes[String(exportItemType.id)] = {
        entityType: 'itemType',
        reason: 'occupied',
        exportId: String(exportItemType.id),
        exportLabel: getItemTypeLabel(exportItemType),
        projectLabel: getItemTypeLabel(projectItemType),
        exportEntity: exportItemType,
        projectEntity: projectItemType,
      };
    }
  }

  for (const exportField of exportSchema.fields) {
    const projectField = projectChildren.fieldsById.get(String(exportField.id));
    if (projectField) {
      result.fields[String(exportField.id)] = {
        entityType: 'field',
        reason: 'occupied',
        exportId: String(exportField.id),
        exportLabel: getFieldLabel(exportField),
        projectLabel: getFieldLabel(projectField.entity),
        exportEntity: exportField,
        projectEntity: projectField.entity,
        exportParentItemType: findExportParentItemType(
          exportSchema,
          exportField,
        ),
        projectParentItemType: projectField.parentItemType,
      };
    }
  }

  for (const exportFieldset of exportSchema.fieldsets) {
    const projectFieldset = projectChildren.fieldsetsById.get(
      String(exportFieldset.id),
    );
    if (projectFieldset) {
      result.fieldsets[String(exportFieldset.id)] = {
        entityType: 'fieldset',
        reason: 'occupied',
        exportId: String(exportFieldset.id),
        exportLabel: exportFieldset.attributes.title || exportFieldset.id,
        projectLabel:
          projectFieldset.entity.attributes.title || projectFieldset.entity.id,
        exportEntity: exportFieldset,
        projectEntity: projectFieldset.entity,
        exportParentItemType: findExportParentItemType(
          exportSchema,
          exportFieldset,
        ),
        projectParentItemType: projectFieldset.parentItemType,
      };
    }
  }

  for (const exportPlugin of exportSchema.plugins) {
    const projectPlugin = pluginsById[String(exportPlugin.id)];
    if (projectPlugin) {
      result.plugins[String(exportPlugin.id)] = {
        entityType: 'plugin',
        reason: 'occupied',
        exportId: String(exportPlugin.id),
        exportLabel: getPluginLabel(exportPlugin),
        projectLabel: getPluginLabel(projectPlugin),
        exportEntity: exportPlugin,
        projectEntity: projectPlugin,
      };
    }
  }

  return result;
}

/**
 * Compare the export snapshot against the project and identify models/plugins that collide
 * by name, API key, URL, or ID.
 */
export default async function buildConflicts(
  exportSchema: ExportSchema,
  projectSchema: ProjectSchema,
  onProgress?: (p: { done: number; total: number; label: string }) => void,
) {
  let done = 0;
  let total = 2 + exportSchema.itemTypes.length + exportSchema.plugins.length;

  onProgress?.({ done, total, label: 'Loading models…' });
  const projectItemTypes = await projectSchema.getAllItemTypes();
  total += projectItemTypes.length;
  done += 1;
  onProgress?.({ done, total, label: 'Loading plugins…' });
  const projectItemTypesByName = keyBy(projectItemTypes, 'attributes.name');
  const projectItemTypesByApiKey = keyBy(
    projectItemTypes,
    'attributes.api_key',
  );

  const projectPlugins = await projectSchema.getAllPlugins();
  done += 1;
  onProgress?.({ done, total, label: 'Scanning item types…' });
  const projectPluginsByName = keyBy(projectPlugins, 'attributes.name');
  const projectPluginsByUrl = keyBy(projectPlugins, 'attributes.url');

  const progress = { done, total };
  const projectChildren = await buildProjectChildEntityMaps(
    projectSchema,
    projectItemTypes,
    onProgress,
    progress,
  );
  done = progress.done;

  const idConflicts = buildIdConflicts({
    exportSchema,
    projectItemTypes,
    projectPlugins,
    projectChildren,
  });
  const legacyIds = buildLegacyIdIssues(exportSchema);

  const conflicts: Conflicts = {
    plugins: {},
    itemTypes: {},
    ids: idConflicts,
    legacyIds,
  };

  for (const itemType of exportSchema.itemTypes) {
    const conflictingItemType =
      projectItemTypesByName[itemType.attributes.name] ||
      projectItemTypesByApiKey[itemType.attributes.api_key];

    if (conflictingItemType) {
      conflicts.itemTypes[String(itemType.id)] = conflictingItemType;
    }
    done += 1;
    onProgress?.({
      done,
      total,
      label: `Item type: ${itemType.attributes.name}`,
    });
  }

  onProgress?.({ done, total, label: 'Scanning plugins…' });
  for (const plugin of exportSchema.plugins) {
    const conflictingPlugin =
      projectPluginsByUrl[plugin.attributes.url] ||
      projectPluginsByName[plugin.attributes.name];

    if (conflictingPlugin) {
      conflicts.plugins[String(plugin.id)] = conflictingPlugin;
    }
    done += 1;
    onProgress?.({ done, total, label: `Plugin: ${plugin.attributes.name}` });
  }

  return conflicts;
}

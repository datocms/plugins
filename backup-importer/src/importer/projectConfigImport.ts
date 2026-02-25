import type { Client } from '@datocms/cma-client-browser';
import { createDebugLogger, type DebugLogger } from './debugLogger';
import type {
  ImportExecutionPhase,
  JsonObject,
  ProjectConfigurationExport,
  RecordExportEnvelope,
} from './types';
import {
  asArray,
  asString,
  compactObject,
  deepRemapKnownIds,
  extractEntityId,
  isObject,
  makeCompositeKey,
} from './resourceUtils';
import { patchItemTypeWorkflowRelationships } from './schemaClone';

type ImportProgress = {
  phase: ImportExecutionPhase;
  finished: number;
  total: number;
  message: string;
};

type ImportFailure = {
  resource: string;
  sourceId: string | null;
  message: string;
};

type NonSideEffectImportResult = {
  warnings: string[];
  failures: ImportFailure[];
  workflowIdMap: Map<string, string>;
  roleIdMap: Map<string, string>;
  modelFilterIdMap: Map<string, string>;
  menuItemIdMap: Map<string, string>;
  schemaMenuItemIdMap: Map<string, string>;
  addOnlySkippedByResource: Record<string, number>;
};

type NonSideEffectImportOptions = {
  includePlugins?: boolean;
  includeWorkflows?: boolean;
  includeRoles?: boolean;
  includeModelFilters?: boolean;
  includeMenuItems?: boolean;
  includeSchemaMenuItems?: boolean;
  addOnlyDifferences?: boolean;
};

type ImportContext = {
  client: Client;
  envelope: RecordExportEnvelope;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  createdItemTypeSourceIds?: Set<string>;
  addOnlyDifferences?: boolean;
  logger?: DebugLogger;
  onProgress?: (progress: ImportProgress) => void;
};

function emptyProjectConfiguration(): ProjectConfigurationExport {
  return {
    site: null,
    scheduledPublications: [],
    scheduledUnpublishings: [],
    fieldsets: [],
    menuItems: [],
    schemaMenuItems: [],
    modelFilters: [],
    plugins: [],
    workflows: [],
    roles: [],
    webhooks: [],
    buildTriggers: [],
    warnings: [],
  };
}

function projectConfiguration(envelope: RecordExportEnvelope): ProjectConfigurationExport {
  return envelope.projectConfiguration ?? emptyProjectConfiguration();
}

function pushFailure(
  result: { warnings: string[]; failures: ImportFailure[] },
  failure: ImportFailure,
  logger?: DebugLogger,
) {
  result.failures.push(failure);
  result.warnings.push(`[${failure.resource}] ${failure.message}`);
  logger?.warn('Configuration import warning', failure);
}

function getLogger(logger: DebugLogger | undefined, scope: string): DebugLogger {
  return (logger ?? createDebugLogger({ enabled: false })).child(scope);
}

function markAddOnlySkip(args: {
  warnings: string[];
  addOnlySkippedByResource: Record<string, number>;
  resource: string;
  key: string;
  logger?: DebugLogger;
}) {
  args.warnings.push(`[add-only][${args.resource}] Skipped existing ${args.key}`);
  args.addOnlySkippedByResource[args.resource] =
    (args.addOnlySkippedByResource[args.resource] ?? 0) + 1;
  args.logger?.warn('Skipped existing resource in add-only mode', {
    resource: args.resource,
    key: args.key,
  });
}

const VALID_PLUGIN_PERMISSIONS = new Set(['currentUserAccessToken']);
const VALID_PLUGIN_TYPES = new Set(['field_editor', 'sidebar', 'field_addon']);
const VALID_PLUGIN_FIELD_TYPES = new Set([
  'boolean',
  'date',
  'date_time',
  'float',
  'integer',
  'string',
  'text',
  'lat_lon',
  'json',
  'seo',
  'link',
  'links',
  'video',
  'color',
  'slug',
  'rich_text',
  'file',
  'gallery',
]);

function sanitizePluginPermissions(value: unknown): string[] | undefined {
  const sanitized = Array.from(
    new Set(
      asArray(value).flatMap((entry) => {
        const normalized = asString(entry);
        if (!normalized || !VALID_PLUGIN_PERMISSIONS.has(normalized)) {
          return [];
        }

        return [normalized];
      }),
    ),
  );

  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizePluginType(value: unknown): string | undefined {
  const type = asString(value);
  if (!type || !VALID_PLUGIN_TYPES.has(type)) {
    return undefined;
  }
  return type;
}

function sanitizePluginFieldTypes(value: unknown): string[] | undefined {
  const sanitized = Array.from(
    new Set(
      asArray(value).flatMap((entry) => {
        const normalized = asString(entry);
        if (!normalized || !VALID_PLUGIN_FIELD_TYPES.has(normalized)) {
          return [];
        }

        return [normalized];
      }),
    ),
  );
  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizePluginParameterDefinitions(value: unknown): JsonObject | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const global = asArray(value.global);
  const instance = asArray(value.instance);

  return {
    global,
    instance,
  };
}

function buildPluginUpdatePayload(source: JsonObject): JsonObject {
  return compactObject({
    name: source.name,
    description: source.description,
    url: source.url,
    parameters: source.parameters,
    package_version: source.package_version,
    permissions: sanitizePluginPermissions(source.permissions),
  });
}

function buildPluginPackageCreatePayload(
  source: JsonObject,
  includeVersion: boolean,
): JsonObject | null {
  const packageName = asString(source.package_name);
  if (!packageName) {
    return null;
  }

  const packageVersion = asString(source.package_version);
  return compactObject({
    package_name: packageName,
    package_version: includeVersion ? packageVersion ?? undefined : undefined,
  });
}

function buildPluginPrivateCreatePayload(args: {
  source: JsonObject;
  includeFieldExtensionConfig: boolean;
}): JsonObject {
  const base = compactObject({
    name: asString(args.source.name) ?? undefined,
    description: args.source.description,
    url: asString(args.source.url) ?? undefined,
    permissions: sanitizePluginPermissions(args.source.permissions),
  });

  if (!args.includeFieldExtensionConfig) {
    return base;
  }

  return compactObject({
    ...base,
    plugin_type: sanitizePluginType(args.source.plugin_type),
    field_types: sanitizePluginFieldTypes(args.source.field_types),
    parameter_definitions: sanitizePluginParameterDefinitions(
      args.source.parameter_definitions,
    ),
  });
}

function isSiteNameUniquenessError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (
    error instanceof Error &&
    error.message.includes('"field": "name"') &&
    error.message.includes('VALIDATION_UNIQUENESS')
  ) {
    return true;
  }

  if (typeof error !== 'object') {
    return false;
  }

  const maybeErrors = (error as { errors?: unknown[] }).errors;
  if (!Array.isArray(maybeErrors)) {
    return false;
  }

  return maybeErrors.some((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const attributes = (entry as { attributes?: unknown }).attributes;
    if (!attributes || typeof attributes !== 'object') {
      return false;
    }

    const details = (attributes as { details?: unknown }).details;
    if (!details || typeof details !== 'object') {
      return false;
    }

    return (
      (details as { field?: unknown }).field === 'name' &&
      (details as { code?: unknown }).code === 'VALIDATION_UNIQUENESS'
    );
  });
}

function remapRelationship(args: {
  sourceValue: unknown;
  idMap: Map<string, string>;
  type: string;
}): JsonObject | null | undefined {
  if (args.sourceValue === null) {
    return null;
  }

  const sourceId = extractEntityId(args.sourceValue);
  if (!sourceId) {
    return undefined;
  }

  const targetId = args.idMap.get(sourceId);
  if (!targetId) {
    return undefined;
  }

  return {
    type: args.type,
    id: targetId,
  };
}

function remapRelationshipCollection(args: {
  sourceValue: unknown;
  idMap: Map<string, string>;
  type: string;
}): JsonObject[] | undefined {
  const entries = asArray(args.sourceValue);
  if (!entries.length) {
    return undefined;
  }

  const mapped = entries
    .map((entry) => remapRelationship({ ...args, sourceValue: entry }))
    .filter((entry): entry is JsonObject => Boolean(entry));

  return mapped.length > 0 ? mapped : undefined;
}

async function importWorkflows(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/workflows');
  const sourceWorkflows = asArray(
    projectConfiguration(args.context.envelope).workflows,
  ).filter(isObject) as JsonObject[];

  logger.debug('Starting workflow import', {
    sourceCount: sourceWorkflows.length,
  });

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceWorkflows.length || 1,
    message: 'Importing workflows',
  });

  const targetWorkflows = (await args.context.client.workflows.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetByApiKey = new Map(
    targetWorkflows
      .map((workflow) => [asString(workflow.api_key), workflow] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );
  const targetByName = new Map(
    targetWorkflows
      .map((workflow) => [asString(workflow.name), workflow] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );

  for (let index = 0; index < sourceWorkflows.length; index += 1) {
    const source = sourceWorkflows[index];
    const sourceId = asString(source.id);
    const sourceApiKey = asString(source.api_key);
    const sourceName = asString(source.name);

    args.context.onProgress?.({
      phase: 'config-import',
      finished: index,
      total: sourceWorkflows.length || 1,
      message: `Importing workflow ${index + 1}/${sourceWorkflows.length || 1}`,
    });

    try {
      const payload = compactObject({
        name: source.name,
        api_key: source.api_key,
        stages: deepRemapKnownIds(source.stages, [args.context.itemTypeIdMap]),
      });

      const existing =
        (sourceApiKey ? targetByApiKey.get(sourceApiKey) : null) ??
        (sourceName ? targetByName.get(sourceName) : null);

      if (existing && args.context.addOnlyDifferences) {
        const targetId = asString(existing.id);
        if (sourceId && targetId) {
          args.result.workflowIdMap.set(sourceId, targetId);
        }
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'workflows',
          key: `workflow '${sourceApiKey ?? sourceName ?? sourceId ?? 'unknown'}'`,
          logger,
        });
        continue;
      }

      const target = existing
        ? await args.context.client.workflows.update(asString(existing.id)!, payload as any)
        : await args.context.client.workflows.create(payload as any);

      const targetId = asString(target.id);
      if (sourceId && targetId) {
        args.result.workflowIdMap.set(sourceId, targetId);
      }
      if (sourceApiKey && targetId) {
        targetByApiKey.set(sourceApiKey, { ...source, id: targetId });
      }
      if (sourceName && targetId) {
        targetByName.set(sourceName, { ...source, id: targetId });
      }
      logger.debug('Imported workflow', {
        sourceId,
        sourceApiKey,
        sourceName,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'workflows',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import workflow '${sourceApiKey ?? sourceName ?? sourceId ?? 'unknown'}': ${error.message}`
            : 'Failed to import workflow.',
      }, logger);
    }
  }

  logger.debug('Finished workflow import', {
    mappedCount: args.result.workflowIdMap.size,
    failures: args.result.failures.filter((entry) => entry.resource === 'workflows').length,
  });
}

async function seedWorkflowIdMapFromExisting(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/workflows');
  const sourceWorkflows = asArray(
    projectConfiguration(args.context.envelope).workflows,
  ).filter(isObject) as JsonObject[];
  const targetWorkflows = (await args.context.client.workflows.list()).filter(
    isObject,
  ) as JsonObject[];

  const targetByApiKey = new Map(
    targetWorkflows
      .map((workflow) => [asString(workflow.api_key), workflow] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );
  const targetByName = new Map(
    targetWorkflows
      .map((workflow) => [asString(workflow.name), workflow] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );

  let mappedCount = 0;
  for (const source of sourceWorkflows) {
    const sourceId = asString(source.id);
    if (!sourceId) {
      continue;
    }
    const sourceApiKey = asString(source.api_key);
    const sourceName = asString(source.name);
    const existing =
      (sourceApiKey ? targetByApiKey.get(sourceApiKey) : null) ??
      (sourceName ? targetByName.get(sourceName) : null);

    const targetId = existing ? asString(existing.id) : null;
    if (!targetId) {
      continue;
    }

    args.result.workflowIdMap.set(sourceId, targetId);
    mappedCount += 1;
  }

  logger.debug('Seeded workflow ID map from existing target workflows', {
    sourceCount: sourceWorkflows.length,
    mappedCount,
  });
}

function buildRolePayload(args: {
  source: JsonObject;
  itemTypeIdMap: Map<string, string>;
  workflowIdMap: Map<string, string>;
  roleIdMap: Map<string, string>;
  includeInheritance: boolean;
}): JsonObject {
  const remappedPermissions = deepRemapKnownIds(args.source, [
    args.itemTypeIdMap,
    args.workflowIdMap,
  ]) as JsonObject;

  const payload = compactObject({
    name: remappedPermissions.name,
    can_edit_favicon: remappedPermissions.can_edit_favicon,
    can_edit_site: remappedPermissions.can_edit_site,
    can_edit_schema: remappedPermissions.can_edit_schema,
    can_manage_menu: remappedPermissions.can_manage_menu,
    can_edit_environment: remappedPermissions.can_edit_environment,
    can_promote_environments: remappedPermissions.can_promote_environments,
    environments_access: remappedPermissions.environments_access,
    can_manage_users: remappedPermissions.can_manage_users,
    can_manage_shared_filters: remappedPermissions.can_manage_shared_filters,
    can_manage_search_indexes: remappedPermissions.can_manage_search_indexes,
    can_manage_upload_collections: remappedPermissions.can_manage_upload_collections,
    can_manage_build_triggers: remappedPermissions.can_manage_build_triggers,
    can_manage_webhooks: remappedPermissions.can_manage_webhooks,
    can_manage_environments: remappedPermissions.can_manage_environments,
    can_manage_sso: remappedPermissions.can_manage_sso,
    can_access_audit_log: remappedPermissions.can_access_audit_log,
    can_manage_workflows: remappedPermissions.can_manage_workflows,
    can_manage_access_tokens: remappedPermissions.can_manage_access_tokens,
    can_perform_site_search: remappedPermissions.can_perform_site_search,
    can_access_build_events_log: remappedPermissions.can_access_build_events_log,
    can_access_search_index_events_log:
      remappedPermissions.can_access_search_index_events_log,
    positive_item_type_permissions: remappedPermissions.positive_item_type_permissions,
    negative_item_type_permissions: remappedPermissions.negative_item_type_permissions,
    positive_upload_permissions: remappedPermissions.positive_upload_permissions,
    negative_upload_permissions: remappedPermissions.negative_upload_permissions,
    positive_build_trigger_permissions:
      remappedPermissions.positive_build_trigger_permissions,
    negative_build_trigger_permissions:
      remappedPermissions.negative_build_trigger_permissions,
    positive_search_index_permissions:
      remappedPermissions.positive_search_index_permissions,
    negative_search_index_permissions:
      remappedPermissions.negative_search_index_permissions,
  });

  if (!args.includeInheritance) {
    return payload;
  }

  const inherits = remapRelationship({
    sourceValue: args.source.inherits_permissions_from,
    idMap: args.roleIdMap,
    type: 'role',
  });

  if (inherits !== undefined) {
    payload.inherits_permissions_from = inherits;
  }

  return payload;
}

async function importRoles(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/roles');
  const sourceRoles = asArray(projectConfiguration(args.context.envelope).roles).filter(
    isObject,
  ) as JsonObject[];

  const targetRoles = (await args.context.client.roles.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetByName = new Map(
    targetRoles
      .map((role) => [asString(role.name), role] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );
  const createdRoleSourceIds = new Set<string>();

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceRoles.length || 1,
    message: 'Importing roles (pass A)',
  });

  for (let index = 0; index < sourceRoles.length; index += 1) {
    const source = sourceRoles[index];
    const sourceId = asString(source.id);
    const sourceName = asString(source.name);

    args.context.onProgress?.({
      phase: 'config-import',
      finished: index,
      total: sourceRoles.length || 1,
      message: `Importing role ${index + 1}/${sourceRoles.length || 1}`,
    });

    try {
      const existing = sourceName ? targetByName.get(sourceName) : null;
      if (existing && args.context.addOnlyDifferences) {
        const targetId = asString(existing.id);
        if (sourceId && targetId) {
          args.result.roleIdMap.set(sourceId, targetId);
        }
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'roles',
          key: `role '${sourceName ?? sourceId ?? 'unknown'}'`,
          logger,
        });
        continue;
      }

      const payload = buildRolePayload({
        source,
        itemTypeIdMap: args.context.itemTypeIdMap,
        workflowIdMap: args.result.workflowIdMap,
        roleIdMap: args.result.roleIdMap,
        includeInheritance: false,
      });
      const target = existing
        ? await args.context.client.roles.update(asString(existing.id)!, payload as any)
        : await args.context.client.roles.create(payload as any);

      const targetId = asString(target.id);
      if (sourceId && targetId) {
        args.result.roleIdMap.set(sourceId, targetId);
        if (!existing) {
          createdRoleSourceIds.add(sourceId);
        }
      }
      if (sourceName && targetId) {
        targetByName.set(sourceName, { ...source, id: targetId });
      }
      logger.debug('Imported role pass A', {
        sourceId,
        sourceName,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'roles',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import role '${sourceName ?? sourceId ?? 'unknown'}': ${error.message}`
            : 'Failed to import role.',
      }, logger);
    }
  }

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceRoles.length || 1,
    message: 'Importing roles (pass B)',
  });

  for (let index = 0; index < sourceRoles.length; index += 1) {
    const source = sourceRoles[index];
    const sourceId = asString(source.id);
    if (!sourceId) {
      continue;
    }

    if (args.context.addOnlyDifferences && !createdRoleSourceIds.has(sourceId)) {
      continue;
    }

    const targetId = args.result.roleIdMap.get(sourceId);
    if (!targetId) {
      continue;
    }

    try {
      const payload = buildRolePayload({
        source,
        itemTypeIdMap: args.context.itemTypeIdMap,
        workflowIdMap: args.result.workflowIdMap,
        roleIdMap: args.result.roleIdMap,
        includeInheritance: true,
      });
      await args.context.client.roles.update(targetId, payload as any);
      logger.debug('Finalized role inheritance', {
        sourceId,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'roles',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to finalize role '${sourceId}': ${error.message}`
            : 'Failed to finalize role inheritance.',
      }, logger);
    }
  }
}

async function importPlugins(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/plugins');
  const sourcePlugins = asArray(projectConfiguration(args.context.envelope).plugins).filter(
    isObject,
  ) as JsonObject[];
  const targetPlugins = (await args.context.client.plugins.list()).filter(
    isObject,
  ) as JsonObject[];

  const targetByPackageName = new Map(
    targetPlugins
      .map((plugin) => [asString(plugin.package_name), plugin] as const)
      .filter((entry): entry is [string, JsonObject] => Boolean(entry[0])),
  );

  for (let index = 0; index < sourcePlugins.length; index += 1) {
    const source = sourcePlugins[index];
    const sourceId = asString(source.id);
    const packageName = asString(source.package_name);
    const sourceName = asString(source.name);

    args.context.onProgress?.({
      phase: 'config-import',
      finished: index,
      total: sourcePlugins.length || 1,
      message: `Importing plugin ${index + 1}/${sourcePlugins.length || 1}`,
    });

    try {
      const existing = packageName ? targetByPackageName.get(packageName) : null;
      if (existing) {
        if (args.context.addOnlyDifferences) {
          markAddOnlySkip({
            warnings: args.result.warnings,
            addOnlySkippedByResource: args.result.addOnlySkippedByResource,
            resource: 'plugins',
            key: `plugin '${packageName ?? sourceName ?? sourceId ?? 'unknown'}'`,
            logger,
          });
          continue;
        }

        const payload = buildPluginUpdatePayload(source);
        await args.context.client.plugins.update(asString(existing.id)!, payload as any);
      } else {
        let createdId: string | null = null;
        const attemptErrors: string[] = [];

        const runCreateAttempt = async (
          payload: JsonObject | null,
          attemptLabel: string,
        ): Promise<string | null> => {
          if (!payload || Object.keys(payload).length === 0) {
            return null;
          }

          try {
            const response = (await args.context.client.plugins.create(
              payload as any,
            )) as { id?: unknown } | string | null;
            const maybeId =
              response && typeof response === 'object'
                ? asString(response.id)
                : asString(response);
            if (!maybeId) {
              throw new Error('Plugin create response did not include id.');
            }
            logger.debug('Plugin create attempt succeeded', {
              sourceId,
              packageName,
              sourceName,
              attempt: attemptLabel,
              payloadKeys: Object.keys(payload),
            });
            return maybeId;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            attemptErrors.push(`${attemptLabel}: ${message}`);
            logger.warn('Plugin create attempt failed', {
              sourceId,
              packageName,
              sourceName,
              attempt: attemptLabel,
              payloadKeys: Object.keys(payload),
              error: message,
            });
            return null;
          }
        };

        if (packageName) {
          const withVersionPayload = buildPluginPackageCreatePayload(source, true);
          const withoutVersionPayload = buildPluginPackageCreatePayload(source, false);

          createdId = await runCreateAttempt(
            withVersionPayload,
            'package-install-with-version',
          );
          if (!createdId) {
            const differentWithoutVersion = JSON.stringify(withVersionPayload) !==
              JSON.stringify(withoutVersionPayload);
            if (differentWithoutVersion) {
              createdId = await runCreateAttempt(withoutVersionPayload, 'package-install');
            }
          }
        }

        if (!createdId) {
          const privateFullPayload = buildPluginPrivateCreatePayload({
            source,
            includeFieldExtensionConfig: true,
          });
          const privateMinimalPayload = buildPluginPrivateCreatePayload({
            source,
            includeFieldExtensionConfig: false,
          });

          createdId = await runCreateAttempt(
            privateFullPayload,
            'private-create-with-field-config',
          );
          if (!createdId) {
            const differentMinimal =
              JSON.stringify(privateFullPayload) !==
              JSON.stringify(privateMinimalPayload);
            if (differentMinimal) {
              createdId = await runCreateAttempt(
                privateMinimalPayload,
                'private-create-minimal',
              );
            }
          }
        }

        if (!createdId) {
          throw new Error(
            `All plugin create attempts failed. ${attemptErrors.join(' | ')}`,
          );
        }

        if (packageName) {
          targetByPackageName.set(packageName, { ...source, id: createdId });
        }
      }
      logger.debug('Imported plugin', {
        sourceId,
        packageName,
        sourceName,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'plugins',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import plugin '${sourceName ?? packageName ?? sourceId ?? 'unknown'}': ${error.message}`
            : 'Failed to import plugin.',
      }, logger);
    }
  }
}

function createEmptyConfigResult(): NonSideEffectImportResult {
  return {
    warnings: [],
    failures: [],
    workflowIdMap: new Map<string, string>(),
    roleIdMap: new Map<string, string>(),
    modelFilterIdMap: new Map<string, string>(),
    menuItemIdMap: new Map<string, string>(),
    schemaMenuItemIdMap: new Map<string, string>(),
    addOnlySkippedByResource: {},
  };
}

export async function importPluginsForSchema(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  addOnlyDifferences?: boolean;
  logger?: DebugLogger;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<{
  warnings: string[];
  failures: ImportFailure[];
  addOnlySkippedByResource: Record<string, number>;
}> {
  const result = createEmptyConfigResult();
  const context: ImportContext = {
    client: args.client,
    envelope: args.envelope,
    itemTypeIdMap: new Map<string, string>(),
    fieldIdMap: new Map<string, string>(),
    addOnlyDifferences: args.addOnlyDifferences,
    logger: args.logger,
    onProgress: args.onProgress,
  };

  await importPlugins({ context, result });

  return {
    warnings: result.warnings,
    failures: result.failures,
    addOnlySkippedByResource: result.addOnlySkippedByResource,
  };
}

async function importModelFilters(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/model-filters');
  const sourceFilters = asArray(
    projectConfiguration(args.context.envelope).modelFilters,
  ).filter(isObject) as JsonObject[];
  const targetFilters = (await args.context.client.itemTypeFilters.list()).filter(
    isObject,
  ) as JsonObject[];

  const targetByKey = new Map<string, JsonObject>();
  targetFilters.forEach((entry) => {
    const key = makeCompositeKey([
      asString(entry.name),
      extractEntityId(entry.item_type),
    ]);
    targetByKey.set(key, entry);
  });

  for (let index = 0; index < sourceFilters.length; index += 1) {
    const source = sourceFilters[index];
    const sourceId = asString(source.id);
    const sourceName = asString(source.name);
    const sourceItemTypeId = extractEntityId(source.item_type);
    const targetItemTypeId = sourceItemTypeId
      ? args.context.itemTypeIdMap.get(sourceItemTypeId)
      : null;

    args.context.onProgress?.({
      phase: 'config-import',
      finished: index,
      total: sourceFilters.length || 1,
      message: `Importing model filter ${index + 1}/${sourceFilters.length || 1}`,
    });

    if (!targetItemTypeId) {
      pushFailure(args.result, {
        resource: 'modelFilters',
        sourceId,
        message: `Skipped model filter '${sourceName ?? sourceId ?? 'unknown'}': missing mapped model.`,
      }, logger);
      continue;
    }

    const key = makeCompositeKey([sourceName, targetItemTypeId]);
    const existing = targetByKey.get(key);

    try {
      if (existing && args.context.addOnlyDifferences) {
        const targetId = asString(existing.id);
        if (sourceId && targetId) {
          args.result.modelFilterIdMap.set(sourceId, targetId);
        }
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'modelFilters',
          key: `model filter '${sourceName ?? sourceId ?? 'unknown'}'`,
          logger,
        });
        continue;
      }

      const payload = compactObject({
        name: source.name,
        filter: deepRemapKnownIds(source.filter, [args.context.itemTypeIdMap]),
        columns: deepRemapKnownIds(source.columns, [args.context.itemTypeIdMap]),
        order_by: deepRemapKnownIds(source.order_by, [args.context.itemTypeIdMap]),
        shared: source.shared,
        item_type: {
          type: 'item_type',
          id: targetItemTypeId,
        },
      });

      const target = existing
        ? await args.context.client.itemTypeFilters.update(
            asString(existing.id)!,
            payload as any,
          )
        : await args.context.client.itemTypeFilters.create(payload as any);

      const targetId = asString(target.id);
      if (sourceId && targetId) {
        args.result.modelFilterIdMap.set(sourceId, targetId);
      }
      if (targetId) {
        targetByKey.set(key, { ...source, id: targetId, item_type: { id: targetItemTypeId } });
      }
      logger.debug('Imported model filter', {
        sourceId,
        sourceName,
        targetId,
        targetItemTypeId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'modelFilters',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import model filter '${sourceName ?? sourceId ?? 'unknown'}': ${error.message}`
            : 'Failed to import model filter.',
      }, logger);
    }
  }
}

async function seedModelFilterIdMapFromExisting(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/model-filters');
  const sourceFilters = asArray(
    projectConfiguration(args.context.envelope).modelFilters,
  ).filter(isObject) as JsonObject[];
  const targetFilters = (await args.context.client.itemTypeFilters.list()).filter(
    isObject,
  ) as JsonObject[];

  const targetByKey = new Map<string, JsonObject>();
  targetFilters.forEach((entry) => {
    const key = makeCompositeKey([
      asString(entry.name),
      extractEntityId(entry.item_type),
    ]);
    targetByKey.set(key, entry);
  });

  let mappedCount = 0;
  for (const source of sourceFilters) {
    const sourceId = asString(source.id);
    const sourceName = asString(source.name);
    const sourceItemTypeId = extractEntityId(source.item_type);
    const targetItemTypeId = sourceItemTypeId
      ? args.context.itemTypeIdMap.get(sourceItemTypeId)
      : null;
    if (!sourceId || !targetItemTypeId) {
      continue;
    }

    const key = makeCompositeKey([sourceName, targetItemTypeId]);
    const existing = targetByKey.get(key);
    const targetId = existing ? asString(existing.id) : null;
    if (!targetId) {
      continue;
    }

    args.result.modelFilterIdMap.set(sourceId, targetId);
    mappedCount += 1;
  }

  logger.debug('Seeded model filter ID map from existing target model filters', {
    sourceCount: sourceFilters.length,
    mappedCount,
  });
}

function buildMenuItemPayload(args: {
  source: JsonObject;
  itemTypeIdMap: Map<string, string>;
  modelFilterIdMap: Map<string, string>;
  menuItemIdMap: Map<string, string>;
  includeParent: boolean;
  includeItemTypeFilter: boolean;
}): JsonObject {
  const payload = compactObject({
    label: args.source.label,
    external_url: args.source.external_url,
    position: args.source.position,
    open_in_new_tab: args.source.open_in_new_tab,
  });

  const itemType = remapRelationship({
    sourceValue: args.source.item_type,
    idMap: args.itemTypeIdMap,
    type: 'item_type',
  });
  if (itemType !== undefined) {
    payload.item_type = itemType;
  }

  if (args.includeItemTypeFilter) {
    const itemTypeFilter = remapRelationship({
      sourceValue: args.source.item_type_filter,
      idMap: args.modelFilterIdMap,
      type: 'item_type_filter',
    });
    if (itemTypeFilter !== undefined) {
      payload.item_type_filter = itemTypeFilter;
    }
  }

  if (args.includeParent) {
    const parent = remapRelationship({
      sourceValue: args.source.parent,
      idMap: args.menuItemIdMap,
      type: 'menu_item',
    });
    if (parent !== undefined) {
      payload.parent = parent;
    }
  }

  return payload;
}

async function importMenuItems(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/menu-items');
  const sourceMenuItems = asArray(
    projectConfiguration(args.context.envelope).menuItems,
  ).filter(isObject) as JsonObject[];
  const targetMenuItems = (await args.context.client.menuItems.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetByComparableKey = new Map<string, JsonObject>();

  targetMenuItems.forEach((target) => {
    const key = makeCompositeKey([
      asString(target.label),
      asString(target.external_url),
      extractEntityId(target.item_type),
    ]);
    targetByComparableKey.set(key, target);
  });
  const createdMenuItemSourceIds = new Set<string>();

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceMenuItems.length || 1,
    message: 'Importing menu items (pass A)',
  });

  for (let index = 0; index < sourceMenuItems.length; index += 1) {
    const source = sourceMenuItems[index];
    const sourceId = asString(source.id);
    const mappedItemType = remapRelationship({
      sourceValue: source.item_type,
      idMap: args.context.itemTypeIdMap,
      type: 'item_type',
    });

    const key = makeCompositeKey([
      asString(source.label),
      asString(source.external_url),
      extractEntityId(mappedItemType),
    ]);
    const existing = targetByComparableKey.get(key);

    try {
      if (existing && args.context.addOnlyDifferences) {
        const targetId = asString(existing.id);
        if (sourceId && targetId) {
          args.result.menuItemIdMap.set(sourceId, targetId);
        }
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'menuItems',
          key: `menu item '${sourceId ?? key}'`,
          logger,
        });
        continue;
      }

      const payload = buildMenuItemPayload({
        source,
        itemTypeIdMap: args.context.itemTypeIdMap,
        modelFilterIdMap: args.result.modelFilterIdMap,
        menuItemIdMap: args.result.menuItemIdMap,
        includeParent: false,
        includeItemTypeFilter: false,
      });
      const target = existing
        ? await args.context.client.menuItems.update(asString(existing.id)!, payload as any)
        : await args.context.client.menuItems.create(payload as any);
      const targetId = asString(target.id);
      if (sourceId && targetId) {
        args.result.menuItemIdMap.set(sourceId, targetId);
        if (!existing) {
          createdMenuItemSourceIds.add(sourceId);
        }
      }
      if (targetId) {
        targetByComparableKey.set(key, { ...source, id: targetId });
      }
      logger.debug('Imported menu item pass A', {
        sourceId,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'menuItems',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import menu item '${sourceId ?? key}': ${error.message}`
            : 'Failed to import menu item.',
      }, logger);
    }
  }

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceMenuItems.length || 1,
    message: 'Importing menu items (pass B)',
  });

  for (let index = 0; index < sourceMenuItems.length; index += 1) {
    const source = sourceMenuItems[index];
    const sourceId = asString(source.id);
    if (!sourceId) {
      continue;
    }

    if (args.context.addOnlyDifferences && !createdMenuItemSourceIds.has(sourceId)) {
      continue;
    }

    const targetId = args.result.menuItemIdMap.get(sourceId);
    if (!targetId) {
      continue;
    }

    try {
      const payload = buildMenuItemPayload({
        source,
        itemTypeIdMap: args.context.itemTypeIdMap,
        modelFilterIdMap: args.result.modelFilterIdMap,
        menuItemIdMap: args.result.menuItemIdMap,
        includeParent: true,
        includeItemTypeFilter: true,
      });
      await args.context.client.menuItems.update(targetId, payload as any);
      logger.debug('Finalized menu item pass B', {
        sourceId,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'menuItems',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to finalize menu item '${sourceId}': ${error.message}`
            : 'Failed to finalize menu item.',
      }, logger);
    }
  }
}

function buildSchemaMenuItemPayload(args: {
  source: JsonObject;
  itemTypeIdMap: Map<string, string>;
  schemaMenuItemIdMap: Map<string, string>;
  includeParent: boolean;
  includeChildren: boolean;
}): JsonObject {
  const payload = compactObject({
    label: args.source.label,
    position: args.source.position,
    kind: args.source.kind,
  });

  const itemType = remapRelationship({
    sourceValue: args.source.item_type,
    idMap: args.itemTypeIdMap,
    type: 'item_type',
  });
  if (itemType !== undefined) {
    payload.item_type = itemType;
  }

  if (args.includeParent) {
    const parent = remapRelationship({
      sourceValue: args.source.parent,
      idMap: args.schemaMenuItemIdMap,
      type: 'schema_menu_item',
    });
    if (parent !== undefined) {
      payload.parent = parent;
    }
  }

  if (args.includeChildren) {
    const children = remapRelationshipCollection({
      sourceValue: args.source.children,
      idMap: args.schemaMenuItemIdMap,
      type: 'schema_menu_item',
    });
    if (children !== undefined) {
      payload.children = children;
    }
  }

  return payload;
}

async function importSchemaMenuItems(args: {
  context: ImportContext;
  result: NonSideEffectImportResult;
}) {
  const logger = getLogger(args.context.logger, 'config-import/schema-menu-items');
  const sourceSchemaMenuItems = asArray(
    projectConfiguration(args.context.envelope).schemaMenuItems,
  ).filter(isObject) as JsonObject[];
  const targetSchemaMenuItems = (
    await args.context.client.schemaMenuItems.list()
  ).filter(isObject) as JsonObject[];
  const targetByComparableKey = new Map<string, JsonObject>();

  targetSchemaMenuItems.forEach((target) => {
    const key = makeCompositeKey([
      asString(target.label),
      asString(target.kind),
      extractEntityId(target.item_type),
    ]);
    targetByComparableKey.set(key, target);
  });
  const createdSchemaMenuItemSourceIds = new Set<string>();

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceSchemaMenuItems.length || 1,
    message: 'Importing schema menu items (pass A)',
  });

  for (let index = 0; index < sourceSchemaMenuItems.length; index += 1) {
    const source = sourceSchemaMenuItems[index];
    const sourceId = asString(source.id);
    const mappedItemType = remapRelationship({
      sourceValue: source.item_type,
      idMap: args.context.itemTypeIdMap,
      type: 'item_type',
    });
    const key = makeCompositeKey([
      asString(source.label),
      asString(source.kind),
      extractEntityId(mappedItemType),
    ]);
    const existing = targetByComparableKey.get(key);

    try {
      if (existing && args.context.addOnlyDifferences) {
        const targetId = asString(existing.id);
        if (sourceId && targetId) {
          args.result.schemaMenuItemIdMap.set(sourceId, targetId);
        }
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'schemaMenuItems',
          key: `schema menu item '${sourceId ?? key}'`,
          logger,
        });
        continue;
      }

      const payload = buildSchemaMenuItemPayload({
        source,
        itemTypeIdMap: args.context.itemTypeIdMap,
        schemaMenuItemIdMap: args.result.schemaMenuItemIdMap,
        includeParent: false,
        includeChildren: false,
      });
      const target = existing
        ? await args.context.client.schemaMenuItems.update(
            asString(existing.id)!,
            payload as any,
          )
        : await args.context.client.schemaMenuItems.create(payload as any);
      const targetId = asString(target.id);
      if (sourceId && targetId) {
        args.result.schemaMenuItemIdMap.set(sourceId, targetId);
        if (!existing) {
          createdSchemaMenuItemSourceIds.add(sourceId);
        }
      }
      if (targetId) {
        targetByComparableKey.set(key, { ...source, id: targetId });
      }
      logger.debug('Imported schema menu item pass A', {
        sourceId,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'schemaMenuItems',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import schema menu item '${sourceId ?? key}': ${error.message}`
            : 'Failed to import schema menu item.',
      }, logger);
    }
  }

  args.context.onProgress?.({
    phase: 'config-import',
    finished: 0,
    total: sourceSchemaMenuItems.length || 1,
    message: 'Importing schema menu items (pass B)',
  });

  for (let index = 0; index < sourceSchemaMenuItems.length; index += 1) {
    const source = sourceSchemaMenuItems[index];
    const sourceId = asString(source.id);
    if (!sourceId) {
      continue;
    }

    if (
      args.context.addOnlyDifferences &&
      !createdSchemaMenuItemSourceIds.has(sourceId)
    ) {
      continue;
    }

    const targetId = args.result.schemaMenuItemIdMap.get(sourceId);
    if (!targetId) {
      continue;
    }

    try {
      const payload = buildSchemaMenuItemPayload({
        source,
        itemTypeIdMap: args.context.itemTypeIdMap,
        schemaMenuItemIdMap: args.result.schemaMenuItemIdMap,
        includeParent: true,
        includeChildren: true,
      });
      await args.context.client.schemaMenuItems.update(targetId, payload as any);
      logger.debug('Finalized schema menu item pass B', {
        sourceId,
        targetId,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'schemaMenuItems',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to finalize schema menu item '${sourceId}': ${error.message}`
            : 'Failed to finalize schema menu item.',
      }, logger);
    }
  }
}

async function importWebhooks(args: {
  context: ImportContext;
  result: {
    warnings: string[];
    failures: ImportFailure[];
    addOnlySkippedByResource: Record<string, number>;
  };
}) {
  const logger = getLogger(args.context.logger, 'integration-import/webhooks');
  const sourceWebhooks = asArray(
    projectConfiguration(args.context.envelope).webhooks,
  ).filter(isObject) as JsonObject[];
  const targetWebhooks = (await args.context.client.webhooks.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetByKey = new Map<string, JsonObject>();

  targetWebhooks.forEach((target) => {
    const key = makeCompositeKey([asString(target.name), asString(target.url)]);
    targetByKey.set(key, target);
  });

  for (let index = 0; index < sourceWebhooks.length; index += 1) {
    const source = sourceWebhooks[index];
    const sourceId = asString(source.id);
    const key = makeCompositeKey([asString(source.name), asString(source.url)]);
    const existing = targetByKey.get(key);

    try {
      if (existing && args.context.addOnlyDifferences) {
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'webhooks',
          key: `webhook '${key}'`,
          logger,
        });
        continue;
      }

      const payload = compactObject({
        name: source.name,
        url: source.url,
        custom_payload: source.custom_payload,
        headers: source.headers,
        events: source.events,
        http_basic_user: source.http_basic_user,
        http_basic_password: source.http_basic_password,
        enabled: source.enabled,
        payload_api_version: source.payload_api_version,
        nested_items_in_payload: source.nested_items_in_payload,
        auto_retry: source.auto_retry,
      });

      const target = existing
        ? await args.context.client.webhooks.update(asString(existing.id)!, payload as any)
        : await args.context.client.webhooks.create(payload as any);

      const targetId = asString(target.id);
      if (targetId) {
        targetByKey.set(key, { ...source, id: targetId });
      }
      logger.debug('Imported webhook', {
        sourceId,
        key,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'webhooks',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import webhook '${key}': ${error.message}`
            : 'Failed to import webhook.',
      }, logger);
    }
  }
}

async function importBuildTriggers(args: {
  context: ImportContext;
  result: {
    warnings: string[];
    failures: ImportFailure[];
    addOnlySkippedByResource: Record<string, number>;
  };
}) {
  const logger = getLogger(args.context.logger, 'integration-import/build-triggers');
  const sourceBuildTriggers = asArray(
    projectConfiguration(args.context.envelope).buildTriggers,
  ).filter(isObject) as JsonObject[];
  const targetBuildTriggers = (await args.context.client.buildTriggers.list()).filter(
    isObject,
  ) as JsonObject[];
  const targetByKey = new Map<string, JsonObject>();

  targetBuildTriggers.forEach((target) => {
    const key = makeCompositeKey([asString(target.name), asString(target.adapter)]);
    targetByKey.set(key, target);
  });

  for (let index = 0; index < sourceBuildTriggers.length; index += 1) {
    const source = sourceBuildTriggers[index];
    const sourceId = asString(source.id);
    const key = makeCompositeKey([asString(source.name), asString(source.adapter)]);
    const existing = targetByKey.get(key);

    try {
      if (existing && args.context.addOnlyDifferences) {
        markAddOnlySkip({
          warnings: args.result.warnings,
          addOnlySkippedByResource: args.result.addOnlySkippedByResource,
          resource: 'buildTriggers',
          key: `build trigger '${key}'`,
          logger,
        });
        continue;
      }

      if (existing) {
        const updatePayload = compactObject({
          name: source.name,
          adapter: source.adapter,
          indexing_enabled: source.indexing_enabled,
          enabled: source.enabled,
          frontend_url: source.frontend_url,
          autotrigger_on_scheduled_publications:
            source.autotrigger_on_scheduled_publications,
          adapter_settings: source.adapter_settings,
        });
        await args.context.client.buildTriggers.update(
          asString(existing.id)!,
          updatePayload as any,
        );
      } else {
        const createPayload = compactObject({
          name: source.name,
          webhook_token: source.webhook_token,
          adapter: source.adapter,
          indexing_enabled: source.indexing_enabled,
          enabled: source.enabled,
          frontend_url: source.frontend_url,
          autotrigger_on_scheduled_publications:
            source.autotrigger_on_scheduled_publications,
          adapter_settings: source.adapter_settings,
        });
        const created = await args.context.client.buildTriggers.create(createPayload as any);
        const createdId = asString(created.id);
        if (createdId) {
          targetByKey.set(key, { ...source, id: createdId });
        }
      }
      logger.debug('Imported build trigger', {
        sourceId,
        key,
      });
    } catch (error) {
      pushFailure(args.result, {
        resource: 'buildTriggers',
        sourceId,
        message:
          error instanceof Error
            ? `Failed to import build trigger '${key}': ${error.message}`
            : 'Failed to import build trigger.',
      }, logger);
    }
  }
}

export async function importSiteBaseline(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  logger?: DebugLogger;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<{ warnings: string[]; failures: ImportFailure[] }> {
  const logger = getLogger(args.logger, 'site-baseline');
  const result = {
    warnings: [] as string[],
    failures: [] as ImportFailure[],
  };

  args.onProgress?.({
    phase: 'site-baseline',
    finished: 0,
    total: 1,
    message: 'Applying site baseline settings',
  });

  const site = projectConfiguration(args.envelope).site;
  if (!site || !isObject(site)) {
    pushFailure(
      result,
      {
        resource: 'site',
        sourceId: null,
        message:
          '`projectConfiguration.site` is missing. Site baseline is required before schema import.',
      },
      logger,
    );
    return result;
  }

  try {
    const payload = compactObject({
      locales: site.locales,
      timezone: site.timezone,
      name: site.name,
      no_index: site.no_index,
      theme: site.theme,
      require_2fa: site.require_2fa,
      ip_tracking_enabled: site.ip_tracking_enabled,
      force_use_of_sandbox_environments: site.force_use_of_sandbox_environments,
    });
    logger.debug('Applying site baseline payload', {
      payloadKeys: Object.keys(payload),
      locales: payload.locales,
    });
    await args.client.site.update(payload as any);
    logger.debug('Site baseline applied');
  } catch (error) {
    if (isSiteNameUniquenessError(error)) {
      const payloadWithoutName = compactObject({
        locales: site.locales,
        timezone: site.timezone,
        no_index: site.no_index,
        theme: site.theme,
        require_2fa: site.require_2fa,
        ip_tracking_enabled: site.ip_tracking_enabled,
        force_use_of_sandbox_environments: site.force_use_of_sandbox_environments,
      });

      logger.warn(
        'Retrying site baseline without `name` due uniqueness constraint in target project',
        {
          sourceSiteId: asString(site.id),
          payloadKeys: Object.keys(payloadWithoutName),
        },
      );

      try {
        if (Object.keys(payloadWithoutName).length > 0) {
          await args.client.site.update(payloadWithoutName as any);
        }
        result.warnings.push(
          '[site] Skipped `site.name` because target project enforces uniqueness.',
        );
        logger.warn('Applied site baseline with `name` excluded');
        return result;
      } catch (retryError) {
        pushFailure(
          result,
          {
            resource: 'site',
            sourceId: asString(site.id),
            message:
              retryError instanceof Error
                ? `Failed to apply site baseline after excluding \`name\`: ${retryError.message}`
                : 'Failed to apply site baseline after excluding `name`.',
          },
          logger,
        );
        return result;
      }
    }

    pushFailure(result, {
      resource: 'site',
      sourceId: asString(site.id),
      message:
        error instanceof Error
          ? `Failed to apply site baseline: ${error.message}`
          : 'Failed to apply site baseline.',
    }, logger);
  }

  return result;
}

export async function importNonSideEffectConfiguration(
  context: ImportContext,
  options: NonSideEffectImportOptions = {},
): Promise<NonSideEffectImportResult> {
  const effectiveContext: ImportContext = {
    ...context,
    addOnlyDifferences:
      options.addOnlyDifferences ?? context.addOnlyDifferences ?? false,
  };
  const logger = getLogger(effectiveContext.logger, 'config-import');
  const result = createEmptyConfigResult();
  const includeWorkflows = options.includeWorkflows ?? true;
  const includeRoles = options.includeRoles ?? true;
  const includePlugins = options.includePlugins ?? true;
  const includeModelFilters = options.includeModelFilters ?? true;
  const includeMenuItems = options.includeMenuItems ?? true;
  const includeSchemaMenuItems = options.includeSchemaMenuItems ?? true;

  logger.debug('Starting non-side-effect configuration import');

  if (includeWorkflows) {
    await importWorkflows({ context: effectiveContext, result });
  } else {
    result.warnings.push('Skipped workflow import phase by option.');
    await seedWorkflowIdMapFromExisting({ context: effectiveContext, result });
  }

  if (includeWorkflows) {
    const workflowPatchScope = effectiveContext.addOnlyDifferences
      ? effectiveContext.createdItemTypeSourceIds
      : undefined;

    if (
      !effectiveContext.addOnlyDifferences ||
      (workflowPatchScope && workflowPatchScope.size > 0)
    ) {
      try {
        await patchItemTypeWorkflowRelationships({
          client: effectiveContext.client,
          envelope: effectiveContext.envelope,
          itemTypeIdMap: effectiveContext.itemTypeIdMap,
          fieldIdMap: effectiveContext.fieldIdMap,
          workflowIdMap: result.workflowIdMap,
          allowedSourceItemTypeIds: workflowPatchScope,
          logger: effectiveContext.logger,
        });
      } catch (error) {
        pushFailure(result, {
          resource: 'itemTypes.workflow',
          sourceId: null,
          message:
            error instanceof Error
              ? `Failed to patch model workflow relations: ${error.message}`
              : 'Failed to patch model workflow relations.',
        }, logger);
      }
    } else {
      result.warnings.push(
        '[add-only][itemTypes] Skipped workflow relationship patch for existing models.',
      );
    }
  } else {
    result.warnings.push('Skipped model workflow relationship patch by option.');
  }

  if (includeRoles) {
    await importRoles({ context: effectiveContext, result });
  } else {
    result.warnings.push('Skipped role import phase by option.');
  }

  if (includePlugins) {
    await importPlugins({ context: effectiveContext, result });
  }

  if (includeModelFilters) {
    await importModelFilters({ context: effectiveContext, result });
  } else {
    result.warnings.push('Skipped model filter import phase by option.');
    await seedModelFilterIdMapFromExisting({ context: effectiveContext, result });
  }

  if (includeMenuItems) {
    await importMenuItems({ context: effectiveContext, result });
  } else {
    result.warnings.push('Skipped menu item import phase by option.');
  }

  if (includeSchemaMenuItems) {
    await importSchemaMenuItems({ context: effectiveContext, result });
  } else {
    result.warnings.push('Skipped schema menu item import phase by option.');
  }

  logger.debug('Finished non-side-effect configuration import', {
    workflowMappings: result.workflowIdMap.size,
    roleMappings: result.roleIdMap.size,
    modelFilterMappings: result.modelFilterIdMap.size,
    menuItemMappings: result.menuItemIdMap.size,
    schemaMenuItemMappings: result.schemaMenuItemIdMap.size,
    warnings: result.warnings.length,
    failures: result.failures.length,
  });

  return result;
}

export async function replayScheduledActions(args: {
  client: Client;
  envelope: RecordExportEnvelope;
  recordIdMap: Map<string, string>;
  skipSourceRecordIds?: Set<string>;
  logger?: DebugLogger;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<{ warnings: string[]; failures: ImportFailure[] }> {
  const logger = getLogger(args.logger, 'schedule-replay');
  const result = {
    warnings: [] as string[],
    failures: [] as ImportFailure[],
  };

  const config = projectConfiguration(args.envelope);
  const publications = config.scheduledPublications;
  const unpublishings = config.scheduledUnpublishings;
  const total = publications.length + unpublishings.length;

  logger.debug('Starting schedule replay', {
    publications: publications.length,
    unpublishings: unpublishings.length,
  });

  args.onProgress?.({
    phase: 'schedule-replay',
    finished: 0,
    total: total || 1,
    message: 'Replaying scheduled actions',
  });

  let cursor = 0;

  for (const sourceAction of publications) {
    cursor += 1;
    args.onProgress?.({
      phase: 'schedule-replay',
      finished: cursor - 1,
      total: total || 1,
      message: `Replaying publication schedule ${cursor}/${total || 1}`,
    });

    if (args.skipSourceRecordIds?.has(sourceAction.itemId)) {
      continue;
    }

    const targetRecordId = args.recordIdMap.get(sourceAction.itemId);
    if (!targetRecordId) {
      pushFailure(result, {
        resource: 'scheduledPublications',
        sourceId: sourceAction.itemId,
        message: `Skipped publication schedule '${sourceAction.itemId}': target record was not imported.`,
      }, logger);
      continue;
    }

    try {
      try {
        await args.client.scheduledPublication.destroy(targetRecordId);
      } catch (_error) {
        // Ignore missing existing schedule.
      }

      await args.client.scheduledPublication.create(targetRecordId, {
        publication_scheduled_at: sourceAction.scheduledAt,
      } as any);
      logger.debug('Replayed publication schedule', {
        sourceRecordId: sourceAction.itemId,
        targetRecordId,
        scheduledAt: sourceAction.scheduledAt,
      });
    } catch (error) {
      pushFailure(result, {
        resource: 'scheduledPublications',
        sourceId: sourceAction.itemId,
        message:
          error instanceof Error
            ? `Failed to replay publication schedule '${sourceAction.itemId}': ${error.message}`
            : `Failed to replay publication schedule '${sourceAction.itemId}'.`,
      }, logger);
    }
  }

  for (const sourceAction of unpublishings) {
    cursor += 1;
    args.onProgress?.({
      phase: 'schedule-replay',
      finished: cursor - 1,
      total: total || 1,
      message: `Replaying unpublishing schedule ${cursor}/${total || 1}`,
    });

    if (args.skipSourceRecordIds?.has(sourceAction.itemId)) {
      continue;
    }

    const targetRecordId = args.recordIdMap.get(sourceAction.itemId);
    if (!targetRecordId) {
      pushFailure(result, {
        resource: 'scheduledUnpublishings',
        sourceId: sourceAction.itemId,
        message: `Skipped unpublishing schedule '${sourceAction.itemId}': target record was not imported.`,
      }, logger);
      continue;
    }

    try {
      try {
        await args.client.scheduledUnpublishing.destroy(targetRecordId);
      } catch (_error) {
        // Ignore missing existing schedule.
      }

      await args.client.scheduledUnpublishing.create(targetRecordId, {
        unpublishing_scheduled_at: sourceAction.scheduledAt,
      } as any);
      logger.debug('Replayed unpublishing schedule', {
        sourceRecordId: sourceAction.itemId,
        targetRecordId,
        scheduledAt: sourceAction.scheduledAt,
      });
    } catch (error) {
      pushFailure(result, {
        resource: 'scheduledUnpublishings',
        sourceId: sourceAction.itemId,
        message:
          error instanceof Error
            ? `Failed to replay unpublishing schedule '${sourceAction.itemId}': ${error.message}`
            : `Failed to replay unpublishing schedule '${sourceAction.itemId}'.`,
      }, logger);
    }
  }

  logger.debug('Finished schedule replay', {
    warnings: result.warnings.length,
    failures: result.failures.length,
  });

  return result;
}

export async function importSideEffectIntegrations(
  context: ImportContext & {
    includeWebhooks?: boolean;
    includeBuildTriggers?: boolean;
  },
): Promise<{
  warnings: string[];
  failures: ImportFailure[];
  addOnlySkippedByResource: Record<string, number>;
}> {
  const logger = getLogger(context.logger, 'integration-import');
  const result = {
    warnings: [] as string[],
    failures: [] as ImportFailure[],
    addOnlySkippedByResource: {} as Record<string, number>,
  };
  const includeWebhooks = context.includeWebhooks ?? true;
  const includeBuildTriggers = context.includeBuildTriggers ?? true;
  const totalPhases =
    (includeWebhooks ? 1 : 0) + (includeBuildTriggers ? 1 : 0);

  logger.debug('Starting integration import');

  if (totalPhases === 0) {
    context.onProgress?.({
      phase: 'integration-import',
      finished: 1,
      total: 1,
      message: 'Skipping integration import by option',
    });
    result.warnings.push('Skipped webhook import phase by option.');
    result.warnings.push('Skipped build trigger import phase by option.');
    logger.warn('Skipped integration import phases by option');
    return result;
  }

  let finished = 0;
  if (includeWebhooks) {
    context.onProgress?.({
      phase: 'integration-import',
      finished,
      total: totalPhases,
      message: 'Importing active webhooks',
    });
    await importWebhooks({ context, result });
    finished += 1;
  } else {
    result.warnings.push('Skipped webhook import phase by option.');
  }

  if (includeBuildTriggers) {
    context.onProgress?.({
      phase: 'integration-import',
      finished,
      total: totalPhases,
      message: 'Importing active build triggers',
    });
    await importBuildTriggers({ context, result });
  } else {
    result.warnings.push('Skipped build trigger import phase by option.');
  }

  logger.debug('Finished integration import', {
    warnings: result.warnings.length,
    failures: result.failures.length,
  });

  return result;
}

export function buildVerificationWarnings(args: {
  envelope: RecordExportEnvelope;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  fieldsetIdMap: Map<string, string>;
  recordIdMap: Map<string, string>;
  uploadIdMap: Map<string, string>;
}) {
  const warnings: string[] = [];

  const sourceItemTypes = asArray(args.envelope.schema.itemTypes).filter(isObject).length;
  const sourceFields = asArray(args.envelope.schema.fields).filter(isObject).length;
  const sourceFieldsets = asArray(
    projectConfiguration(args.envelope).fieldsets,
  ).filter(isObject).length;
  const sourceRecords = args.envelope.records.length;
  const sourceUploads = args.envelope.referenceIndex.uploadRefs.length;

  if (args.itemTypeIdMap.size < sourceItemTypes) {
    warnings.push(
      `Verification: mapped ${args.itemTypeIdMap.size}/${sourceItemTypes} item types.`,
    );
  }
  if (args.fieldIdMap.size < sourceFields) {
    warnings.push(`Verification: mapped ${args.fieldIdMap.size}/${sourceFields} fields.`);
  }
  if (args.fieldsetIdMap.size < sourceFieldsets) {
    warnings.push(
      `Verification: mapped ${args.fieldsetIdMap.size}/${sourceFieldsets} fieldsets.`,
    );
  }
  if (args.recordIdMap.size < sourceRecords) {
    warnings.push(`Verification: mapped ${args.recordIdMap.size}/${sourceRecords} records.`);
  }
  if (sourceUploads > 0 && args.uploadIdMap.size === 0) {
    warnings.push(
      'Verification: upload references are present in export, but no upload mappings were generated.',
    );
  }

  return warnings;
}

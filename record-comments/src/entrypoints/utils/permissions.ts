import type { ModelInfo } from '@hooks/useMentions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';

export type PermissionContext = Pick<
  RenderItemFormSidebarCtx,
  'currentRole' | 'environment'
>;

type Permission = {
  environment: string;
  action: string;
  item_type?: string | null;
  workflow?: string | null;
  on_stage?: string | null;
  to_stage?: string | null;
  on_creator?: string | null;
  localization_scope?: string | null;
  locale?: string | null;
};

function isUnrestrictedReadPermission(permission: Permission) {
  const unrestrictedCreator =
    permission.on_creator == null || permission.on_creator === 'anyone';
  const unrestrictedLocalization =
    permission.localization_scope == null ||
    permission.localization_scope === 'all';
  return (
    unrestrictedCreator &&
    unrestrictedLocalization &&
    permission.workflow == null &&
    permission.on_stage == null &&
    permission.to_stage == null &&
    permission.locale == null
  );
}

/** A paginated scan is complete only if the role can see every model record. */
export function hasUnrestrictedModelReadPermission(
  ctx: PermissionContext,
  modelId: string,
) {
  const matches = (permission: Permission) =>
    permission.environment === ctx.environment &&
    (permission.action === 'read' || permission.action === 'all') &&
    (permission.item_type === null || permission.item_type === modelId);
  const positive =
    ctx.currentRole.attributes.positive_item_type_permissions ?? [];
  const negative =
    ctx.currentRole.attributes.negative_item_type_permissions ?? [];
  return (
    positive.some(
      (permission) =>
        matches(permission) && isUnrestrictedReadPermission(permission),
    ) && !negative.some(matches)
  );
}

/**
 * Checks if permission is granted based on positive/negative permission lists.
 * A permission is granted if there's a matching positive permission and no matching negative permission.
 */
function checkPermission(
  positivePermissions: Permission[],
  negativePermissions: Permission[],
  currentEnv: string,
  extraMatcher?: (perm: Permission) => boolean,
) {
  const matchesEnvironmentAndAction = (perm: Permission) =>
    perm.environment === currentEnv &&
    (perm.action === 'all' || perm.action === 'read');

  const matchesPerm = (perm: Permission) =>
    matchesEnvironmentAndAction(perm) && (!extraMatcher || extraMatcher(perm));

  const hasPositive = positivePermissions.some(matchesPerm);
  if (!hasPositive) return false;

  const hasNegative = negativePermissions.some(matchesPerm);
  return !hasNegative;
}

export function hasUploadReadPermission(ctx: PermissionContext) {
  const role = ctx.currentRole;
  const positivePermissions = role.attributes.positive_upload_permissions || [];
  const negativePermissions = role.attributes.negative_upload_permissions || [];

  return checkPermission(
    positivePermissions,
    negativePermissions,
    ctx.environment,
  );
}

export function canEditSchema(ctx: Pick<PermissionContext, 'currentRole'>) {
  return ctx.currentRole.meta.final_permissions.can_edit_schema;
}

/** Build once, rather than rescanning every permission for every model. */
function indexModelPermissions(permissions: Permission[], environment: string) {
  const modelIds = new Set<string>();
  let appliesToAll = false;
  for (const permission of permissions) {
    if (
      permission.environment !== environment ||
      (permission.action !== 'all' && permission.action !== 'read')
    ) {
      continue;
    }
    if (permission.item_type === null) {
      appliesToAll = true;
    } else if (permission.item_type !== undefined) {
      modelIds.add(permission.item_type);
    }
  }
  return { modelIds, appliesToAll };
}

export function filterReadableModels(
  ctx: PermissionContext,
  models: ModelInfo[],
) {
  const role = ctx.currentRole;
  const positive = indexModelPermissions(
    role.attributes.positive_item_type_permissions || [],
    ctx.environment,
  );
  const negative = indexModelPermissions(
    role.attributes.negative_item_type_permissions || [],
    ctx.environment,
  );
  if (negative.appliesToAll) return [];
  return models.filter(
    (model) =>
      (positive.appliesToAll || positive.modelIds.has(model.id)) &&
      !negative.modelIds.has(model.id),
  );
}

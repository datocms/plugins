import type { ModelInfo } from '@hooks/useMentions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';

export type PermissionContext = RenderItemFormSidebarCtx;

type Permission = {
  environment: string;
  action: string;
  item_type?: string | null;
};

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

export function canEditSchema(ctx: PermissionContext) {
  return ctx.currentRole.meta.final_permissions.can_edit_schema;
}

/** item_type=null applies to all models. */
function canReadModel(ctx: PermissionContext, modelId: string) {
  const role = ctx.currentRole;
  const positivePermissions =
    role.attributes.positive_item_type_permissions || [];
  const negativePermissions =
    role.attributes.negative_item_type_permissions || [];

  const matchesModel = (perm: Permission) =>
    perm.item_type === null || perm.item_type === modelId;

  return checkPermission(
    positivePermissions,
    negativePermissions,
    ctx.environment,
    matchesModel,
  );
}

export function filterReadableModels(
  ctx: PermissionContext,
  models: ModelInfo[],
) {
  return models.filter((model) => canReadModel(ctx, model.id));
}

import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import type { ModelInfo } from '@hooks/useMentions';

export type PermissionContext = RenderItemFormSidebarCtx | RenderPageCtx;

export function hasUploadReadPermission(ctx: PermissionContext): boolean {
  const role = ctx.currentRole;
  const currentEnv = ctx.environment;

  // Access the permissions from the role attributes
  const positiveUploadPermissions = role.attributes.positive_upload_permissions || [];
  const negativeUploadPermissions = role.attributes.negative_upload_permissions || [];

  const hasPositive = positiveUploadPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read')
  );

  if (!hasPositive) return false;

  const hasNegative = negativeUploadPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read')
  );

  return !hasNegative;
}

export function canEditSchema(ctx: PermissionContext): boolean {
  return ctx.currentRole.meta.final_permissions.can_edit_schema;
}

/** item_type=null applies to all models. */
export function canReadModel(
  ctx: PermissionContext,
  modelId: string
): boolean {
  const role = ctx.currentRole;
  const currentEnv = ctx.environment;

  const positiveItemPermissions = role.attributes.positive_item_type_permissions || [];
  const negativeItemPermissions = role.attributes.negative_item_type_permissions || [];

  const hasPositive = positiveItemPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read') &&
      (perm.item_type === null || perm.item_type === modelId)
  );

  if (!hasPositive) return false;

  const hasNegative = negativeItemPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read') &&
      (perm.item_type === null || perm.item_type === modelId)
  );

  return !hasNegative;
}

export function filterReadableModels(
  ctx: PermissionContext,
  models: ModelInfo[]
): ModelInfo[] {
  return models.filter((model) => canReadModel(ctx, model.id));
}

export function getMentionPermissions(
  ctx: PermissionContext,
  models: ModelInfo[]
): {
  canMentionAssets: boolean;
  canMentionModels: boolean;
  readableModels: ModelInfo[];
} {
  return {
    canMentionAssets: hasUploadReadPermission(ctx),
    canMentionModels: canEditSchema(ctx),
    readableModels: filterReadableModels(ctx, models),
  };
}

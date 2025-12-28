import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import type { ModelInfo } from '@hooks/useMentions';

/**
 * Union type for contexts that provide permission information.
 * Both sidebar and page contexts have the same permission-related properties.
 */
export type PermissionContext = RenderItemFormSidebarCtx | RenderPageCtx;

/**
 * Check if the current user has permission to read/access uploads in the media area.
 * This is determined by checking if they have any positive upload permissions
 * with 'read' or 'all' action in the current environment, and no overriding
 * negative permissions.
 */
export function hasUploadReadPermission(ctx: PermissionContext): boolean {
  const role = ctx.currentRole;
  const currentEnv = ctx.environment;

  // Access the permissions from the role attributes
  const positiveUploadPermissions = role.attributes.positive_upload_permissions || [];
  const negativeUploadPermissions = role.attributes.negative_upload_permissions || [];

  // Check if there's a positive permission for read/all in this environment
  const hasPositive = positiveUploadPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read')
  );

  if (!hasPositive) return false;

  // Check if there's a negative permission that overrides
  const hasNegative = negativeUploadPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read')
  );

  return !hasNegative;
}

/**
 * Check if the current user has permission to edit schema (access models).
 * This uses the final_permissions which accounts for role inheritance.
 */
export function canEditSchema(ctx: PermissionContext): boolean {
  return ctx.currentRole.meta.final_permissions.can_edit_schema;
}

/**
 * Check if the current user has read permission for a specific model.
 * Permissions with item_type=null apply to all models.
 */
export function canReadModel(
  ctx: PermissionContext,
  modelId: string
): boolean {
  const role = ctx.currentRole;
  const currentEnv = ctx.environment;

  const positiveItemPermissions = role.attributes.positive_item_type_permissions || [];
  const negativeItemPermissions = role.attributes.negative_item_type_permissions || [];

  // Check positive permissions
  // A permission with item_type: null applies to ALL models
  const hasPositive = positiveItemPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read') &&
      (perm.item_type === null || perm.item_type === modelId)
  );

  if (!hasPositive) return false;

  // Check negative permissions (they override positive)
  const hasNegative = negativeItemPermissions.some(
    (perm) =>
      perm.environment === currentEnv &&
      (perm.action === 'all' || perm.action === 'read') &&
      (perm.item_type === null || perm.item_type === modelId)
  );

  return !hasNegative;
}

/**
 * Filter a list of models to only include those the user has read permission for.
 */
export function filterReadableModels(
  ctx: PermissionContext,
  models: ModelInfo[]
): ModelInfo[] {
  return models.filter((model) => canReadModel(ctx, model.id));
}

/**
 * Get all mention permissions for the current user.
 * This is a convenience function that computes all permission checks at once.
 */
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

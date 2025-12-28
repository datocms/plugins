import { useMemo } from 'react';
import type { ModelInfo } from './useMentions';
import {
  hasUploadReadPermission,
  canEditSchema,
  filterReadableModels,
  type PermissionContext,
} from '@utils/permissions';

export type MentionPermissions = {
  canMentionAssets: boolean;
  canMentionModels: boolean;
  readableModels: ModelInfo[];
};

/**
 * Hook to compute and memoize mention permissions based on the current user's role.
 * Works with both sidebar context (RenderItemFormSidebarCtx) and page context (RenderPageCtx).
 *
 * Permissions are determined by:
 * - Asset mentions (^): User must have upload read permissions
 * - Model mentions ($): User must have can_edit_schema permission
 * - Record mentions (&): Only models where user has read permission are shown
 */
export function useMentionPermissions(
  ctx: PermissionContext,
  projectModels: ModelInfo[]
): MentionPermissions {
  // Memoize asset permission check
  const canMentionAssets = useMemo(
    () => hasUploadReadPermission(ctx),
    [ctx.currentRole, ctx.environment]
  );

  // Memoize model permission check
  const canMentionModels = useMemo(
    () => canEditSchema(ctx),
    [ctx.currentRole]
  );

  // Memoize filtered models list
  const readableModels = useMemo(
    () => filterReadableModels(ctx, projectModels),
    [ctx.currentRole, ctx.environment, projectModels]
  );

  return {
    canMentionAssets,
    canMentionModels,
    readableModels,
  };
}

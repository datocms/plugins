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

export function useMentionPermissions(
  ctx: PermissionContext,
  projectModels: ModelInfo[]
): MentionPermissions {
  const canMentionAssets = useMemo(
    () => hasUploadReadPermission(ctx),
    [ctx.currentRole, ctx.environment]
  );

  const canMentionModels = useMemo(
    () => canEditSchema(ctx),
    [ctx.currentRole]
  );

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

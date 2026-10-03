import {
  canEditSchema,
  filterReadableModels,
  hasUploadReadPermission,
  type PermissionContext,
} from '@utils/permissions';
import { useMemo } from 'react';
import type { ModelInfo } from './useMentions';

export type MentionPermissions = {
  canMentionAssets: boolean;
  canMentionModels: boolean;
  readableModels: ModelInfo[];
};

export function useMentionPermissions(
  ctx: PermissionContext,
  projectModels: ModelInfo[],
): MentionPermissions {
  const { currentRole, environment } = ctx;
  const canMentionAssets = useMemo(
    () => hasUploadReadPermission({ currentRole, environment }),
    [currentRole, environment],
  );

  const canMentionModels = useMemo(
    () => canEditSchema({ currentRole }),
    [currentRole],
  );

  const readableModels = useMemo(
    () => filterReadableModels({ currentRole, environment }, projectModels),
    [currentRole, environment, projectModels],
  );

  return {
    canMentionAssets,
    canMentionModels,
    readableModels,
  };
}

import { useState, useMemo } from 'react';
import { detectActiveTrigger } from '@utils/mentions';
import type { TriggerInfo } from '@utils/mentions';

/**
 * Context-specific permissions for mention triggers.
 *
 * ARCHITECTURAL NOTE: This type is DISTINCT from the `MentionPermissions` type
 * exported by `useMentionPermissions.ts`. The naming collision was intentional
 * to avoid confusion, hence the rename to `TriggerPermissions`:
 *
 * - `TriggerPermissions` (this file): Context-based flags for what mention types
 *   are AVAILABLE in the current UI context. For example, field mentions are
 *   unavailable in the global comments dashboard because there's no record context.
 *
 * - `MentionPermissions` (useMentionPermissions.ts): Role-based permissions for
 *   what the current user CAN do based on their DatoCMS role (e.g., can they
 *   read assets, can they edit schema).
 *
 * These are composed together at the component level - a mention type is only
 * shown if BOTH the context allows it AND the user has permission.
 */
type TriggerPermissions = {
  canMentionAssets: boolean;
  canMentionModels: boolean;
  canMentionFields: boolean;
};

type UseMentionTriggerOptions = {
  value: string;
  permissions: TriggerPermissions;
};

type UseMentionTriggerReturn = {
  cursorPosition: number;
  setCursorPosition: (pos: number) => void;
  triggerInfo: TriggerInfo | null;
  activeDropdown: 'user' | 'field' | 'model' | 'asset' | 'record' | null;
};

/**
 * Hook for detecting mention triggers in text input.
 * Handles cursor position tracking and determines which dropdown should be active.
 */
export function useMentionTrigger({
  value,
  permissions,
}: UseMentionTriggerOptions): UseMentionTriggerReturn {
  const [cursorPosition, setCursorPosition] = useState(0);

  // Detect if we're in a mention trigger
  const rawTriggerInfo = useMemo(
    () => detectActiveTrigger(value, cursorPosition),
    [value, cursorPosition]
  );

  // Filter trigger based on permissions
  const triggerInfo = useMemo(() => {
    if (!rawTriggerInfo) return null;

    // Block asset trigger if user doesn't have asset permissions
    if (rawTriggerInfo.type === 'asset' && !permissions.canMentionAssets) return null;
    // Block model trigger if user doesn't have schema permissions
    if (rawTriggerInfo.type === 'model' && !permissions.canMentionModels) return null;
    // Block field trigger if fields are not available (e.g., global comments page)
    if (rawTriggerInfo.type === 'field' && !permissions.canMentionFields) return null;

    return rawTriggerInfo;
  }, [rawTriggerInfo, permissions.canMentionAssets, permissions.canMentionModels, permissions.canMentionFields]);

  const activeDropdown = triggerInfo?.type ?? null;

  // Note: setCursorPosition from useState is already a stable function reference,
  // so we return it directly without wrapping in useCallback.
  return {
    cursorPosition,
    setCursorPosition,
    triggerInfo,
    activeDropdown,
  };
}

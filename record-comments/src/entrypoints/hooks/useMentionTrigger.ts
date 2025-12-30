import { useState, useMemo } from 'react';
import { detectActiveTrigger } from '@utils/mentions';
import type { TriggerInfo } from '@utils/mentions';

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

export function useMentionTrigger({
  value,
  permissions,
}: UseMentionTriggerOptions): UseMentionTriggerReturn {
  const [cursorPosition, setCursorPosition] = useState(0);

  const rawTriggerInfo = useMemo(
    () => detectActiveTrigger(value, cursorPosition),
    [value, cursorPosition]
  );

  const triggerInfo = useMemo(() => {
    if (!rawTriggerInfo) return null;
    if (rawTriggerInfo.type === 'asset' && !permissions.canMentionAssets) return null;
    if (rawTriggerInfo.type === 'model' && !permissions.canMentionModels) return null;
    if (rawTriggerInfo.type === 'field' && !permissions.canMentionFields) return null;
    return rawTriggerInfo;
  }, [rawTriggerInfo, permissions.canMentionAssets, permissions.canMentionModels, permissions.canMentionFields]);

  const activeDropdown = triggerInfo?.type ?? null;

  return {
    cursorPosition,
    setCursorPosition,
    triggerInfo,
    activeDropdown,
  };
}

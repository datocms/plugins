import type { PluginParameters } from '../types';

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readPluginParameters(raw: unknown): PluginParameters {
  const value = raw && typeof raw === 'object' ? raw : {};
  const record = value as Record<string, unknown>;

  return {
    allowedRoleIds: readStringArray(record.allowedRoleIds),
    allowedModelIds: readStringArray(record.allowedModelIds),
  };
}

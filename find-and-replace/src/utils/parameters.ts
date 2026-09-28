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

function readRestriction(value: unknown, ids: string[]): boolean {
  return typeof value === 'boolean' ? value : ids.length > 0;
}

export function readPluginParameters(raw: unknown): PluginParameters {
  const value = raw && typeof raw === 'object' ? raw : {};
  const record = value as Record<string, unknown>;
  const allowedRoleIds = readStringArray(record.allowedRoleIds);
  const allowedModelIds = readStringArray(record.allowedModelIds);

  return {
    restrictToRoles: readRestriction(record.restrictToRoles, allowedRoleIds),
    allowedRoleIds,
    restrictToModels: readRestriction(record.restrictToModels, allowedModelIds),
    allowedModelIds,
  };
}

import type { ContentModel } from '../types';
import { joinFacts, joinNames, localeName } from './format';

/**
 * What a project scan covers: every model or locale, or the listed IDs, and
 * whether records in draft status are left out.
 */
export type Scope = {
  modelIds: 'all' | string[];
  localeIds: 'all' | string[];
  excludeUnpublished?: boolean;
};

export const ALL_SCOPE: Scope = { modelIds: 'all', localeIds: 'all' };

type ModelSummary = Pick<ContentModel, 'id' | 'name'>;

function isIdList(value: unknown): value is 'all' | string[] {
  return (
    value === 'all' ||
    (Array.isArray(value) && value.every((id) => typeof id === 'string'))
  );
}

export function isScope(value: unknown): value is Scope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    isIdList(candidate.modelIds) &&
    isIdList(candidate.localeIds) &&
    (candidate.excludeUnpublished === undefined ||
      typeof candidate.excludeUnpublished === 'boolean')
  );
}

/** Drops unknown IDs and keeps the loader's model order and the site's locale order. */
export function resolveScope<T extends ModelSummary>(
  scope: Scope,
  models: readonly T[],
  siteLocales: readonly string[],
): { models: T[]; locales: string[] } {
  const { modelIds, localeIds } = scope;
  return {
    models:
      modelIds === 'all'
        ? [...models]
        : models.filter((model) => modelIds.includes(model.id)),
    locales:
      localeIds === 'all'
        ? [...siteLocales]
        : siteLocales.filter((locale) => localeIds.includes(locale)),
  };
}

function localeNames(locales: readonly string[], uiLocale: string): string[] {
  return locales.map((code) => localeName(code, uiLocale));
}

/**
 * "All models • All locales", "Page • English", "2 of 12 models • 3 locales",
 * "All models • Unpublished skipped".
 */
export function scopeLabel(
  scope: Scope,
  models: readonly ModelSummary[],
  siteLocales: readonly string[],
  uiLocale: string,
): string {
  const resolved = resolveScope(scope, models, siteLocales);
  const k = resolved.models.length;
  const m = models.length;
  let modelPart = `${k.toLocaleString(uiLocale)} of ${m.toLocaleString(uiLocale)} models`;
  if (k === m) modelPart = 'All models';
  else if (k === 1) modelPart = resolved.models[0].name;
  const statusPart = scope.excludeUnpublished ? ['Unpublished skipped'] : [];
  if (siteLocales.length <= 1) return joinFacts([modelPart, ...statusPart]);
  const n = resolved.locales.length;
  let localePart = `${n.toLocaleString(uiLocale)} locales`;
  if (n === siteLocales.length) localePart = 'All locales';
  else if (n <= 2)
    localePart = joinNames(localeNames(resolved.locales, uiLocale));
  return joinFacts([modelPart, localePart, ...statusPart]);
}

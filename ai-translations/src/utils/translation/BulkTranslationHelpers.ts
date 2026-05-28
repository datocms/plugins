/**
 * BulkTranslationHelpers.ts
 * -------------------------
 * Pure, side-effect-free helpers backing the AI Bulk Translations page.
 *
 * Keeping these in their own module lets the UI component stay thin and gives
 * us focused unit coverage for filtering, locale resolution, and validity
 * checks — the parts that historically caused the page to silently
 * translate too much or too little.
 */

import { modularContentVariations } from '../../entrypoints/Config/configConstants';
import { isFieldExcluded, isFieldTranslatable } from './SharedFieldUtils';

/**
 * Sentinel value used in the target-locale multi-select to represent the
 * "all other locales" choice. Picking it implies every locale except the
 * configured source locale.
 */
export const ALL_LOCALES_VALUE = '__all__';

/**
 * Minimal projection of the plugin-SDK Field shape (JSON:API style) consumed
 * by the bulk page. Mirrors what `ctx.loadItemTypeFields(modelId)` returns,
 * keeping the test runtime free of the full SDK type bundle.
 *
 * `position` is needed because `loadItemTypeFields` does not return fields
 * in schema-layout order in practice — we sort by `position` ourselves.
 */
export interface SdkField {
  id: string;
  attributes: {
    api_key: string;
    label: string;
    localized: boolean;
    position: number;
    appearance: { editor: string };
  };
}

/**
 * Lightweight, UI-ready descriptor for a translatable field. The bulk page
 * renders these as checkbox rows showing the friendly label plus the api_key
 * as muted secondary text.
 */
export interface TranslatableField {
  id: string;
  apiKey: string;
  label: string;
  editor: string;
}

/**
 * Subset of plugin params relevant to field filtering. Accepting just these
 * fields keeps the helper decoupled from `ctxParamsType` and trivial to
 * exercise in tests.
 */
export interface FieldFilterConfig {
  translationFields: string[];
  apiKeysToBeExcludedFromThisPlugin: string[];
}

/**
 * Returns a copy of `fields` sorted by `attributes.position`.
 *
 * `ctx.loadItemTypeFields` does not guarantee any particular order in the
 * array it returns, so the bulk page sorts by `position` itself to render
 * fields in the schema's actual layout order. Pure: returns a new array.
 *
 * @param fields - Raw fields (SDK JSON:API shape).
 */
export function sortFieldsByLayoutOrder(fields: SdkField[]): SdkField[] {
  return [...fields].sort(
    (a, b) => a.attributes.position - b.attributes.position,
  );
}

/**
 * Filters a model's fields down to those the plugin is allowed to translate.
 *
 * A field is considered translatable when it is localized, its editor type is
 * enabled in plugin settings (with the usual gallery/modular allowances), and
 * it is not explicitly excluded by ID or api_key.
 *
 * Input order is preserved — call `sortFieldsByLayoutOrder` first if you
 * want results in schema-layout order.
 *
 * @param fields - Raw fields (SDK JSON:API shape).
 * @param config - Plugin config slice with allowed editor types and exclusions.
 * @returns UI-ready translatable field descriptors, in input order.
 */
export function filterTranslatableFields(
  fields: SdkField[],
  config: FieldFilterConfig,
): TranslatableField[] {
  const result: TranslatableField[] = [];

  for (const field of fields) {
    const attrs = field.attributes;
    if (!attrs.localized) continue;

    const editor = attrs.appearance.editor;
    if (
      !isFieldTranslatable(
        editor,
        config.translationFields,
        modularContentVariations,
      )
    ) {
      continue;
    }

    if (
      isFieldExcluded(config.apiKeysToBeExcludedFromThisPlugin, [
        field.id,
        attrs.api_key,
      ])
    ) {
      continue;
    }

    result.push({
      id: field.id,
      apiKey: attrs.api_key,
      label: attrs.label,
      editor,
    });
  }

  return result;
}

/**
 * Resolves a user's target-locale selection into the concrete list to
 * translate to. Handles the `ALL_LOCALES_VALUE` sentinel by expanding it
 * against the environment's locale list, then drops the source locale and
 * deduplicates the result.
 *
 * @param selectedValues - Locale codes (or `ALL_LOCALES_VALUE`) chosen by the user.
 * @param allLocales - Every locale configured in the environment.
 * @param sourceLocale - The source locale to translate from.
 * @returns Ordered, deduped target locales with the source excluded.
 */
export function resolveTargetLocales(
  selectedValues: string[],
  allLocales: string[],
  sourceLocale: string,
): string[] {
  const includesAll = selectedValues.includes(ALL_LOCALES_VALUE);
  const candidates = includesAll
    ? allLocales
    : selectedValues.filter((value) => value !== ALL_LOCALES_VALUE);

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const locale of candidates) {
    if (locale === sourceLocale) continue;
    if (seen.has(locale)) continue;
    seen.add(locale);
    ordered.push(locale);
  }
  return ordered;
}

/**
 * Returns true when the user has picked at least one field to translate for
 * the given model. Used both to gate the Start button and to skip models
 * whose entire selection was deselected after the model was added.
 */
export function hasAnyFieldSelectedForModel(
  modelId: string,
  selectionByModel: Record<string, string[]>,
): boolean {
  const selection = selectionByModel[modelId];
  return Array.isArray(selection) && selection.length > 0;
}

/**
 * Checks whether a specific field on a specific model is included in the
 * user's per-model field allowlist.
 *
 * When `selectionByModel` is `undefined`, no filtering is in effect and the
 * function returns `true` so existing callers (single-record dropdown,
 * legacy bulk flows) keep their previous behavior.
 *
 * @param modelId - The DatoCMS item_type id.
 * @param fieldApiKey - The field's api_key on that model.
 * @param selectionByModel - Optional map of allowed api_keys, keyed by model id.
 */
export function isFieldIncludedInSelection(
  modelId: string,
  fieldApiKey: string,
  selectionByModel: Record<string, string[]> | undefined,
): boolean {
  if (!selectionByModel) return true;
  const allowed = selectionByModel[modelId];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(fieldApiKey);
}

/**
 * Combined readiness check for the Start button on the bulk page.
 *
 * Returns true only when every required input is set: a source locale, at
 * least one resolved target locale, at least one selected model, and at
 * least one selected field for *every* selected model.
 */
export function isReadyToTranslate(args: {
  sourceLocale: string | null;
  targetLocales: string[];
  selectedModelIds: string[];
  selectedFieldsByModel: Record<string, string[]>;
}): boolean {
  if (!args.sourceLocale) return false;
  if (args.targetLocales.length === 0) return false;
  if (args.selectedModelIds.length === 0) return false;
  return args.selectedModelIds.every((id) =>
    hasAnyFieldSelectedForModel(id, args.selectedFieldsByModel),
  );
}

/**
 * Computes the default field selection when a user newly adds a model:
 * every translatable field is selected so they can simply hit Start.
 *
 * @param fields - The translatable fields previously filtered for this model.
 * @returns The api_keys of all fields, in input order.
 */
export function defaultFieldSelection(fields: TranslatableField[]): string[] {
  return fields.map((f) => f.apiKey);
}

/**
 * Removes entries from a model-keyed map for models the user just deselected.
 *
 * Pure: returns a new object rather than mutating the input. Avoids unbounded
 * growth of cache and selection maps across model add/remove cycles. Works
 * for any value shape — selection arrays of api_keys, cached field-metadata
 * arrays, etc.
 *
 * @param byModel - Current model-keyed map.
 * @param keptModelIds - Models that should remain in the result.
 */
export function pruneFieldSelection<T>(
  byModel: Record<string, T>,
  keptModelIds: string[],
): Record<string, T> {
  const keptSet = new Set(keptModelIds);
  const next: Record<string, T> = {};
  for (const [modelId, value] of Object.entries(byModel)) {
    if (keptSet.has(modelId)) {
      next[modelId] = value;
    }
  }
  return next;
}

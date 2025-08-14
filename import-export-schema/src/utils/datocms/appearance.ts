import type { SchemaTypes } from '@datocms/cma-client';
import {
  defaultAppearanceForFieldType,
  isHardcodedEditor,
} from '@/utils/datocms/fieldTypeInfo';

/**
 * Return an appearance suitable for export. If the original field appearance is
 * missing, or if it references a non-exported plugin editor, fallback to the
 * default appearance for the field type. Also filters addons to those whose IDs
 * are included in the allowlist.
 */
export async function ensureExportableAppearance(
  field: SchemaTypes.Field,
  allowedPluginIds: string[],
): Promise<NonNullable<SchemaTypes.Field['attributes']['appearance']>> {
  const original = field.attributes.appearance;
  const hasAppearance = !!original;
  const editorId = original?.editor;
  const editorIsHardcoded = editorId ? await isHardcodedEditor(editorId) : true;

  const appearance =
    hasAppearance && (editorIsHardcoded || allowedPluginIds.includes(editorId!))
      ? { ...original }
      : await defaultAppearanceForFieldType(field.attributes.field_type);

  // Filter addons by allowlist
  appearance.addons = (original?.addons ?? []).filter((addon: { id: string }) =>
    allowedPluginIds.includes(addon.id),
  ) as NonNullable<typeof appearance.addons>;

  return appearance;
}

/**
 * Map a field appearance to the target project by translating any plugin-based
 * editor/addon IDs using the provided mapping. If the editor is hardcoded, keep
 * it as-is. Missing appearances will be replaced with a default for the field type.
 */
export async function mapAppearanceToProject(
  field: SchemaTypes.Field,
  pluginIdMappings: Map<string, string>,
): Promise<NonNullable<SchemaTypes.Field['attributes']['appearance']>> {
  const base = await defaultAppearanceForFieldType(field.attributes.field_type);
  const original = field.attributes.appearance;
  let next = { ...base } as NonNullable<
    SchemaTypes.Field['attributes']['appearance']
  >;

  if (original) {
    const editorId = original.editor;
    const isHardcoded = await isHardcodedEditor(editorId);
    if (isHardcoded) {
      next = {
        ...next,
        editor: editorId,
        parameters: original.parameters,
        field_extension: original.field_extension,
      };
    } else if (editorId && pluginIdMappings.has(editorId)) {
      next = {
        ...next,
        editor: pluginIdMappings.get(editorId)!,
      };
    }

    const sourceAddons = (original.addons ?? []) as Array<
      { id: string } & Record<string, unknown>
    >;
    next.addons = sourceAddons
      .filter((addon) => pluginIdMappings.has(addon.id))
      .map((addon) => ({
        ...addon,
        id: pluginIdMappings.get(addon.id)!,
        parameters:
          (addon as { parameters?: Record<string, unknown> }).parameters ?? {},
      }));
  }

  return next;
}

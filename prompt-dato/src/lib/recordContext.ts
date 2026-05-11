import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';

export type FieldInfo = {
  id: string;
  apiKey: string;
  label: string;
  fieldType: string;
  localized: boolean;
};

export type WriteBlocker = {
  path: string;
  fieldApiKey: string;
  fieldLabel: string;
  fieldType: string;
  locale: string | null;
  reason: 'dirty_value_truncated';
  instruction: string;
};

export type RecordContextSnapshot = {
  json: string;
  fields: FieldInfo[];
  writeBlockers: WriteBlocker[];
};

const MAX_VALUE_CHARS = 2000;

/**
 * Returns the list of fields that belong to the current record's model,
 * sorted by their `position` so the chat sees them in the same order the
 * editor does.
 */
export function listFieldsForCurrentItemType(
  ctx: RenderItemFormSidebarCtx,
): FieldInfo[] {
  const itemTypeId = ctx.itemType.id;
  const collected: Array<FieldInfo & { position: number }> = [];

  for (const field of Object.values(ctx.fields)) {
    if (!field) continue;
    if (field.relationships.item_type.data.id !== itemTypeId) continue;
    collected.push({
      id: field.id,
      apiKey: field.attributes.api_key,
      label: field.attributes.label,
      fieldType: field.attributes.field_type,
      localized: field.attributes.localized,
      position: field.attributes.position ?? 0,
    });
  }

  collected.sort((a, b) => a.position - b.position);
  return collected.map(({ position: _position, ...rest }) => rest);
}

/**
 * Builds a two-section JSON snapshot of the record currently being edited.
 *
 * The shape is:
 *   {
 *     "schema": { record identity + field catalog (no values) },
 *     "live":   { status, editor_locale, is_form_dirty, dirty_fields }
 *   }
 *
 * `schema` is byte-identical across turns within a chat session — that's the
 * cacheable prefix for the prompt cache. `ctx.isFormDirty` is the
 * authoritative clean/dirty signal from the editor. Only when it is true do we
 * ask the SDK for changed API-shaped fields via `ctx.formValuesToItem(...,
 * true)`. Complex editors such as Structured Text can emit API-shaped values
 * that look changed even when the editor says the form is clean, so the
 * conversion result must never create dirty fields on its own. Clean fields are
 * deliberately omitted — the chat runtime fetches them via MCP if it needs to
 * read or mutate them. Dirty values are capped so very large drafts cannot
 * flood the request. If a dirty value is capped, `live.write_blockers` names the
 * exact path that must not be remotely written until the user saves or reloads.
 */
export async function buildRecordContext(
  ctx: RenderItemFormSidebarCtx,
): Promise<RecordContextSnapshot> {
  const fields = listFieldsForCurrentItemType(ctx);
  const availableLocales = ctx.site.attributes.locales;

  const schema = {
    record: {
      id: ctx.item?.id ?? null,
      model: {
        api_key: ctx.itemType.attributes.api_key,
        name: ctx.itemType.attributes.name,
      },
      site_id: ctx.site.id,
      environment: ctx.environment,
      available_locales: availableLocales,
    },
    fields: fields.map((field) => ({
      api_key: field.apiKey,
      label: field.label,
      type: field.fieldType,
      localized: field.localized,
    })),
  };

  const isFormDirty = ctx.isFormDirty;

  const dirty: Record<string, unknown> = {};
  const writeBlockers: WriteBlocker[] = [];
  if (isFormDirty) {
    const changedItem = await ctx.formValuesToItem(ctx.formValues, true);
    const changedAttributes =
      (changedItem?.attributes as Record<string, unknown> | undefined) ?? {};

    for (const field of fields) {
      if (!Object.hasOwn(changedAttributes, field.apiKey)) continue;

      const changedValue = changedAttributes[field.apiKey];

      if (field.localized) {
        const changedMap = isPlainObject(changedValue) ? changedValue : {};
        const dirtyLocales: Record<string, unknown> = {};
        for (const locale of availableLocales) {
          if (Object.hasOwn(changedMap, locale)) {
            const cappedValue = capSnapshotValue(
              changedMap[locale] ?? null,
              `${field.apiKey}.${locale}`,
            );
            dirtyLocales[locale] = cappedValue;
            if (isTruncatedSnapshotValue(cappedValue)) {
              writeBlockers.push(
                buildWriteBlocker(field, `${field.apiKey}.${locale}`, locale),
              );
            }
          }
        }
        if (Object.keys(dirtyLocales).length > 0) {
          dirty[field.apiKey] = dirtyLocales;
        }
      } else {
        const cappedValue = capSnapshotValue(
          changedValue ?? null,
          field.apiKey,
        );
        dirty[field.apiKey] = cappedValue;
        if (isTruncatedSnapshotValue(cappedValue)) {
          writeBlockers.push(buildWriteBlocker(field, field.apiKey, null));
        }
      }
    }
  }

  const live = {
    status: ctx.itemStatus,
    editor_locale: ctx.locale,
    is_form_dirty: isFormDirty,
    dirty_fields: dirty,
    write_blockers: writeBlockers,
  };

  const payload = { schema, live };
  const json = JSON.stringify(payload, null, 2);

  return { json, fields, writeBlockers };
}

export function buildSuggestionRecordContext(
  ctx: RenderItemFormSidebarCtx,
): RecordContextSnapshot {
  const fields = listFieldsForCurrentItemType(ctx);
  const availableLocales = ctx.site.attributes.locales;

  const schema = {
    record: {
      id: ctx.item?.id ?? null,
      model: {
        api_key: ctx.itemType.attributes.api_key,
        name: ctx.itemType.attributes.name,
      },
      site_id: ctx.site.id,
      environment: ctx.environment,
      available_locales: availableLocales,
    },
    fields: fields.map((field) => ({
      api_key: field.apiKey,
      label: field.label,
      type: field.fieldType,
      localized: field.localized,
    })),
  };

  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const formValue = ctx.formValues[field.apiKey];
    if (field.localized) {
      const formMap = isPlainObject(formValue) ? formValue : {};
      const localeValues: Record<string, unknown> = {};
      for (const locale of availableLocales) {
        localeValues[locale] = capSnapshotValue(
          formMap[locale] ?? null,
          `${field.apiKey}.${locale}`,
        );
      }
      values[field.apiKey] = localeValues;
    } else {
      values[field.apiKey] = capSnapshotValue(formValue ?? null, field.apiKey);
    }
  }

  const live = {
    status: ctx.itemStatus,
    editor_locale: ctx.locale,
    values,
  };

  const payload = { schema, live };
  const json = JSON.stringify(payload, null, 2);

  return { json, fields, writeBlockers: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value),
  );
}

function capSnapshotValue(value: unknown, path: string): unknown {
  const serialized = serializeForLength(value);
  if (serialized.length <= MAX_VALUE_CHARS) return value;

  if (typeof value === 'string') {
    return {
      truncated: true,
      path,
      original_serialized_length: serialized.length,
      included_preview_length: MAX_VALUE_CHARS,
      preview: value.slice(0, MAX_VALUE_CHARS),
    };
  }

  return {
    truncated: true,
    path,
    original_serialized_length: serialized.length,
    included_preview_length: MAX_VALUE_CHARS,
    preview_json: serialized.slice(0, MAX_VALUE_CHARS),
  };
}

function isTruncatedSnapshotValue(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return value.truncated === true;
}

function buildWriteBlocker(
  field: FieldInfo,
  path: string,
  locale: string | null,
): WriteBlocker {
  return {
    path,
    fieldApiKey: field.apiKey,
    fieldLabel: field.label,
    fieldType: field.fieldType,
    locale,
    reason: 'dirty_value_truncated',
    instruction:
      'Do not write this path through MCP now. Ask the user to save or reload before mutating it, because the unsaved editor value is dirty and the snapshot is truncated.',
  };
}

function serializeForLength(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

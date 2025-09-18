import type { FieldAttributes } from '@datocms/cma-client/dist/types/generated/SchemaTypes';

/** Utilities for resolving editor metadata used in field appearance exports/imports. */

type FieldTypeInfo = Record<
  string,
  {
    default_editor: { id: string; parameters: Record<string, unknown> };
    other_editor_ids: string[];
  }
>;

let cached: Promise<FieldTypeInfo> | undefined;

// Built-in fallback for default editors when the remote metadata endpoint is
// unavailable (eg: offline, CORS/network issues). Parameters are kept empty
// unless the editor requires a specific shape.
const FALLBACK_DEFAULT_EDITORS: Record<
  string,
  { id: string; parameters: Record<string, unknown> }
> = {
  boolean: { id: 'boolean', parameters: {} },
  color: { id: 'color_picker', parameters: {} },
  date: { id: 'date_picker', parameters: {} },
  date_time: { id: 'date_time_picker', parameters: {} },
  file: { id: 'file', parameters: {} },
  float: { id: 'float', parameters: {} },
  gallery: { id: 'gallery', parameters: {} },
  integer: { id: 'integer', parameters: {} },
  json: { id: 'json', parameters: {} },
  lat_lon: { id: 'map', parameters: {} },
  link: { id: 'link_select', parameters: {} },
  links: { id: 'links_select', parameters: {} },
  rich_text: { id: 'rich_text', parameters: {} },
  seo: { id: 'seo', parameters: {} },
  single_block: { id: 'framed_single_block', parameters: {} },
  slug: { id: 'slug', parameters: {} },
  string: { id: 'single_line', parameters: {} },
  structured_text: { id: 'structured_text', parameters: {} },
  text: { id: 'textarea', parameters: {} },
  video: { id: 'video', parameters: {} },
};

function fallbackFieldTypeInfo(): FieldTypeInfo {
  const entries = Object.entries(FALLBACK_DEFAULT_EDITORS).map(
    ([fieldType, editor]) => [
      fieldType,
      {
        default_editor: editor,
        other_editor_ids: [] as string[],
      },
    ],
  );
  return Object.fromEntries(entries) as FieldTypeInfo;
}

async function fetchFieldTypeInfo() {
  if (cached) return cached;
  cached = (async () => {
    try {
      const response = await fetch('https://internal.datocms.com/field-types');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as FieldTypeInfo;
    } catch {
      // Fall back to a local static map to keep flows working safely
      return fallbackFieldTypeInfo();
    }
  })();
  return cached;
}

async function allEditors() {
  const info = await fetchFieldTypeInfo();

  return Object.values(info).flatMap((fieldInfo) => [
    fieldInfo.default_editor.id,
    ...fieldInfo.other_editor_ids,
  ]);
}

export async function isHardcodedEditor(editor: string) {
  try {
    return (await allEditors()).includes(editor);
  } catch {
    // Fallback to a conservative check against known built-ins
    return Object.values(FALLBACK_DEFAULT_EDITORS)
      .map((e) => e.id)
      .includes(editor);
  }
}

export async function defaultAppearanceForFieldType(
  fieldType: string,
): Promise<FieldAttributes['appearance']> {
  const info = (await fetchFieldTypeInfo())[fieldType];
  const defaultEditor = info?.default_editor ||
    FALLBACK_DEFAULT_EDITORS[fieldType] || {
      id: 'single_line',
      parameters: {},
    };

  return {
    editor: defaultEditor.id,
    parameters: defaultEditor.parameters,
    field_extension: undefined,
    addons: [],
  };
}

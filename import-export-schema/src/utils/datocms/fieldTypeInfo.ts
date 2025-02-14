import type { FieldAttributes } from '@datocms/cma-client/dist/types/generated/SchemaTypes';

type FieldTypeInfo = Record<
  string,
  {
    default_editor: { id: string; parameters: Record<string, unknown> };
    other_editor_ids: string[];
  }
>;

let cached: Promise<FieldTypeInfo> | undefined;

async function fetchFieldTypeInfo() {
  if (cached) {
    return cached;
  }

  cached = fetch('https://internal.datocms.com/field-types').then((response) =>
    response.json(),
  );

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
  return (await allEditors()).includes(editor);
}

export async function defaultAppearanceForFieldType(
  fieldType: string,
): Promise<FieldAttributes['appearance']> {
  const info = (await fetchFieldTypeInfo())[fieldType];

  return {
    editor: info.default_editor.id,
    parameters: info.default_editor.parameters,
    field_extension: undefined,
    addons: [],
  };
}

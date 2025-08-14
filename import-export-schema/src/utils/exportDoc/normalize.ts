import type { SchemaTypes } from '@datocms/cma-client';
import type { ExportDoc, ExportDocV2 } from '@/utils/types';

function asStringId<T extends { id: string | number }>(e: T): T {
  return { ...e, id: String(e.id) } as T;
}

/** Upcast older export docs to V2 and normalize all IDs to strings. */
export function normalizeExportDoc(doc: ExportDoc): ExportDocV2 {
  const entities = (
    doc.entities as Array<
      | SchemaTypes.ItemType
      | SchemaTypes.Field
      | SchemaTypes.Fieldset
      | SchemaTypes.Plugin
    >
  ).map((e) => asStringId(e));

  if (doc.version === '2') {
    return { ...doc, entities, rootItemTypeId: String(doc.rootItemTypeId) };
  }

  // For V1 we cannot know the root with certainty; pick the first model with no inbound links
  const itemTypes = entities.filter(
    (e) => e.type === 'item_type',
  ) as SchemaTypes.ItemType[];
  const fields = entities.filter(
    (e) => e.type === 'field',
  ) as SchemaTypes.Field[];

  const linkTargets = new Set<string>();
  for (const f of fields) {
    const itemTypeId = String(f.relationships.item_type.data.id);
    // Best-effort: add validators containing item type IDs
    const validators = (f.attributes.validators ?? {}) as Record<
      string,
      unknown
    >;
    const maybeArrays = Object.values(validators).filter((v) =>
      Array.isArray(v),
    ) as string[][];
    for (const arr of maybeArrays) {
      for (const id of arr) {
        linkTargets.add(String(id));
      }
    }
    linkTargets.add(itemTypeId);
  }

  const root =
    itemTypes.find((it) => !linkTargets.has(String(it.id))) || itemTypes[0];
  return {
    version: '2',
    rootItemTypeId: String(root?.id ?? ''),
    entities,
  };
}

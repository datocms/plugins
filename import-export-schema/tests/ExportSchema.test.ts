import type { Client, SchemaTypes } from '@datocms/cma-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { buildImportDoc } from '@/entrypoints/ImportPage/buildImportDoc';
import buildConflicts, {
  type Conflicts,
} from '@/entrypoints/ImportPage/ConflictsManager/buildConflicts';
import importSchema from '@/entrypoints/ImportPage/importSchema';
import { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';

afterEach(() => vi.useRealTimers());

function model(
  id: string,
  fields: SchemaTypes.Field[] = [],
): SchemaTypes.ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name: id, api_key: id, modular_block: false },
    relationships: {
      fields: { data: fields.map((f) => ({ type: 'field', id: f.id })) },
      fieldsets: { data: [] },
    },
  } as unknown as SchemaTypes.ItemType;
}

function field(
  parent: string,
  id: string,
  targets: string[] = [],
): SchemaTypes.Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: id,
      label: id,
      field_type: 'links',
      validators: { items_item_type: { item_types: targets } },
    },
    relationships: {
      item_type: { data: { id: parent, type: 'item_type' } },
      fieldset: { data: null },
    },
  } as unknown as SchemaTypes.Field;
}

const emptyConflicts: Conflicts = {
  itemTypes: {},
  plugins: {},
  ids: { itemTypes: {}, plugins: {}, fields: {}, fieldsets: {} },
  legacyIds: { itemTypes: {}, plugins: {}, fields: {}, fieldsets: {} },
};

function bundle(
  entities: ExportDoc['entities'],
  rootItemTypeId = 'a',
): ExportDoc {
  return { version: '2', rootItemTypeId, entities };
}

describe('export file integrity and import coverage', () => {
  it('includes cycles pointing into an already reachable component and standalone plugins', async () => {
    const a = field('a', 'af', ['b']);
    const c = field('c', 'cf', ['d', 'b']);
    const d = field('d', 'df', ['c']);
    const plugin = {
      id: 'plugin',
      type: 'plugin',
      attributes: { name: 'Standalone' },
    } as unknown as SchemaTypes.Plugin;
    const schema = new ExportSchema(
      bundle([
        model('a', [a]),
        model('b'),
        model('c', [c]),
        model('d', [d]),
        a,
        c,
        d,
        plugin,
      ]),
    );
    expect(schema.rootItemTypes.map((m) => m.id)).toEqual(['a', 'c']);
    const doc = await buildImportDoc(schema, emptyConflicts, {
      itemTypes: {},
      plugins: {},
      idCollisions: {},
    });
    expect(
      new Set(doc.itemTypes.entitiesToCreate.map((m) => m.entity.id)),
    ).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(doc.plugins.entitiesToCreate).toEqual([plugin]);
  });

  it('keeps bundled dependencies when their parent is reused', async () => {
    const a = field('a', 'af', ['b']);
    const schema = new ExportSchema(bundle([model('a', [a]), model('b'), a]));
    const doc = await buildImportDoc(
      schema,
      { ...emptyConflicts, itemTypes: { a: model('target') } },
      {
        itemTypes: { a: { strategy: 'reuseExisting' } },
        plugins: {},
        idCollisions: {},
      },
    );
    expect(doc.itemTypes.idsToReuse).toEqual({ a: 'target' });
    expect(doc.itemTypes.entitiesToCreate.map((m) => m.entity.id)).toEqual([
      'b',
    ]);
  });

  it('rejects duplicate IDs, missing parents, missing dependencies and missing child relationships', () => {
    expect(() => new ExportSchema(bundle([model('a'), model('a')]))).toThrow(
      'duplicate',
    );
    expect(
      () => new ExportSchema(bundle([model('a'), field('missing', 'f')])),
    ).toThrow('missing parent');
    const dangling = field('a', 'f', ['missing']);
    expect(
      () => new ExportSchema(bundle([model('a', [dangling]), dangling])),
    ).toThrow('missing model/block');
    expect(
      () => new ExportSchema(bundle([model('a'), field('a', 'f')])),
    ).toThrow('absent from parent');
    const absent = field('a', 'f');
    expect(() => new ExportSchema(bundle([model('a', [absent])]))).toThrow(
      'inconsistent fields',
    );
  });

  it('rejects fieldsets belonging to a different parent', () => {
    const f = field('a', 'f');
    f.relationships.fieldset.data = { type: 'fieldset', id: 'fs' };
    const fs = {
      id: 'fs',
      type: 'fieldset',
      attributes: {},
      relationships: { item_type: { data: { type: 'item_type', id: 'b' } } },
    } as unknown as SchemaTypes.Fieldset;
    const b = model('b');
    b.relationships.fieldsets = { data: [{ type: 'fieldset', id: 'fs' }] };
    expect(() => new ExportSchema(bundle([model('a', [f]), b, f, fs]))).toThrow(
      'another model/block',
    );
  });

  it('retains version 1 single-root compatibility and accepts legacy numeric IDs', () => {
    expect(
      new ExportSchema({ version: '1', entities: [model('a')] }).rootItemType
        .id,
    ).toBe('a');
    const numeric = { ...model('1'), id: 1 } as unknown as SchemaTypes.ItemType;
    expect(new ExportSchema(bundle([numeric], '1')).rootItemType.id).toBe('1');
    expect(
      () =>
        new ExportSchema({
          version: '3',
          entities: [],
        } as unknown as ExportDoc),
    ).toThrow('version 1 or 2');
  });

  it('normalizes numeric relationship, validator and plugin IDs throughout legacy exports', async () => {
    const f = field('1', '11', ['2']);
    f.attributes.appearance = {
      editor: '3',
      parameters: {},
      addons: [{ id: '3', parameters: {} }],
    };
    const doc = bundle(
      [
        model('1', [f]),
        model('2'),
        f,
        {
          id: '3',
          type: 'plugin',
          attributes: { name: 'P' },
        } as unknown as SchemaTypes.Plugin,
      ],
      '1',
    );
    const numeric = JSON.parse(
      JSON.stringify(doc),
      (key: string, value: unknown) => {
        if (key === 'item_types' && Array.isArray(value))
          return value.map(Number);
        if (
          ['id', 'editor', 'rootItemTypeId'].includes(key) &&
          typeof value === 'string'
        )
          return Number(value);
        return value;
      },
    ) as ExportDoc;
    const schema = new ExportSchema(numeric);
    const importedField = schema.fields[0];
    expect(importedField.id).toBe('11');
    expect(importedField.relationships.item_type.data.id).toBe('1');
    expect(importedField.attributes.validators).toEqual({
      items_item_type: { item_types: ['2'] },
    });
    expect(importedField.attributes.appearance).toMatchObject({
      editor: '3',
      addons: [{ id: '3' }],
    });
    const importDoc = await buildImportDoc(schema, emptyConflicts, {
      itemTypes: {},
      plugins: {},
      idCollisions: {},
    });
    expect(importDoc.itemTypes.entitiesToCreate.length).toBe(2);
    expect(importDoc.plugins.entitiesToCreate[0].id).toBe('3');
  });

  it('normalizes legacy numeric slug title references before import preflight', async () => {
    const title = field('1', '11');
    title.attributes.field_type = 'string';
    title.attributes.validators = {};
    const slug = field('1', '12');
    slug.attributes.field_type = 'slug';
    slug.attributes.validators = {
      slug_title_field: { title_field_id: '11' },
    };
    const numeric = JSON.parse(
      JSON.stringify({
        version: '1',
        entities: [model('1', [title, slug]), title, slug],
      }),
      (key: string, value: unknown) =>
        ['id', 'title_field_id'].includes(key) && typeof value === 'string'
          ? Number(value)
          : value,
    ) as ExportDoc;
    const schema = new ExportSchema(numeric);
    const importDoc = await buildImportDoc(schema, emptyConflicts, {
      itemTypes: {},
      plugins: {},
      idCollisions: {},
    });
    const reachedClient = new Error('Reached CMA initialization');
    const client = {
      get config() {
        throw reachedClient;
      },
    } as unknown as Client;

    // The valid legacy reference must pass preflight before CMA is initialized.
    await expect(importSchema(importDoc, client, () => {})).rejects.toBe(
      reachedClient,
    );
    expect(schema.fieldsById.get('12')?.attributes.validators).toEqual({
      slug_title_field: { title_field_id: '11' },
    });
  });

  it('rejects missing or unsupported field types before importing any entities', () => {
    const f = field('a', 'f');
    const doc = bundle([model('a', [f]), f]);
    const invalid = JSON.parse(JSON.stringify(doc)) as ExportDoc;
    const invalidField = invalid.entities[1] as SchemaTypes.Field;
    invalidField.attributes.field_type =
      'unsupported' as SchemaTypes.Field['attributes']['field_type'];
    expect(() => new ExportSchema(invalid)).toThrow('unknown field_type');
    const missingType = JSON.parse(
      JSON.stringify(doc).replace('"field_type":"links",', ''),
    ) as ExportDoc;
    expect(() => new ExportSchema(missingType)).toThrow('unknown field_type');
  });
});

describe('synthetic schema scale', () => {
  it('indexes and covers 1,000 cyclic models/blocks with 30,000 fields', async () => {
    const entities: ExportDoc['entities'] = [];
    for (let i = 0; i < 1000; i++) {
      const fields = Array.from({ length: 30 }, (_, j) =>
        field(`m${i}`, `f${i}_${j}`, [`m${(i + 1) % 1000}`]),
      );
      const itemType = model(`m${i}`, fields);
      itemType.attributes.modular_block = i % 2 === 0;
      entities.push(itemType, ...fields);
    }
    const schema = new ExportSchema(bundle(entities, 'm0'));
    const doc = await buildImportDoc(schema, emptyConflicts, {
      itemTypes: {},
      plugins: {},
      idCollisions: {},
    });
    expect(schema.fields.length).toBe(30000);
    expect(schema.rootItemTypes.length).toBe(1);
    expect(doc.itemTypes.entitiesToCreate.length).toBe(1000);
    expect(
      doc.itemTypes.entitiesToCreate.reduce((n, m) => n + m.fields.length, 0),
    ).toBe(30000);
  });

  it('scans all target models with bounded workers and accurate collision progress', async () => {
    vi.useFakeTimers();
    const models = Array.from({ length: 500 }, (_, i) => model(`m${i}`));
    const fields = models.map((m) => field(m.id, `f${m.id}`));
    let active = 0;
    let maxActive = 0;
    const read = async (
      value: SchemaTypes.Field[] | SchemaTypes.Fieldset[],
    ) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return { data: value };
    };
    const rawFields = vi.fn((id: string) =>
      read(fields.filter((f) => f.relationships.item_type.data.id === id)),
    );
    const schema = new ProjectSchema({
      itemTypes: { rawList: async () => ({ data: models }) },
      plugins: { rawList: async () => ({ data: [] }) },
      fields: { rawList: rawFields },
      fieldsets: { rawList: () => read([]) },
    } as unknown as Client);
    const sourceModel = model('m499', [fields[499]]);
    const source = new ExportSchema(bundle([sourceModel, fields[499]], 'm499'));
    const updates: Array<{ done: number; total: number }> = [];
    const task = buildConflicts(source, schema, (p) => updates.push(p));
    await vi.runAllTimersAsync();
    const conflicts = await task;
    expect(rawFields).toHaveBeenCalledTimes(500);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(conflicts.ids.fields.fm499.projectParentItemType.id).toBe('m499');
    expect(updates.at(-1)).toMatchObject({ done: 503, total: 503 });
    expect(
      updates.every((p, i) => i === 0 || p.done >= updates[i - 1].done),
    ).toBe(true);
  });

  it('stops conflict scanning when inputs change', async () => {
    const schema = new ProjectSchema({
      itemTypes: { rawList: vi.fn() },
    } as unknown as Client);
    const source = new ExportSchema(bundle([model('a')]));
    await expect(
      buildConflicts(source, schema, undefined, { shouldCancel: () => true }),
    ).rejects.toThrow('cancelled');
    expect(schema.client.itemTypes.rawList).not.toHaveBeenCalled();
  });
});

import type { SchemaTypes } from '@datocms/cma-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import buildExportDoc, {
  buildExportBlob,
} from '../src/entrypoints/ExportPage/buildExportDoc';
import { downloadBlob } from '../src/utils/downloadJson';
import type { ProjectSchema } from '../src/utils/ProjectSchema';

vi.mock('@/utils/datocms/fieldTypeInfo', () => ({
  isHardcodedEditor: async (editor: string) =>
    ['single_line', 'links_select'].includes(editor),
  defaultAppearanceForFieldType: async () => ({
    editor: 'single_line',
    parameters: {},
    addons: [],
  }),
}));

function itemType(id: string, block = false): SchemaTypes.ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { api_key: id, name: id, modular_block: block },
    relationships: {
      fields: { data: [{ type: 'field', id: `${id}-field` }] },
      fieldsets: { data: [{ type: 'fieldset', id: `${id}-fieldset` }] },
    },
  } as unknown as SchemaTypes.ItemType;
}

function field(
  id: string,
  linkedIds = ['model', 'block', 'outside'],
): SchemaTypes.Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: id,
      label: id,
      field_type: 'links',
      localized: true,
      default_value: { en: null, pt: null, fr: null },
      validators: {
        items_item_type: { item_types: linkedIds },
        size: { min: 0 },
      },
      appearance: {
        editor: 'plugin-editor',
        parameters: { localizedHint: { en: 'Welcome', pt: 'Bem-vindo' } },
        addons: [
          { id: 'plugin-addon', parameters: { theme: 'dark' } },
          { id: 'outside-plugin', parameters: {} },
        ],
      },
    },
    relationships: {
      item_type: { data: { type: 'item_type', id: id.split('-field')[0] } },
      fieldset: {
        data: { type: 'fieldset', id: `${id.split('-field')[0]}-fieldset` },
      },
    },
  } as unknown as SchemaTypes.Field;
}

function fieldset(modelId: string): SchemaTypes.Fieldset {
  return {
    id: `${modelId}-fieldset`,
    type: 'fieldset',
    relationships: {
      item_type: { data: { type: 'item_type', id: modelId } },
    },
    attributes: { title: 'Field group', position: 1 },
  } as SchemaTypes.Fieldset;
}

function makeSchema(modelCount = 2, fieldCount = 1, pluginCount = 2) {
  const ids =
    modelCount === 2
      ? ['model', 'block']
      : Array.from({ length: modelCount }, (_, index) => `model-${index}`);
  const itemTypes = ids.map((id, index) => {
    const model = itemType(id, index % 2 === 1);
    model.relationships.fields.data = Array.from(
      { length: fieldCount },
      (_, fieldIndex) => ({ type: 'field', id: `${id}-field-${fieldIndex}` }),
    );
    return model;
  });
  const pluginIds = [
    'plugin-editor',
    'plugin-addon',
    ...Array.from(
      { length: Math.max(0, pluginCount - 2) },
      (_, index) => `plugin-${index}`,
    ),
  ];
  const plugins = pluginIds.map((id) => ({
    id,
    type: 'plugin',
    attributes: {
      name: id,
      parameters: { localized: { en: 'Test', pt: 'Teste' } },
    },
  })) as unknown as SchemaTypes.Plugin[];
  const itemTypesById = new Map(itemTypes.map((model) => [model.id, model]));
  const pluginsById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const getItemTypeById = vi.fn(async (id: string) => {
    const found = itemTypesById.get(id);
    if (!found) throw new Error('Not found');
    return found;
  });
  const getPluginById = vi.fn(async (id: string) => {
    const found = pluginsById.get(id);
    if (!found) throw new Error('Not found');
    return found;
  });
  const getItemTypeFieldsAndFieldsets = vi.fn(
    async (
      model: SchemaTypes.ItemType,
    ): Promise<[SchemaTypes.Field[], SchemaTypes.Fieldset[]]> => [
      Array.from({ length: fieldCount }, (_, index) =>
        field(`${model.id}-field-${index}`, [
          ...ids.slice(0, 12),
          model.id,
          'outside',
        ]),
      ),
      [fieldset(model.id)],
    ],
  );
  const schema = {
    maxConcurrentRequests: 2,
    getItemTypeById,
    getPluginById,
    getItemTypeFieldsAndFieldsets,
  } as unknown as ProjectSchema;
  return {
    schema,
    ids,
    itemTypes,
    plugins,
    getItemTypeById,
    getItemTypeFieldsAndFieldsets,
  };
}

async function finishTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true, value }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('schema export integrity', () => {
  it('keeps cyclic dependencies, localized defaults, block fieldsets and selected plugin appearances', async () => {
    const { schema, ids, getItemTypeFieldsAndFieldsets } = makeSchema();
    const original = field('model-field-0');
    const originalSnapshot = structuredClone(original);
    getItemTypeFieldsAndFieldsets.mockResolvedValueOnce([
      [original],
      [fieldset('model')],
    ]);
    const updates: number[] = [];
    const doc = await finishTimers(
      buildExportDoc(schema, ids[0], ids, ['plugin-editor', 'plugin-addon'], {
        onProgress: (update) => updates.push(update.done),
      }),
    );
    const exported = doc.entities.find(
      (entity) => entity.id === 'model-field-0',
    ) as SchemaTypes.Field;
    expect(exported.attributes.validators).toEqual({
      items_item_type: { item_types: ['model', 'block'] },
      size: { min: 0 },
    });
    expect(exported.attributes.default_value).toEqual(
      originalSnapshot.attributes.default_value,
    );
    expect(exported.attributes.appearance?.editor).toBe('plugin-editor');
    expect(
      exported.attributes.appearance?.addons.map((addon) => addon.id),
    ).toEqual(['plugin-addon']);
    expect(doc.entities.some((entity) => entity.id === 'block-fieldset')).toBe(
      true,
    );
    expect(original).toEqual(originalSnapshot);
    expect(updates).toEqual([1, 2, 3, 4]);
  });

  it('deduplicates selections and does not invent absent reference validators', async () => {
    const { schema, ids, getItemTypeFieldsAndFieldsets } = makeSchema();
    const original = field('model-field-0');
    original.attributes.field_type = 'structured_text';
    original.attributes.validators = { required: {} };
    getItemTypeFieldsAndFieldsets.mockResolvedValueOnce([
      [original],
      [fieldset('model')],
    ]);
    const updates: Array<{ done: number; total: number }> = [];
    const doc = await finishTimers(
      buildExportDoc(
        schema,
        'model',
        [...ids, ...ids],
        ['plugin-addon', 'plugin-addon'],
        {
          onProgress: (update) => updates.push(update),
        },
      ),
    );
    expect(
      doc.entities.filter((entity) => entity.type === 'item_type'),
    ).toHaveLength(2);
    expect(
      doc.entities.filter((entity) => entity.type === 'plugin'),
    ).toHaveLength(1);
    expect(
      (
        doc.entities.find(
          (entity) => entity.id === original.id,
        ) as SchemaTypes.Field
      ).attributes.validators,
    ).toEqual({ required: {} });
    expect(updates.map((update) => [update.done, update.total])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('produces the same v2 document through the download path', async () => {
    const { schema, ids } = makeSchema();
    const doc = await finishTimers(
      buildExportDoc(schema, ids[0], ids, ['plugin-addon']),
    );
    const blob = await finishTimers(
      buildExportBlob(schema, ids[0], ids, ['plugin-addon']),
    );
    expect(JSON.parse(await blob.text())).toEqual(doc);
  });

  it('drains started reads, retains the initial error and starts no later batch after failure', async () => {
    const { schema, ids, getItemTypeById, getItemTypeFieldsAndFieldsets } =
      makeSchema(6);
    let finishSlowRead:
      | ((data: [SchemaTypes.Field[], SchemaTypes.Fieldset[]]) => void)
      | undefined;
    getItemTypeFieldsAndFieldsets
      .mockRejectedValueOnce(new Error('Original field failure'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSlowRead = resolve;
          }),
      );
    let settled = false;
    const updates: number[] = [];
    const pending = buildExportDoc(schema, ids[0], ids, [], {
      onProgress: (update) => updates.push(update.done),
    }).finally(() => {
      settled = true;
    });
    const failure = expect(pending).rejects.toThrow('Original field failure');
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(getItemTypeFieldsAndFieldsets).toHaveBeenCalledTimes(2);
    finishSlowRead?.([[], []]);
    await finishTimers(failure);
    expect(getItemTypeById).toHaveBeenCalledTimes(2);
    expect(updates).toEqual([]);
  });

  it('drains cancellation and starts no additional work or progress updates', async () => {
    const { schema, ids, getItemTypeById, getItemTypeFieldsAndFieldsets } =
      makeSchema(8);
    const completions: Array<
      (data: [SchemaTypes.Field[], SchemaTypes.Fieldset[]]) => void
    > = [];
    getItemTypeFieldsAndFieldsets.mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(resolve);
        }),
    );
    let cancelled = false;
    const updates: number[] = [];
    const pending = buildExportBlob(schema, ids[0], ids, [], {
      shouldCancel: () => cancelled,
      onProgress: (update) => updates.push(update.done),
    });
    const failure = expect(pending).rejects.toThrow('Export cancelled');
    await vi.advanceTimersByTimeAsync(0);
    cancelled = true;
    for (const complete of completions) complete([[], []]);
    await finishTimers(failure);
    expect(getItemTypeById).toHaveBeenCalledTimes(2);
    expect(updates).toEqual([]);
  });

  it('rejects an export with no selected root before fetching entities', async () => {
    const { schema, getItemTypeById } = makeSchema();
    await expect(
      buildExportDoc(schema, 'outside', ['model'], []),
    ).rejects.toThrow('root model');
    expect(getItemTypeById).not.toHaveBeenCalled();
  });
});

describe('blob download cleanup', () => {
  it('waits for the browser to consume a large download before releasing its URL', async () => {
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:synthetic-download');
    vi.stubGlobal('URL', { revokeObjectURL, createObjectURL });
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => link,
      body: { appendChild },
    });
    downloadBlob(new Blob(['{}']), { fileName: 'schema.json' });
    expect(link.download).toBe('schema.json');
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-download');
  });

  it('releases the URL immediately when the download fails', () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      revokeObjectURL,
      createObjectURL: () => 'blob:failed-download',
    });
    const link = {
      href: '',
      download: '',
      click: () => {
        throw new Error('Blocked download');
      },
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: () => link,
      body: { appendChild: vi.fn() },
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    expect(() => downloadBlob(new Blob(['{}']))).toThrow('Blocked download');
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-download');
    consoleError.mockRestore();
  });
});

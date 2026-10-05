import type { Client, SchemaTypes } from '@datocms/cma-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../src/utils/ProjectSchema';

function itemType(id: string, block = false): SchemaTypes.ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { api_key: id, name: id, modular_block: block },
    relationships: { fields: { data: [] }, fieldsets: { data: [] } },
  } as unknown as SchemaTypes.ItemType;
}

function field(id: string): SchemaTypes.Field {
  return { id, type: 'field' } as SchemaTypes.Field;
}

function fieldset(id: string): SchemaTypes.Fieldset {
  return { id, type: 'fieldset' } as SchemaTypes.Fieldset;
}

function makeClient() {
  const resources = {
    itemTypes: { rawList: vi.fn(async () => ({ data: [itemType('model')] })) },
    plugins: {
      rawList: vi.fn(async () => ({ data: [] as SchemaTypes.Plugin[] })),
    },
    fields: {
      rawList: vi.fn(async (_id: string) => ({ data: [field('field')] })),
    },
    fieldsets: {
      rawList: vi.fn(async (_id: string) => ({ data: [fieldset('fieldset')] })),
    },
  };
  return {
    resources,
    schema: new ProjectSchema(resources as unknown as Client),
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { localStorage: { getItem: () => null } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProjectSchema request and cache lifecycle', () => {
  it.each(['itemTypes', 'plugins'] as const)(
    'deduplicates %s reads and discards a rejected cached promise',
    async (resource) => {
      const { schema, resources } = makeClient();
      resources[resource].rawList.mockRejectedValueOnce(new Error('temporary'));
      const load = (): Promise<
        SchemaTypes.ItemType[] | SchemaTypes.Plugin[]
      > =>
        resource === 'itemTypes'
          ? schema.getAllItemTypes()
          : schema.getAllPlugins();
      const attempts = Promise.allSettled([load(), load()]);
      const failures = await finishTimers(attempts);
      expect(failures.every((result) => result.status === 'rejected')).toBe(
        true,
      );
      expect(resources[resource].rawList).toHaveBeenCalledTimes(1);
      await finishTimers(load());
      await finishTimers(load());
      expect(resources[resource].rawList).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['fields', 'fieldsets'] as const)(
    'deduplicates %s reads and retries after an eventual failure',
    async (resource) => {
      const { schema, resources } = makeClient();
      resources[resource].rawList.mockRejectedValueOnce(new Error('temporary'));
      const model = itemType('block', true);
      const failures = await finishTimers(
        Promise.allSettled([
          schema.getItemTypeFieldsAndFieldsets(model),
          schema.getItemTypeFieldsAndFieldsets(model),
        ]),
      );
      expect(failures.every((result) => result.status === 'rejected')).toBe(
        true,
      );
      const [fields, fieldsets] = await finishTimers(
        schema.getItemTypeFieldsAndFieldsets(model),
      );
      expect(fields.map((value) => value.id)).toEqual(['field']);
      expect(fieldsets.map((value) => value.id)).toEqual(['fieldset']);
      await finishTimers(schema.getItemTypeFieldsAndFieldsets(model));
      expect(resources[resource].rawList).toHaveBeenCalledTimes(2);
      expect(
        resources[resource === 'fields' ? 'fieldsets' : 'fields'].rawList,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it('never exceeds the shared concurrency cap across metadata endpoints', async () => {
    const { schema, resources } = makeClient();
    const starts: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const read = async () => {
      starts.push(Date.now());
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      active -= 1;
    };
    resources.itemTypes.rawList.mockImplementation(async () => {
      await read();
      return { data: [itemType('model')] };
    });
    resources.plugins.rawList.mockImplementation(async () => {
      await read();
      return { data: [] };
    });
    resources.fields.rawList.mockImplementation(async () => {
      await read();
      return { data: [] };
    });
    resources.fieldsets.rawList.mockImplementation(async () => {
      await read();
      return { data: [] };
    });
    await finishTimers(
      Promise.all([
        schema.getAllItemTypes(),
        schema.getAllPlugins(),
        ...Array.from({ length: 8 }, (_, index) =>
          schema.getItemTypeFieldsAndFieldsets(
            itemType(`model-${index}`, index % 2 === 0),
          ),
        ),
      ]),
    );
    expect(starts).toHaveLength(18);
    expect(maximumActive).toBe(2);
  });

  it('cancels between fieldset and field reads while retaining valid shared metadata', async () => {
    const { schema, resources } = makeClient();
    let cancelled = false;
    resources.fieldsets.rawList.mockImplementation(async () => {
      cancelled = true;
      return { data: [fieldset('fieldset')] };
    });
    await expect(
      finishTimers(
        schema.getItemTypeFieldsAndFieldsets(itemType('model'), {
          shouldCancel: () => cancelled,
        }),
      ),
    ).rejects.toThrow('Export cancelled');
    expect(resources.fields.rawList).not.toHaveBeenCalled();
    await finishTimers(schema.getItemTypeFieldsAndFieldsets(itemType('model')));
    expect(resources.fieldsets.rawList).toHaveBeenCalledTimes(1);
    expect(resources.fields.rawList).toHaveBeenCalledTimes(1);
  });

  it('does not let an outdated item-type request repopulate an invalidated schema', async () => {
    const { schema, resources } = makeClient();
    let resolveOld:
      | ((data: { data: SchemaTypes.ItemType[] }) => void)
      | undefined;
    resources.itemTypes.rawList
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: [itemType('new-model')] });
    const old = schema.getAllItemTypes();
    await vi.advanceTimersByTimeAsync(0);
    schema.invalidate();
    const current = schema.getAllItemTypes();
    await finishTimers(current);
    resolveOld?.({ data: [itemType('old-model')] });
    expect(await finishTimers(old)).toEqual([itemType('new-model')]);
    expect(await schema.getItemTypeByApiKey('new-model')).toEqual(
      itemType('new-model'),
    );
    await expect(schema.getItemTypeByApiKey('old-model')).rejects.toThrow(
      'not found',
    );
    expect(resources.itemTypes.rawList).toHaveBeenCalledTimes(2);
  });

  it('does not let outdated child requests overwrite the new schema cache', async () => {
    const { schema, resources } = makeClient();
    let resolveOld:
      | ((data: { data: SchemaTypes.Fieldset[] }) => void)
      | undefined;
    resources.fieldsets.rawList
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: [fieldset('new-fieldset')] });
    resources.fields.rawList.mockResolvedValue({ data: [field('new-field')] });
    const model = itemType('model');
    const old = schema.getItemTypeFieldsAndFieldsets(model);
    await vi.advanceTimersByTimeAsync(0);
    schema.invalidate();
    const current = await finishTimers(
      schema.getItemTypeFieldsAndFieldsets(model),
    );
    resolveOld?.({ data: [fieldset('old-fieldset')] });
    expect(await finishTimers(old)).toEqual(current);
    expect(current[1].map((value) => value.id)).toEqual(['new-fieldset']);
    expect(resources.fields.rawList).toHaveBeenCalledTimes(1);
    expect(resources.fieldsets.rawList).toHaveBeenCalledTimes(2);
  });
});

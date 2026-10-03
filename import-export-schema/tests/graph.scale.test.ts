import type { SchemaTypes } from '@datocms/cma-client';
import { describe, expect, it, vi } from 'vitest';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import { buildGraph } from '@/utils/graph/buildGraph';
import * as hierarchyModule from '@/utils/graph/buildHierarchyNodes';
import { expandSelectionWithDependencies } from '@/utils/graph/dependencies';
import { mapWithConcurrency } from '@/utils/graph/mapWithConcurrency';
import type { SchemaProgressUpdate } from '@/utils/graph/types';
import type { ISchemaSource } from '@/utils/schema/ISchemaSource';

function itemType(index: number): SchemaTypes.ItemType {
  return {
    id: String(index),
    type: 'item_type',
    attributes: {
      name: `Schema ${index}`,
      api_key: `schema_${String(index).padStart(4, '0')}`,
      modular_block: index % 2 === 1,
    },
    relationships: { fields: { data: [] }, fieldsets: { data: [] } },
    meta: { has_singleton_item: false },
  } as unknown as SchemaTypes.ItemType;
}

function field(
  owner: SchemaTypes.ItemType,
  index: number,
  targets: string[],
  pluginId: string,
): SchemaTypes.Field {
  return {
    id: `${owner.id}-field-${index}`,
    type: 'field',
    attributes: {
      label: `Field ${index}`,
      api_key: `field_${index}`,
      field_type: 'links',
      localized: true,
      validators: { items_item_type: { item_types: targets } },
      appearance: {
        editor: pluginId,
        parameters: {},
        addons: [{ id: pluginId, parameters: {} }],
      },
    },
    relationships: {
      item_type: { data: { id: owner.id, type: 'item_type' } },
      fieldset: { data: null },
    },
  } as SchemaTypes.Field;
}

function syntheticSource(count: number, fieldsPerModel = 20) {
  const itemTypes = Array.from({ length: count }, (_, index) =>
    itemType(index),
  );
  const plugins = Array.from(
    { length: 25 },
    (_, index) =>
      ({
        id: `plugin-${index}`,
        type: 'plugin',
        attributes: { name: `Plugin ${index}` },
      }) as SchemaTypes.Plugin,
  );
  const itemTypesById = new Map(itemTypes.map((entity) => [entity.id, entity]));
  const pluginsById = new Map(plugins.map((entity) => [entity.id, entity]));
  const fieldsById = new Map<string, SchemaTypes.Field[]>();
  const fieldsetsById = new Map<string, SchemaTypes.Fieldset[]>();
  for (const [index, entity] of itemTypes.entries()) {
    const fields = Array.from({ length: fieldsPerModel }, (_, position) => {
      const targets =
        index === 0 && position === 0
          ? itemTypes.slice(1).map((dependency) => dependency.id)
          : [String(Math.max(1, (index + position + 1) % count))];
      return field(
        entity,
        position,
        targets,
        `plugin-${index % plugins.length}`,
      );
    });
    const fieldsets = entity.attributes.modular_block
      ? []
      : Array.from(
          { length: 4 },
          (_, position) =>
            ({
              id: `${entity.id}-fieldset-${position}`,
              type: 'fieldset',
              attributes: { title: `Fieldset ${position}`, position },
              relationships: {
                item_type: { data: { id: entity.id, type: 'item_type' } },
              },
            }) as SchemaTypes.Fieldset,
        );
    entity.relationships.fields.data = fields.map(({ id }) => ({
      id,
      type: 'field',
    }));
    entity.relationships.fieldsets.data = fieldsets.map(({ id }) => ({
      id,
      type: 'fieldset',
    }));
    fieldsById.set(entity.id, fields);
    fieldsetsById.set(entity.id, fieldsets);
  }

  let activeReads = 0;
  let maximumActiveReads = 0;
  const read = async <T>(value: T): Promise<T> => {
    activeReads += 1;
    maximumActiveReads = Math.max(maximumActiveReads, activeReads);
    await Promise.resolve();
    activeReads -= 1;
    return value;
  };
  const getItemTypeById = vi.fn(async (id: string) => {
    const entity = itemTypesById.get(id);
    if (!entity) throw new Error(`Unknown model ${id}`);
    return read(entity);
  });
  const getPluginById = vi.fn(async (id: string) => {
    const entity = pluginsById.get(id);
    if (!entity) throw new Error(`Unknown plugin ${id}`);
    return read(entity);
  });
  const getItemTypeFieldsAndFieldsets = vi.fn(
    async (entity: SchemaTypes.ItemType) =>
      read<[SchemaTypes.Field[], SchemaTypes.Fieldset[]]>([
        fieldsById.get(entity.id) ?? [],
        fieldsetsById.get(entity.id) ?? [],
      ]),
  );
  const source: ISchemaSource = {
    maxConcurrentRequests: 4,
    getKnownPluginIds: () => new Set(pluginsById.keys()),
    getItemTypeById,
    getPluginById,
    getItemTypeFieldsAndFieldsets,
  };
  return {
    source,
    itemTypes,
    getItemTypeById,
    getPluginById,
    getItemTypeFieldsAndFieldsets,
    maximumActiveReads: () => maximumActiveReads,
  };
}

describe('large schema graph preparation', () => {
  it('loads a cyclic 1,000 model/block schema with 20,000 fields through bounded workers', async () => {
    const fixture = syntheticSource(1_000);
    const progress: SchemaProgressUpdate[] = [];
    const layout = vi.spyOn(hierarchyModule, 'buildHierarchyNodes');
    const graph = await buildGraph({
      source: fixture.source,
      initialItemTypes: [fixture.itemTypes[0]],
      onProgress: (update) => progress.push(update),
    });

    expect(graph.nodes).toHaveLength(1_025);
    expect(fixture.getItemTypeById).toHaveBeenCalledTimes(999);
    expect(fixture.getItemTypeFieldsAndFieldsets).toHaveBeenCalledTimes(1_000);
    expect(fixture.getPluginById).toHaveBeenCalledTimes(25);
    expect(fixture.maximumActiveReads()).toBeLessThanOrEqual(4);
    expect(fixture.maximumActiveReads()).toBe(4);
    expect(layout).not.toHaveBeenCalled();
    expect(
      new Set(graph.nodes.map(({ position }) => `${position.x},${position.y}`))
        .size,
    ).toBe(1_025);
    expect(
      graph.nodes
        .filter((node) => node.type === 'itemType')
        .reduce((total, node) => total + node.data.fields.length, 0),
    ).toBe(20_000);
    expect(
      graph.nodes
        .filter((node) => node.type === 'itemType')
        .reduce((total, node) => total + node.data.fieldsets.length, 0),
    ).toBe(2_000);

    const scanUpdates = progress.filter(({ phase }) => phase === 'scan');
    expect(scanUpdates[scanUpdates.length - 1]).toMatchObject({
      done: 1_000,
      total: 1_000,
    });
    for (let index = 1; index < scanUpdates.length; index++) {
      expect(scanUpdates[index].done).toBeGreaterThanOrEqual(
        scanUpdates[index - 1].done,
      );
      expect(scanUpdates[index].done).toBeLessThanOrEqual(
        scanUpdates[index].total,
      );
    }
    expect(progress[progress.length - 1]).toMatchObject({
      done: 1_025,
      total: 1_025,
      phase: 'build',
    });

    const expansion = expandSelectionWithDependencies({
      graph,
      seedItemTypeIds: ['0'],
      seedPluginIds: [],
      installedPluginIds: fixture.source.getKnownPluginIds() as Set<string>,
    });
    expect(expansion.itemTypeIds.size).toBe(1_000);
    expect(expansion.pluginIds.size).toBe(25);
    expect(expansion.addedItemTypeIds).toHaveLength(999);
    expect(expansion.addedPluginIds).toHaveLength(25);
    layout.mockRestore();
  });

  it('still uses the current layout for small schemas and deduplicates seeds', async () => {
    const fixture = syntheticSource(4, 2);
    const layout = vi.spyOn(hierarchyModule, 'buildHierarchyNodes');
    const graph = await buildGraph({
      source: fixture.source,
      initialItemTypes: [fixture.itemTypes[0], fixture.itemTypes[0]],
    });
    expect(graph.nodes.length).toBeLessThanOrEqual(GRAPH_NODE_THRESHOLD);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(fixture.getItemTypeFieldsAndFieldsets).toHaveBeenCalledTimes(4);
    expect(
      graph.nodes.every(
        ({ position }) =>
          Number.isFinite(position.x) && Number.isFinite(position.y),
      ),
    ).toBe(true);
    layout.mockRestore();
  });

  it('stops scheduling after a read failure and waits for the already active read', async () => {
    let finishActive: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      finishActive = resolve;
    });
    const failure = new Error('Read failed');
    const started: number[] = [];
    let settled = false;
    const result = mapWithConcurrency([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 0) throw failure;
      await active;
      return value;
    });
    void result.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(settled).toBe(false);
    finishActive?.();
    await expect(result).rejects.toBe(failure);
    expect(started).toEqual([0, 1]);
  });

  it('cancels before preparing more frontiers without returning a partial graph', async () => {
    const fixture = syntheticSource(10, 2);
    let cancelled = false;
    await expect(
      buildGraph({
        source: fixture.source,
        initialItemTypes: [fixture.itemTypes[0]],
        shouldCancel: () => cancelled,
        onProgress: (update) => {
          if (update.done === 1) cancelled = true;
        },
      }),
    ).rejects.toThrow('Schema preparation cancelled');
    expect(fixture.getItemTypeById).not.toHaveBeenCalled();
    expect(fixture.getPluginById).not.toHaveBeenCalled();
    expect(fixture.getItemTypeFieldsAndFieldsets).toHaveBeenCalledTimes(1);
  });
});

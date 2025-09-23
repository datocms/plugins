import type { SchemaTypes } from '@datocms/cma-client';
import { buildGraph } from '@/utils/graph/buildGraph';
import type { Graph, SchemaProgressUpdate } from '@/utils/graph/types';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { ProjectSchemaSource } from '@/utils/schema/ProjectSchemaSource';

type Options = {
  initialItemTypes: SchemaTypes.ItemType[];
  selectedItemTypeIds: string[];
  schema: ProjectSchema;
  onProgress?: (update: SchemaProgressUpdate) => void;
  installedPluginIds?: Set<string>;
};

/**
 * Lightweight wrapper that adapts the current project schema into the shared
 * `buildGraph` helper so the export view can render a dependency graph.
 */
export async function buildGraphFromSchema({
  initialItemTypes,
  selectedItemTypeIds,
  schema,
  onProgress,
  installedPluginIds,
}: Options): Promise<Graph> {
  const source = new ProjectSchemaSource(schema, {
    installedPluginIds,
  });
  return buildGraph({
    source,
    initialItemTypes,
    selectedItemTypeIds,
    onProgress,
  });
}

export type { SchemaTypes };

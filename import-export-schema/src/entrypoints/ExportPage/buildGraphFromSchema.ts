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

// Note: queue type was unused; removed for strict build

export async function buildGraphFromSchema({
  initialItemTypes,
  selectedItemTypeIds,
  schema,
  onProgress,
}: Options): Promise<Graph> {
  const source = new ProjectSchemaSource(schema);
  return buildGraph({
    source,
    initialItemTypes,
    selectedItemTypeIds,
    onProgress,
  });
}

// The helper exports moved to utils/graph; kept named export for compatibility if imported elsewhere
export type { SchemaTypes };

import { buildGraph } from '@/utils/graph/buildGraph';
import type { Graph } from '@/utils/graph/types';
import { ExportSchemaSource } from '@/utils/schema/ExportSchemaSource';
import type { ExportSchema } from '../ExportPage/ExportSchema';

export async function buildGraphFromExportDoc(
  exportSchema: ExportSchema,
  itemTypeIdsToSkip: string[],
): Promise<Graph> {
  // Convert the static export document into the graph format expected by React Flow.
  const source = new ExportSchemaSource(exportSchema);
  return buildGraph({
    source,
    initialItemTypes: exportSchema.rootItemTypes,
    itemTypeIdsToSkip,
  });
}

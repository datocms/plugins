import { useEffect, useState } from 'react';
import type { SchemaTypes } from '@datocms/cma-client';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { Graph, SchemaProgressUpdate } from '@/utils/graph/types';
import { buildGraphFromSchema } from './buildGraphFromSchema';

type Options = {
  initialItemTypes: SchemaTypes.ItemType[];
  selectedItemTypeIds: string[];
  schema: ProjectSchema;
  onPrepareProgress?: (update: SchemaProgressUpdate) => void;
  onGraphPrepared?: () => void;
  installedPluginIds?: Set<string>;
};

export function useExportGraph({
  initialItemTypes,
  selectedItemTypeIds,
  schema,
  onPrepareProgress,
  onGraphPrepared,
  installedPluginIds,
}: Options) {
  const [graph, setGraph] = useState<Graph | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setError(undefined);
        if (
          typeof window !== 'undefined' &&
          window.localStorage?.getItem('schemaDebug') === '1'
        ) {
          console.log('[ExportGraph] buildGraphFromSchema start', {
            selectedItemTypeIds: selectedItemTypeIds.length,
          });
        }
        const nextGraph = await buildGraphFromSchema({
          initialItemTypes,
          selectedItemTypeIds,
          schema,
          onProgress: onPrepareProgress,
          installedPluginIds,
        });
        if (cancelled) return;
        setGraph(nextGraph);
        if (
          typeof window !== 'undefined' &&
          window.localStorage?.getItem('schemaDebug') === '1'
        ) {
          console.log('[ExportGraph] buildGraphFromSchema done', {
            nodes: nextGraph.nodes.length,
            edges: nextGraph.edges.length,
          });
        }
        onGraphPrepared?.();
      } catch (err) {
        if (cancelled) return;
        console.error('Error building export graph:', err);
        setError(err as Error);
        onGraphPrepared?.();
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [
    initialItemTypes
      .map((it) => it.id)
      .sort()
      .join('-'),
    selectedItemTypeIds
      .slice()
      .sort()
      .join('-'),
    schema,
    refreshKey,
    onPrepareProgress,
    onGraphPrepared,
    installedPluginIds,
  ]);

  return {
    graph,
    error,
    refresh: () => setRefreshKey((key) => key + 1),
  };
}

import type { SchemaTypes } from '@datocms/cma-client';
import { useEffect, useRef, useState } from 'react';
import { debugLog } from '@/utils/debug';
import type { Graph, SchemaProgressUpdate } from '@/utils/graph/types';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { buildGraphFromSchema } from './buildGraphFromSchema';

type Options = {
  initialItemTypes: SchemaTypes.ItemType[];
  selectedItemTypeIds: string[];
  schema: ProjectSchema;
  onPrepareProgress?: (update: SchemaProgressUpdate) => void;
  onGraphPrepared?: () => void;
  installedPluginIds?: Set<string>;
};

/**
 * Builds the export dependency graph whenever the selection or schema changes,
 * surfacing progress callbacks and exposing a manual `refresh` helper.
 */
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
  const prepareProgressRef = useRef(onPrepareProgress);
  const graphPreparedRef = useRef(onGraphPrepared);

  useEffect(() => {
    prepareProgressRef.current = onPrepareProgress;
  }, [onPrepareProgress]);

  useEffect(() => {
    graphPreparedRef.current = onGraphPrepared;
  }, [onGraphPrepared]);

  useEffect(() => {
    // Avoid setting state after unmount or when inputs change mid-build.
    let cancelled = false;
    async function run() {
      try {
        setError(undefined);
        debugLog('ExportGraph build start', {
          selectedItemTypeCount: selectedItemTypeIds.length,
        });
        const nextGraph = await buildGraphFromSchema({
          initialItemTypes,
          selectedItemTypeIds,
          schema,
          onProgress: prepareProgressRef.current,
          installedPluginIds,
        });
        if (cancelled) return;
        setGraph(nextGraph);
        debugLog('ExportGraph build complete', {
          nodeCount: nextGraph.nodes.length,
          edgeCount: nextGraph.edges.length,
        });
        graphPreparedRef.current?.();
      } catch (err) {
        if (cancelled) return;
        console.error('Error building export graph:', err);
        setError(err as Error);
        graphPreparedRef.current?.();
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
    selectedItemTypeIds.slice().sort().join('-'),
    schema,
    refreshKey,
    installedPluginIds,
  ]);

  return {
    graph,
    error,
    // Trigger a rebuild (for example after an intermittent API failure).
    refresh: () => setRefreshKey((key) => key + 1),
  };
}

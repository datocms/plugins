import type { SchemaTypes } from '@datocms/cma-client';
import { faFileExport, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { type NodeMouseHandler, type NodeTypes, Panel } from '@xyflow/react';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import '@xyflow/react/dist/style.css';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Spinner, useCtx } from 'datocms-react-ui';
import { without } from 'lodash-es';
import { useCallback, useEffect, useState } from 'react';
import { GraphCanvas } from '@/components/GraphCanvas';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
// import { collectDependencies } from '@/utils/graph/dependencies';
import { type AppNode, edgeTypes, type Graph } from '@/utils/graph/types';
import { EntitiesToExportContext } from './EntitiesToExportContext';
import { ExportItemTypeNodeRenderer } from './ExportItemTypeNodeRenderer';
import { ExportPluginNodeRenderer } from './ExportPluginNodeRenderer';
import LargeSelectionView from './LargeSelectionView';
import { useAnimatedNodes } from './useAnimatedNodes';
import { useExportGraph } from './useExportGraph';

const nodeTypes: NodeTypes = {
  itemType: ExportItemTypeNodeRenderer,
  plugin: ExportPluginNodeRenderer,
};

type Props = {
  initialItemTypes: SchemaTypes.ItemType[];
  schema: ProjectSchema;
  onExport: (itemTypeIds: string[], pluginIds: string[]) => void;
  onClose?: () => void;
  onGraphPrepared?: () => void;
  onPrepareProgress?: (update: {
    done: number;
    total: number;
    label: string;
    phase?: 'scan' | 'build';
  }) => void;
  installedPluginIds?: Set<string>;
  onSelectingDependenciesChange?: (busy: boolean) => void;
};

export default function Inner({
  initialItemTypes,
  schema,
  onExport,
  onClose,
  onGraphPrepared,
  onPrepareProgress,
  installedPluginIds,
  onSelectingDependenciesChange,
}: Props) {
  const ctx = useCtx<RenderPageCtx>();

  const [selectedItemTypeIds, setSelectedItemTypeIds] = useState<string[]>(
    initialItemTypes.map((it) => it.id),
  );

  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [selectingDependencies, setSelectingDependencies] = useState(false);
  const [autoSelectedDependencies, setAutoSelectedDependencies] = useState<{
    itemTypeIds: Set<string>;
    pluginIds: Set<string>;
  }>({ itemTypeIds: new Set(), pluginIds: new Set() });

  const { graph, error, refresh } = useExportGraph({
    initialItemTypes,
    selectedItemTypeIds,
    schema,
    onPrepareProgress,
    onGraphPrepared,
    installedPluginIds,
  });

  // Overlay is controlled by parent; we signal prepared after each build

  // Keep selection in sync if the parent changes the initial set of item types
  useEffect(() => {
    const mustHave = new Set(initialItemTypes.map((it) => it.id));
    setSelectedItemTypeIds((prev) => {
      const next = new Set(prev);
      for (const id of mustHave) next.add(id);
      return Array.from(next);
    });
  }, [
    initialItemTypes
      .map((it) => it.id)
      .sort()
      .join('-'),
  ]);

  const GRAPH_NODE_THRESHOLD = 60;

  const showGraph = !!graph && graph.nodes.length <= GRAPH_NODE_THRESHOLD;

  const animatedNodes = useAnimatedNodes(
    showGraph && graph ? graph.nodes : [],
  );

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(
    (_, node) => {
      if (node.type === 'itemType') {
        if (initialItemTypes.some((it) => `itemType--${it.id}` === node.id)) {
          return;
        }

        setSelectedItemTypeIds((old) =>
          old.includes(node.data.itemType.id)
            ? without(old, node.data.itemType.id)
            : [...old, node.data.itemType.id],
        );
      }

      if (node.type === 'plugin') {
        setSelectedPluginIds((old) =>
          old.includes(node.data.plugin.id)
            ? without(old, node.data.plugin.id)
            : [...old, node.data.plugin.id],
        );
      }
    },
    [
      initialItemTypes
        .map((it) => it.id)
        .sort()
        .join('-'),
    ],
  );

  const handleSelectAllDependencies = useCallback(async () => {
    setSelectingDependencies(true);
    onSelectingDependenciesChange?.(true);
    try {
      // Ensure any preparation overlay is hidden during dependency selection
      onGraphPrepared?.();
      // Determine installed plugin IDs, warn user once if unknown
      // (avoids false positives when detecting plugin dependencies)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnedKey = 'exportPluginIdsWarned';
      const installedFromGraph = graph
        ? new Set(
            graph.nodes
              .filter((n) => n.type === 'plugin')
              .map((n) => (n.type === 'plugin' ? n.data.plugin.id : '')),
          )
        : undefined;
      const installed =
        installedPluginIds && installedPluginIds.size > 0
          ? installedPluginIds
          : installedFromGraph && installedFromGraph.size > 0
            ? installedFromGraph
            : undefined;
      if (!installed && typeof window !== 'undefined') {
        try {
          const already = window.sessionStorage.getItem(warnedKey) === '1';
          if (!already) {
            void ctx.notice(
              'Plugin dependency detection may be incomplete (installed plugin list unavailable).',
            );
            window.sessionStorage.setItem(warnedKey, '1');
          }
        } catch {}
      }
      if (
        typeof window !== 'undefined' &&
        window.localStorage?.getItem('schemaDebug') === '1'
      ) {
        console.log('[SelectAllDependencies] start', {
          selectedItemTypeIds: selectedItemTypeIds.length,
          selectedPluginIds: selectedPluginIds.length,
          installedPluginIds: installed
            ? Array.from(installed).slice(0, 5)
            : 'unknown',
        });
      }
      const beforeItemTypeIds = new Set<string>(selectedItemTypeIds);
      const beforePluginIds = new Set<string>(selectedPluginIds);
      const nextItemTypeIds = new Set<string>(selectedItemTypeIds);
      const nextPluginIds = new Set<string>(selectedPluginIds);

      const queue = [...selectedItemTypeIds];

      while (queue.length > 0) {
        const popped = queue.pop();
        if (!popped) break;
        const id = popped;
        const node = graph?.nodes.find((n) => n.id === `itemType--${id}`);
        const fields = node?.type === 'itemType' ? node.data.fields : [];

        for (const field of fields) {
          for (const linkedId of findLinkedItemTypeIds(field)) {
            if (!nextItemTypeIds.has(linkedId)) {
              nextItemTypeIds.add(linkedId);
              queue.push(linkedId);
            }
          }

          for (const pluginId of findLinkedPluginIds(field, installed)) {
            nextPluginIds.add(pluginId);
          }
        }
      }

      const addedItemTypeIds = Array.from(nextItemTypeIds).filter(
        (id) => !beforeItemTypeIds.has(id),
      );
      const addedPluginIds = Array.from(nextPluginIds).filter(
        (id) => !beforePluginIds.has(id),
      );

      setSelectedItemTypeIds(Array.from(nextItemTypeIds));
      setSelectedPluginIds(Array.from(nextPluginIds));
      setAutoSelectedDependencies({
        itemTypeIds: new Set(addedItemTypeIds),
        pluginIds: new Set(addedPluginIds),
      });
      if (
        typeof window !== 'undefined' &&
        window.localStorage?.getItem('schemaDebug') === '1'
      ) {
        console.log('[SelectAllDependencies] done', {
          itemTypeIds: nextItemTypeIds.size,
          pluginIds: nextPluginIds.size,
          samplePluginIds: Array.from(nextPluginIds).slice(0, 5),
        });
      }
      void ctx.notice(
        `Selected dependencies: +${addedItemTypeIds.length} models, +${addedPluginIds.length} plugins`,
      );
    } finally {
      setSelectingDependencies(false);
      // Do not lift overlay suppression here; let onGraphPrepared re-enable it
    }
  }, [
    graph,
    selectedItemTypeIds,
    selectedPluginIds,
    installedPluginIds,
    onSelectingDependenciesChange,
    ctx,
  ]);

  const handleUnselectAllDependencies = useCallback(() => {
    // Remove dependencies previously auto-selected; fallback to none
    const toRemoveItemTypeIds = autoSelectedDependencies.itemTypeIds;
    const toRemovePluginIds = autoSelectedDependencies.pluginIds;

    if (toRemoveItemTypeIds.size === 0 && toRemovePluginIds.size === 0) {
      // No recorded auto-selected deps; nothing to do
      void ctx.notice('No dependencies to unselect');
      return;
    }

    const removedModelsCount = selectedItemTypeIds.filter((id) =>
      toRemoveItemTypeIds.has(id),
    ).length;
    const removedPluginsCount = selectedPluginIds.filter((id) =>
      toRemovePluginIds.has(id),
    ).length;

    setSelectedItemTypeIds((prev) =>
      prev.filter((id) => !toRemoveItemTypeIds.has(id)),
    );
    setSelectedPluginIds((prev) =>
      prev.filter((id) => !toRemovePluginIds.has(id)),
    );
    setAutoSelectedDependencies({
      itemTypeIds: new Set(),
      pluginIds: new Set(),
    });
    void ctx.notice(
      `Unselected dependencies: -${removedModelsCount} models, -${removedPluginsCount} plugins`,
    );
  }, [autoSelectedDependencies, ctx, selectedItemTypeIds, selectedPluginIds]);

  // Determine if all deps are selected to toggle label
  const areAllDependenciesSelected = (() => {
    try {
      const installedFromGraph = graph
        ? new Set(
            graph.nodes
              .filter((n) => n.type === 'plugin')
              .map((n) => (n.type === 'plugin' ? n.data.plugin.id : '')),
          )
        : undefined;
      const installed =
        installedPluginIds && installedPluginIds.size > 0
          ? installedPluginIds
          : installedFromGraph && installedFromGraph.size > 0
            ? installedFromGraph
            : undefined;

      const nextItemTypeIds = new Set<string>(selectedItemTypeIds);
      const nextPluginIds = new Set<string>(selectedPluginIds);
      const queue = [...selectedItemTypeIds];
      while (queue.length > 0) {
        const popped = queue.pop();
        if (!popped) break;
        const id = popped;
        const node = graph?.nodes.find((n) => n.id === `itemType--${id}`);
        const fields = node?.type === 'itemType' ? node.data.fields : [];
        for (const field of fields) {
          for (const linkedId of findLinkedItemTypeIds(field)) {
            if (!nextItemTypeIds.has(linkedId)) {
              nextItemTypeIds.add(linkedId);
              queue.push(linkedId);
            }
          }
          for (const pluginId of findLinkedPluginIds(field, installed)) {
            nextPluginIds.add(pluginId);
          }
        }
      }
      const toAddItemTypes = Array.from(nextItemTypeIds).filter(
        (id) => !selectedItemTypeIds.includes(id),
      );
      const toAddPlugins = Array.from(nextPluginIds).filter(
        (id) => !selectedPluginIds.includes(id),
      );
      return toAddItemTypes.length === 0 && toAddPlugins.length === 0;
    } catch {
      return false;
    }
  })();

  return (
    <div className="page page--export">
      <div
        style={{
          padding: '8px var(--spacing-l)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div className="page__toolbar__title">
          {initialItemTypes.length === 1
            ? `Export ${initialItemTypes[0].attributes.name}`
            : 'Export selection'}
        </div>
        <div style={{ flex: '1' }} />
        <Button
          leftIcon={<FontAwesomeIcon icon={faXmark} />}
          buttonSize="s"
          onClick={() => {
            if (onClose) {
              onClose();
            } else {
              ctx.navigateTo(
                `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/export`,
              );
            }
          }}
        >
          Close
        </Button>
      </div>
      <div className="page__content">
        <div className="export-wrapper">
          {!graph && !error ? (
            <Spinner size={60} placement="centered" />
          ) : error ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 600 }}>Could not load export graph</div>
              <div
                style={{ color: '#666', maxWidth: 540, textAlign: 'center' }}
              >
                {(() => {
                  const anyErr = error as unknown as {
                    response?: { status?: number };
                  };
                  const status = anyErr?.response?.status;
                  if (status === 429) {
                    return "You're being rate-limited by the API (429). Please wait a few seconds and try again.";
                  }
                  if (status === 401 || status === 403) {
                    return 'You do not have permission to load the project schema. Please check your credentials and try again.';
                  }
                  if (status && status >= 500) {
                    return 'The API is temporarily unavailable. Please try again shortly.';
                  }
                  return 'An unexpected error occurred while preparing the export. Please try again.';
                })()}
              </div>
              <Button
                buttonSize="m"
                onClick={() => {
                  refresh();
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <EntitiesToExportContext.Provider
              value={{
                itemTypeIds: selectedItemTypeIds,
                pluginIds: selectedPluginIds,
              }}
            >
              {showGraph ? (
                <>
                  <GraphCanvas
                    graph={{ nodes: animatedNodes, edges: graph.edges }}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodeClick={onNodeClick as unknown as NodeMouseHandler}
                    style={{ position: 'absolute' }}
                    fitView
                  />
                  <Panel position="bottom-center">
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                    >
                      <Button
                        type="button"
                        buttonSize="m"
                        onClick={
                          areAllDependenciesSelected
                            ? handleUnselectAllDependencies
                            : handleSelectAllDependencies
                        }
                        disabled={selectingDependencies}
                      >
                        {areAllDependenciesSelected
                          ? 'Unselect all dependencies'
                          : 'Select all dependencies'}
                      </Button>
                      {selectingDependencies && <Spinner size={20} />}

                      <Button
                        type="button"
                        buttonSize="xl"
                        buttonType="primary"
                        leftIcon={<FontAwesomeIcon icon={faFileExport} />}
                        onClick={() =>
                          onExport(selectedItemTypeIds, selectedPluginIds)
                        }
                        disabled={selectingDependencies}
                      >
                        Export {selectedItemTypeIds.length} elements as JSON
                      </Button>
                    </div>
                  </Panel>
                </>
              ) : (
                <LargeSelectionView
                  initialItemTypes={initialItemTypes}
                  graph={graph as Graph}
                  selectedItemTypeIds={selectedItemTypeIds}
                  setSelectedItemTypeIds={setSelectedItemTypeIds}
                  selectedPluginIds={selectedPluginIds}
                  setSelectedPluginIds={setSelectedPluginIds}
                  onExport={onExport}
                  onSelectAllDependencies={handleSelectAllDependencies}
                  onUnselectAllDependencies={handleUnselectAllDependencies}
                  areAllDependenciesSelected={areAllDependenciesSelected}
                  selectingDependencies={selectingDependencies}
                />
              )}
            </EntitiesToExportContext.Provider>
          )}
        </div>
      </div>
    </div>
  );
}

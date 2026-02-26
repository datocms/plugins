import type { SchemaTypes } from '@datocms/cma-client';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  type NodeMouseHandler,
  type NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import '@xyflow/react/dist/style.css';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Spinner, useCtx } from 'datocms-react-ui';
import without from 'lodash-es/without';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraphCanvas } from '@/components/GraphCanvas';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import { debugLog } from '@/utils/debug';
import { expandSelectionWithDependencies } from '@/utils/graph/dependencies';
import { type AppNode, edgeTypes } from '@/utils/graph/types';
import { DependencyActionsPanel } from './DependencyActionsPanel';
import { EntitiesToExportContext } from './EntitiesToExportContext';
import { ExportItemTypeNodeRenderer } from './ExportItemTypeNodeRenderer';
import { ExportPluginNodeRenderer } from './ExportPluginNodeRenderer';
import { ExportSchemaOverview } from './ExportSchemaOverview';
import { useExportGraph } from './useExportGraph';

// Map React Flow node types to their respective renderer components.
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

/**
 * Presents the export graph, wiring selection state, dependency resolution, and
 * export call-outs. For large selections it warns before rendering the full canvas.
 */
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
  const { fitBounds, fitView } = useReactFlow();

  // Track the current selection while ensuring initial models stay checked.
  const [selectedItemTypeIds, setSelectedItemTypeIds] = useState<string[]>(
    initialItemTypes.map((it) => it.id),
  );
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [selectingDependencies, setSelectingDependencies] = useState(false);
  // Remember which dependencies were auto-selected so we can undo the action later.
  const [autoSelectedDependencies, setAutoSelectedDependencies] = useState<{
    itemTypeIds: Set<string>;
    pluginIds: Set<string>;
  }>({ itemTypeIds: new Set(), pluginIds: new Set() });
  const [focusedEntity, setFocusedEntity] = useState<
    SchemaTypes.ItemType | SchemaTypes.Plugin | undefined
  >(undefined);
  const [forceRenderGraph, setForceRenderGraph] = useState(false);
  const [pendingZoomEntity, setPendingZoomEntity] = useState<
    SchemaTypes.ItemType | SchemaTypes.Plugin | null | undefined
  >(undefined);

  const { graph, error, refresh } = useExportGraph({
    initialItemTypes,
    selectedItemTypeIds,
    schema,
    onPrepareProgress,
    onGraphPrepared,
    installedPluginIds,
  });

  const resolvedInstalledPluginIds = useMemo(() => {
    if (installedPluginIds && installedPluginIds.size > 0) {
      return installedPluginIds;
    }
    if (!graph) return undefined;
    const discovered = new Set(
      graph.nodes
        .filter((node) => node.type === 'plugin')
        .map((node) => (node.type === 'plugin' ? node.data.plugin.id : '')),
    );
    return discovered.size > 0 ? discovered : undefined;
  }, [installedPluginIds, graph]);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    ctx.navigateTo(
      `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/export`,
    );
  }, [ctx, onClose]);

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

  const graphTooLarge = !!graph && graph.nodes.length > GRAPH_NODE_THRESHOLD;
  useEffect(() => {
    if (!graphTooLarge && forceRenderGraph) {
      setForceRenderGraph(false);
    }
  }, [graphTooLarge, forceRenderGraph]);

  const showGraph = !!graph && (!graphTooLarge || forceRenderGraph);

  useEffect(() => {
    if (!showGraph || pendingZoomEntity === undefined || !graph) {
      return;
    }

    if (pendingZoomEntity === null) {
      fitView({ duration: 800 });
      setPendingZoomEntity(undefined);
      return;
    }

    const node = graph.nodes.find((node) =>
      pendingZoomEntity.type === 'plugin'
        ? node.type === 'plugin' && node.data.plugin.id === pendingZoomEntity.id
        : node.type === 'itemType' &&
          node.data.itemType.id === pendingZoomEntity.id,
    );

    if (!node) {
      setPendingZoomEntity(undefined);
      return;
    }

    fitBounds(
      { x: node.position.x, y: node.position.y, width: 200, height: 200 },
      { duration: 800, padding: 1 },
    );
    setPendingZoomEntity(undefined);
  }, [fitBounds, fitView, graph, pendingZoomEntity, showGraph]);

  const graphNodes = useMemo<AppNode[]>(() => {
    if (!showGraph || !graph) {
      return [];
    }
    return graph.nodes;
  }, [graph, showGraph]);

  const handleSelectEntity = useCallback(
    (
      newEntity: SchemaTypes.ItemType | SchemaTypes.Plugin | undefined,
      zoomIn = false,
    ) => {
      setFocusedEntity(newEntity);

      if (!zoomIn) {
        return;
      }

      setPendingZoomEntity(newEntity ?? null);
    },
    [graphTooLarge],
  );

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(
    (_, node) => {
      if (node.type === 'itemType') {
        setFocusedEntity(node.data.itemType);
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
        setFocusedEntity(node.data.plugin);
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

      const warnedKey = 'exportPluginIdsWarned';
      if (!resolvedInstalledPluginIds && typeof window !== 'undefined') {
        try {
          const alreadyWarned =
            window.sessionStorage.getItem(warnedKey) === '1';
          if (!alreadyWarned) {
            void ctx.notice(
              'Plugin dependency detection may be incomplete (installed plugin list unavailable).',
            );
            window.sessionStorage.setItem(warnedKey, '1');
          }
        } catch {}
      }

      debugLog('SelectAllDependencies start', {
        selectedItemTypeCount: selectedItemTypeIds.length,
        selectedPluginCount: selectedPluginIds.length,
        installedPluginIds: resolvedInstalledPluginIds
          ? Array.from(resolvedInstalledPluginIds).slice(0, 5)
          : 'unknown',
      });

      const expansion = expandSelectionWithDependencies({
        graph,
        seedItemTypeIds: selectedItemTypeIds,
        seedPluginIds: selectedPluginIds,
        installedPluginIds: resolvedInstalledPluginIds,
      });

      const { addedItemTypeIds, addedPluginIds } = expansion;

      setSelectedItemTypeIds(Array.from(expansion.itemTypeIds));
      setSelectedPluginIds(Array.from(expansion.pluginIds));
      setAutoSelectedDependencies({
        itemTypeIds: new Set(addedItemTypeIds),
        pluginIds: new Set(addedPluginIds),
      });

      debugLog('SelectAllDependencies done', {
        itemTypeCount: expansion.itemTypeIds.size,
        pluginCount: expansion.pluginIds.size,
        samplePluginIds: Array.from(expansion.pluginIds).slice(0, 5),
      });

      void ctx.notice(
        `Selected dependencies: +${addedItemTypeIds.length} models, +${addedPluginIds.length} plugins`,
      );
    } finally {
      setSelectingDependencies(false);
      // Do not lift overlay suppression here; let onGraphPrepared re-enable it
    }
  }, [
    ctx,
    graph,
    onGraphPrepared,
    onSelectingDependenciesChange,
    resolvedInstalledPluginIds,
    selectedItemTypeIds,
    selectedPluginIds,
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

  // Determine if all dependencies are already selected to flip the CTA label.
  const areAllDependenciesSelected = useMemo(() => {
    try {
      const expansion = expandSelectionWithDependencies({
        graph,
        seedItemTypeIds: selectedItemTypeIds,
        seedPluginIds: selectedPluginIds,
        installedPluginIds: resolvedInstalledPluginIds,
      });
      return (
        expansion.addedItemTypeIds.length === 0 &&
        expansion.addedPluginIds.length === 0
      );
    } catch {
      return false;
    }
  }, [
    graph,
    resolvedInstalledPluginIds,
    selectedItemTypeIds,
    selectedPluginIds,
  ]);

  return (
    <div className="page page--export">
      <div className="page__content">
        <SelectedEntityContext.Provider
          value={{ entity: focusedEntity, set: handleSelectEntity }}
        >
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
                <div style={{ fontWeight: 600 }}>
                  Could not load export graph
                </div>
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
              <div
                style={{
                  display: 'flex',
                  width: '100%',
                  height: '100%',
                }}
              >
                <section
                  style={{
                    flex: '2 1 0%',
                    minWidth: 480,
                    position: 'relative',
                  }}
                  aria-label="Export graph panel"
                >
                  <div
                    className="export__graph"
                    style={{ position: 'relative', height: '100%' }}
                  >
                    <div className="export__graph-close">
                      <Button
                        type="button"
                        buttonSize="s"
                        buttonType="muted"
                        leftIcon={<FontAwesomeIcon icon={faXmark} />}
                        onClick={handleClose}
                      >
                        Close
                      </Button>
                    </div>
                    <EntitiesToExportContext.Provider
                      value={{
                        itemTypeIds: selectedItemTypeIds,
                        pluginIds: selectedPluginIds,
                      }}
                    >
                      {showGraph ? (
                        <>
                          <GraphCanvas
                            graph={{ nodes: graphNodes, edges: graph.edges }}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            onNodeClick={
                              onNodeClick as unknown as NodeMouseHandler
                            }
                            style={{ width: '100%', height: '100%' }}
                            fitView
                          />
                          <DependencyActionsPanel
                            selectingDependencies={selectingDependencies}
                            areAllDependenciesSelected={
                              areAllDependenciesSelected
                            }
                            selectedItemCount={selectedItemTypeIds.length}
                            onSelectAllDependencies={
                              handleSelectAllDependencies
                            }
                            onUnselectAllDependencies={
                              handleUnselectAllDependencies
                            }
                            onExport={() =>
                              onExport(selectedItemTypeIds, selectedPluginIds)
                            }
                          />
                        </>
                      ) : graph ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            height: '100%',
                            gap: 16,
                            padding: '0 24px',
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>
                            This graph has {graph.nodes.length} nodes. Trying to
                            render it may slow down your browser.
                          </div>
                          <Button
                            type="button"
                            buttonSize="s"
                            onClick={() => setForceRenderGraph(true)}
                          >
                            Render it anyway
                          </Button>
                        </div>
                      ) : null}
                    </EntitiesToExportContext.Provider>
                  </div>
                </section>
                <section
                  style={{
                    flex: '1 1 0%',
                    minWidth: 340,
                    position: 'relative',
                  }}
                  aria-label="Schema overview panel"
                >
                  <div className="export__details">
                    <ExportSchemaOverview
                      graph={graph}
                      selectedItemTypeIds={selectedItemTypeIds}
                      selectedPluginIds={selectedPluginIds}
                    />
                  </div>
                </section>
              </div>
            )}
          </div>
        </SelectedEntityContext.Provider>
      </div>
    </div>
  );
}

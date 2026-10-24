import type { SchemaTypes } from '@datocms/cma-client';
import {
  type NodeMouseHandler,
  type NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Aside from 'datocms-react-ui/Aside';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import SplitPane from 'datocms-react-ui/SplitPane';
import Toolbar from 'datocms-react-ui/Toolbar';
import without from 'lodash-es/without';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas } from '@/components/GraphCanvas';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { CircleExclamationIcon, ExportIcon, RefreshIcon } from '@/icons';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import { useOverviewSplit } from '@/shared/hooks/useOverviewSplit';
import { type Formatters, useFormatters } from '@/texts';
import { debugLog } from '@/utils/debug';
import { expandSelectionWithDependencies } from '@/utils/graph/dependencies';
import {
  type AppNode,
  edgeTypes,
  type Graph,
  type SchemaProgressUpdate,
} from '@/utils/graph/types';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { EntitiesToExportContext } from './EntitiesToExportContext';
import { ExportItemTypeNodeRenderer } from './ExportItemTypeNodeRenderer';
import { ExportPluginNodeRenderer } from './ExportPluginNodeRenderer';
import {
  ExportSchemaOverview,
  useExportOverviewList,
} from './ExportSchemaOverview';
import s from './styles.module.css';
import { useExportGraph } from './useExportGraph';

// Map React Flow node types to their respective renderer components.
const nodeTypes: NodeTypes = {
  itemType: ExportItemTypeNodeRenderer,
  plugin: ExportPluginNodeRenderer,
};

// The flag that the plugin warning was shown in this browser session. The
// key starts with the name of the plugin, because every plugin shares the
// origin of the plugins CDN; the old key still counts.
const pluginIdsWarnedKey = 'import-export-schema.exportPluginIdsWarned';
const legacyPluginIdsWarnedKey = 'exportPluginIdsWarned';
const goBackLabel = 'Back to the export options';

type Props = {
  initialItemTypes: SchemaTypes.ItemType[];
  schema: ProjectSchema;
  onExport: (itemTypeIds: string[], pluginIds: string[]) => void;
  /**
   * Goes back to the previous step. Without it, the chevron opens the export
   * page of the environment.
   */
  onClose?: () => void;
  installedPluginIds?: Set<string>;
};

type FocusedEntity = SchemaTypes.ItemType | SchemaTypes.Plugin;

/** What the user can do about a failed graph, from the status of the API */
function describeGraphError(error: Error) {
  const status = (error as { response?: { status?: number } }).response?.status;
  if (status === 429) {
    return 'The API is limiting the requests. Wait a few seconds, then try again.';
  }
  if (status === 401 || status === 403) {
    return "You don't have the permission to read the schema of this environment.";
  }
  if (status && status >= 500) {
    return 'The API is not available right now. Try again in a few moments.';
  }
  return 'Something went wrong while preparing the export. Try again.';
}

/** Why "Export as JSON" does nothing yet, if it does nothing */
function exportDisabledReason(
  selectingDependencies: boolean,
  hasGraph: boolean,
) {
  if (selectingDependencies) {
    return { reason: 'The dependencies are being selected.' };
  }
  if (!hasGraph) {
    return { reason: 'The export is available once the graph loads.' };
  }
  return undefined;
}

/** "3 models or blocks and 1 plugin", or an empty string when both are 0 */
function describeDependencies(
  format: Formatters,
  itemTypeCount: number,
  pluginCount: number,
) {
  const parts: string[] = [];
  if (itemTypeCount > 0) {
    parts.push(
      format.count(itemTypeCount, 'model or block', 'models or blocks'),
    );
  }
  if (pluginCount > 0) {
    parts.push(format.count(pluginCount, 'plugin', 'plugins'));
  }
  return parts.join(' and ');
}

/**
 * The graph step of the export: the dependency graph of the starting models
 * at the left, the overview of its elements at the right. Clicks on the nodes
 * (or the switches of the overview) choose what goes in the export.
 */
export default function Inner({
  initialItemTypes,
  schema,
  onExport,
  onClose,
  installedPluginIds,
}: Props) {
  const ctx = useCtx<RenderPageCtx>();
  const format = useFormatters();
  const { fitBounds, fitView } = useReactFlow();
  const initialItemTypeIds = useMemo(
    () => initialItemTypes.map((itemType) => itemType.id),
    [initialItemTypes],
  );

  // Track the current selection while ensuring initial models stay checked.
  const [selectedItemTypeIds, setSelectedItemTypeIds] =
    useState<string[]>(initialItemTypeIds);
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [selectingDependencies, setSelectingDependencies] = useState(false);
  // Remember which dependencies were auto-selected so we can undo the action later.
  const [autoSelectedDependencies, setAutoSelectedDependencies] = useState<{
    itemTypeIds: Set<string>;
    pluginIds: Set<string>;
  }>({ itemTypeIds: new Set(), pluginIds: new Set() });
  const [focusedEntity, setFocusedEntity] = useState<FocusedEntity | undefined>(
    undefined,
  );
  const [forceRenderGraph, setForceRenderGraph] = useState(false);
  const [pendingZoomEntity, setPendingZoomEntity] = useState<
    FocusedEntity | null | undefined
  >(undefined);

  // The progress of the first build (the blank slate shows it), and whether a
  // build runs (after the first graph, the toolbar spinner shows it).
  const [prepareProgress, setPrepareProgress] = useState<
    SchemaProgressUpdate | undefined
  >(undefined);
  const [building, setBuilding] = useState(true);
  const hasGraphRef = useRef(false);

  const handlePrepareProgress = useCallback(
    (progress: SchemaProgressUpdate) => {
      setBuilding(true);
      if (!hasGraphRef.current) {
        setPrepareProgress(progress);
      }
    },
    [],
  );
  const handleGraphPrepared = useCallback(() => {
    setBuilding(false);
  }, []);

  const { graph, error, refresh } = useExportGraph({
    initialItemTypes,
    selectedItemTypeIds,
    schema,
    onPrepareProgress: handlePrepareProgress,
    onGraphPrepared: handleGraphPrepared,
    installedPluginIds,
  });

  useEffect(() => {
    hasGraphRef.current = Boolean(graph);
  }, [graph]);

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

  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const exportPagePath = `${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/export`;

  // Keep selection in sync if the parent changes the initial set of item types
  useEffect(() => {
    const mustHave = new Set(initialItemTypeIds);
    setSelectedItemTypeIds((prev) => {
      const next = new Set(prev);
      for (const id of mustHave) next.add(id);
      return Array.from(next);
    });
  }, [initialItemTypeIds]);

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
    (newEntity: FocusedEntity | undefined, zoomIn = false) => {
      setFocusedEntity(newEntity);

      if (!zoomIn) {
        return;
      }

      setPendingZoomEntity(newEntity ?? null);
    },
    [],
  );

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(
    (_, node) => {
      if (node.type === 'itemType') {
        setFocusedEntity(node.data.itemType);
        if (initialItemTypeIds.some((id) => `itemType--${id}` === node.id)) {
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
    [initialItemTypeIds],
  );

  // The switches of the overview: the same toggles as a click on the node,
  // without the pointer. The initial item types always stay in the export.
  const handleToggleItemType = useCallback(
    (itemTypeId: string) => {
      if (initialItemTypeIds.includes(itemTypeId)) {
        return;
      }
      setSelectedItemTypeIds((old) =>
        old.includes(itemTypeId)
          ? without(old, itemTypeId)
          : [...old, itemTypeId],
      );
    },
    [initialItemTypeIds],
  );

  const handleTogglePlugin = useCallback((pluginId: string) => {
    setSelectedPluginIds((old) =>
      old.includes(pluginId) ? without(old, pluginId) : [...old, pluginId],
    );
  }, []);

  const handleSelectAllDependencies = useCallback(async () => {
    setSelectingDependencies(true);
    try {
      if (!resolvedInstalledPluginIds && typeof window !== 'undefined') {
        try {
          const alreadyWarned =
            window.sessionStorage.getItem(pluginIdsWarnedKey) === '1' ||
            window.sessionStorage.getItem(legacyPluginIdsWarnedKey) === '1';
          if (!alreadyWarned) {
            void ctx.customToast({
              type: 'warning',
              message:
                'The installed plugins are not known, so some plugin dependencies may be missing.',
              dismissAfterTimeout: true,
            });
            window.sessionStorage.setItem(pluginIdsWarnedKey, '1');
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

      const added = describeDependencies(
        format,
        addedItemTypeIds.length,
        addedPluginIds.length,
      );
      void ctx.notice(added ? `Added ${added}.` : 'No dependencies to add.');
    } finally {
      setSelectingDependencies(false);
    }
  }, [
    ctx,
    format,
    graph,
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
      void ctx.notice('No dependencies to remove.');
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

    const removed = describeDependencies(
      format,
      removedModelsCount,
      removedPluginsCount,
    );
    void ctx.notice(
      removed ? `Removed ${removed}.` : 'No dependencies to remove.',
    );
  }, [
    autoSelectedDependencies,
    ctx,
    format,
    selectedItemTypeIds,
    selectedPluginIds,
  ]);

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

  // A failed rebuild keeps the last graph, which lacks what the change asked
  // for. Until "Try again" builds a new one, the graph area shows the error,
  // and the dependency actions, the export and the overview wait too.
  const readyGraph = error ? undefined : graph;

  // The overview: beside the graph, or over it in a narrow frame (closed
  // there until its rail opens it)
  const overviewSplit = useOverviewSplit({ openWhenSmall: false });
  const overviewList = useExportOverviewList({
    graph: readyGraph,
    focusedEntity,
    selectedItemTypeIds,
    selectedPluginIds,
  });

  const selectedEntityValue = useMemo(
    () => ({ entity: focusedEntity, set: handleSelectEntity }),
    [focusedEntity, handleSelectEntity],
  );
  const entitiesToExportValue = useMemo(
    () => ({ itemTypeIds: selectedItemTypeIds, pluginIds: selectedPluginIds }),
    [selectedItemTypeIds, selectedPluginIds],
  );

  const title =
    initialItemTypes.length === 1
      ? `Export “${initialItemTypes[0].attributes.name}”`
      : 'Export the selection';
  const showUnselect = Boolean(readyGraph) && areAllDependenciesSelected;
  const selectedCount = selectedItemTypeIds.length + selectedPluginIds.length;
  const goBack = onClose ? (
    <Toolbar.GoBack onClick={onClose} ariaLabel={goBackLabel} />
  ) : (
    <Toolbar.GoBack to={exportPagePath} ariaLabel={goBackLabel} />
  );
  const dependenciesDisabled = readyGraph
    ? undefined
    : { reason: 'The dependencies show once the graph loads.' };
  const exportDisabled = exportDisabledReason(
    selectingDependencies,
    Boolean(readyGraph),
  );

  return (
    <div className={s.layout}>
      <SelectedEntityContext.Provider value={selectedEntityValue}>
        <EntitiesToExportContext.Provider value={entitiesToExportValue}>
          <SplitPane primaryPane="left" {...overviewSplit}>
            <Main>
              <Pane
                ariaLabel="Dependency graph"
                header={
                  <Toolbar>
                    {goBack}
                    <Toolbar.Title
                      level={1}
                      help={
                        <Toolbar.Help>
                          Click a node to add it to the export or remove it. The
                          models you started from are always included.
                        </Toolbar.Help>
                      }
                    >
                      {title}
                    </Toolbar.Title>
                    <Toolbar.Subtitle>
                      {format.count(
                        selectedCount,
                        'element to export',
                        'elements to export',
                      )}
                    </Toolbar.Subtitle>
                    <Toolbar.Spinner show={building && Boolean(graph)} />
                    <Toolbar.Space />
                    <Toolbar.Button
                      label={
                        showUnselect
                          ? 'Unselect all dependencies'
                          : 'Select all dependencies'
                      }
                      onClick={
                        showUnselect
                          ? handleUnselectAllDependencies
                          : handleSelectAllDependencies
                      }
                      disabled={dependenciesDisabled}
                    />
                    <Toolbar.Button
                      tone="primary"
                      icon={ExportIcon}
                      label="Export as JSON"
                      onClick={() =>
                        onExport(selectedItemTypeIds, selectedPluginIds)
                      }
                      disabled={exportDisabled}
                    />
                  </Toolbar>
                }
              >
                <GraphArea
                  graph={graph}
                  error={error}
                  showGraph={showGraph}
                  graphNodes={graphNodes}
                  prepareProgress={prepareProgress}
                  onRetry={refresh}
                  onShowAnyway={() => setForceRenderGraph(true)}
                  onNodeClick={onNodeClick}
                />
              </Pane>
            </Main>
            <Aside ariaLabel="Schema overview">
              <ExportSchemaOverview
                graph={readyGraph}
                failed={Boolean(error)}
                list={overviewList}
                initialItemTypeIds={initialItemTypeIds}
                onToggleItemType={handleToggleItemType}
                onTogglePlugin={handleTogglePlugin}
              />
            </Aside>
          </SplitPane>
        </EntitiesToExportContext.Provider>
      </SelectedEntityContext.Provider>
    </div>
  );
}

type GraphAreaProps = {
  graph: Graph | undefined;
  error: Error | undefined;
  /** The graph is small enough, or the user asked to draw it anyway */
  showGraph: boolean;
  graphNodes: AppNode[];
  /** The progress of the first build */
  prepareProgress: SchemaProgressUpdate | undefined;
  onRetry: () => void;
  onShowAnyway: () => void;
  onNodeClick: NodeMouseHandler<AppNode>;
};

/**
 * The content of the graph pane: the first build, the failed build, the
 * graph too large to draw, or the read-only canvas. Rebuilds keep the last
 * graph on screen.
 */
function GraphArea({
  graph,
  error,
  showGraph,
  graphNodes,
  prepareProgress,
  onRetry,
  onShowAnyway,
  onNodeClick,
}: GraphAreaProps) {
  if (error) {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="The graph could not be loaded"
        code={error.message}
        description={describeGraphError(error)}
        actions={
          <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
        }
      />
    );
  }

  if (!graph) {
    return (
      <BlankSlate
        placement="area"
        loading
        title="Preparing the dependency graph"
        caption={prepareProgress?.label}
      >
        {prepareProgress && prepareProgress.total > 0 ? (
          <ProgressBar
            value={prepareProgress.done / prepareProgress.total}
            ariaLabel="Preparing the dependency graph"
          />
        ) : null}
      </BlankSlate>
    );
  }

  if (!showGraph) {
    return (
      <BlankSlate
        placement="area"
        icon={<ExportIcon />}
        title="The graph is too large to show"
        description={{
          id: 'importExportSchema.graphTooLarge',
          values: { count: graph.nodes.length },
        }}
        actions={
          <Button label="Show the graph anyway" onClick={onShowAnyway} />
        }
      />
    );
  }

  return (
    <div className={s.canvas}>
      <GraphCanvas
        graph={{ nodes: graphNodes, edges: graph.edges }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        fitView
      />
    </div>
  );
}

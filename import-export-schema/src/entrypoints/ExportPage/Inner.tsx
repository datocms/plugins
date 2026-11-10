import type { SchemaTypes } from '@datocms/cma-client';
import type { NodeMouseHandler, NodeTypes } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Aside from 'datocms-react-ui/Aside';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import SplitPane from 'datocms-react-ui/SplitPane';
import Toolbar from 'datocms-react-ui/Toolbar';
import without from 'lodash-es/without';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas, useGraphView } from '@/components/GraphCanvas';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import {
  CircleExclamationIcon,
  ExportIcon,
  ModelIcon,
  RefreshIcon,
} from '@/icons';
import {
  EXPORT_GRAPH_TOO_LARGE_DESCRIPTION,
  GRAPH_NODE_THRESHOLD,
} from '@/shared/constants/graph';
import { useOverviewSplit } from '@/shared/hooks/useOverviewSplit';
import { type Formatters, useFormatters } from '@/texts';
import {
  describeSchemaReadError,
  errorCode,
  isPermissionError,
} from '@/utils/apiError';
import { debugLog } from '@/utils/debug';
import { expandSelectionWithDependencies } from '@/utils/graph/dependencies';
import {
  type AppEdge,
  type AppNode,
  edgeTypes,
  type Graph,
  type SchemaProgressUpdate,
} from '@/utils/graph/types';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { EntitiesToExportContext } from './EntitiesToExportContext';
import { ExportItemTypeNodeRenderer } from './ExportItemTypeNodeRenderer';
import { ExportLegend } from './ExportLegend';
import { ExportPluginNodeRenderer } from './ExportPluginNodeRenderer';
import {
  ExportSchemaOverview,
  useExportOverviewList,
} from './ExportSchemaOverview';
import {
  type ExportSelection,
  edgesWithExportState,
  exportSummaryText,
  summarizeExport,
} from './exportState';
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
// What a screen reader reads on a node of the graph, in place of the hint of
// React Flow
const nodeKeyboardHint =
  'Press Enter to include it in the export or to leave it out.';

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

/** Why "Export as JSON" does nothing yet, if it does nothing */
function exportDisabledReason({
  selectingDependencies,
  hasGraph,
  failed,
}: {
  selectingDependencies: boolean;
  hasGraph: boolean;
  /** The graph could not be loaded */
  failed: boolean;
}) {
  if (selectingDependencies) {
    return { reason: 'Still adding to the file.' };
  }
  if (failed) {
    return { reason: 'The diagram could not be loaded.' };
  }
  if (!hasGraph) {
    return { reason: 'The export is available once the diagram loads.' };
  }
  return undefined;
}

/**
 * The parts of the graph pane that need a ready graph: the summary of the
 * file next to the button that writes it, with the words of the pills and
 * of the presets of the overview, and the legend under the drawn graph.
 */
function graphPaneExtras({
  graph,
  showGraph,
  selection,
  count,
}: {
  graph: Graph | undefined;
  /** The graph is drawn (not too large, or drawn anyway) */
  showGraph: boolean;
  selection: ExportSelection;
  count: Formatters['count'];
}) {
  return {
    summaryNote: graph ? (
      <Toolbar.Note>
        {exportSummaryText(summarizeExport(graph.nodes, selection), count)}
      </Toolbar.Note>
    ) : null,
    legend: graph && showGraph ? <ExportLegend /> : undefined,
  };
}

/**
 * The secondary button of the toolbar. "Remove what was added" undoes "Add
 * what it uses", thus it shows only when that added something; with
 * all of it in the file otherwise, the add has nothing to do.
 */
function dependencyButton({
  hasGraph,
  failed,
  allSelected,
  addedByButton,
  single,
}: {
  hasGraph: boolean;
  /** The graph could not be loaded */
  failed: boolean;
  allSelected: boolean;
  addedByButton: boolean;
  /** The export starts from one model or block */
  single: boolean;
}) {
  if (!hasGraph) {
    return {
      remove: false,
      label: single ? 'Add what it uses' : 'Add what they use',
      disabled: {
        reason: failed
          ? 'The diagram could not be loaded.'
          : 'The diagram is still loading.',
      },
    };
  }
  if (allSelected && addedByButton) {
    return { remove: true, label: 'Remove what was added' };
  }
  return {
    remove: false,
    label: single ? 'Add what it uses' : 'Add what they use',
    disabled: allSelected
      ? {
          reason: single
            ? 'Everything it uses is already in the file.'
            : 'Everything they use is already in the file.',
        }
      : undefined,
  };
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
  const { fitGraph, showNode } = useGraphView();
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
      fitGraph(800);
    } else {
      const node = graph.nodes.find((node) =>
        pendingZoomEntity.type === 'plugin'
          ? node.type === 'plugin' &&
            node.data.plugin.id === pendingZoomEntity.id
          : node.type === 'itemType' &&
            node.data.itemType.id === pendingZoomEntity.id,
      );
      if (node) {
        showNode(node.id);
      }
    }
    setPendingZoomEntity(undefined);
  }, [fitGraph, graph, pendingZoomEntity, showGraph, showNode]);

  const graphNodes = useMemo<AppNode[]>(() => {
    if (!showGraph || !graph) {
      return [];
    }
    return graph.nodes;
  }, [graph, showGraph]);

  // The selection as the nodes, the edges, the overview and the summary read
  // it: what goes in the file, and why
  const exportSelection = useMemo<ExportSelection>(
    () => ({
      initialItemTypeIds: new Set(initialItemTypeIds),
      itemTypeIds: new Set(selectedItemTypeIds),
      pluginIds: new Set(selectedPluginIds),
      dependencyItemTypeIds: autoSelectedDependencies.itemTypeIds,
      dependencyPluginIds: autoSelectedDependencies.pluginIds,
    }),
    [
      initialItemTypeIds,
      selectedItemTypeIds,
      selectedPluginIds,
      autoSelectedDependencies,
    ],
  );

  // Each link drawn as kept in the file, or not
  const graphEdges = useMemo<AppEdge[]>(() => {
    if (!showGraph || !graph) {
      return [];
    }
    return edgesWithExportState(graph.nodes, graph.edges, exportSelection);
  }, [exportSelection, graph, showGraph]);

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

  // A click on a node, or Enter on it: it opens in the overview, and it goes
  // in or out of the file (the item types the export starts from stay in)
  const activateNode = useCallback(
    (node: AppNode) => {
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

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(
    (_, node) => activateNode(node),
    [activateNode],
  );
  const nodeKeyboard = useMemo(
    () => ({ hint: nodeKeyboardHint, onActivate: activateNode }),
    [activateNode],
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
                'The installed plugins could not be read, so some plugins it uses may be missing.',
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

      // The graph and the count show what was added: only nothing needs
      // words
      if (addedItemTypeIds.length + addedPluginIds.length === 0) {
        void ctx.notice('Nothing more to add.');
      }
    } finally {
      setSelectingDependencies(false);
    }
  }, [
    ctx,
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
      void ctx.notice('Nothing to remove.');
      return;
    }

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
  }, [autoSelectedDependencies, ctx]);

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
  // there until its rail opens it). Without a graph it has nothing to list:
  // it stays closed, with no rail, and the blank slate of the graph pane
  // gets the whole page.
  const overviewSplit = useOverviewSplit({ openWhenSmall: false });
  const split = readyGraph
    ? overviewSplit
    : {
        ...overviewSplit,
        collapse: { ...overviewSplit.collapse, open: false, hideRail: true },
      };
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
  const { summaryNote, legend } = graphPaneExtras({
    graph: readyGraph,
    showGraph,
    selection: exportSelection,
    count: format.count,
  });

  const single = initialItemTypes.length === 1;
  const title = single
    ? `Export “${initialItemTypes[0].attributes.name}”`
    : 'Export the selection';
  const loadingTitle = single
    ? `Finding what “${initialItemTypes[0].attributes.name}” uses`
    : 'Finding what the selection uses';
  // A diagram too large to draw has no boxes to click
  const howToChoose =
    graphTooLarge && !forceRenderGraph
      ? 'open an item in the overview'
      : 'click a box';
  const dependencies = dependencyButton({
    hasGraph: Boolean(readyGraph),
    failed: Boolean(error),
    allSelected: areAllDependenciesSelected,
    addedByButton:
      autoSelectedDependencies.itemTypeIds.size +
        autoSelectedDependencies.pluginIds.size >
      0,
    single,
  });

  const goBack = onClose ? (
    <Toolbar.GoBack onClick={onClose} ariaLabel={goBackLabel} />
  ) : (
    <Toolbar.GoBack to={exportPagePath} ariaLabel={goBackLabel} />
  );
  const exportDisabled = exportDisabledReason({
    selectingDependencies,
    hasGraph: Boolean(readyGraph),
    failed: Boolean(error),
  });

  return (
    <div className={s.layout}>
      <SelectedEntityContext.Provider value={selectedEntityValue}>
        <EntitiesToExportContext.Provider value={exportSelection}>
          <SplitPane primaryPane="left" {...split}>
            <Main>
              <Pane
                ariaLabel="Dependency diagram"
                header={
                  <Toolbar>
                    {goBack}
                    <Toolbar.Title
                      level={1}
                      help={
                        <Toolbar.Help>
                          {`Choose what goes in the file: ${howToChoose} to include or exclude it. Fields that link to something not exported lose that link.`}
                        </Toolbar.Help>
                      }
                    >
                      {title}
                    </Toolbar.Title>
                    <Toolbar.Spinner show={building && Boolean(graph)} />
                    <Toolbar.Space />
                    <Toolbar.Button
                      label={dependencies.label}
                      onClick={
                        dependencies.remove
                          ? handleUnselectAllDependencies
                          : handleSelectAllDependencies
                      }
                      disabled={dependencies.disabled}
                    />
                    {summaryNote}
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
                footer={legend}
              >
                <GraphArea
                  graph={graph}
                  error={error}
                  showGraph={showGraph}
                  graphNodes={graphNodes}
                  graphEdges={graphEdges}
                  nodeKeyboard={nodeKeyboard}
                  loadingTitle={loadingTitle}
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
  /** The edges, with what the export does with each link */
  graphEdges: AppEdge[];
  /** Enter on a node, as a click */
  nodeKeyboard: { hint: string; onActivate: (node: AppNode) => void };
  /** What the first build finds, for its blank slate */
  loadingTitle: string;
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
  graphEdges,
  nodeKeyboard,
  loadingTitle,
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
        title="The diagram could not be loaded"
        code={errorCode(error)}
        description={describeSchemaReadError(error)}
        actions={
          // Another attempt can't give a permission
          isPermissionError(error) ? undefined : (
            <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
          )
        }
      />
    );
  }

  // One busy signal: the spinner, with the step as its caption. The scan
  // finds more to read as it goes, thus it has no share for a bar.
  if (!graph) {
    return (
      <BlankSlate
        placement="area"
        loading
        title={loadingTitle}
        caption={prepareProgress?.label}
      />
    );
  }

  if (!showGraph) {
    return (
      <BlankSlate
        placement="area"
        icon={<ModelIcon />}
        title="The diagram is too large to show"
        description={EXPORT_GRAPH_TOO_LARGE_DESCRIPTION}
        actions={
          <Button label="Show the diagram anyway" onClick={onShowAnyway} />
        }
      />
    );
  }

  return (
    <div className={s.canvas}>
      <GraphCanvas
        graph={{ nodes: graphNodes, edges: graphEdges }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        nodeKeyboard={nodeKeyboard}
      />
    </div>
  );
}

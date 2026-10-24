import type { SchemaTypes } from '@datocms/cma-client';
import {
  type NodeMouseHandler,
  type NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import Aside from 'datocms-react-ui/Aside';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import SplitPane from 'datocms-react-ui/SplitPane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraphCanvas } from '@/components/GraphCanvas';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { CircleExclamationIcon, ImportIcon } from '@/icons';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import { useOverviewSplit } from '@/shared/hooks/useOverviewSplit';
import { type Formatters, useFormatters } from '@/texts';
import { type AppNode, edgeTypes, type Graph } from '@/utils/graph/types';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
import ConflictsManager, { useConflictsOverviewList } from './ConflictsManager';
import { useImportReview } from './ConflictsManager/useImportReview';
import { ImportItemTypeNodeRenderer } from './ImportItemTypeNodeRenderer';
import { ImportPluginNodeRenderer } from './ImportPluginNodeRenderer';
import { useSkippedItemsAndPluginIds, useSubmitGuard } from './ResolutionsForm';
import s from './review.module.css';

// Map React Flow node types to the dedicated renderers for import graphs.
const nodeTypes: NodeTypes = {
  itemType: ImportItemTypeNodeRenderer,
  plugin: ImportPluginNodeRenderer,
};

type FocusedEntity = SchemaTypes.ItemType | SchemaTypes.Plugin;

type Props = {
  exportSchema: ExportSchema;
  /** The name of the file, or the title of the shared export */
  label: string;
  /** Asks to drop the file and its choices, to choose another file */
  onRequestClose?: () => void;
};

/** "No conflicts to resolve", "1 conflict to resolve", "3 conflicts to resolve" */
function describeConflicts(format: Formatters, count: number) {
  return count === 0
    ? 'No conflicts to resolve'
    : format.count(count, 'conflict to resolve', 'conflicts to resolve');
}

/**
 * The review of an import: the graph of the file at the left, the overview of
 * its elements at the right, where the user resolves the conflicts. The
 * Import button of the toolbar submits the resolutions form around it.
 */
export function Inner({ exportSchema, label, onRequestClose }: Props) {
  const { fitBounds, fitView, setNodes, setEdges } = useReactFlow();
  const format = useFormatters();
  const review = useImportReview(exportSchema);
  // Enter in a rename field never imports while the button is disabled
  useSubmitGuard(review.proceedDisabled);

  const { skippedItemTypeIds } = useSkippedItemsAndPluginIds();
  const skippedItemTypeIdsKey = useMemo(
    () => JSON.stringify(skippedItemTypeIds),
    [skippedItemTypeIds],
  );

  const [graph, setGraph] = useState<Graph | undefined>();
  const [graphError, setGraphError] = useState<Error | undefined>();
  const [forceRenderGraph, setForceRenderGraph] = useState(false);
  const [pendingZoomEntity, setPendingZoomEntity] = useState<
    FocusedEntity | null | undefined
  >(undefined);

  // Rebuild the graph when the export document or skip lists change.
  useEffect(() => {
    let cancelled = false;
    const itemTypeIdsToSkip = JSON.parse(skippedItemTypeIdsKey) as string[];

    async function run() {
      try {
        setGraphError(undefined);
        const nextGraph = await buildGraphFromExportDoc(
          exportSchema,
          itemTypeIdsToSkip,
          () => cancelled,
        );
        if (!cancelled) setGraph(nextGraph);
      } catch (error) {
        if (cancelled) return;
        setGraph(undefined);
        setGraphError(
          error instanceof Error ? error : new Error('Unknown error'),
        );
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [exportSchema, skippedItemTypeIdsKey]);

  const [selectedEntity, setSelectedEntity] = useState<
    FocusedEntity | undefined
  >();

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback((_, node) => {
    setSelectedEntity(
      node.type === 'itemType'
        ? node.data.itemType
        : node.type === 'plugin'
          ? node.data.plugin
          : undefined,
    );
  }, []);

  // A click on the empty canvas releases the focus
  const onPaneClick = useCallback(() => {
    setSelectedEntity(undefined);
  }, []);

  const totalPotentialNodes =
    exportSchema.itemTypes.length + exportSchema.plugins.length;

  const graphTooLarge =
    !!graph &&
    (graph.nodes.length > GRAPH_NODE_THRESHOLD ||
      totalPotentialNodes > GRAPH_NODE_THRESHOLD);

  useEffect(() => {
    if (!graphTooLarge && forceRenderGraph) {
      setForceRenderGraph(false);
    }
  }, [graphTooLarge, forceRenderGraph]);

  // Prefer the interactive graph for small/medium selections; allow manual override otherwise.
  const showGraph = !!graph && (!graphTooLarge || forceRenderGraph);

  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }

    if (!showGraph) {
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
  }, [graph, showGraph, setNodes, setEdges]);

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

  // Zoom the viewport to the full graph once React Flow has mounted and the graph is visible.
  useEffect(() => {
    if (!showGraph) {
      return;
    }
    const timeout = window.setTimeout(() => fitView(), 100);
    return () => window.clearTimeout(timeout);
  }, [fitView, showGraph]);

  const handleSelectEntity = useCallback(
    (newEntity: FocusedEntity | undefined, zoomIn?: boolean) => {
      setSelectedEntity(newEntity);

      if (!zoomIn) {
        return;
      }

      setPendingZoomEntity(newEntity ?? null);
    },
    [],
  );

  const selectedEntityValue = useMemo(
    () => ({ entity: selectedEntity, set: handleSelectEntity }),
    [selectedEntity, handleSelectEntity],
  );

  // The overview: beside the graph, or over it in a narrow frame, where it
  // starts open too, because it holds the conflicts to resolve
  const overviewSplit = useOverviewSplit({ openWhenSmall: true });
  const overviewList = useConflictsOverviewList(review, selectedEntity);

  return (
    <SelectedEntityContext.Provider value={selectedEntityValue}>
      <SplitPane primaryPane="left" {...overviewSplit}>
        <Main>
          <Pane
            ariaLabel="Dependency graph"
            header={
              <Toolbar>
                {onRequestClose ? (
                  <Toolbar.GoBack
                    onClick={onRequestClose}
                    ariaLabel="Choose another file"
                  />
                ) : null}
                <Toolbar.Title
                  level={1}
                  help={
                    <Toolbar.Help>
                      The import adds the models, blocks and plugins of the file
                      to this environment, and never changes the existing ones.
                      Resolve the conflicts in the overview, then import.
                    </Toolbar.Help>
                  }
                >
                  {`Import “${label}”`}
                </Toolbar.Title>
                <Toolbar.Subtitle>
                  {describeConflicts(format, review.unresolvedCount)}
                </Toolbar.Subtitle>
                <Toolbar.Space />
                <Toolbar.Button
                  tone="primary"
                  submit
                  label="Import"
                  busy={review.submitting}
                  disabled={
                    review.proceedDisabledReason
                      ? { reason: review.proceedDisabledReason }
                      : undefined
                  }
                />
              </Toolbar>
            }
          >
            <GraphArea
              graph={graph}
              error={graphError}
              showGraph={showGraph}
              nodeCount={Math.max(
                graph?.nodes.length ?? 0,
                totalPotentialNodes,
              )}
              onShowAnyway={() => setForceRenderGraph(true)}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onChooseAnotherFile={onRequestClose}
            />
          </Pane>
        </Main>
        <Aside ariaLabel="Schema overview">
          <ConflictsManager review={review} list={overviewList} />
        </Aside>
      </SplitPane>
    </SelectedEntityContext.Provider>
  );
}

type GraphAreaProps = {
  graph: Graph | undefined;
  error: Error | undefined;
  /** The graph is small enough, or the user asked to draw it anyway */
  showGraph: boolean;
  /** The size of the graph, for the message of a graph too large to draw */
  nodeCount: number;
  onShowAnyway: () => void;
  onNodeClick: NodeMouseHandler<AppNode>;
  onPaneClick: () => void;
  /** The next step after a failed build */
  onChooseAnotherFile?: () => void;
};

/**
 * The content of the graph pane: the first build, the failed build, the graph
 * too large to draw, or the read-only canvas. Rebuilds (after a decision to
 * reuse a model) keep the last graph on screen.
 */
function GraphArea({
  graph,
  error,
  showGraph,
  nodeCount,
  onShowAnyway,
  onNodeClick,
  onPaneClick,
  onChooseAnotherFile,
}: GraphAreaProps) {
  if (error) {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="The graph could not be drawn"
        code={error.message}
        description="The file may be damaged. Choose another file to try again."
        actions={
          onChooseAnotherFile ? (
            <Button label="Choose another file" onClick={onChooseAnotherFile} />
          ) : null
        }
      />
    );
  }

  if (!graph) {
    return <BlankSlate placement="area" loading title="Drawing the graph" />;
  }

  if (!showGraph) {
    return (
      <BlankSlate
        placement="area"
        icon={<ImportIcon />}
        title="The graph is too large to show"
        description={{
          id: 'importExportSchema.graphTooLarge',
          values: { count: nodeCount },
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
        graph={graph}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
      />
    </div>
  );
}

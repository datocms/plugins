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
import isEqual from 'lodash-es/isEqual';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-final-form';
import { GraphCanvas, useGraphView } from '@/components/GraphCanvas';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { CircleExclamationIcon, ModelIcon } from '@/icons';
import {
  GRAPH_NODE_THRESHOLD,
  GRAPH_TOO_LARGE_DESCRIPTION,
} from '@/shared/constants/graph';
import { useOverviewSplit } from '@/shared/hooks/useOverviewSplit';
import { type Formatters, useFormatters } from '@/texts';
import { errorCode } from '@/utils/apiError';
import { type AppNode, edgeTypes, type Graph } from '@/utils/graph/types';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
import ConflictsManager, { useConflictsOverviewList } from './ConflictsManager';
import { UnresolvedConflictsContext } from './ConflictsManager/ConflictsContext';
import { useImportReview } from './ConflictsManager/useImportReview';
import { ImportItemTypeNodeRenderer } from './ImportItemTypeNodeRenderer';
import { ImportPluginNodeRenderer } from './ImportPluginNodeRenderer';
import {
  type FormValues,
  useSkippedItemsAndPluginIds,
  useSubmitGuard,
} from './ResolutionsForm';
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
  /**
   * Asks to drop the file and its choices, to choose another file. It asks
   * first only when the user made choices.
   */
  onRequestClose?: (hasChoices: boolean) => void;
};

/** "Ready to import", "1 conflict to resolve", "3 conflicts to resolve" */
function describeConflicts(format: Formatters, count: number) {
  return count === 0
    ? 'Ready to import'
    : format.count(count, 'conflict to resolve', 'conflicts to resolve');
}

/**
 * The review of an import: the graph of the file at the left, the overview of
 * its elements at the right, where the user resolves the conflicts. The
 * Import button of the toolbar submits the resolutions form around it.
 */
export function Inner({ exportSchema, label, onRequestClose }: Props) {
  const { setNodes, setEdges } = useReactFlow();
  const { fitGraph, showNode } = useGraphView();
  const format = useFormatters();
  const review = useImportReview(exportSchema);
  const form = useForm<FormValues>();
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
  // starts open while it holds conflicts to resolve. Without any, it starts
  // closed there, and the Import button at the right end of the toolbar
  // shows.
  const overviewSplit = useOverviewSplit({
    openWhenSmall: review.hasUnresolvedConflicts,
  });
  const overviewList = useConflictsOverviewList(review, selectedEntity);

  // The values, not the dirty state of the form: the fields of a closed
  // item are not registered, thus their choices don't count as dirty
  const requestClose = onRequestClose
    ? () => {
        const { values, initialValues } = form.getState();
        onRequestClose(!isEqual(values, initialValues));
      }
    : undefined;

  return (
    <SelectedEntityContext.Provider value={selectedEntityValue}>
      <UnresolvedConflictsContext.Provider value={review.unresolvedIds}>
        <SplitPane primaryPane="left" {...overviewSplit}>
          <Main>
            <Pane
              ariaLabel="Dependency diagram"
              header={
                <Toolbar>
                  {requestClose ? (
                    <Toolbar.GoBack
                      onClick={requestClose}
                      ariaLabel="Choose another file"
                    />
                  ) : null}
                  <Toolbar.Title
                    level={1}
                    help={
                      <Toolbar.Help>
                        The import adds the models, blocks and plugins of the
                        file to this environment, and never changes the existing
                        ones.
                        {review.hasConflicts
                          ? ' Click a conflict to choose how to import it.'
                          : null}
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
                onShowAnyway={() => setForceRenderGraph(true)}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onChooseAnotherFile={requestClose}
              />
            </Pane>
          </Main>
          <Aside ariaLabel="Schema overview">
            <ConflictsManager review={review} list={overviewList} />
          </Aside>
        </SplitPane>
      </UnresolvedConflictsContext.Provider>
    </SelectedEntityContext.Provider>
  );
}

type GraphAreaProps = {
  graph: Graph | undefined;
  error: Error | undefined;
  /** The graph is small enough, or the user asked to draw it anyway */
  showGraph: boolean;
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
        title="The diagram could not be drawn"
        code={errorCode(error)}
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
    return <BlankSlate placement="area" loading title="Drawing the diagram" />;
  }

  if (!showGraph) {
    return (
      <BlankSlate
        placement="area"
        icon={<ModelIcon />}
        title="The diagram is too large to show"
        description={GRAPH_TOO_LARGE_DESCRIPTION}
        actions={
          <Button label="Show the diagram anyway" onClick={onShowAnyway} />
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
      />
    </div>
  );
}

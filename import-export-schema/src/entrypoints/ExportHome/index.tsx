/**
 * Export navigation flow:
 *
 *  ┌──────────┐   onSelectModels    ┌────────────┐   onStart (with selection)    ┌──────────┐
 *  │ Landing  │ ──────────────────▶ │ Selection  │ ─────────────────────────────▶│  Graph   │
 *  └──────────┘   onExportAll runs  └────────────┘   onBack ⟲ Landing            └──────────┘
 */
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useId, useState } from 'react';
import { ExportLandingPanel } from '@/components/ExportLandingPanel';
import { ExportSelectionPanel } from '@/components/ExportSelectionPanel';
import { TaskOverlayStack } from '@/components/TaskOverlayStack';
import { useExportAllHandler } from '@/shared/hooks/useExportAllHandler';
import { useExportSelection } from '@/shared/hooks/useExportSelection';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useSchemaExportTask } from '@/shared/hooks/useSchemaExportTask';
import {
  useLongTask,
  type UseLongTaskResult,
} from '@/shared/tasks/useLongTask';
import ExportInner from '../ExportPage/Inner';

type Props = {
  ctx: RenderPageCtx;
};

type ExportView = 'landing' | 'selection' | 'graph';

type OverlayItems = Parameters<typeof TaskOverlayStack>[0]['items'];

type BuildOverlayItemsArgs = {
  exportAllTask: UseLongTaskResult;
  exportPreparingTask: UseLongTaskResult;
  exportSelectionTask: UseLongTaskResult;
  exportPreparingPercent: number;
};

// Keep overlay wiring centralized so the JSX tree stays readable and we can reuse
// the same overlay definitions if we ever need them elsewhere (e.g. tests).
function buildOverlayItems({
  exportAllTask,
  exportPreparingTask,
  exportSelectionTask,
  exportPreparingPercent,
}: BuildOverlayItemsArgs): OverlayItems {
  return [
    {
      id: 'export-all',
      task: exportAllTask,
      title: 'Exporting entire schema',
      subtitle: 'Sit tight, we’re gathering models, blocks, and plugins…',
      ariaLabel: 'Export in progress',
      progressLabel: (progress) =>
        progress.label ?? 'Loading project schema…',
      cancel: () => ({
        label: 'Cancel export',
        intent: exportAllTask.state.cancelRequested ? 'muted' : 'negative',
        disabled: exportAllTask.state.cancelRequested,
        onCancel: () => exportAllTask.controller.requestCancel(),
      }),
    },
    {
      id: 'export-preparing',
      task: exportPreparingTask,
      title: 'Preparing export',
      subtitle: 'Sit tight, we’re setting up your models, blocks, and plugins…',
      ariaLabel: 'Preparing export',
      progressLabel: (progress) => progress.label ?? 'Preparing export…',
      percentOverride: exportPreparingPercent,
    },
    {
      id: 'export-selection',
      task: exportSelectionTask,
      title: 'Exporting selection',
      subtitle: 'Sit tight, we’re gathering models, blocks, and plugins…',
      ariaLabel: 'Export in progress',
      progressLabel: (progress) => progress.label ?? 'Preparing export…',
      cancel: () => ({
        label: 'Cancel export',
        intent: exportSelectionTask.state.cancelRequested ? 'muted' : 'negative',
        disabled: exportSelectionTask.state.cancelRequested,
        onCancel: () => exportSelectionTask.controller.requestCancel(),
      }),
    },
  ];
}

/**
 * Landing page for the export workflow. Guides the user from the initial action
 * choice into the detailed graph view while coordinating the long-running tasks.
 */
export default function ExportHome({ ctx }: Props) {
  // ----- Schema + selection state -----
  // Seed the selection autocomplete and schema data used by every subview; we
  // establish this once so each panel can rely on the same shared data.
  const exportInitialSelectId = useId();
  const projectSchema = useProjectSchema(ctx);

  const {
    allItemTypes,
    selectedIds: exportInitialItemTypeIds,
    selectedItemTypes: exportInitialItemTypes,
    setSelectedIds: setExportInitialItemTypeIds,
  } = useExportSelection({ schema: projectSchema });

  const [view, setView] = useState<ExportView>('landing');

  // ----- Long-running tasks -----
  // The export flow manipulates three distinct tasks (export all, prepare graph,
  // targeted export). 
  const exportAllTask = useLongTask();
  const exportPreparingTask = useLongTask();
  const { task: exportSelectionTask, runExport: runSelectionExport } =
    useSchemaExportTask({
      schema: projectSchema,
      ctx,
    });

  // Smoothed percent for preparing overlay to avoid jitter and changing max
  const [exportPreparingPercent, setExportPreparingPercent] = useState(0.1);

  const runExportAll = useExportAllHandler({
    ctx,
    schema: projectSchema,
    task: exportAllTask.controller,
  });

  // Determine once whether the user has made a selection and keep the root item
  // handy so downstream callbacks stay simple.
  const hasSelection = exportInitialItemTypeIds.length > 0;
  const rootItemTypeId = hasSelection ? exportInitialItemTypeIds[0] : undefined;

  const handleLandingSelect = () => {
    setView('selection');
  };

  const handleBackToLanding = () => {
    setView('landing');
  };

  const handleStartSelection = () => {
    if (!hasSelection) {
      return;
    }

    exportPreparingTask.controller.start({
      label: 'Preparing export…',
    });
    setExportPreparingPercent(0.1);
    setView('graph');
  };

  const handleGraphPrepared = () => {
    setExportPreparingPercent(1);
    exportPreparingTask.controller.complete({
      label: 'Graph prepared',
    });
  };

  const handlePrepareProgress = (progress: {
    done: number;
    total: number;
    label: string;
    phase?: 'scan' | 'build';
  }) => {
    if (exportPreparingTask.state.status !== 'running') {
      exportPreparingTask.controller.start(progress);
    } else {
      exportPreparingTask.controller.setProgress(progress);
    }

    // When the task cannot provide a total, gently advance toward 25% so the
    // overlay feels alive; otherwise map the true progress into the remaining
    // 75% so the visual bar always pushes forward. This may seem like a hack,
    // but it's the best way to keep the overlay feeling alive while the task is running.
    const hasFixedTotal = (progress.total ?? 0) > 0;
    const raw = hasFixedTotal ? progress.done / progress.total : 0;

    if (!hasFixedTotal) {
      setExportPreparingPercent((prev) =>
        Math.min(0.25, Math.max(prev, prev + 0.02)),
      );
    } else {
      const mapped = 0.25 + raw * 0.75;
      setExportPreparingPercent((prev) =>
        Math.max(prev, Math.min(1, mapped)),
      );
    }
  };

  const handleCloseGraph = () => {
    setView('selection');
    setExportPreparingPercent(0.1);
    exportPreparingTask.controller.reset();
  };

  const handleSelectionExport = (itemTypeIds: string[], pluginIds: string[]) => {
    if (!rootItemTypeId) {
      return;
    }

    void runSelectionExport({
      rootItemTypeId,
      itemTypeIds,
      pluginIds,
    });
  };

  // The view map condenses our conditional rendering into a single lookup and
  // keeps each subview’s JSX colocated with the handlers it consumes.
  const viewContent: Record<ExportView, JSX.Element> = {
    landing: (
      <ExportLandingPanel
        onSelectModels={handleLandingSelect}
        onExportAll={runExportAll}
        exportAllDisabled={exportAllTask.state.status === 'running'}
      />
    ),
    selection: (
      <ExportSelectionPanel
        selectId={exportInitialSelectId}
        itemTypes={allItemTypes}
        selectedIds={exportInitialItemTypeIds}
        onSelectedIdsChange={setExportInitialItemTypeIds}
        onStart={handleStartSelection}
        onBack={handleBackToLanding}
        startDisabled={!hasSelection}
      />
    ),
    graph: (
      <ExportInner
        initialItemTypes={exportInitialItemTypes}
        schema={projectSchema}
        onGraphPrepared={handleGraphPrepared}
        onPrepareProgress={handlePrepareProgress}
        onClose={handleCloseGraph}
        onExport={handleSelectionExport}
      />
    ),
  };

  // Precompute overlay config outside the JSX so the render tree remains easy to
  // scan and future overlays only require extending this list.
  const overlayItems = buildOverlayItems({
    exportAllTask,
    exportPreparingTask,
    exportSelectionTask,
    exportPreparingPercent,
  });

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          <div className="page__content">
            <div className="blank-slate">{viewContent[view]}</div>
          </div>
        </div>
      </ReactFlowProvider>

      {/* Blocking overlay while exporting all */}
      <TaskOverlayStack items={overlayItems} />
    </Canvas>
  );
}

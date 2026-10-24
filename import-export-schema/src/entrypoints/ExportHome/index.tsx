/**
 * Export navigation flow:
 *
 *  ┌────────────┐   Continue (with picks)   ┌──────────┐
 *  │ Start step │ ─────────────────────────▶│  Graph   │
 *  └────────────┘   Back ⟲ (picks kept)     └──────────┘
 *        │
 *        └── Export everything: confirm, then export the entire schema
 */
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Main from 'datocms-react-ui/Main';
import { Page } from 'datocms-react-ui/Page';
import Pane from 'datocms-react-ui/Pane';
import SettingsList from 'datocms-react-ui/SettingsList';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useState } from 'react';
import { ExportSelectionPanel } from '@/components/ExportSelectionPanel';
import { TaskOverlayStack } from '@/components/TaskOverlayStack';
import { ExportIcon } from '@/icons';
import { useExportAllHandler } from '@/shared/hooks/useExportAllHandler';
import { useExportSelection } from '@/shared/hooks/useExportSelection';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useSchemaExportTask } from '@/shared/hooks/useSchemaExportTask';
import {
  type LongTaskState,
  type UseLongTaskResult,
  useLongTask,
} from '@/shared/tasks/useLongTask';
import ExportInner from '../ExportPage/Inner';
import s from '../ExportPage/styles.module.css';

type Props = {
  ctx: RenderPageCtx;
};

type ExportView = 'start' | 'graph';

type OverlayItems = Parameters<typeof TaskOverlayStack>[0]['items'];

function isTaskActive(task: UseLongTaskResult) {
  return task.state.status === 'running' || task.state.status === 'cancelling';
}

/** The line of the export dialog once its Cancel was used */
function describeExportCancel(state: LongTaskState) {
  return state.cancelRequested
    ? 'Stopping the export after the current step…'
    : undefined;
}

// Keep the dialog wiring in one place so the JSX tree stays readable.
function buildOverlayItems(
  exportAllTask: UseLongTaskResult,
  exportSelectionTask: UseLongTaskResult,
): OverlayItems {
  return [
    {
      id: 'export-all',
      task: exportAllTask,
      title: 'Exporting the entire schema',
      subtitle: describeExportCancel,
      progressLabel: (progress) =>
        progress.label ?? 'Loading the project schema…',
      cancel: (state) =>
        state.cancelRequested
          ? undefined
          : { onCancel: () => exportAllTask.controller.requestCancel() },
    },
    {
      id: 'export-selection',
      task: exportSelectionTask,
      title: 'Exporting the selection',
      subtitle: describeExportCancel,
      progressLabel: (progress) => progress.label ?? 'Preparing the export…',
      cancel: (state) =>
        state.cancelRequested
          ? undefined
          : { onCancel: () => exportSelectionTask.controller.requestCancel() },
    },
  ];
}

/**
 * The export page opened from the settings sidebar: the start step picks the
 * models and blocks of the graph, or exports the entire schema at once.
 */
export default function ExportHome({ ctx }: Props) {
  const projectSchema = useProjectSchema(ctx);

  const {
    allItemTypes,
    error: itemTypesError,
    retry: retryItemTypes,
    selectedIds,
    selectedItemTypes,
    setSelectedIds,
  } = useExportSelection({ schema: projectSchema });

  const [view, setView] = useState<ExportView>('start');

  const exportAllTask = useLongTask();
  const { task: exportSelectionTask, runExport: runSelectionExport } =
    useSchemaExportTask({
      schema: projectSchema,
      ctx,
    });

  const runExportAll = useExportAllHandler({
    ctx,
    schema: projectSchema,
    task: exportAllTask.controller,
  });

  // The first pick is the root item type of the export.
  const rootItemTypeId = selectedIds[0];

  const handleContinue = () => {
    if (selectedIds.length === 0) {
      return;
    }
    setView('graph');
  };

  const handleSelectionExport = (
    itemTypeIds: string[],
    pluginIds: string[],
  ) => {
    if (!rootItemTypeId) {
      return;
    }

    void runSelectionExport({
      rootItemTypeId,
      itemTypeIds,
      pluginIds,
    });
  };

  return (
    <ReactFlowProvider>
      {view === 'graph' ? (
        <ExportInner
          initialItemTypes={selectedItemTypes}
          schema={projectSchema}
          onClose={() => setView('start')}
          onExport={handleSelectionExport}
        />
      ) : (
        <Main className={s.layout}>
          <Pane
            header={
              <Pane.Header>
                <Pane.Header.Title
                  level={1}
                  help={
                    <Toolbar.Help>
                      Export models, block models and plugins as a JSON file.
                      Import it in another project or environment with this
                      plugin.
                    </Toolbar.Help>
                  }
                >
                  Export schema
                </Pane.Header.Title>
              </Pane.Header>
            }
          >
            <Page>
              <Page.Content>
                <ExportSelectionPanel
                  itemTypes={allItemTypes}
                  error={itemTypesError}
                  onRetry={retryItemTypes}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={setSelectedIds}
                  onContinue={handleContinue}
                />
                <Page.Group title="Entire schema">
                  <SettingsList>
                    <SettingsList.Row
                      title="Export everything"
                      description="All the models, block models and plugins of this environment, in one JSON file."
                      action={
                        <Button
                          tone="ghost"
                          icon={ExportIcon}
                          label="Export"
                          onClick={() => {
                            void runExportAll();
                          }}
                          disabled={
                            isTaskActive(exportAllTask)
                              ? { reason: 'The export is running.' }
                              : undefined
                          }
                        />
                      }
                    />
                  </SettingsList>
                </Page.Group>
              </Page.Content>
            </Page>
          </Pane>
        </Main>
      )}

      {/* The dialogs of the exports: they block the page while they run */}
      <TaskOverlayStack
        items={buildOverlayItems(exportAllTask, exportSelectionTask)}
      />
    </ReactFlowProvider>
  );
}

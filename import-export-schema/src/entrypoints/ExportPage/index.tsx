import type { SchemaTypes } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Main from 'datocms-react-ui/Main';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TaskOverlayStack } from '@/components/TaskOverlayStack';
import { CircleExclamationIcon } from '@/icons';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useSchemaExportTask } from '@/shared/hooks/useSchemaExportTask';
import type { LongTaskState } from '@/shared/tasks/useLongTask';
import { errorCode } from '@/utils/apiError';
import { debugLog } from '@/utils/debug';
import Inner from './Inner';
import s from './styles.module.css';

type Props = {
  ctx: RenderPageCtx;
  initialItemTypeId: string;
};

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/** The line of the export dialog once its Cancel was used */
function describeExportCancel(state: LongTaskState) {
  return state.cancelRequested
    ? 'Stopping the export after the current step…'
    : undefined;
}

/**
 * The export page opened from the menu of a model ("Export as JSON…"): it
 * loads the model, then shows its dependency graph.
 */
export default function ExportPage({ ctx, initialItemTypeId }: Props) {
  const schema = useProjectSchema(ctx);

  const [initialItemType, setInitialItemType] = useState<
    SchemaTypes.ItemType | undefined
  >();
  // The failed load of a model, with its ID
  const [loadFailure, setLoadFailure] = useState<
    { itemTypeId: string; error: Error } | undefined
  >();
  const { task: exportTask, runExport } = useSchemaExportTask({
    schema,
    ctx,
  });

  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const exportPagePath = `${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/export`;

  // Preload installed plugin IDs once to avoid network calls during selection
  const [installedPluginIds, setInstalledPluginIds] = useState<
    Set<string> | undefined
  >();
  // Pre-fetch plugin IDs so dependency expansion can quickly filter installed extensions.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const plugins = await schema.getAllPlugins();
        if (active) setInstalledPluginIds(new Set(plugins.map((p) => p.id)));
      } catch (_) {
        // ignore; selection will just skip plugin dependencies when unknown
      }
    })();
    return () => {
      active = false;
    };
  }, [schema]);

  const [lastPreparedForId, setLastPreparedForId] = useState<
    string | undefined
  >(undefined);
  // Load the model the export starts from, the first time we enter for it.
  useEffect(() => {
    let active = true;

    schema.getItemTypeById(initialItemTypeId).then(
      (itemType) => {
        if (!active) return;

        setInitialItemType(itemType);

        if (lastPreparedForId !== initialItemTypeId) {
          debugLog('ExportPage preparing start', { initialItemTypeId });
          setLastPreparedForId(initialItemTypeId);
        }
      },
      (error: unknown) => {
        if (!active) return;

        debugLog('ExportPage failed to load initial item type', error);
        setLoadFailure({
          itemTypeId: initialItemTypeId,
          error: toError(error),
        });
      },
    );

    return () => {
      active = false;
    };
  }, [schema, initialItemTypeId, lastPreparedForId]);

  // The model of the current URL: after a change of the URL, the previous
  // model does not show while the next one loads
  const currentItemType =
    initialItemType?.id === initialItemTypeId ? initialItemType : undefined;
  const loadError =
    loadFailure?.itemTypeId === initialItemTypeId
      ? loadFailure.error
      : undefined;

  // A stable list, thus the graph builds again only when the model changes
  const initialItemTypes = useMemo(
    () => (currentItemType ? [currentItemType] : []),
    [currentItemType],
  );

  const handleExport = useCallback(
    (itemTypeIds: string[], pluginIds: string[]) => {
      void runExport({
        rootItemTypeId: initialItemTypeId,
        itemTypeIds,
        pluginIds,
      });
    },
    [initialItemTypeId, runExport],
  );

  if (loadError && !currentItemType) {
    return (
      <Main className={s.layout}>
        <BlankSlate
          placement="area"
          titleLevel={1}
          error
          icon={<CircleExclamationIcon />}
          title="The model could not be loaded"
          code={errorCode(loadError)}
          description="It may have been deleted, or you may not have access to it."
          actions={<Button label="Choose what to export" to={exportPagePath} />}
        />
      </Main>
    );
  }

  if (!currentItemType) {
    return (
      <Main className={s.layout}>
        <BlankSlate
          placement="area"
          titleLevel={1}
          loading
          title="Loading the model"
        />
      </Main>
    );
  }

  return (
    <ReactFlowProvider>
      <Inner
        key={initialItemTypeId}
        initialItemTypes={initialItemTypes}
        schema={schema}
        onExport={handleExport}
        installedPluginIds={installedPluginIds}
      />
      {/* The dialog of the export: it blocks the page while it runs */}
      <TaskOverlayStack
        items={[
          {
            id: 'export-selection',
            task: exportTask,
            // The title of the page names the model: so does the dialog
            title: `Exporting “${currentItemType.attributes.name}”`,
            subtitle: describeExportCancel,
            progressLabel: (progress) =>
              progress.label ?? 'Preparing the export…',
            cancel: (state) =>
              state.cancelRequested
                ? undefined
                : { onCancel: () => exportTask.controller.requestCancel() },
          },
        ]}
      />
    </ReactFlowProvider>
  );
}

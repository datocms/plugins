import { ProjectSchema } from '@/utils/ProjectSchema';
import { downloadJSON } from '@/utils/downloadJson';
import { type SchemaTypes, buildClient } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import Inner from './Inner';
import buildExportDoc from './buildExportDoc';

type Props = {
  ctx: RenderPageCtx;
  initialItemTypeId: string;
};

export default function ExportPage({ ctx, initialItemTypeId }: Props) {
  const [initialItemType, setInitialItemType] = useState<
    SchemaTypes.ItemType | undefined
  >();

  const schema = useMemo(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken!,
      environment: ctx.environment,
    });
    return new ProjectSchema(client);
  }, [ctx.currentUserAccessToken, ctx.environment]);

  useEffect(() => {
    async function run() {
      const itemType = await schema.getItemTypeById(initialItemTypeId);
      setInitialItemType(itemType);
    }

    run();
  }, [schema, initialItemTypeId]);

  async function handleExport(itemTypeIds: string[], pluginIds: string[]) {
    const exportDoc = await buildExportDoc(
      schema,
      initialItemTypeId,
      itemTypeIds,
      pluginIds,
    );
    downloadJSON(exportDoc, { fileName: 'export.json', prettify: true });
    ctx.notice('Export completed with success!');
    ctx.navigateTo(
      `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import-export`,
    );
  }

  if (!initialItemType) {
    return (
      <div className="page">
        <div className="page__content">
          <Spinner size={60} placement="centered" />
        </div>
      </div>
    );
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <ReactFlowProvider>
        <Inner
          key={initialItemTypeId}
          initialItemType={initialItemType}
          schema={schema}
          onExport={handleExport}
        />
      </ReactFlowProvider>
    </Canvas>
  );
}

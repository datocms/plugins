import { buildClient, type SchemaTypes } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import { downloadJSON } from '@/utils/downloadJson';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import ExportGraphRenderer from './ExportGraphRenderer';
import buildExportDoc from './buildExportDoc';
import { useEffect, useMemo } from 'react';
import { ItemTypeManager } from '@/utils/itemTypeManager';

type Props = {
  ctx: RenderModalCtx;
};

export default function ExportModal({ ctx }: Props) {
  const initialItemType = ctx.parameters.itemType as SchemaTypes.ItemType;

  const schema = useMemo(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken!,
      environment: ctx.environment,
    });
    return new ItemTypeManager(client);
  }, [ctx.currentUserAccessToken, ctx.environment]);

  async function handleExport(itemTypeIds: string[], pluginIds: string[]) {
    const exportDoc = await buildExportDoc(schema, itemTypeIds, pluginIds);
    downloadJSON(exportDoc, { fileName: 'export.json', prettify: true });
  }

  useEffect(() => {
    ctx.setHeight(1000);
  }, []);

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <ReactFlowProvider>
        <ExportGraphRenderer
          key={initialItemType.id}
          initialItemType={initialItemType}
          schema={schema}
          onExport={handleExport}
        />
      </ReactFlowProvider>
    </Canvas>
  );
}

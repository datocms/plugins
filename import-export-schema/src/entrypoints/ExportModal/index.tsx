import { downloadJSON } from '@/utils/downloadJson';
import { ItemTypeManager } from '@/utils/itemTypeManager';
import { type SchemaTypes, buildClient } from '@datocms/cma-client';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import ExportGraphRenderer from './ExportGraphRenderer';
import buildExportDoc from './buildExportDoc';

type Props = {
  ctx: RenderModalCtx;
};

export default function ExportModal({ ctx }: Props) {
  const initialItemTypeId = (ctx.parameters.itemType as SchemaTypes.ItemType)
    .id;

  const [initialItemType, setInitialItemType] = useState<
    SchemaTypes.ItemType | undefined
  >();

  const schema = useMemo(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken!,
      environment: ctx.environment,
    });
    return new ItemTypeManager(client);
  }, [ctx.currentUserAccessToken, ctx.environment]);

  useEffect(() => {
    async function run() {
      const itemType = await schema.getItemTypeById(initialItemTypeId);
      setInitialItemType(itemType);
    }

    run();
  }, [schema, initialItemTypeId]);

  async function handleExport(itemTypeIds: string[], pluginIds: string[]) {
    const exportDoc = await buildExportDoc(schema, itemTypeIds, pluginIds);
    downloadJSON(exportDoc, { fileName: 'export.json', prettify: true });
  }

  useEffect(() => {
    ctx.setHeight(600);
  }, []);

  if (!initialItemType) {
    return null;
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <ReactFlowProvider>
        <ExportGraphRenderer
          key={initialItemTypeId}
          initialItemType={initialItemType}
          schema={schema}
          onExport={handleExport}
        />
      </ReactFlowProvider>
    </Canvas>
  );
}

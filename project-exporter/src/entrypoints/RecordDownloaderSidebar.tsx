import { buildClient } from '@datocms/cma-client-browser';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useState } from 'react';
import downloadRecordsFile from '../utils/downloadRecordsFile';
import {
  buildRecordExportEnvelope,
  fetchProjectConfigurationExport,
} from '../utils/recordExport';
import type { AvailableFormats } from './ConfigScreen';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

export default function RecordDownloaderSidebar({ ctx }: PropTypes) {
  const [isLoading, setIsLoading] = useState(false);

  const downloadTxtFile = async () => {
    if (!ctx.item) {
      ctx.alert('Save the record before trying to download it!');
      return;
    }

    const selectedFormat =
      (ctx.plugin.attributes.parameters.format as AvailableFormats) ?? 'JSON';
    const recordValue = ctx.item;

    if (selectedFormat !== 'JSON') {
      await downloadRecordsFile([recordValue], selectedFormat);
      return;
    }

    if (!ctx.currentUserAccessToken) {
      ctx.alert(
        'A user access token is required to export JSON metadata for this record.',
      );
      return;
    }

    setIsLoading(true);

    try {
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken,
        environment: ctx.environment,
      });

      const itemTypes = await client.itemTypes.list();
      const fields = (
        await Promise.all(
          itemTypes.map((model) => client.fields.list(model.id)),
        )
      ).flat();
      const { projectConfiguration, siteInfo } =
        await fetchProjectConfigurationExport({
          client,
          itemTypes: itemTypes as unknown as Record<string, unknown>[],
          records: [recordValue as unknown as Record<string, unknown>],
        });

      const exportEnvelope = buildRecordExportEnvelope({
        records: [recordValue as unknown as Record<string, unknown>],
        itemTypes: itemTypes as unknown as Record<string, unknown>[],
        fields: fields as unknown as Record<string, unknown>[],
        siteInfo,
        projectConfiguration,
        filtersUsed: {},
        scope: 'single-record',
      });

      await downloadRecordsFile(exportEnvelope, 'JSON');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <Button onClick={downloadTxtFile} disabled={isLoading}>
        {isLoading ? 'Preparing JSON...' : 'Download this record'}
      </Button>
    </Canvas>
  );
}

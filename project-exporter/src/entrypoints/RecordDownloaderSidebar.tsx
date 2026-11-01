import { buildClient } from '@datocms/cma-client-browser';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import downloadRecordsFile from '../utils/downloadRecordsFile';
import { mapWithConcurrency } from '../utils/exportRuntime';
import { readRecord } from '../utils/readRecords';
import {
  buildRecordExportEnvelope,
  fetchProjectConfigurationExport,
} from '../utils/recordExport';
import type { AvailableFormats } from './ConfigScreen';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

export default function RecordDownloaderSidebar({ ctx }: PropTypes) {
  const downloadRecord = async () => {
    if (!ctx.item) return;

    const selectedFormat =
      (ctx.plugin.attributes.parameters.format as AvailableFormats) ?? 'JSON';

    if (!ctx.currentUserAccessToken) {
      ctx.alert('A user access token is required to export this record.');
      return;
    }

    try {
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken,
        environment: ctx.environment,
        baseUrl: ctx.cmaBaseUrl,
      });

      const recordValue = await readRecord(client, ctx.item.id);
      if (selectedFormat !== 'JSON') {
        await downloadRecordsFile([recordValue], selectedFormat);
        return;
      }

      const itemTypes = await client.itemTypes.list();
      const fields = (
        await mapWithConcurrency(itemTypes, 4, (model) =>
          client.fields.list(model.id),
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
        siteInfo: { ...siteInfo, sourceEnvironment: ctx.environment },
        projectConfiguration,
        filtersUsed: {},
        scope: 'single-record',
      });

      await downloadRecordsFile(exportEnvelope, 'JSON');
    } catch (error) {
      await ctx.alert(
        error instanceof Error ? error.message : 'The record export failed.',
      );
    }
  };

  return (
    <Canvas ctx={ctx}>
      <Button
        expand
        label="Download this record"
        onClick={downloadRecord}
        disabled={
          ctx.item
            ? undefined
            : { reason: 'Save the record before you download it.' }
        }
      />
    </Canvas>
  );
}

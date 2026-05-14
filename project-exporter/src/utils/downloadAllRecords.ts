import { buildClient } from '@datocms/cma-client-browser';
import type { AvailableFormats } from '../entrypoints/ConfigScreen';
import downloadRecordsFile from './downloadRecordsFile';
import {
  buildRecordExportEnvelope,
  fetchProjectConfigurationExport,
} from './recordExport';

type Options = {
  modelIDs?: string[];
  textQuery?: string;
};

export default async function downloadAllRecords(
  apiToken: string,
  environment: string,
  baseUrl: string | undefined,
  format: AvailableFormats,
  options: Options,
  onProgress?: (progress: number, msg: string) => void,
) {
  const client = buildClient({
    apiToken,
    environment,
    baseUrl,
  });

  const records: Record<string, unknown>[] = [];
  onProgress?.(0, 'Fetching entities...');

  const filter = {
    ...(options.modelIDs && { type: options.modelIDs.join(',') }),
    ...(options.textQuery && { query: options.textQuery }),
  };

  let totalCount = 0;
  try {
    const response = await client.items.rawList({
      nested: false,
      page: { limit: 1 },
      meta: 'true',
      filter,
    });
    totalCount = response.meta.total_count;
  } catch (e) {
    console.error('Error fetching total count:', e);
  }

  let count = 0;
  for await (const record of client.items.listPagedIterator({
    nested: false,
    filter,
  })) {
    records.push(record);
    count++;
    if (count % 50 === 0) {
      const percentage = totalCount > 0 ? (count / totalCount) * 100 : 0;
      onProgress?.(percentage, `Fetched ${count} entities...`);
    }
  }

  onProgress?.(100, 'Preparing file for download...');

  if (format === 'JSON') {
    onProgress?.(100, 'Fetching schema information...');
    const itemTypes = await client.itemTypes.list();
    const fields = (
      await Promise.all(itemTypes.map((model) => client.fields.list(model.id)))
    ).flat();
    onProgress?.(100, 'Fetching project configuration...');
    const { projectConfiguration, siteInfo } =
      await fetchProjectConfigurationExport({
        client,
        itemTypes: itemTypes as unknown as Record<string, unknown>[],
        records,
      });
    onProgress?.(100, 'Building export metadata...');
    const exportEnvelope = buildRecordExportEnvelope({
      records,
      itemTypes: itemTypes as unknown as Record<string, unknown>[],
      fields: fields as unknown as Record<string, unknown>[],
      siteInfo,
      projectConfiguration,
      filtersUsed: options,
      scope: 'bulk',
    });

    await downloadRecordsFile(exportEnvelope, format);
  } else {
    await downloadRecordsFile(records, format);
  }
}

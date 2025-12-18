import { buildClient, SimpleSchemaTypes } from '@datocms/cma-client-browser';
import { AvailableFormats } from '../entrypoints/ConfigScreen';
import downloadRecordsFile from './downloadRecordsFile';

type Options = {
  modelIDs?: string[];
  textQuery?: string;
};

export default async function downloadAllRecords(
  apiToken: string,
  format: AvailableFormats,
  options: Options,
  onProgress?: (progress: number, msg: string) => void
) {
  const client = buildClient({
    apiToken,
  });

  const records = [];
  onProgress?.(0, 'Fetching entities...');

  const filterObject: SimpleSchemaTypes.ItemInstancesHrefSchema = {};

  filterObject.filter = {
    ...(options.modelIDs && { type: options.modelIDs.join(',') }),
    ...(options.textQuery && { query: options.textQuery }),
  };

  let totalCount = 0;
  try {
    const queryParams = new URLSearchParams({
      'page[limit]': '1',
      meta: 'true',
      ...(options.modelIDs && { 'filter[type]': options.modelIDs.join(',') }),
      ...(options.textQuery && { 'filter[query]': options.textQuery }),
    });

    const response = await fetch(
      `https://site-api.datocms.com/items?${queryParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
          'X-Api-Version': '3',
        },
      }
    );

    const responseData = await response.json();
    if (responseData.meta && responseData.meta.total_count) {
      totalCount = responseData.meta.total_count;
    }
  } catch (e) {
    console.error('Error fetching total count:', e);
  }

  let count = 0;
  for await (const record of client.items.listPagedIterator(filterObject)) {
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

    downloadRecordsFile({ records, schema: { itemTypes, fields } }, format);
  } else {
    downloadRecordsFile(records, format);
  }
}

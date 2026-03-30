import { json2csv } from 'json-2-csv';
import jsontoxml from 'jsontoxml';
import { AvailableFormats } from '../entrypoints/ConfigScreen';
import { flatten } from 'flat';
import { Workbook } from 'exceljs';

function downloadFile(content: BlobPart, type: string, extension: string) {
  const file = new Blob([content], {
    type: type,
  });
  const element = document.createElement('a');
  element.href = URL.createObjectURL(file);
  element.download = `allDatocmsRecords${new Date().toISOString()}.${extension}`;
  document.body.appendChild(element);
  element.click();
}

async function downloadXlsxFile(records: unknown[]): Promise<void> {
  const flattenedData = records.map((item, index) => {
    const flattenedItem = flatten(item as Record<string, unknown>) as Record<
      string,
      unknown
    >;
    return { row: index + 1, ...flattenedItem };
  });

  const columnKeys = Array.from(
    new Set(flattenedData.flatMap((row) => Object.keys(row)))
  );

  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet('DatoRecords');

  worksheet.columns = columnKeys.map((key) => ({
    header: key,
    key,
  }));

  flattenedData.forEach((row) => {
    worksheet.addRow(row);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(
    buffer as BlobPart,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xlsx'
  );
}

async function downloadRecordsFile(
  data: any,
  format: AvailableFormats
): Promise<void> {
  const records = Array.isArray(data) ? data : data.records;

  switch (format) {
    case 'JSON':
      downloadFile(
        JSON.stringify(data, null, 2),
        'application/json',
        'json'
      );
      break;
    case 'CSV':
      downloadFile(await json2csv(records), 'text/csv', 'csv');
      break;
    case 'XML':
      downloadFile(jsontoxml(records), 'application/xml', 'xml');
      break;
    case 'XLSX':
      await downloadXlsxFile(records);
      break;
  }
}

export default downloadRecordsFile;

import { json2csv } from 'json-2-csv';
import jsontoxml from 'jsontoxml';
import { AvailableFormats } from '../entrypoints/ConfigScreen';
import * as XLSX from 'xlsx';
import { flatten } from 'flat';

function downloadRecordsFile(data: any, format: AvailableFormats) {
  function downloadFile(content: string, type: string, extension: string) {
    const file = new Blob([content], {
      type: type,
    });
    const element = document.createElement('a');
    element.href = URL.createObjectURL(file);
    element.download = `allDatocmsRecords${new Date().toISOString()}.${extension}`;
    document.body.appendChild(element);
    element.click();
  }

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
      downloadFile(json2csv(records), 'text/csv', 'csv');
      break;
    case 'XML':
      downloadFile(jsontoxml(records), 'application/xml', 'xml');
      break;
    case 'XLSX':
      const flattenedData = records.map((item: any, index: number) => {
        const flattenedItem = flatten(item) as Record<string, unknown>;
        return { [`row_${index}`]: index, ...flattenedItem };
      });
      const worksheet = XLSX.utils.json_to_sheet(flattenedData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'DatoRecords');
      XLSX.writeFile(
        workbook,
        `allDatocmsRecords${new Date().toISOString()}.xlsx`
      );
      break;
  }
}

export default downloadRecordsFile;

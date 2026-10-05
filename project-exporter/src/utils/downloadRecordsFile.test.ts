import { Buffer, Blob as NodeBlob } from 'node:buffer';
import { Workbook } from 'exceljs';
import { vi } from 'vitest';
import downloadRecordsFile, {
  prepareRecordDownload,
  RecordPartSizeError,
  XLSX_MAX_CELL_CHARACTERS,
} from './downloadRecordsFile';
import { downloadBlob, yieldToBrowser } from './exportRuntime';
import { buildRecordExportEnvelope } from './recordExport';

vi.mock('./exportRuntime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./exportRuntime')>();
  return {
    ...original,
    downloadBlob: vi.fn().mockResolvedValue(undefined),
    yieldToBrowser: vi.fn().mockResolvedValue(undefined),
  };
});

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if (character === '\r' && content[index + 1] === '\n' && !quoted) {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      index++;
    } else {
      value += character;
    }
  }
  return rows;
}

function xmlValue(element: Element): unknown {
  const type = element.getAttribute('type');
  if (type === 'null') return null;
  if (type === 'boolean') return element.textContent === 'true';
  if (type === 'number') return Number(element.textContent);
  if (type === 'string') {
    return element.getAttribute('encoding') === 'json'
      ? JSON.parse(element.textContent ?? '')
      : (element.textContent ?? '');
  }
  const children = Array.from(element.children);
  if (type === 'array') {
    return children.map((child) => {
      if (!child.firstElementChild) throw new Error('Missing array value.');
      return xmlValue(child.firstElementChild);
    });
  }
  return Object.fromEntries(
    children.map((child) => {
      if (!child.firstElementChild) throw new Error('Missing property value.');
      const attribute = child.getAttribute('name') ?? '';
      const key =
        child.getAttribute('nameEncoding') === 'json'
          ? JSON.parse(attribute)
          : attribute;
      return [key, xmlValue(child.firstElementChild)];
    }),
  );
}

const complexRecord = {
  id: 'record-1',
  row: 'a real field, never the synthetic row number',
  title: 'A "quoted", title\r\nwith a second line',
  localized: { en: null, 'pt-BR': 'Olá 🌎', empty: '' },
  gallery: [null, { upload_id: 'asset-2', alt: { en: 'cover' } }],
  blocks: [
    {
      id: 'block-1',
      children: [{ links: ['record-2', 'record-3'], empty: [] }],
    },
  ],
  active: false,
  count: 0,
};

describe('bounded record file formats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Blob', NodeBlob);
  });
  afterEach(() => vi.unstubAllGlobals());

  test('JSON preserves the complete envelope and reference metadata', async () => {
    const envelope = buildRecordExportEnvelope({
      records: [complexRecord],
      itemTypes: [],
      fields: [],
      siteInfo: {
        sourceProjectId: 'project',
        sourceEnvironment: 'main',
        locales: ['en', 'pt-BR'],
        defaultLocale: 'en',
      },
      filtersUsed: { modelIDs: ['model-1'] },
      scope: 'bulk',
    });
    const file = await prepareRecordDownload(envelope, 'JSON');
    expect(JSON.parse(await file.text())).toEqual(envelope);
    expect(file.type).toBe('application/json');
  });

  test('CSV retains one row per record, nested JSON values, Unicode, delimiters and heterogeneous fields', async () => {
    const file = await prepareRecordDownload(
      [complexRecord, { id: 'record-2', extra: ['new column'] }],
      'CSV',
    );
    const [headers, first, second] = parseCsv(await file.text());
    const firstRow = Object.fromEntries(
      headers.map((key, index) => [key, first[index]]),
    );
    const secondRow = Object.fromEntries(
      headers.map((key, index) => [key, second[index]]),
    );
    expect(firstRow.title).toBe(complexRecord.title);
    expect(firstRow.row).toBe(complexRecord.row);
    expect(JSON.parse(firstRow.blocks)).toEqual(complexRecord.blocks);
    expect(JSON.parse(firstRow.localized)).toEqual(complexRecord.localized);
    expect(JSON.parse(firstRow.gallery)).toEqual(complexRecord.gallery);
    expect(firstRow.active).toBe('false');
    expect(firstRow.count).toBe('0');
    expect(secondRow.localized).toBe('');
    expect(JSON.parse(secondRow.extra)).toEqual(['new column']);
    expect(headers).not.toContain('blocks.0.children.0.links.0');
  });

  test('XML is one valid document and round trips arbitrary keys, types, nulls, arrays and forbidden characters', async () => {
    const special = {
      ...complexRecord,
      'en-US': 'A&B <test> "quoted"\r\n',
      '0 bad <key>\t\n': {
        '': '',
        'nul\u0000': 'nul\u0000',
        surrogate: '\ud800',
        ['__proto__']: 'literal',
      },
      emptyArray: [],
      emptyObject: {},
      negative: -12.5,
    };
    const file = await prepareRecordDownload([special], 'XML');
    const content = await file.text();
    const document = new DOMParser().parseFromString(
      content,
      'application/xml',
    );
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.documentElement.tagName).toBe('records');
    const value = document.querySelector('record > value');
    if (!value) throw new Error('Missing record value.');
    expect(xmlValue(value)).toEqual(special);
    expect(content).toContain('nameEncoding="json"');
    expect(content).toContain('encoding="json"');
    expect(content).not.toContain('\u0000');
  });

  test('XLSX retains nested JSON without flattening and keeps numbers beyond Excel precision as text', async () => {
    const record = {
      ...complexRecord,
      exact: Number('0.12345678901234567'),
      safe: 125.25,
      nullable: null,
    };
    const file = await prepareRecordDownload(
      [record, { id: 'record-2', onlySecond: 'second' }],
      'XLSX',
    );
    const workbook = new Workbook();
    // Node's Blob returns an ArrayBuffer outside jsdom's realm. JSZip accepts
    // Node Buffer reliably; ExcelJS declares that Buffer as an ArrayBuffer.
    const buffer = Buffer.from(await file.arrayBuffer());
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const header = sheet.getRow(1);
    const column = (key: string) => {
      let number = 0;
      header.eachCell((cell, index) => {
        if (cell.value === key) number = index;
      });
      if (!number) throw new Error(`Missing column ${key}`);
      return number;
    };
    expect(sheet.columnCount).toBe(Object.keys(record).length + 1);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(2).getCell(column('row')).value).toBe(record.row);
    expect(
      JSON.parse(String(sheet.getRow(2).getCell(column('blocks')).value)),
    ).toEqual(record.blocks);
    expect(
      JSON.parse(String(sheet.getRow(2).getCell(column('localized')).value)),
    ).toEqual(record.localized);
    expect(sheet.getRow(2).getCell(column('active')).value).toBe(false);
    expect(sheet.getRow(2).getCell(column('safe')).value).toBe(125.25);
    expect(sheet.getRow(2).getCell(column('exact')).value).toBe(
      String(record.exact),
    );
    expect(sheet.getRow(2).getCell(column('nullable')).value).toBe('null');
    expect(sheet.getRow(3).getCell(column('onlySecond')).value).toBe('second');
  });

  test('XLSX refuses oversized strings, nested values, headers and excessive line feeds without silent truncation', async () => {
    await Promise.all(
      [
        { text: 'x'.repeat(XLSX_MAX_CELL_CHARACTERS + 1) },
        { nested: { text: 'x'.repeat(XLSX_MAX_CELL_CHARACTERS) } },
        { ['x'.repeat(XLSX_MAX_CELL_CHARACTERS + 1)]: 'value' },
        { text: '\n'.repeat(254) },
      ].map((record) =>
        expect(prepareRecordDownload([record], 'XLSX')).rejects.toThrow(
          'cell limit',
        ),
      ),
    );
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test('XLSX round trips controls, carriage returns, literal OpenXML escapes and unpaired surrogates', async () => {
    const value =
      'nul\u0000 del\u007f literal_x0041_ _x00ab_ CR\rLF\n emoji🌎 lone\ud800 end\uffff';
    const record = {
      'key_x0041_\r': value,
      nested: { _x0042_: '_x0043_' },
    };
    const file = await prepareRecordDownload([record], 'XLSX');
    const workbook = new Workbook();
    await workbook.xlsx.load(
      Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer,
    );
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe('key_x0041_\r');
    expect(sheet.getRow(2).getCell(1).value).toBe(value);
    expect(JSON.parse(String(sheet.getRow(2).getCell(2).value))).toEqual(
      record.nested,
    );
  });

  test('shared nested objects are allowed while circular references fail explicitly', async () => {
    const shared = { id: 'asset-1' };
    const file = await prepareRecordDownload(
      [{ first: shared, second: shared }],
      'JSON',
    );
    expect(JSON.parse(await file.text())).toEqual([
      { first: shared, second: shared },
    ]);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await Promise.all(
      (['JSON', 'XML', 'CSV', 'XLSX'] as const).map((format) =>
        expect(prepareRecordDownload([circular], format)).rejects.toThrow(
          'circular',
        ),
      ),
    );
  });

  test('caps sparse CSV expansion before constructing a giant Blob', async () => {
    // Fifty small heterogeneous records still create 2,500 CSV cells. The
    // output cap catches the dense expansion independently of input size.
    const sparse = Array.from({ length: 50 }, (_, index) => ({
      [`field-${index}`]: 'small',
    }));
    const progress = vi.fn();
    await expect(
      prepareRecordDownload(sparse, 'CSV', {
        maxBytes: 2000,
        onProgress: progress,
      }),
    ).rejects.toBeInstanceOf(RecordPartSizeError);
    expect(progress.mock.calls.at(-1)?.[0]).toBeLessThan(50);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test.each(['JSON', 'CSV', 'XML'] as const)(
    'counts UTF-8 bytes for the %s output budget',
    async (format) => {
      const records = [{ text: 'é🌎' }];
      const file = await prepareRecordDownload(records, format);
      const bounded = await prepareRecordDownload(records, format, {
        maxBytes: file.size,
      });
      expect(bounded.size).toBe(file.size);
      await expect(
        prepareRecordDownload(records, format, { maxBytes: file.size - 1 }),
      ).rejects.toBeInstanceOf(RecordPartSizeError);
    },
  );

  test('CSV rejects unpaired Unicode surrogates instead of silently replacing them', async () => {
    await expect(
      prepareRecordDownload([{ text: 'bad\ud800' }], 'CSV'),
    ).rejects.toThrow('UTF-8 cannot preserve');
    await expect(
      prepareRecordDownload([{ 'bad\udc00': 'value' }], 'CSV'),
    ).rejects.toThrow('UTF-8 cannot preserve');
    const file = await prepareRecordDownload(
      [{ text: 'bad\ud800', nested: ['bad\udc00'] }],
      'JSON',
    );
    expect(JSON.parse(await file.text())).toEqual([
      { text: 'bad\ud800', nested: ['bad\udc00'] },
    ]);
  });

  test('reports record progress, cancels between records, and never downloads a cancelled part', async () => {
    const progress = vi.fn();
    await prepareRecordDownload(
      Array.from({ length: 51 }, (_, index) => ({ id: `${index}` })),
      'CSV',
      { onProgress: progress },
    );
    expect(progress).toHaveBeenNthCalledWith(1, 0, 51);
    expect(progress).toHaveBeenLastCalledWith(51, 51);
    expect(yieldToBrowser).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    await expect(
      downloadRecordsFile([{ id: '1' }, { id: '2' }], 'JSON', {
        signal: controller.signal,
        onProgress: (completed) => {
          if (completed === 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test('uses the common download lifecycle and an explicit automatic part filename', async () => {
    await downloadRecordsFile([{ id: '1' }], 'JSON', {
      filename: 'records-part-00002.json',
    });
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(NodeBlob),
      'records-part-00002.json',
    );
  });

  test.each(['JSON', 'XML', 'CSV', 'XLSX'] as const)(
    'empty %s exports remain valid',
    async (format) => {
      const file = await prepareRecordDownload([], format);
      expect(file.size).toBeGreaterThan(0);
      if (format === 'JSON') expect(JSON.parse(await file.text())).toEqual([]);
      if (format === 'XML')
        expect(
          new DOMParser()
            .parseFromString(await file.text(), 'application/xml')
            .querySelector('parsererror'),
        ).toBeNull();
    },
  );
});

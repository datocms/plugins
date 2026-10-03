import { Workbook } from 'exceljs';
import type { AvailableFormats } from '../entrypoints/ConfigScreen';
import { downloadBlob, throwIfAborted, yieldToBrowser } from './exportRuntime';
import type { RecordExportEnvelope } from './recordExport';

type RecordRow = Record<string, unknown>;
type RecordData = RecordExportEnvelope | RecordRow[];

export type RecordDownloadOptions = {
  filename?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  onProgress?: (completed: number, total: number) => void;
};

export class RecordPartSizeError extends Error {
  constructor() {
    super('The record part exceeds its browser memory budget.');
    this.name = 'RecordPartSizeError';
    Object.setPrototypeOf(this, RecordPartSizeError.prototype);
  }
}

// https://support.microsoft.com/en-us/excel/excel-specifications-and-limits
export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;
export const XLSX_MAX_CELL_CHARACTERS = 32_767;
const XLSX_MAX_CELL_LINE_FEEDS = 253;
const TOKENS_PER_YIELD = 2000;
const RECORDS_PER_YIELD = 25;
const TEXT_CHUNK_CHARACTERS = 64 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

type ContainerFrame = {
  value: object;
  keys: string[] | null;
  index: number;
};
type ValueFrame = { value: unknown };
type SerializationFrame = ContainerFrame | ValueFrame | string;
type Serialization = {
  primitive: (value: unknown) => string | null;
  open: (keys: string[] | null) => string;
  close: (frame: ContainerFrame) => string;
  beginChild: (frame: ContainerFrame, index: number) => string;
  endChild: (frame: ContainerFrame) => string;
};

function isSerializableProperty(value: unknown): boolean {
  return !['undefined', 'function', 'symbol'].includes(typeof value);
}

function objectKeys(value: object): string[] {
  return Object.keys(value).filter((key) =>
    isSerializableProperty((value as RecordRow)[key]),
  );
}

// Walk one child at a time. Recursion and flattened copies both grow badly for
// deeply nested blocks, and arrays must remain arrays rather than new columns.
function advanceContainer(
  stack: SerializationFrame[],
  ancestors: Set<object>,
  frame: ContainerFrame,
  format: Serialization,
): string {
  const length = frame.keys
    ? frame.keys.length
    : (frame.value as unknown[]).length;
  if (frame.index === length) {
    stack.pop();
    ancestors.delete(frame.value);
    return format.close(frame);
  }
  const index = frame.index++;
  const child = frame.keys
    ? (frame.value as RecordRow)[frame.keys[index]]
    : (frame.value as unknown[])[index];
  stack.push(format.endChild(frame), { value: child });
  return format.beginChild(frame, index);
}

function* serializedTokens(
  root: unknown,
  format: Serialization,
): Generator<string> {
  const stack: SerializationFrame[] = [{ value: root }];
  const ancestors = new Set<object>();
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (typeof frame === 'string') {
      stack.pop();
      yield frame;
      continue;
    }
    if ('index' in frame) {
      yield advanceContainer(stack, ancestors, frame, format);
      continue;
    }
    stack.pop();
    const token = format.primitive(frame.value);
    if (token !== null) {
      yield token;
      continue;
    }
    const value = frame.value as object;
    if (ancestors.has(value)) {
      throw new Error('A circular value cannot be exported.');
    }
    ancestors.add(value);
    const keys = Array.isArray(value) ? null : objectKeys(value);
    stack.push({ value, keys, index: 0 });
    yield format.open(keys);
  }
}

const jsonSerialization: Serialization = {
  primitive: (value) => {
    if (value === null || typeof value !== 'object' || value instanceof Date) {
      return JSON.stringify(value) ?? 'null';
    }
    return null;
  },
  open: (keys) => (keys ? '{' : '['),
  close: (frame) => (frame.keys ? '}' : ']'),
  beginChild: (frame, index) => {
    const comma = index ? ',' : '';
    return frame.keys ? `${comma}${JSON.stringify(frame.keys[index])}:` : comma;
  },
  endChild: () => '',
};

function jsonTokens(root: unknown): Generator<string> {
  return serializedTokens(root, jsonSerialization);
}

function escapeXml(value: string, attribute = false): string {
  let escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
  if (attribute) {
    escaped = escaped
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/\n/g, '&#10;')
      .replace(/\t/g, '&#9;');
  }
  return escaped;
}

function needsXmlJsonEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const character = value.charCodeAt(index);
    if (
      (character < 32 && ![9, 10, 13].includes(character)) ||
      character === 0xfffe ||
      character === 0xffff
    )
      return true;
    if (character >= 0xd800 && character <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (character >= 0xdc00 && character <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function xmlString(value: string): string {
  return needsXmlJsonEncoding(value)
    ? `<value type="string" encoding="json">${escapeXml(JSON.stringify(value))}</value>`
    : `<value type="string">${escapeXml(value)}</value>`;
}

// Property names are attributes, never element names. XML strings containing
// forbidden XML 1.0 characters use explicit JSON encoding instead of deletion.
function xmlPrimitive(value: unknown): string | null {
  if (value === null || !isSerializableProperty(value))
    return '<value type="null"/>';
  if (value instanceof Date) return xmlString(value.toISOString());
  switch (typeof value) {
    case 'string':
      return xmlString(value);
    case 'boolean':
      return `<value type="boolean">${value}</value>`;
    case 'number':
      return Number.isFinite(value)
        ? `<value type="number">${value}</value>`
        : '<value type="null"/>';
    case 'object':
      return null;
    default:
      throw new Error(`A ${typeof value} value cannot be exported as XML.`);
  }
}

const xmlSerialization: Serialization = {
  primitive: xmlPrimitive,
  open: (keys) => `<value type="${keys ? 'object' : 'array'}">`,
  close: () => '</value>',
  beginChild: (frame, index) => {
    if (!frame.keys) return `<item index="${index}">`;
    const key = frame.keys[index];
    const encoded = needsXmlJsonEncoding(key);
    return `<property name="${escapeXml(encoded ? JSON.stringify(key) : key, true)}"${encoded ? ' nameEncoding="json"' : ''}>`;
  },
  endChild: (frame) => (frame.keys ? '</property>' : '</item>'),
};

function xmlTokens(root: unknown): Generator<string> {
  return serializedTokens(root, xmlSerialization);
}

class TextChunks {
  readonly parts: string[] = [];
  private pending: string[] = [];
  private pendingCharacters = 0;
  private bytes = 0;

  constructor(private maxBytes = DEFAULT_MAX_OUTPUT_BYTES) {}

  push(value: string): void {
    if (!value) return;
    // Count UTF-8 bytes without allocating a duplicate encoded buffer. Lone
    // surrogates become U+FFFD in a Blob, so they also occupy three bytes.
    for (let index = 0; index < value.length; index++) {
      const character = value.charCodeAt(index);
      if (character < 0x80) this.bytes++;
      else if (character < 0x800) this.bytes += 2;
      else if (
        character >= 0xd800 &&
        character <= 0xdbff &&
        value.charCodeAt(index + 1) >= 0xdc00 &&
        value.charCodeAt(index + 1) <= 0xdfff
      ) {
        this.bytes += 4;
        index++;
      } else this.bytes += 3;
      if (this.bytes > this.maxBytes) throw new RecordPartSizeError();
    }
    this.pending.push(value);
    this.pendingCharacters += value.length;
    if (this.pendingCharacters >= TEXT_CHUNK_CHARACTERS) this.flush();
  }

  flush(): void {
    if (this.pending.length) this.parts.push(this.pending.join(''));
    this.pending = [];
    this.pendingCharacters = 0;
  }
}

async function appendTokens(
  tokens: Iterable<string>,
  output: TextChunks,
  options: RecordDownloadOptions,
  maxCharacters?: number,
): Promise<void> {
  throwIfAborted(options.signal);
  let characters = 0;
  let count = 0;
  const iterator = tokens[Symbol.iterator]();
  while (true) {
    const next = iterator.next();
    if (next.done) break;
    const token = next.value;
    characters += token.length;
    if (maxCharacters !== undefined && characters > maxCharacters) {
      throw new Error(
        'A record field exceeds the XLSX cell limit of 32,767 characters. Choose JSON, CSV or XML to preserve the complete value.',
      );
    }
    output.push(token);
    if (++count % TOKENS_PER_YIELD === 0) {
      // biome-ignore lint/performance/noAwaitInLoops: Ordered serialization must yield without accumulating concurrent work.
      await yieldToBrowser();
      throwIfAborted(options.signal);
    }
  }
  throwIfAborted(options.signal);
}

async function completeRecord(
  index: number,
  total: number,
  options: RecordDownloadOptions,
): Promise<void> {
  options.onProgress?.(index + 1, total);
  if ((index + 1) % RECORDS_PER_YIELD === 0) await yieldToBrowser();
  throwIfAborted(options.signal);
}

async function collectColumnKeys(
  records: RecordRow[],
  options: RecordDownloadOptions,
  maximum?: number,
): Promise<string[]> {
  const keys = new Set<string>();
  let processed = 0;
  for (const record of records) {
    for (const key of Object.keys(record)) {
      keys.add(key);
      if (maximum !== undefined && keys.size > maximum) {
        if (records.length > 1) throw new RecordPartSizeError();
        throw new Error(
          'The XLSX export exceeds 16,384 columns. Choose JSON, CSV or XML to preserve all fields.',
        );
      }
      if (++processed % TOKENS_PER_YIELD === 0) {
        // biome-ignore lint/performance/noAwaitInLoops: This sequential scan yields to keep cancellation responsive.
        await yieldToBrowser();
        throwIfAborted(options.signal);
      }
    }
  }
  return Array.from(keys);
}

async function tabularValue(
  value: unknown,
  options: RecordDownloadOptions,
  maxCharacters?: number,
): Promise<string> {
  if (typeof value === 'string') return value;
  const output = new TextChunks(options.maxBytes);
  await appendTokens(jsonTokens(value), output, options, maxCharacters);
  output.flush();
  return output.parts.join('');
}

function quoteCsv(value: string): string {
  if (hasUnpairedSurrogate(value)) {
    throw new Error(
      'A CSV field contains an unpaired Unicode surrogate that UTF-8 cannot preserve. Choose JSON or XML to export the complete value.',
    );
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const character = value.charCodeAt(index);
    if (character >= 0xd800 && character <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (character >= 0xdc00 && character <= 0xdfff) return true;
  }
  return false;
}

async function prepareJson(
  data: RecordData,
  options: RecordDownloadOptions,
): Promise<Blob> {
  const output = new TextChunks(options.maxBytes);
  const records = Array.isArray(data) ? data : data.records;
  async function appendRecords() {
    output.push('[');
    for (let index = 0; index < records.length; index++) {
      if (index) output.push(',');
      // biome-ignore lint/performance/noAwaitInLoops: Only one record is serialized into the bounded output at a time.
      await appendTokens(jsonTokens(records[index]), output, options);
      await completeRecord(index, records.length, options);
    }
    output.push(']');
  }
  if (Array.isArray(data)) {
    await appendRecords();
  } else {
    output.push('{');
    let index = 0;
    for (const [key, value] of Object.entries(data)) {
      if (!isSerializableProperty(value)) continue;
      if (index++) output.push(',');
      output.push(`${JSON.stringify(key)}:`);
      const append =
        key === 'records'
          ? appendRecords()
          : appendTokens(jsonTokens(value), output, options);
      // biome-ignore lint/performance/noAwaitInLoops: Envelope properties share an ordered output with a single memory budget.
      await append;
    }
    output.push('}');
  }
  output.flush();
  return new Blob(output.parts, { type: 'application/json' });
}

async function prepareCsv(
  records: RecordRow[],
  options: RecordDownloadOptions,
): Promise<Blob> {
  const keys = await collectColumnKeys(records, options);
  const output = new TextChunks(options.maxBytes);
  output.push(`${keys.map(quoteCsv).join(',')}\r\n`);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    let column = 0;
    for (const key of keys) {
      if (column++) output.push(',');
      const present = Object.hasOwn(record, key);
      // biome-ignore lint/performance/noAwaitInLoops: Cells append in column order without concurrent copies of nested data.
      const value = present ? await tabularValue(record[key], options) : '';
      output.push(quoteCsv(value));
    }
    output.push('\r\n');
    await completeRecord(index, records.length, options);
  }
  output.flush();
  return new Blob(output.parts, { type: 'text/csv;charset=utf-8' });
}

async function prepareXml(
  records: RecordRow[],
  options: RecordDownloadOptions,
): Promise<Blob> {
  const output = new TextChunks(options.maxBytes);
  output.push('<?xml version="1.0" encoding="UTF-8"?><records>');
  for (let index = 0; index < records.length; index++) {
    output.push('<record>');
    // biome-ignore lint/performance/noAwaitInLoops: Only one nested record is serialized at a time.
    await appendTokens(xmlTokens(records[index]), output, options);
    output.push('</record>');
    await completeRecord(index, records.length, options);
  }
  output.push('</records>');
  output.flush();
  return new Blob(output.parts, { type: 'application/xml' });
}

function validateXlsxCell(value: string): void {
  if (
    value.length > XLSX_MAX_CELL_CHARACTERS ||
    value.split('\n').length - 1 > XLSX_MAX_CELL_LINE_FEEDS
  ) {
    throw new Error(
      'A record field exceeds the XLSX cell limit (32,767 characters or 253 line feeds). Choose JSON, CSV or XML to preserve the complete value.',
    );
  }
}

function hasExcelNumberPrecision(value: number): boolean {
  const digits = Math.abs(value)
    .toString()
    .split('e')[0]
    .replace('.', '')
    .replace(/^0+/, '');
  return digits.length <= 15;
}

function escapedXlsxCharacter(
  value: string,
  index: number,
): string | undefined {
  const code = value.charCodeAt(index);
  if ((code < 32 && ![9, 10].includes(code)) || code === 127 || code >= 0xfffe)
    return xlsxCharacterCode(code);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return next >= 0xdc00 && next <= 0xdfff
      ? undefined
      : xlsxCharacterCode(code);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = value.charCodeAt(index - 1);
    return previous >= 0xd800 && previous <= 0xdbff
      ? undefined
      : xlsxCharacterCode(code);
  }
  return undefined;
}

function xlsxCharacterCode(code: number): string {
  return `_x${code.toString(16).toUpperCase().padStart(4, '0')}_`;
}

function needsXlsxCharacterEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (escapedXlsxCharacter(value, index) !== undefined) return true;
  }
  return false;
}

// ExcelJS strips controls and interprets literal _xHHHH_ strings on load.
// ST_Xstring escaping preserves them and CRs without changing displayed text.
// https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/d34ae755-c53f-4a44-a363-c6dd3ee018a4
function escapeXlsxString(value: string): string {
  const escaped = value.replace(
    /_x[0-9a-fA-F]{4}_/g,
    (match) => `_x005F_${match.slice(1)}`,
  );
  if (!needsXlsxCharacterEncoding(escaped)) return escaped;
  const output: string[] = [];
  for (let index = 0; index < escaped.length; index++) {
    output.push(escapedXlsxCharacter(escaped, index) ?? escaped[index]);
  }
  return output.join('');
}

async function xlsxCellValue(
  value: unknown,
  options: RecordDownloadOptions,
): Promise<string | boolean | number> {
  if (typeof value === 'boolean') return value;
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    hasExcelNumberPrecision(value)
  )
    return value;
  const cell = await tabularValue(value, options, XLSX_MAX_CELL_CHARACTERS);
  validateXlsxCell(cell);
  return escapeXlsxString(cell);
}

async function prepareXlsx(
  records: RecordRow[],
  options: RecordDownloadOptions,
): Promise<Blob> {
  if (records.length >= XLSX_MAX_ROWS) {
    throw new Error(
      'The XLSX export exceeds 1,048,575 records plus its header. Export smaller automatic parts.',
    );
  }
  const keys = await collectColumnKeys(records, options, XLSX_MAX_COLUMNS);
  for (const key of keys) validateXlsxCell(key);
  const columnIndices = new Map(keys.map((key, index) => [key, index + 1]));
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet('DatoRecords');
  worksheet.addRow(keys.map(escapeXlsxString));
  for (let index = 0; index < records.length; index++) {
    const row = worksheet.addRow([]);
    // Sparse rows avoid records × all model fields allocations for mixed models.
    for (const [key, value] of Object.entries(records[index])) {
      const columnIndex = columnIndices.get(key);
      if (columnIndex === undefined) continue;
      // biome-ignore lint/performance/noAwaitInLoops: Nested cell strings are produced and released sequentially.
      row.getCell(columnIndex).value = await xlsxCellValue(value, options);
    }
    await completeRecord(index, records.length, options);
  }
  throwIfAborted(options.signal);
  await yieldToBrowser();
  const buffer = await workbook.xlsx.writeBuffer();
  throwIfAborted(options.signal);
  return new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// The caller supplies a bounded part. Each format preserves nested values and
// the bulk caller downloads/releases that part before preparing the next one.
export async function prepareRecordDownload(
  data: RecordData,
  format: AvailableFormats,
  options: RecordDownloadOptions = {},
): Promise<Blob> {
  throwIfAborted(options.signal);
  if (
    options.maxBytes !== undefined &&
    (!Number.isFinite(options.maxBytes) || options.maxBytes < 1)
  ) {
    throw new Error(
      'The record part memory budget must be a positive byte count.',
    );
  }
  const records = Array.isArray(data) ? data : data.records;
  options.onProgress?.(0, records.length);
  throwIfAborted(options.signal);
  switch (format) {
    case 'JSON':
      return prepareJson(data, options);
    case 'CSV':
      return prepareCsv(records, options);
    case 'XML':
      return prepareXml(records, options);
    case 'XLSX':
      return prepareXlsx(records, options);
    default:
      throw new Error(`Unsupported record export format: ${format}`);
  }
}

async function downloadRecordsFile(
  data: RecordData,
  format: AvailableFormats,
  options: RecordDownloadOptions = {},
): Promise<void> {
  const blob = await prepareRecordDownload(data, format, options);
  throwIfAborted(options.signal);
  await downloadBlob(
    blob,
    options.filename ??
      `allDatocmsRecords${new Date().toISOString()}.${format.toLowerCase()}`,
  );
}

export default downloadRecordsFile;

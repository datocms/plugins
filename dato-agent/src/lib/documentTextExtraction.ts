import { unzipSync } from 'fflate';

export const DEFAULT_MAX_EXTRACTED_DOCUMENT_CHARACTERS = 200_000;
export const MAX_EXTRACTED_DOCUMENT_CHARACTERS = 500_000;
export const MAX_DOCUMENT_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_ARCHIVE_ENTRIES = 2_048;
export const MAX_SELECTED_ARCHIVE_ENTRIES = 256;
export const MAX_SELECTED_ARCHIVE_ENTRY_BYTES = 4 * 1024 * 1024;
export const MAX_SELECTED_ARCHIVE_TOTAL_BYTES = 12 * 1024 * 1024;

export type ExtractableDocumentFormat = 'docx' | 'pptx' | 'xlsx' | 'odt';

export type DocumentTextExtractionErrorCode =
  | 'unsupported_format'
  | 'legacy_binary_format'
  | 'file_too_large'
  | 'archive_limit_exceeded'
  | 'invalid_archive'
  | 'invalid_document';

export class DocumentTextExtractionError extends Error {
  readonly code: DocumentTextExtractionErrorCode;

  constructor(code: DocumentTextExtractionErrorCode, message: string) {
    super(message);
    this.name = 'DocumentTextExtractionError';
    this.code = code;
  }
}

export type ExtractedDocumentText = {
  format: ExtractableDocumentFormat;
  text: string;
  truncated: boolean;
};

export type DocumentTextExtractionOptions = {
  maxCharacters?: number;
};

type FileLike = Blob & { name?: string; type?: string };

const FORMAT_BY_EXTENSION: Readonly<Record<string, ExtractableDocumentFormat>> =
  {
    docx: 'docx',
    odt: 'odt',
    pptx: 'pptx',
    xlsx: 'xlsx',
  };

const FORMAT_BY_MIME_TYPE: Readonly<Record<string, ExtractableDocumentFormat>> =
  {
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
  };

const LEGACY_EXTENSIONS = new Set(['doc', 'ppt', 'xls']);
const LEGACY_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

const textDecoder = new TextDecoder('utf-8', { fatal: false });

class TextCollector {
  private readonly chunks: string[] = [];
  private length = 0;
  truncated = false;

  constructor(private readonly maximumLength: number) {}

  append(value: string): void {
    if (!value || this.length >= this.maximumLength) {
      if (value) this.truncated = true;
      return;
    }

    const remaining = this.maximumLength - this.length;
    const chunk = value.slice(0, remaining);
    this.chunks.push(chunk);
    this.length += chunk.length;
    if (chunk.length < value.length) this.truncated = true;
  }

  separator(value = '\n'): void {
    const previous = this.chunks.at(-1) ?? '';
    if (!previous.endsWith(value)) this.append(value);
  }

  result(): string {
    return this.chunks
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

function fileExtension(filename: string): string {
  const cleanFilename = filename.toLowerCase().split(/[?#]/u, 1)[0] ?? '';
  const finalDot = cleanFilename.lastIndexOf('.');
  return finalDot < 0 ? '' : cleanFilename.slice(finalDot + 1);
}

export function detectExtractableDocumentFormat(
  file: Pick<FileLike, 'name' | 'type'>,
): ExtractableDocumentFormat | undefined {
  const extension = fileExtension(file.name ?? '');
  if (LEGACY_EXTENSIONS.has(extension)) return undefined;

  return (
    FORMAT_BY_EXTENSION[extension] ??
    FORMAT_BY_MIME_TYPE[(file.type ?? '').toLowerCase()]
  );
}

export function isExtractableDocumentFile(
  file: Pick<FileLike, 'name' | 'type'>,
): boolean {
  return detectExtractableDocumentFormat(file) !== undefined;
}

function assertNotLegacyDocument(file: Pick<FileLike, 'name' | 'type'>): void {
  const extension = fileExtension(file.name ?? '');
  const mimeType = (file.type ?? '').toLowerCase();
  const hasKnownModernExtension = FORMAT_BY_EXTENSION[extension] !== undefined;
  if (
    LEGACY_EXTENSIONS.has(extension) ||
    (!hasKnownModernExtension && LEGACY_MIME_TYPES.has(mimeType))
  ) {
    throw new DocumentTextExtractionError(
      'legacy_binary_format',
      'Legacy .doc, .xls, and .ppt files cannot be read. Convert the file to DOCX, XLSX, PPTX, or PDF first.',
    );
  }
}

function maximumCharacters(options: DocumentTextExtractionOptions): number {
  const requested = options.maxCharacters;
  if (requested === undefined) {
    return DEFAULT_MAX_EXTRACTED_DOCUMENT_CHARACTERS;
  }

  if (!Number.isFinite(requested) || requested < 1) {
    throw new RangeError('maxCharacters must be a positive finite number.');
  }

  return Math.min(Math.floor(requested), MAX_EXTRACTED_DOCUMENT_CHARACTERS);
}

function archiveEntryIsRelevant(
  format: ExtractableDocumentFormat,
  name: string,
): boolean {
  if (format === 'docx') {
    return (
      name === 'word/document.xml' ||
      /^word\/(?:comments|endnotes|footnotes|footer\d+|header\d+)\.xml$/u.test(
        name,
      )
    );
  }

  if (format === 'pptx') {
    return /^ppt\/(?:slides\/slide|notesSlides\/notesSlide)\d+\.xml$/u.test(
      name,
    );
  }

  if (format === 'xlsx') {
    return (
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/u.test(name)
    );
  }

  return name === 'content.xml';
}

function unzipSelectedDocumentEntries(
  archive: Uint8Array,
  format: ExtractableDocumentFormat,
): Record<string, Uint8Array> {
  let archiveEntries = 0;
  let selectedEntries = 0;
  let selectedBytes = 0;
  const seenSelectedNames = new Set<string>();

  try {
    const result = unzipSync(archive, {
      filter(entry) {
        archiveEntries += 1;
        if (archiveEntries > MAX_DOCUMENT_ARCHIVE_ENTRIES) {
          throw new DocumentTextExtractionError(
            'archive_limit_exceeded',
            `The document archive contains more than ${MAX_DOCUMENT_ARCHIVE_ENTRIES.toLocaleString()} entries.`,
          );
        }

        if (!archiveEntryIsRelevant(format, entry.name)) return false;
        if (seenSelectedNames.has(entry.name)) {
          throw new DocumentTextExtractionError(
            'invalid_archive',
            `The document archive contains a duplicate ${entry.name} entry.`,
          );
        }
        seenSelectedNames.add(entry.name);

        selectedEntries += 1;
        selectedBytes += entry.originalSize;
        if (
          selectedEntries > MAX_SELECTED_ARCHIVE_ENTRIES ||
          entry.originalSize > MAX_SELECTED_ARCHIVE_ENTRY_BYTES ||
          selectedBytes > MAX_SELECTED_ARCHIVE_TOTAL_BYTES
        ) {
          throw new DocumentTextExtractionError(
            'archive_limit_exceeded',
            'The document expands beyond the safe in-browser extraction limit.',
          );
        }

        return true;
      },
    });

    let actualBytes = 0;
    for (const bytes of Object.values(result)) {
      actualBytes += bytes.byteLength;
      if (
        bytes.byteLength > MAX_SELECTED_ARCHIVE_ENTRY_BYTES ||
        actualBytes > MAX_SELECTED_ARCHIVE_TOTAL_BYTES
      ) {
        throw new DocumentTextExtractionError(
          'archive_limit_exceeded',
          'The document expands beyond the safe in-browser extraction limit.',
        );
      }
    }

    return result;
  } catch (error) {
    if (error instanceof DocumentTextExtractionError) throw error;
    throw new DocumentTextExtractionError(
      'invalid_archive',
      'The document is not a valid or supported ZIP-based document.',
    );
  }
}

function parseXml(bytes: Uint8Array, entryName: string): XMLDocument {
  const document = new DOMParser().parseFromString(
    textDecoder.decode(bytes),
    'application/xml',
  );
  if (
    document.documentElement.localName === 'parsererror' ||
    document.getElementsByTagName('parsererror').length > 0
  ) {
    throw new DocumentTextExtractionError(
      'invalid_document',
      `The ${entryName} document part contains invalid XML.`,
    );
  }
  return document;
}

function childElements(element: Element): Element[] {
  return Array.from(element.children);
}

function descendantsByLocalName(
  root: ParentNode,
  localName: string,
): Element[] {
  return Array.from(root.querySelectorAll('*')).filter(
    (element) => element.localName === localName,
  );
}

function appendXmlText(node: Node, collector: TextCollector): void {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.nodeValue?.trim()) collector.append(node.nodeValue);
    return;
  }

  if (!(node instanceof Element)) return;

  if (node.localName === 'tab') {
    collector.append('\t');
    return;
  }
  if (node.localName === 'br' || node.localName === 'line-break') {
    collector.separator();
    return;
  }

  for (const child of Array.from(node.childNodes)) {
    appendXmlText(child, collector);
  }

  const parentName = node.parentElement?.localName;
  if (
    (node.localName === 'p' || node.localName === 'h') &&
    parentName !== 'tc' &&
    parentName !== 'table-cell'
  ) {
    collector.separator();
  } else if (node.localName === 'tc' || node.localName === 'table-cell') {
    collector.append('\t');
  } else if (node.localName === 'tr' || node.localName === 'table-row') {
    collector.separator();
  }
}

function numericSuffix(path: string): number {
  const match = path.match(/(\d+)\.xml$/u);
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
}

function appendLabeledXmlPart(
  collector: TextCollector,
  bytes: Uint8Array,
  entryName: string,
  label?: string,
): void {
  if (label) {
    collector.separator();
    collector.append(`[${label}]`);
    collector.separator();
  }
  appendXmlText(parseXml(bytes, entryName).documentElement, collector);
}

function requiredEntry(
  entries: Record<string, Uint8Array>,
  entryName: string,
): Uint8Array {
  const value = entries[entryName];
  if (value) return value;
  throw new DocumentTextExtractionError(
    'invalid_document',
    `The document is missing its required ${entryName} part.`,
  );
}

function extractDocx(
  entries: Record<string, Uint8Array>,
  collector: TextCollector,
): void {
  appendLabeledXmlPart(
    collector,
    requiredEntry(entries, 'word/document.xml'),
    'word/document.xml',
  );

  const supplementalParts = Object.keys(entries)
    .filter((name) => name !== 'word/document.xml')
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  for (const name of supplementalParts) {
    appendLabeledXmlPart(
      collector,
      entries[name] as Uint8Array,
      name,
      name
        .slice('word/'.length, -'.xml'.length)
        .replace(/(\D)(\d+)$/u, '$1 $2'),
    );
  }
}

function extractPptx(
  entries: Record<string, Uint8Array>,
  collector: TextCollector,
): void {
  const slides = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => numericSuffix(left) - numericSuffix(right));
  if (slides.length === 0) {
    throw new DocumentTextExtractionError(
      'invalid_document',
      'The presentation contains no readable slides.',
    );
  }

  for (const name of slides) {
    appendLabeledXmlPart(
      collector,
      entries[name] as Uint8Array,
      name,
      `Slide ${numericSuffix(name)}`,
    );
  }

  const notes = Object.keys(entries)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(name))
    .sort((left, right) => numericSuffix(left) - numericSuffix(right));
  for (const name of notes) {
    appendLabeledXmlPart(
      collector,
      entries[name] as Uint8Array,
      name,
      `Notes for slide ${numericSuffix(name)}`,
    );
  }
}

function normalizedArchivePath(
  base: string,
  target: string,
): string | undefined {
  const parts = target.startsWith('/')
    ? target.slice(1).split('/')
    : [...base.split('/'), ...target.split('/')];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (normalized.length === 0) return undefined;
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join('/');
}

function relationshipTargets(
  entries: Record<string, Uint8Array>,
): Map<string, string> {
  const bytes = entries['xl/_rels/workbook.xml.rels'];
  if (!bytes) return new Map();

  const result = new Map<string, string>();
  const document = parseXml(bytes, 'xl/_rels/workbook.xml.rels');
  for (const relationship of descendantsByLocalName(document, 'Relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    const path = target ? normalizedArchivePath('xl', target) : undefined;
    if (id && path?.startsWith('xl/worksheets/')) result.set(id, path);
  }
  return result;
}

function workbookSheetNames(
  entries: Record<string, Uint8Array>,
): Map<string, string> {
  const bytes = entries['xl/workbook.xml'];
  if (!bytes) return new Map();

  const targets = relationshipTargets(entries);
  const result = new Map<string, string>();
  const document = parseXml(bytes, 'xl/workbook.xml');
  const sheets = descendantsByLocalName(document, 'sheet');
  for (const [index, sheet] of sheets.entries()) {
    const relationshipId =
      sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ) ?? sheet.getAttribute('r:id');
    const fallbackPath = `xl/worksheets/sheet${index + 1}.xml`;
    const path =
      (relationshipId && targets.get(relationshipId)) || fallbackPath;
    result.set(path, sheet.getAttribute('name') || `Sheet ${index + 1}`);
  }
  return result;
}

function sharedStrings(entries: Record<string, Uint8Array>): string[] {
  const bytes = entries['xl/sharedStrings.xml'];
  if (!bytes) return [];

  const document = parseXml(bytes, 'xl/sharedStrings.xml');
  return descendantsByLocalName(document, 'si').map((item) =>
    descendantsByLocalName(item, 't')
      .map((text) => text.textContent ?? '')
      .join(''),
  );
}

function directChild(element: Element, localName: string): Element | undefined {
  return childElements(element).find((child) => child.localName === localName);
}

function spreadsheetCellValue(cell: Element, strings: string[]): string {
  const type = cell.getAttribute('t');
  const formula = directChild(cell, 'f')?.textContent?.trim() ?? '';
  const rawValue = directChild(cell, 'v')?.textContent?.trim() ?? '';
  let value = rawValue;

  if (type === 's') {
    const index = Number.parseInt(rawValue, 10);
    value = Number.isFinite(index) ? (strings[index] ?? rawValue) : rawValue;
  } else if (type === 'inlineStr') {
    const inlineString = directChild(cell, 'is');
    value = inlineString
      ? descendantsByLocalName(inlineString, 't')
          .map((text) => text.textContent ?? '')
          .join('')
      : '';
  } else if (type === 'b') {
    value = rawValue === '1' ? 'TRUE' : 'FALSE';
  }

  if (!formula) return value;
  return value ? `=${formula} → ${value}` : `=${formula}`;
}

function appendWorksheet(
  collector: TextCollector,
  bytes: Uint8Array,
  entryName: string,
  sheetName: string,
  strings: string[],
): void {
  collector.separator();
  collector.append(`[Sheet: ${sheetName}]`);
  collector.separator();

  const document = parseXml(bytes, entryName);
  for (const row of descendantsByLocalName(document, 'row')) {
    const cells: string[] = [];
    for (const cell of childElements(row).filter(
      (element) => element.localName === 'c',
    )) {
      const value = spreadsheetCellValue(cell, strings);
      if (!value) continue;
      const reference = (cell.getAttribute('r') || '?').slice(0, 32);
      cells.push(`${reference}: ${value}`);
    }
    if (cells.length > 0) {
      collector.append(cells.join(' · '));
      collector.separator();
    }
  }
}

function extractXlsx(
  entries: Record<string, Uint8Array>,
  collector: TextCollector,
): void {
  const names = workbookSheetNames(entries);
  const strings = sharedStrings(entries);
  const sheets = Object.keys(entries)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((left, right) => numericSuffix(left) - numericSuffix(right));
  if (sheets.length === 0) {
    throw new DocumentTextExtractionError(
      'invalid_document',
      'The spreadsheet contains no readable worksheets.',
    );
  }

  for (const [index, name] of sheets.entries()) {
    appendWorksheet(
      collector,
      entries[name] as Uint8Array,
      name,
      names.get(name) ?? `Sheet ${index + 1}`,
      strings,
    );
  }
}

function extractOdt(
  entries: Record<string, Uint8Array>,
  collector: TextCollector,
): void {
  appendLabeledXmlPart(
    collector,
    requiredEntry(entries, 'content.xml'),
    'content.xml',
  );
}

export async function extractDocumentText(
  file: FileLike,
  options: DocumentTextExtractionOptions = {},
): Promise<ExtractedDocumentText> {
  assertNotLegacyDocument(file);
  const format = detectExtractableDocumentFormat(file);
  if (!format) {
    throw new DocumentTextExtractionError(
      'unsupported_format',
      'This file is not a supported DOCX, PPTX, XLSX, or ODT document.',
    );
  }
  if (file.size > MAX_DOCUMENT_ARCHIVE_BYTES) {
    throw new DocumentTextExtractionError(
      'file_too_large',
      `The document exceeds the ${MAX_DOCUMENT_ARCHIVE_BYTES / (1024 * 1024)} MB in-browser extraction limit.`,
    );
  }

  const archive = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSelectedDocumentEntries(archive, format);
  const collector = new TextCollector(maximumCharacters(options));

  if (format === 'docx') extractDocx(entries, collector);
  else if (format === 'pptx') extractPptx(entries, collector);
  else if (format === 'xlsx') extractXlsx(entries, collector);
  else extractOdt(entries, collector);

  return {
    format,
    text: collector.result(),
    truncated: collector.truncated,
  };
}

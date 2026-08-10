import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  type DocumentTextExtractionError,
  detectExtractableDocumentFormat,
  extractDocumentText,
  isExtractableDocumentFile,
  MAX_SELECTED_ARCHIVE_ENTRY_BYTES,
} from './documentTextExtraction';

function zippedFile(
  name: string,
  mimeType: string,
  entries: Record<string, string | Uint8Array>,
): File {
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, value]) => [
        path,
        typeof value === 'string' ? strToU8(value) : value,
      ]),
    ),
    { level: 9 },
  );
  return new File([bytes], name, { type: mimeType });
}

describe('documentTextExtraction', () => {
  it('detects modern readable formats by extension or MIME type', () => {
    expect(
      detectExtractableDocumentFormat({ name: 'Brief.DOCX', type: '' }),
    ).toBe('docx');
    expect(
      detectExtractableDocumentFormat({
        name: 'upload',
        type: 'application/vnd.oasis.opendocument.text',
      }),
    ).toBe('odt');
    expect(isExtractableDocumentFile({ name: 'slides.pptx', type: '' })).toBe(
      true,
    );
    expect(isExtractableDocumentFile({ name: 'archive.zip', type: '' })).toBe(
      false,
    );
    expect(
      detectExtractableDocumentFormat({
        name: 'mislabelled.docx',
        type: 'application/msword',
      }),
    ).toBe('docx');
  });

  it('extracts DOCX paragraphs, tables, and supplemental document parts', async () => {
    const file = zippedFile(
      'brief.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      {
        'word/document.xml': `<?xml version="1.0"?>
          <w:document xmlns:w="urn:word">
            <w:body>
              <w:p><w:r><w:t>Project brief</w:t></w:r></w:p>
              <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Alex</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            </w:body>
          </w:document>`,
        'word/footnotes.xml': `<?xml version="1.0"?>
          <w:footnotes xmlns:w="urn:word"><w:footnote><w:p><w:r><w:t>Internal note</w:t></w:r></w:p></w:footnote></w:footnotes>`,
      },
    );

    await expect(extractDocumentText(file)).resolves.toEqual({
      format: 'docx',
      text: 'Project brief\nOwner\tAlex\n[footnotes]\nInternal note',
      truncated: false,
    });
  });

  it('extracts PPTX slides in numeric order and includes speaker notes', async () => {
    const file = zippedFile(
      'deck.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      {
        'ppt/slides/slide10.xml':
          '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>',
        'ppt/slides/slide2.xml':
          '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>',
        'ppt/notesSlides/notesSlide2.xml':
          '<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Explain this chart</a:t></a:r></a:p></p:notes>',
      },
    );

    const result = await extractDocumentText(file);

    expect(result.format).toBe('pptx');
    expect(result.text).toBe(
      '[Slide 2]\nSecond\n[Slide 10]\nTenth\n[Notes for slide 2]\nExplain this chart',
    );
    expect(result.truncated).toBe(false);
  });

  it('extracts XLSX sheet names, shared strings, inline strings, and formulas', async () => {
    const file = zippedFile(
      'forecast.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      {
        'xl/workbook.xml': `
          <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <sheets><sheet name="Forecast" r:id="rId7" /></sheets>
          </workbook>`,
        'xl/_rels/workbook.xml.rels': `
          <Relationships><Relationship Id="rId7" Target="worksheets/sheet3.xml" /></Relationships>`,
        'xl/sharedStrings.xml':
          '<sst><si><t>Revenue</t></si><si><r><t>North</t></r><r><t> America</t></r></si></sst>',
        'xl/worksheets/sheet3.xml': `
          <worksheet><sheetData><row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="B1" t="s"><v>1</v></c>
            <c r="C1"><f>SUM(C2:C4)</f><v>42</v></c>
            <c r="D1" t="inlineStr"><is><t>Approved</t></is></c>
          </row></sheetData></worksheet>`,
      },
    );

    await expect(extractDocumentText(file)).resolves.toEqual({
      format: 'xlsx',
      text: '[Sheet: Forecast]\nA1: Revenue · B1: North America · C1: =SUM(C2:C4) → 42 · D1: Approved',
      truncated: false,
    });
  });

  it('extracts text from an OpenDocument Text file', async () => {
    const file = zippedFile(
      'notes.odt',
      'application/vnd.oasis.opendocument.text',
      {
        'content.xml': `
          <office:document-content xmlns:office="urn:office" xmlns:text="urn:text">
            <office:body><office:text><text:h>Launch notes</text:h><text:p>Ship on <text:span>Friday</text:span>.</text:p></office:text></office:body>
          </office:document-content>`,
      },
    );

    await expect(extractDocumentText(file)).resolves.toEqual({
      format: 'odt',
      text: 'Launch notes\nShip on Friday.',
      truncated: false,
    });
  });

  it('bounds text returned to the model and reports truncation', async () => {
    const file = zippedFile(
      'long.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      {
        'word/document.xml': `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${'abcdefghij'.repeat(20)}</w:t></w:r></w:p></w:body></w:document>`,
      },
    );

    const result = await extractDocumentText(file, { maxCharacters: 37 });

    expect(result.text).toHaveLength(37);
    expect(result.text).toBe('abcdefghijabcdefghijabcdefghijabcdefg');
    expect(result.truncated).toBe(true);
  });

  it('rejects a highly-compressible archive part before expanding it', async () => {
    const file = zippedFile(
      'bomb.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      {
        'word/document.xml': new Uint8Array(
          MAX_SELECTED_ARCHIVE_ENTRY_BYTES + 1,
        ),
      },
    );

    await expect(extractDocumentText(file)).rejects.toMatchObject({
      code: 'archive_limit_exceeded',
    });
  });

  it.each([
    ['contract.doc', 'application/msword'],
    ['budget.xls', 'application/vnd.ms-excel'],
    ['slides.ppt', 'application/vnd.ms-powerpoint'],
  ])('rejects legacy binary Office files clearly', async (name, type) => {
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });

    await expect(extractDocumentText(file)).rejects.toMatchObject({
      code: 'legacy_binary_format',
    });
  });

  it('rejects malformed and unsupported files with stable error codes', async () => {
    const malformed = new File([new Uint8Array([1, 2, 3])], 'broken.docx');
    const unsupported = new File(['hello'], 'notes.txt', {
      type: 'text/plain',
    });

    await expect(extractDocumentText(malformed)).rejects.toMatchObject({
      code: 'invalid_archive',
    });
    await expect(extractDocumentText(unsupported)).rejects.toEqual(
      expect.objectContaining<Partial<DocumentTextExtractionError>>({
        code: 'unsupported_format',
      }),
    );
  });
});

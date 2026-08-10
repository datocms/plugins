import { describe, expect, it } from 'vitest';
import {
  CREATE_DATO_ASSET_TOOL,
  parseCreateDatoAssetInput,
} from './localAssetTool';

describe('local DatoCMS asset-creation tool', () => {
  it('states the explicit-intent and MCP separation boundary in the tool description', () => {
    expect(CREATE_DATO_ASSET_TOOL.description).toContain(
      'only when the user’s own current message explicitly asks',
    );
    expect(CREATE_DATO_ASSET_TOOL.description).toContain(
      'Merely attaching or referencing a file is never permission',
    );
    expect(CREATE_DATO_ASSET_TOOL.description).toContain(
      'use Remote MCP for those',
    );
  });

  it('parses one exact host attachment without treating it as a DatoCMS ID', () => {
    expect(
      parseCreateDatoAssetInput(
        JSON.stringify({
          source: 'attached_file',
          attachment_id: 'local-file-123',
          url: null,
          filename: 'new-name.pdf',
        }),
      ),
    ).toEqual({
      source: 'attached_file',
      attachmentId: 'local-file-123',
      filename: 'new-name.pdf',
    });
  });

  it('normalizes an HTTP URL and permits an inferred filename', () => {
    expect(
      parseCreateDatoAssetInput(
        JSON.stringify({
          source: 'url',
          attachment_id: null,
          url: 'https://example.com/asset.png',
          filename: null,
        }),
      ),
    ).toEqual({
      source: 'url',
      url: 'https://example.com/asset.png',
    });
  });

  it.each([
    'http://localhost/asset.png',
    'http://127.0.0.1/asset.png',
    'http://192.168.1.5/asset.png',
    'http://[fd00::1]/asset.png',
    'https://user:password@example.com/asset.png',
  ])('rejects a non-public or credentialed URL: %s', (url) => {
    expect(() =>
      parseCreateDatoAssetInput(
        JSON.stringify({
          source: 'url',
          attachment_id: null,
          url,
          filename: null,
        }),
      ),
    ).toThrow();
  });

  it.each([
    {
      source: 'attached_file',
      attachment_id: 'local-file-123',
      url: 'https://example.com/file.pdf',
      filename: null,
    },
    {
      source: 'url',
      attachment_id: 'local-file-123',
      url: 'https://example.com/file.pdf',
      filename: null,
    },
    {
      source: 'url',
      attachment_id: null,
      url: 'file:///tmp/file.pdf',
      filename: null,
    },
    {
      source: 'attached_file',
      attachment_id: 'local-file-123',
      url: null,
      filename: null,
      upload_id: 'must-not-be-accepted',
    },
  ])('rejects invalid or ambiguous source arguments', (input) => {
    expect(() => parseCreateDatoAssetInput(JSON.stringify(input))).toThrow();
  });
});

/// <reference types="vitest" />

import {
  buildAssetManifestEntry,
  buildAssetZipEntryName,
  LAST_ASSET_EXPORT_STORAGE_KEY,
  persistLastAssetExportSnapshot,
  readLastAssetExportSnapshot,
} from './assetExport';

describe('assetExport helpers', () => {
  test('buildAssetZipEntryName includes source ID and sanitized filename', () => {
    expect(buildAssetZipEntryName('upload:123', 'Hero Image (Final).png')).toBe(
      'u_upload-123__Hero_Image_-Final-.png',
    );
  });

  test('denied localStorage getters cannot fail an otherwise successful export', () => {
    const deniedWindow = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
    vi.stubGlobal('window', deniedWindow);
    try {
      expect(readLastAssetExportSnapshot()).toBeNull();
      expect(() =>
        persistLastAssetExportSnapshot({
          packageVersion: '3.0.0',
          generatedAt: 'synthetic',
          filename: 'allAssets.synthetic.zip',
          totalAssets: 0,
        }),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('snapshots only match the project and environment that produced them', () => {
    localStorage.setItem(
      LAST_ASSET_EXPORT_STORAGE_KEY,
      JSON.stringify({
        sourceProjectId: 'one',
        sourceEnvironment: 'sandbox',
        filename: 'allAssets.synthetic.zip',
      }),
    );
    try {
      expect(readLastAssetExportSnapshot('one', 'sandbox')).not.toBeNull();
      expect(readLastAssetExportSnapshot('two', 'sandbox')).toBeNull();
      expect(readLastAssetExportSnapshot('one', 'production')).toBeNull();
      expect(readLastAssetExportSnapshot(null, 'sandbox')).toBeNull();
      localStorage.setItem(
        LAST_ASSET_EXPORT_STORAGE_KEY,
        JSON.stringify({ chunkFilenames: ['legacy.zip'] }),
      );
      expect(readLastAssetExportSnapshot('one', 'sandbox')).toBeNull();
    } finally {
      localStorage.removeItem(LAST_ASSET_EXPORT_STORAGE_KEY);
    }
  });

  test('buildAssetManifestEntry preserves import-critical metadata', () => {
    const entry = buildAssetManifestEntry(
      {
        id: 'upload-42',
        filename: 'Brochure.pdf',
        size: 12345,
        mime_type: 'application/pdf',
        width: null,
        height: null,
        md5: 'abc123',
        url: 'https://www.datocms-assets.com/brochure.pdf',
        path: '/brochure.pdf',
        custom_data: { source: 'legacy' },
      },
      'u_upload-42__Brochure.pdf',
    );

    expect(entry.sourceUploadId).toBe('upload-42');
    expect(entry.zipEntryName).toBe('u_upload-42__Brochure.pdf');
    expect(entry.originalFilename).toBe('Brochure.pdf');
    expect(entry.mimeType).toBe('application/pdf');
    expect(entry.checksum).toBe('abc123');
    expect(entry.metadata.custom_data).toEqual({ source: 'legacy' });
  });
});

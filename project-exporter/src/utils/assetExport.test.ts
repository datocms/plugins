/// <reference types="vitest" />

import {
  ASSET_EXPORT_PROGRESS_END,
  ASSET_EXPORT_PROGRESS_START,
  buildAssetChunkZipFilename,
  buildAssetManifestEntry,
  buildAssetZipEntryName,
  calculateAssetExportProgress,
  createAssetChunks,
} from './assetExport';

describe('assetExport helpers', () => {
  test('buildAssetZipEntryName includes source ID and sanitized filename', () => {
    expect(buildAssetZipEntryName('upload:123', 'Hero Image (Final).png')).toBe(
      'u_upload-123__Hero_Image_-Final-.png'
    );
  });

  test('buildAssetChunkZipFilename is deterministic and padded', () => {
    expect(
      buildAssetChunkZipFilename({
        part: 3,
        totalParts: 12,
        timestamp: '2026-02-09T12-00-00.000Z',
      })
    ).toBe('allAssets.part-003-of-012.2026-02-09T12-00-00.000Z.zip');
  });

  test('createAssetChunks splits by conservative byte estimate', () => {
    const chunks = createAssetChunks(
      [
        {
          sourceUploadId: '1',
          originalFilename: 'one.jpg',
          size: 80,
          payload: {},
        },
        {
          sourceUploadId: '2',
          originalFilename: 'two.jpg',
          size: 60,
          payload: {},
        },
        {
          sourceUploadId: '3',
          originalFilename: 'three.jpg',
          size: 40,
          payload: {},
        },
      ],
      {
        maxZipBytes: 100,
        maxFilesPerZip: 10,
        sizeSafetyFactor: 1,
      }
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].assets.map((asset) => asset.sourceUploadId)).toEqual(['1']);
    expect(chunks[1].assets.map((asset) => asset.sourceUploadId)).toEqual([
      '2',
      '3',
    ]);
  });

  test('createAssetChunks isolates oversized assets in their own ZIP', () => {
    const chunks = createAssetChunks(
      [
        {
          sourceUploadId: 'small-1',
          originalFilename: 'small-1.pdf',
          size: 25,
          payload: {},
        },
        {
          sourceUploadId: 'huge',
          originalFilename: 'huge.mov',
          size: 500,
          payload: {},
        },
        {
          sourceUploadId: 'small-2',
          originalFilename: 'small-2.pdf',
          size: 25,
          payload: {},
        },
      ],
      {
        maxZipBytes: 100,
        maxFilesPerZip: 10,
        sizeSafetyFactor: 1,
      }
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[1].assets.map((asset) => asset.sourceUploadId)).toEqual([
      'huge',
    ]);
  });

  test('calculateAssetExportProgress maps downloaded ratio into visible range', () => {
    expect(calculateAssetExportProgress(0, 10)).toBe(ASSET_EXPORT_PROGRESS_START);
    expect(calculateAssetExportProgress(5, 10)).toBe(50);
    expect(calculateAssetExportProgress(10, 10)).toBe(
      ASSET_EXPORT_PROGRESS_END
    );
  });

  test('calculateAssetExportProgress clamps out-of-bounds values', () => {
    expect(calculateAssetExportProgress(-1, 10)).toBe(
      ASSET_EXPORT_PROGRESS_START
    );
    expect(calculateAssetExportProgress(100, 10)).toBe(
      ASSET_EXPORT_PROGRESS_END
    );
    expect(calculateAssetExportProgress(1, 0)).toBe(
      ASSET_EXPORT_PROGRESS_END
    );
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
      'u_upload-42__Brochure.pdf'
    );

    expect(entry.sourceUploadId).toBe('upload-42');
    expect(entry.zipEntryName).toBe('u_upload-42__Brochure.pdf');
    expect(entry.originalFilename).toBe('Brochure.pdf');
    expect(entry.mimeType).toBe('application/pdf');
    expect(entry.checksum).toBe('abc123');
    expect(entry.metadata.custom_data).toEqual({ source: 'legacy' });
  });
});

/// <reference types="vitest" />

import { describe, expect, test, vi } from 'vitest';
import JSZip from 'jszip';
import { importAssetsFromZipFiles } from './assetImport';

type TestAsset = {
  sourceUploadId: string;
  originalFilename: string;
  checksum?: string | null;
  content?: string;
  includeZipEntry?: boolean;
  metadata?: Record<string, unknown>;
};

async function buildAssetZipFile(args: {
  zipName: string;
  assets?: TestAsset[];
}) {
  const assets = args.assets ?? [
    {
      sourceUploadId: 'upload-1',
      originalFilename: 'one.txt',
      content: 'abc',
      checksum: null,
      includeZipEntry: true,
    },
  ];
  const zip = new JSZip();

  const manifest = {
    manifestVersion: '2.0.0',
    generatedAt: '2026-02-10T12:00:00.000Z',
    chunk: {
      index: 1,
      totalChunks: 1,
      filename: args.zipName,
      assetCount: 1,
      estimatedBytes: 10,
    },
    conventions: {
      zipEntryName: 'u_<sourceUploadId>__<sanitizedOriginalFilename>',
      zipFilename: 'allAssets.part-{part}-of-{total}.{timestamp}.zip',
    },
    limits: {
      maxZipBytes: 157286400,
      maxFilesPerZip: 100,
      sizeSafetyFactor: 1.2,
    },
    assets: assets.map((asset) => {
      const content = asset.content ?? 'abc';
      return {
        sourceUploadId: asset.sourceUploadId,
        zipEntryName: `u_${asset.sourceUploadId}__${asset.originalFilename}`,
        originalFilename: asset.originalFilename,
        size: content.length,
        mimeType: 'text/plain',
        width: null,
        height: null,
        checksum: asset.checksum ?? null,
        url: null,
        path: null,
        metadata: asset.metadata ?? {},
      };
    }),
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  assets.forEach((asset) => {
    if (asset.includeZipEntry === false) {
      return;
    }

    zip.file(
      `u_${asset.sourceUploadId}__${asset.originalFilename}`,
      asset.content ?? 'abc',
    );
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], args.zipName, { type: 'application/zip' });
}

describe('importAssetsFromZipFiles', () => {
  test('imports assets and returns upload ID map', async () => {
    const zipFile = await buildAssetZipFile({
      zipName: 'assets-1.zip',
    });

    const createFromFileOrBlob = vi.fn(async () => ({ id: 'target-upload-1' }));
    const update = vi.fn(async () => ({ id: 'target-upload-1' }));

    const report = await importAssetsFromZipFiles({
      client: {
        uploads: {
          createFromFileOrBlob,
          update,
        },
      } as any,
      zipFiles: [zipFile],
      strictMode: true,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      },
      scanExistingUploads: false,
    });

    expect(report.ok).toBe(true);
    expect(report.importedAssets).toBe(1);
    expect(report.uploadIdMap.get('upload-1')).toBe('target-upload-1');
    expect(createFromFileOrBlob).toHaveBeenCalledTimes(1);
  });

  test('reports missing zip entry in strict mode', async () => {
    const zipFile = await buildAssetZipFile({
      zipName: 'assets-missing-entry.zip',
      assets: [
        {
          sourceUploadId: 'upload-1',
          originalFilename: 'one.txt',
          content: 'abc',
          checksum: null,
          includeZipEntry: false,
        },
      ],
    });

    const report = await importAssetsFromZipFiles({
      client: {
        uploads: {
          createFromFileOrBlob: vi.fn(async () => ({ id: 'target-upload-1' })),
          update: vi.fn(async () => ({ id: 'target-upload-1' })),
        },
      } as any,
      zipFiles: [zipFile],
      strictMode: true,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      },
      scanExistingUploads: false,
    });

    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.importedAssets).toBe(0);
  });

  test('reuses existing uploads from destination by checksum', async () => {
    const zipFile = await buildAssetZipFile({
      zipName: 'assets-existing.zip',
      assets: [
        {
          sourceUploadId: 'upload-existing',
          originalFilename: 'one.txt',
          content: 'abc',
          checksum: 'checksum-existing',
          includeZipEntry: true,
        },
      ],
    });

    const createFromFileOrBlob = vi.fn(async () => ({ id: 'target-upload-1' }));

    const report = await importAssetsFromZipFiles({
      client: {
        uploads: {
          createFromFileOrBlob,
          update: vi.fn(async () => ({ id: 'target-upload-1' })),
          listPagedIterator: async function* listPagedIterator() {
            yield {
              id: 'existing-upload-id',
              md5: 'checksum-existing',
              filename: 'one.txt',
              size: 3,
            };
          },
        },
      } as any,
      zipFiles: [zipFile],
      strictMode: true,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      },
      scanExistingUploads: true,
    });

    expect(report.ok).toBe(true);
    expect(report.importedAssets).toBe(0);
    expect(report.skippedAssets).toBe(1);
    expect(report.uploadIdMap.get('upload-existing')).toBe('existing-upload-id');
    expect(createFromFileOrBlob).not.toHaveBeenCalled();
  });

  test('dedupes identical uploads within import payload', async () => {
    const zipFile = await buildAssetZipFile({
      zipName: 'assets-duplicates.zip',
      assets: [
        {
          sourceUploadId: 'upload-a',
          originalFilename: 'same.txt',
          content: 'abc',
          checksum: 'checksum-shared',
          includeZipEntry: true,
        },
        {
          sourceUploadId: 'upload-b',
          originalFilename: 'same.txt',
          content: 'abc',
          checksum: 'checksum-shared',
          includeZipEntry: true,
        },
      ],
    });

    const createFromFileOrBlob = vi.fn(async () => ({ id: 'target-upload-new' }));
    const update = vi.fn(async () => ({ id: 'target-upload-new' }));

    const report = await importAssetsFromZipFiles({
      client: {
        uploads: {
          createFromFileOrBlob,
          update,
        },
      } as any,
      zipFiles: [zipFile],
      strictMode: true,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      },
      scanExistingUploads: false,
      uploadConcurrency: 2,
    });

    expect(report.ok).toBe(true);
    expect(report.importedAssets).toBe(1);
    expect(report.skippedAssets).toBe(1);
    expect(report.uploadIdMap.get('upload-a')).toBe('target-upload-new');
    expect(report.uploadIdMap.get('upload-b')).toBe('target-upload-new');
    expect(createFromFileOrBlob).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(0);
  });

  test('sanitizes locale metadata using target site locales', async () => {
    const zipFile = await buildAssetZipFile({
      zipName: 'assets-locales.zip',
      assets: [
        {
          sourceUploadId: 'upload-locale',
          originalFilename: 'one.txt',
          content: 'abc',
          includeZipEntry: true,
          metadata: {
            default_field_metadata: {
              en: { alt: 'English alt' },
              it: { alt: 'Italian alt' },
            },
            field_metadata: {
              en: { title: 'English title' },
              it: { title: 'Italian title' },
            },
          },
        },
      ],
    });

    const createFromFileOrBlob = vi.fn(async () => ({ id: 'target-upload-locale' }));
    const update = vi.fn(async () => ({ id: 'target-upload-locale' }));

    const report = await importAssetsFromZipFiles({
      client: {
        site: {
          find: vi.fn(async () => ({
            locales: ['en'],
          })),
        },
        uploads: {
          createFromFileOrBlob,
          update,
        },
      } as any,
      zipFiles: [zipFile],
      strictMode: true,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      },
      scanExistingUploads: false,
    });

    expect(report.ok).toBe(true);
    expect(createFromFileOrBlob).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);

    const createCalls = createFromFileOrBlob.mock.calls as Array<unknown[]>;
    const createPayload = createCalls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(createPayload).toBeDefined();
    expect(createPayload?.default_field_metadata).toEqual({
      en: { alt: 'English alt' },
    });

    const updateCalls = update.mock.calls as Array<unknown[]>;
    const updatePayload = updateCalls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload).toBeDefined();
    expect(updatePayload?.field_metadata).toEqual({
      en: { title: 'English title' },
    });
  });

  test('retries upload creation without locale metadata after INVALID_LOCALES', async () => {
    const zipFile = await buildAssetZipFile({
      zipName: 'assets-invalid-locales.zip',
      assets: [
        {
          sourceUploadId: 'upload-retry',
          originalFilename: 'one.txt',
          content: 'abc',
          includeZipEntry: true,
          metadata: {
            default_field_metadata: {
              it: { alt: 'Only invalid locale' },
            },
          },
        },
      ],
    });

    const createFromFileOrBlob = vi
      .fn()
      .mockRejectedValueOnce({
        errors: [
          {
            attributes: {
              details: {
                allowed_locales: ['en'],
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'target-upload-retry' });

    const update = vi.fn(async () => ({ id: 'target-upload-retry' }));

    const report = await importAssetsFromZipFiles({
      client: {
        uploads: {
          createFromFileOrBlob,
          update,
        },
      } as any,
      zipFiles: [zipFile],
      strictMode: true,
      retry: {
        maxAttempts: 1,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
      scanExistingUploads: false,
    });

    expect(report.ok).toBe(true);
    expect(createFromFileOrBlob).toHaveBeenCalledTimes(2);
    const createCalls = createFromFileOrBlob.mock.calls as Array<unknown[]>;
    const firstPayload = createCalls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    const secondPayload = createCalls[1]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(firstPayload).toBeDefined();
    expect(secondPayload).toBeDefined();
    expect(firstPayload?.default_field_metadata).toEqual({
      it: { alt: 'Only invalid locale' },
    });
    expect(secondPayload?.default_field_metadata).toBeUndefined();
    expect(report.uploadIdMap.get('upload-retry')).toBe('target-upload-retry');
  });
});

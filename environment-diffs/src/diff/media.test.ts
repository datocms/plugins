import { describe, expect, it } from 'vitest';
import { compareMediaSnapshots } from './media';
import type { MediaSnapshot } from '../types';

describe('compareMediaSnapshots', () => {
  it('compares folders and uploads by id and includes folder paths in details', () => {
    const left: MediaSnapshot = {
      folders: [
        {
          rowId: 'folder:folder-1',
          id: 'folder-1',
          label: 'Images',
          parentId: null,
          position: 0,
          path: 'Images',
          payload: {
            label: 'Images',
            parent: null,
            position: 0,
            path: 'Images',
          },
        },
        {
          rowId: 'folder:folder-2',
          id: 'folder-2',
          label: 'Archive',
          parentId: null,
          position: 1,
          path: 'Archive',
          payload: {
            label: 'Archive',
            parent: null,
            position: 1,
            path: 'Archive',
          },
        },
      ],
      uploads: [
        {
          rowId: 'upload:upload-1',
          id: 'upload-1',
          label: 'hero.png',
          folderId: 'folder-1',
          folderPath: 'Images',
          payload: {
            filename: 'hero.png',
            basename: 'hero',
            md5: 'left-md5',
            size: 120,
            mime_type: 'image/png',
            tags: ['hero'],
            upload_collection: 'folder-1',
            folder_path: 'Images',
            notes: 'Shared note',
            copyright: 'Shared copyright',
            author: 'Shared author',
            default_field_metadata: {
              en: {
                alt: 'Shared alt',
              },
            },
          },
        },
        {
          rowId: 'upload:upload-2',
          id: 'upload-2',
          label: 'left-only.png',
          folderId: null,
          folderPath: null,
          payload: {
            filename: 'left-only.png',
            basename: 'left-only',
            md5: 'left-only-md5',
            size: 10,
            mime_type: 'image/png',
            tags: [],
            upload_collection: null,
            folder_path: null,
            notes: null,
            copyright: null,
            author: null,
            default_field_metadata: {},
          },
        },
      ],
    };

    const right: MediaSnapshot = {
      folders: [
        {
          rowId: 'folder:folder-1',
          id: 'folder-1',
          label: 'Images',
          parentId: null,
          position: 0,
          path: 'Images',
          payload: {
            label: 'Images',
            parent: null,
            position: 0,
            path: 'Images',
          },
        },
        {
          rowId: 'folder:folder-3',
          id: 'folder-3',
          label: 'Documents',
          parentId: null,
          position: 2,
          path: 'Documents',
          payload: {
            label: 'Documents',
            parent: null,
            position: 2,
            path: 'Documents',
          },
        },
      ],
      uploads: [
        {
          rowId: 'upload:upload-1',
          id: 'upload-1',
          label: 'hero.png',
          folderId: 'folder-1',
          folderPath: 'Images',
          payload: {
            filename: 'hero.png',
            basename: 'hero',
            md5: 'right-md5',
            size: 130,
            mime_type: 'image/png',
            tags: ['hero'],
            upload_collection: 'folder-1',
            folder_path: 'Images',
            notes: 'Shared note',
            copyright: 'Shared copyright',
            author: 'Shared author',
            default_field_metadata: {
              en: {
                alt: 'Shared alt',
              },
            },
          },
        },
        {
          rowId: 'upload:upload-3',
          id: 'upload-3',
          label: 'right-only.png',
          folderId: null,
          folderPath: null,
          payload: {
            filename: 'right-only.png',
            basename: 'right-only',
            md5: 'right-only-md5',
            size: 20,
            mime_type: 'image/png',
            tags: [],
            upload_collection: null,
            folder_path: null,
            notes: null,
            copyright: null,
            author: null,
            default_field_metadata: {},
          },
        },
      ],
    };

    const result = compareMediaSnapshots(left, right);

    expect(result.summary).toEqual({
      folder: {
        total: 3,
        changed: 0,
        leftOnly: 1,
        rightOnly: 1,
        unchanged: 1,
      },
      upload: {
        total: 3,
        changed: 1,
        leftOnly: 1,
        rightOnly: 1,
        unchanged: 0,
      },
    });

    expect(result.rows.map((row) => [row.entityType, row.id, row.status])).toEqual([
      ['folder', 'folder:folder-2', 'leftOnly'],
      ['folder', 'folder:folder-3', 'rightOnly'],
      ['folder', 'folder:folder-1', 'unchanged'],
      ['upload', 'upload:upload-1', 'changed'],
      ['upload', 'upload:upload-2', 'leftOnly'],
      ['upload', 'upload:upload-3', 'rightOnly'],
    ]);

    expect(result.details['upload:upload-1']).toMatchObject({
      entityType: 'upload',
      status: 'changed',
      subtitle: 'Images',
      changes: [
        {
          path: 'md5',
          kind: 'changed',
          leftValue: 'left-md5',
          rightValue: 'right-md5',
        },
        {
          path: 'size',
          kind: 'changed',
          leftValue: 120,
          rightValue: 130,
        },
      ],
    });
  });
});

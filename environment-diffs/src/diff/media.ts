import type { ApiTypes, Client } from '@datocms/cma-client-browser';
import { throwIfCancelled, yieldToMainThread } from '../lib/async';
import { createEnvironmentClient } from '../lib/datocms';
import {
  buildDetailValue,
  determineDiffStatus,
  incrementSummary,
  makeSummaryCounts,
} from '../lib/diff';
import { stableClone } from '../lib/stable';
import type {
  CompareTaskContext,
  MediaDiffResult,
  MediaEntityType,
  MediaSnapshot,
  NormalizedFolder,
  NormalizedUpload,
} from '../types';

function buildFolderPath(
  folder: ApiTypes.UploadCollection,
  folderMap: Map<string, ApiTypes.UploadCollection>,
): string {
  const segments = [folder.label];
  let currentParentId = folder.parent?.id ?? null;

  while (currentParentId) {
    const parentFolder = folderMap.get(currentParentId);
    if (!parentFolder) {
      break;
    }

    segments.unshift(parentFolder.label);
    currentParentId = parentFolder.parent?.id ?? null;
  }

  return segments.join(' / ');
}

function normalizeFolder(
  folder: ApiTypes.UploadCollection,
  folderMap: Map<string, ApiTypes.UploadCollection>,
): NormalizedFolder {
  const path = buildFolderPath(folder, folderMap);

  return {
    rowId: `folder:${folder.id}`,
    id: folder.id,
    label: folder.label,
    parentId: folder.parent?.id ?? null,
    position: folder.position,
    path,
    payload: stableClone({
      label: folder.label,
      parent: folder.parent?.id ?? null,
      position: folder.position,
      path,
    }),
  };
}

function normalizeUpload(
  upload: ApiTypes.Upload,
  folderLookup: Map<string, NormalizedFolder>,
): NormalizedUpload {
  const folderId = upload.upload_collection?.id ?? null;

  return {
    rowId: `upload:${upload.id}`,
    id: upload.id,
    label: upload.filename,
    folderId,
    folderPath: folderId ? folderLookup.get(folderId)?.path ?? null : null,
    payload: stableClone({
      filename: upload.filename,
      basename: upload.basename,
      md5: upload.md5,
      size: upload.size,
      mime_type: upload.mime_type,
      tags: upload.tags,
      upload_collection: folderId,
      folder_path: folderId ? folderLookup.get(folderId)?.path ?? null : null,
      notes: upload.notes,
      copyright: upload.copyright,
      author: upload.author,
      default_field_metadata: upload.default_field_metadata,
    }),
  };
}

async function fetchMediaSnapshot(
  client: Client,
  context: CompareTaskContext,
  stage: number,
  stageLabel: string,
): Promise<MediaSnapshot> {
  context.reportProgress(stage, 4, `${stageLabel}: loading folders`);
  const folders = await client.uploadCollections.list();
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const normalizedFolders = folders
    .map((folder) => normalizeFolder(folder, folderMap))
    .sort((left, right) => left.path.localeCompare(right.path));
  const folderLookup = new Map(
    normalizedFolders.map((folder) => [folder.id, folder]),
  );

  const uploads: NormalizedUpload[] = [];
  let scannedUploads = 0;
  context.reportProgress(stage, 4, `${stageLabel}: scanning uploads`);

  for await (const upload of client.uploads.listPagedIterator()) {
    throwIfCancelled(context.signal);
    uploads.push(normalizeUpload(upload, folderLookup));
    scannedUploads += 1;

    if (scannedUploads % 25 === 0) {
      context.reportProgress(stage, 4, `${stageLabel}: scanned ${scannedUploads} uploads`);
      await yieldToMainThread();
    }
  }

  uploads.sort((left, right) => left.label.localeCompare(right.label));

  return {
    folders: normalizedFolders,
    uploads,
  };
}

export function compareMediaSnapshots(
  left: MediaSnapshot,
  right: MediaSnapshot,
): MediaDiffResult {
  const leftFolders = new Map(left.folders.map((folder) => [folder.rowId, folder]));
  const rightFolders = new Map(right.folders.map((folder) => [folder.rowId, folder]));
  const leftUploads = new Map(left.uploads.map((upload) => [upload.rowId, upload]));
  const rightUploads = new Map(right.uploads.map((upload) => [upload.rowId, upload]));
  const rowIds = Array.from(
    new Set([
      ...leftFolders.keys(),
      ...rightFolders.keys(),
      ...leftUploads.keys(),
      ...rightUploads.keys(),
    ]),
  ).sort((leftId, rightId) => leftId.localeCompare(rightId));

  const summary = {
    folder: makeSummaryCounts(),
    upload: makeSummaryCounts(),
  };
  const rows: MediaDiffResult['rows'] = [];
  const details: MediaDiffResult['details'] = {};

  for (const rowId of rowIds) {
    const leftFolder = leftFolders.get(rowId);
    const rightFolder = rightFolders.get(rowId);
    const leftUpload = leftUploads.get(rowId);
    const rightUpload = rightUploads.get(rowId);

    const entityType: MediaEntityType = rowId.startsWith('folder:') ? 'folder' : 'upload';
    const leftValue = leftFolder?.payload ?? leftUpload?.payload;
    const rightValue = rightFolder?.payload ?? rightUpload?.payload;
    const entity = leftFolder ?? rightFolder ?? leftUpload ?? rightUpload;

    if (!entity) {
      continue;
    }

    const status = determineDiffStatus(leftValue, rightValue);
    incrementSummary(summary[entityType], status);

    const detail = buildDetailValue(
      entity.label,
      entityType === 'folder'
        ? (leftFolder?.path ?? rightFolder?.path)
        : (leftUpload?.folderPath ?? rightUpload?.folderPath ?? 'No folder'),
      status,
      leftValue,
      rightValue,
    );

    details[rowId] = {
      ...detail,
      entityType,
    };

    rows.push({
      id: rowId,
      entityType,
      label: entity.label,
      secondaryLabel:
        entityType === 'folder'
          ? (leftFolder?.path ?? rightFolder?.path)
          : (leftUpload?.folderPath ?? rightUpload?.folderPath ?? 'No folder'),
      status,
      changedCount: detail.changes.length,
    });
  }

  rows.sort((leftRow, rightRow) => {
    if (leftRow.entityType !== rightRow.entityType) {
      return leftRow.entityType.localeCompare(rightRow.entityType);
    }

    return leftRow.label.localeCompare(rightRow.label);
  });

  return {
    summary,
    rows,
    details,
  };
}

export async function buildMediaDiff(
  apiToken: string,
  leftEnv: string,
  rightEnv: string,
  context: CompareTaskContext,
): Promise<MediaDiffResult> {
  const leftClient = createEnvironmentClient(apiToken, leftEnv);
  const rightClient = createEnvironmentClient(apiToken, rightEnv);

  const leftSnapshot = await fetchMediaSnapshot(
    leftClient,
    context,
    1,
    `Loading ${leftEnv}`,
  );
  throwIfCancelled(context.signal);
  const rightSnapshot = await fetchMediaSnapshot(
    rightClient,
    context,
    2,
    `Loading ${rightEnv}`,
  );
  throwIfCancelled(context.signal);
  context.reportProgress(3, 4, 'Comparing media snapshots');
  const result = compareMediaSnapshots(leftSnapshot, rightSnapshot);
  context.reportProgress(4, 4, 'Media diff ready');
  return result;
}

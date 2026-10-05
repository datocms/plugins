import {
  type Client as CmaClient,
  type SimpleSchemaTypes,
  uploadFileOrBlobAndReturnPath,
} from '@datocms/cma-client-browser';
import type { Asset } from './optimizationUtils';

export class AssetChangedError extends Error {
  constructor(id: string) {
    super(`Asset ${id} changed since it was loaded. Replacement was not sent.`);
    this.name = 'AssetChangedError';
  }
}

function unchanged(asset: Asset, current: SimpleSchemaTypes.Upload): boolean {
  return (
    current.id === asset.id &&
    current.path === asset.path &&
    current.size === asset.size &&
    (asset.md5 === undefined || asset.md5 === current.md5) &&
    (asset.updated_at === undefined || asset.updated_at === current.updated_at)
  );
}

/**
 * Replaces only the existing upload's file. IDs, references and every locale's
 * metadata remain intact. The replacement is skipped if someone changed the
 * asset after it was loaded.
 */
export async function replaceAssetFromBlob(
  asset: Asset,
  blob: Blob,
  filename: string,
  client: CmaClient,
): Promise<SimpleSchemaTypes.Upload> {
  if (!asset.id || !asset.path || !filename || blob.size === 0) {
    throw new Error('Asset, replacement file and filename are required');
  }
  const path = await uploadFileOrBlobAndReturnPath(client, blob, { filename });
  const current = await client.uploads.find(asset.id);
  if (!unchanged(asset, current)) throw new AssetChangedError(asset.id);
  return client.uploads.update(asset.id, { path });
}

import type { Client } from '@datocms/cma-client-browser';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Thumbnails render at 40px, so ask imgix for 2x. */
const THUMBNAIL_PARAMS = 'w=80&h=80&fit=crop&auto=format';

/** Upload ID → thumbnail URL, or null for files that aren't images. */
export type ThumbnailMap = ReadonlyMap<string, string | null>;

export function thumbnailUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${THUMBNAIL_PARAMS}`;
}

/** The thumbnail URL of each upload (null when it isn't an image), or null on failure. */
async function fetchThumbnails(
  getClient: () => Client,
  ids: readonly string[],
): Promise<Map<string, string | null> | null> {
  try {
    const uploads = await getClient().uploads.list({
      filter: { ids: ids.join(',') },
      page: { limit: ids.length },
    });
    return new Map(
      uploads.map((upload) => [
        upload.id,
        upload.is_image ? thumbnailUrl(upload.url) : null,
      ]),
    );
  } catch {
    return null;
  }
}

/** Stores fetched thumbnails; an upload missing from the answer was deleted. */
function applyThumbnails(
  cache: Map<string, string | null>,
  requestedIds: readonly string[],
  found: ReadonlyMap<string, string | null>,
) {
  for (const id of requestedIds) {
    const url = found.get(id);
    if (url === undefined) cache.delete(id);
    else cache.set(id, url);
  }
}

/**
 * Fetches the uploads behind the visible rows' images, in one request per
 * page of rows. A change of `resetKey` (a reload) fetches them again.
 * Rows without a resolved image show no thumbnail at all.
 */
export function useThumbnails(
  getClient: () => Client,
  resetKey: unknown,
  uploadIds: readonly string[],
): ThumbnailMap {
  const cache = useRef(new Map<string, string | null>());
  const requested = useRef(new Set<string>());
  const [version, setVersion] = useState(0);

  const getClientRef = useRef(getClient);
  getClientRef.current = getClient;

  // A reload may bring replaced files: fetch every thumbnail again, but keep
  // showing the previous ones until the new answers arrive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger
  useEffect(() => {
    requested.current = new Set();
    setVersion((value) => value + 1);
  }, [resetKey]);

  const key = [...new Set(uploadIds)].sort().join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-checks after a reset
  useEffect(() => {
    const missing = key
      .split(',')
      .filter((id) => id && !requested.current.has(id));
    if (missing.length === 0) return;
    const batch = requested.current;
    for (const id of missing) batch.add(id);

    void fetchThumbnails(getClientRef.current, missing).then((found) => {
      if (requested.current !== batch) return;
      if (!found) {
        // Thumbnails are decoration: allow a later render to ask again.
        for (const id of missing) batch.delete(id);
        return;
      }
      applyThumbnails(cache.current, missing, found);
      setVersion((value) => value + 1);
    });
  }, [key, version]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new snapshot per fetched batch
  return useMemo(() => new Map(cache.current), [version]);
}

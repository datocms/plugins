export const ASSET_PAGE_SIZE = 100;
export const ACTIVITY_LOG_LIMIT = 300;

/** Only copy the visible page, regardless of the size of the result set. */
export function getAssetPage<T>(assets: readonly T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(assets.length / ASSET_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const start = page * ASSET_PAGE_SIZE;
  const end = Math.min(start + ASSET_PAGE_SIZE, assets.length);

  return {
    assets: assets.slice(start, end),
    page,
    totalPages,
    start,
    end,
  };
}

/** Activity entries arrive newest first; keep that order when limiting them. */
export function getVisibleActivityLog<T>(
  log: readonly T[],
  droppedLogCount = 0,
) {
  const entries = log.slice(0, ACTIVITY_LOG_LIMIT);
  const totalEntries = log.length + droppedLogCount;

  return {
    entries,
    totalEntries,
    omittedEntries: totalEntries - entries.length,
  };
}

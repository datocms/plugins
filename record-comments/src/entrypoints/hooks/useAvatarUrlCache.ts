/**
 * Avatar URL Cache Hook
 *
 * Manages caching of avatar URLs for user profile overrides.
 * Fetches asset URLs from DatoCMS and caches them for performance.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Client } from '@datocms/cma-client-browser';
import type { UserOverrides } from '@/entrypoints/utils/pluginParams';
import { logError } from '@/utils/errorLogger';

/**
 * Map of upload IDs to their resolved avatar URLs.
 */
export type AvatarCache = Map<string, string>;

/**
 * Return type for the useAvatarUrlCache hook.
 */
export type AvatarCacheResult = {
  /** Map of uploadId to resolved avatar URL */
  cache: AvatarCache;
  /** Whether avatar URLs are currently being fetched */
  isLoading: boolean;
  /** Force refresh all cached URLs */
  refresh: () => void;
  /** Get a specific avatar URL from cache (returns undefined if not cached) */
  getAvatarUrl: (uploadId: string) => string | undefined;
};

/**
 * Extract all unique upload IDs from user overrides.
 */
function extractUploadIds(overrides: UserOverrides | undefined): string[] {
  if (!overrides) {
    return [];
  }

  const uploadIds = new Set<string>();

  for (const override of Object.values(overrides)) {
    if (override.uploadId) {
      uploadIds.add(override.uploadId);
    }
  }

  return Array.from(uploadIds);
}

/**
 * Build an imgix URL for avatar display.
 * Uses consistent sizing and format optimization.
 *
 * @param baseUrl - The raw asset URL from DatoCMS
 * @param size - Avatar size in pixels (default 96 for 2x display)
 * @returns Optimized avatar URL
 */
function buildAvatarUrl(baseUrl: string, size = 96): string {
  // DatoCMS assets use imgix, so we can add transformation params
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}w=${size}&h=${size}&fit=crop&auto=format`;
}

/**
 * Hook that manages caching of avatar URLs for user profile overrides.
 *
 * Behavior:
 * - Extracts all uploadIds from user overrides
 * - Batch-fetches asset URLs from DatoCMS
 * - Caches results for the session
 * - Only fetches new uploadIds (incremental updates)
 *
 * @param client - DatoCMS CMA client (or null if not available)
 * @param overrides - User overrides from plugin parameters
 * @returns Cache state and utilities
 */
export function useAvatarUrlCache(
  client: Client | null,
  overrides: UserOverrides | undefined
): AvatarCacheResult {
  const [cache, setCache] = useState<AvatarCache>(() => new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Track which uploadIds we've already fetched to avoid duplicate requests
  const fetchedIdsRef = useRef(new Set<string>());

  // Track whether a fetch is in progress to prevent concurrent fetches
  const isFetchingRef = useRef(false);

  // Counter to force re-evaluation of pendingUploadIds after refresh()
  // Incrementing this triggers the useMemo to re-compute even if allUploadIds hasn't changed
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Extract uploadIds and find any that haven't been fetched yet
  const allUploadIds = useMemo(
    () => extractUploadIds(overrides),
    [overrides]
  );

  const pendingUploadIds = useMemo(
    () => allUploadIds.filter((id) => !fetchedIdsRef.current.has(id)),
    // refreshCounter ensures this re-computes after refresh() clears fetchedIdsRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allUploadIds, refreshCounter]
  );

  // Fetch avatar URLs for pending upload IDs
  const fetchAvatars = useCallback(async () => {
    if (!client || pendingUploadIds.length === 0 || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);

    try {
      // Fetch all uploads in parallel
      const results = await Promise.allSettled(
        pendingUploadIds.map(async (uploadId) => {
          const upload = await client.uploads.find(uploadId);
          return { uploadId, url: upload.url };
        })
      );

      // Process results and update cache
      setCache((prevCache) => {
        const newCache = new Map(prevCache);

        results.forEach((result, index) => {
          const uploadId = pendingUploadIds[index];
          fetchedIdsRef.current.add(uploadId);

          if (result.status === 'fulfilled' && result.value.url) {
            newCache.set(uploadId, buildAvatarUrl(result.value.url));
          }
        });

        return newCache;
      });
    } catch (error) {
      logError('Failed to fetch avatar URLs', error);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [client, pendingUploadIds]);

  // Fetch avatars when there are pending IDs
  useEffect(() => {
    if (pendingUploadIds.length > 0) {
      fetchAvatars();
    }
  }, [pendingUploadIds, fetchAvatars]);

  // Force refresh all cached URLs
  const refresh = useCallback(() => {
    fetchedIdsRef.current.clear();
    setCache(new Map());
    // Increment counter to force pendingUploadIds to re-compute
    // This ensures the effect will trigger a refetch even if allUploadIds hasn't changed
    setRefreshCounter((c) => c + 1);
  }, []);

  // Get a specific avatar URL from cache
  const getAvatarUrl = useCallback(
    (uploadId: string): string | undefined => {
      return cache.get(uploadId);
    },
    [cache]
  );

  return {
    cache,
    isLoading,
    refresh,
    getAvatarUrl,
  };
}

/**
 * Synchronously fetch an avatar URL for a single upload.
 * Useful for settings page where we need immediate feedback.
 *
 * @param client - DatoCMS CMA client
 * @param uploadId - The upload ID to fetch
 * @returns Promise resolving to the avatar URL or null
 */
export async function fetchSingleAvatarUrl(
  client: Client,
  uploadId: string
): Promise<string | null> {
  try {
    const upload = await client.uploads.find(uploadId);
    if (upload.url) {
      return buildAvatarUrl(upload.url);
    }
    return null;
  } catch (error) {
    logError('Failed to fetch avatar URL', error, { uploadId });
    return null;
  }
}

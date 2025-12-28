import { useCallback, useMemo } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import type { Client } from '@datocms/cma-client-browser';
import { loadAllFields } from '@utils/fieldLoader';
import {
  ownerToUserInfo,
  regularUserToUserInfo,
  ssoUserToUserInfo,
  type UserInfo,
} from '@utils/userTransformers';
import type { FieldInfo, ModelInfo } from './useMentions';
import { getValidItemTypes } from '@utils/itemTypeUtils';
import { logError } from '@/utils/errorLogger';
import { useAsyncOperation } from './useAsyncOperation';
import { parsePluginParams, type UserOverrides } from '@utils/pluginParams';
import { createUserKey, type UserType, type TypedUserInfo } from '@utils/userDisplayResolver';
import { useAvatarUrlCache } from './useAvatarUrlCache';

type ProjectDataContext = RenderItemFormSidebarCtx | RenderPageCtx;

type UseProjectDataOptions = {
  loadFields?: boolean;
  /** Optional CMA client for fetching avatar URLs from upload overrides */
  client?: Client | null;
};

type LoadError = {
  source: string;
  message: string;
};

type UseProjectDataReturn = {
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  loadError: LoadError | null;
  retry: () => void;
  /** User overrides from plugin parameters */
  userOverrides: UserOverrides | undefined;
  /** Users with type information for override resolution */
  typedUsers: TypedUserInfo[];
};

/**
 * Type guard to check if context is sidebar context (has itemType)
 */
function isSidebarContext(ctx: ProjectDataContext): ctx is RenderItemFormSidebarCtx {
  return 'itemType' in ctx;
}

/**
 * Hook for loading project-level data (users, models, fields)
 * This data is used for mention dropdowns.
 *
 * @param ctx - Either sidebar or page context
 * @param options.loadFields - Set to true to load fields (only works in sidebar context)
 */
export function useProjectData(
  ctx: ProjectDataContext,
  options: UseProjectDataOptions = {}
): UseProjectDataReturn {
  const { loadFields = false, client = null } = options;

  /**
   * STABLE KEY PATTERN FOR REFERENCE-UNSTABLE DEPENDENCIES:
   * --------------------------------------------------------
   * ctx.itemTypes changes reference on every subscription reconnect, even when
   * the actual model list hasn't changed. This would cause projectModels to
   * recalculate unnecessarily, triggering downstream re-renders.
   *
   * Solution: Create a stable string key from the model IDs. The useMemo below
   * uses this key as a dependency instead of ctx.itemTypes.
   *
   * PERFORMANCE ANALYSIS:
   * - For 100 models: ~100 string extractions, O(100 log 100) sort, O(100) join
   * - Total: ~1ms even on slow devices
   * - Runs only when ctx.itemTypes reference changes (rare - subscription reconnects)
   * - Prevents much more expensive downstream recalculations
   *
   * ALTERNATIVES CONSIDERED:
   * - Deep equality check: More expensive than string comparison
   * - Hashing: Same complexity, less readable
   * - External memoization library: Overkill for this use case
   *
   * The sorted IDs ensure order-independent comparison (model list order may vary).
   */
  const itemTypesStableKey = useMemo(() => {
    const itemTypes = getValidItemTypes(ctx.itemTypes);
    return itemTypes.map((it) => it.id).sort().join(',');
  }, [ctx.itemTypes]);

  // Compute project models with the stable key as dependency.
  // This ensures projectModels only recalculates when models actually change,
  // not when ctx.itemTypes reference changes due to subscription reconnects.
  const projectModels = useMemo(() => {
    const itemTypes = getValidItemTypes(ctx.itemTypes);
    return itemTypes.map((itemType): ModelInfo => ({
      id: itemType.id,
      apiKey: itemType.attributes.api_key,
      name: itemType.attributes.name,
      isBlockModel: itemType.attributes.modular_block,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemTypesStableKey]);

  // Extract stable identifiers to prevent infinite refetch loops
  // ctx object changes every render, but these specific values are stable
  const itemTypeId = isSidebarContext(ctx) ? ctx.itemType.id : null;
  const siteId = ctx.site.id;

  // Field loading async function - memoized to prevent unnecessary re-runs
  const loadFieldsAsync = useCallback(async () => {
    // This callback is only called when enabled is true,
    // but we still need the type guard for TypeScript
    if (!isSidebarContext(ctx)) {
      return [];
    }
    return loadAllFields(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemTypeId]);

  // Load fields for the current model (for field mentions)
  // This loads top-level fields and recursively loads nested fields from modular content/structured text
  // Only runs when loadFields is true and we're in sidebar context
  const {
    data: modelFields,
    error: fieldError,
    retry: retryFields,
  } = useAsyncOperation(loadFieldsAsync, [itemTypeId], {
    enabled: loadFields && isSidebarContext(ctx) && itemTypeId !== null,
    operationName: 'load fields',
    errorContext: { itemTypeId },
  });

  // Parse plugin parameters to get user overrides
  const pluginParams = useMemo(
    () => parsePluginParams(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters]
  );
  const userOverrides = pluginParams.userOverrides;

  // Cache avatar URLs for upload ID overrides
  // This fetches asset URLs from DatoCMS and caches them for the session
  const { getAvatarUrl: getCachedAvatarUrl } = useAvatarUrlCache(client, userOverrides);

  // User loading async function - memoized to prevent unnecessary re-runs
  // Returns both flat user list and typed users for override resolution
  const loadUsersAsync = useCallback(async (): Promise<{
    allUsers: UserInfo[];
    typedUsers: TypedUserInfo[];
  }> => {
    // Use Promise.allSettled to handle partial failures gracefully
    // SSO users may fail if not configured, but regular users should still load
    const results = await Promise.allSettled([
      ctx.loadUsers(),
      ctx.loadSsoUsers(),
    ]);

    const regularUsersRaw = results[0].status === 'fulfilled' ? results[0].value : [];
    const ssoUsersRaw = results[1].status === 'fulfilled' ? results[1].value : [];

    // Log if either call failed (for debugging) but continue with partial data
    if (results[0].status === 'rejected') {
      logError('Failed to load regular users', results[0].reason, { siteId });
    }
    if (results[1].status === 'rejected') {
      logError('Failed to load SSO users', results[1].reason, { siteId });
    }

    // If BOTH user sources failed, throw an error so the UI can show an error state.
    // This prevents the confusing scenario of showing an empty user dropdown with no
    // indication that something went wrong. Partial failures are acceptable (SSO may
    // not be configured), but total failure should be surfaced to the user.
    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      throw new Error('Failed to load users. Please check your connection and try again.');
    }

    // Build typed users array with user type information
    const typedUsers: TypedUserInfo[] = [];

    // Add regular users
    for (const user of regularUsersRaw) {
      const userInfo = regularUserToUserInfo(user, 48);
      typedUsers.push({ user: userInfo, userType: 'user' as UserType });
    }

    // Add SSO users
    for (const user of ssoUsersRaw) {
      const userInfo = ssoUserToUserInfo(user, 48);
      typedUsers.push({ user: userInfo, userType: 'sso' as UserType });
    }

    // Add project owner if not already in the list
    const ownerInfo = ownerToUserInfo(ctx.owner, 48);
    const ownerType: UserType = ctx.owner.type === 'organization' ? 'org' : 'account';
    const ownerAlreadyIncluded = typedUsers.some((tu) => tu.user.id === ownerInfo.id);
    if (!ownerAlreadyIncluded) {
      typedUsers.unshift({ user: ownerInfo, userType: ownerType });
    }

    // Also return flat user list for backward compatibility
    const allUsers = typedUsers.map((tu) => tu.user);

    return { allUsers, typedUsers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Load users for the project (for user mentions)
  const {
    data: userData,
    error: userError,
    retry: retryUsers,
  } = useAsyncOperation(loadUsersAsync, [siteId], {
    enabled: true,
    operationName: 'load users',
    errorContext: { siteId },
  });

  // Combined retry function that retries both operations
  const retry = useCallback(() => {
    retryFields();
    retryUsers();
  }, [retryFields, retryUsers]);

  // Determine the current load error - prefer field error if both exist
  const currentLoadError = fieldError || userError;

  // PERFORMANCE: Memoize fallback empty arrays to maintain stable references.
  // Without this, `projectUsers ?? []` creates a new array reference on each render
  // when data is null/undefined, which breaks React.memo comparisons in child components
  // (e.g., Comment's arePropsEqual checks `prev.projectUsers === next.projectUsers`).
  //
  // Also apply name and avatar overrides here so all consumers (dropdowns, mentions, etc.)
  // see the customized display names and avatars automatically.
  const stableProjectUsers = useMemo(() => {
    const users = userData?.allUsers ?? [];
    const typedUsers = userData?.typedUsers ?? [];

    if (!userOverrides || Object.keys(userOverrides).length === 0) {
      return users;
    }

    // Apply name and avatar overrides to users
    return users.map((user, index) => {
      const typedUser = typedUsers[index];
      if (!typedUser) return user;

      const userKey = createUserKey(user.id, typedUser.userType);
      const override = userOverrides[userKey];

      if (!override) {
        return user;
      }

      // Build the updated user with overrides
      const updatedUser = { ...user };

      if (override.nameOverride) {
        updatedUser.name = override.nameOverride;
      }

      if (override.uploadId) {
        const cachedAvatarUrl = getCachedAvatarUrl(override.uploadId);
        if (cachedAvatarUrl) {
          updatedUser.avatarUrl = cachedAvatarUrl;
        }
      }

      return updatedUser;
    });
  }, [userData, userOverrides, getCachedAvatarUrl]);

  const stableTypedUsers = useMemo(
    () => userData?.typedUsers ?? [],
    [userData]
  );

  const stableModelFields = useMemo(
    () => modelFields ?? [],
    [modelFields]
  );

  return {
    projectUsers: stableProjectUsers,
    projectModels,
    modelFields: stableModelFields,
    loadError: currentLoadError,
    retry,
    userOverrides,
    typedUsers: stableTypedUsers,
  };
}

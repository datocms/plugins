/**
 * User Display Resolver
 *
 * Centralized utilities for resolving user display information with overrides.
 * Handles the application of custom names and avatars across the plugin.
 */

import type { UserInfo } from './userTransformers';
import type { UserOverrides, UserOverride } from './pluginParams';
import { logWarn } from '@/utils/errorLogger';

/**
 * User type for creating composite keys.
 * - 'user': Regular DatoCMS collaborator
 * - 'sso': SSO user
 * - 'account': Individual account owner
 * - 'org': Organization owner
 */
export type UserType = 'user' | 'sso' | 'account' | 'org';

/**
 * Extended user info that tracks override state and original values.
 */
export type ResolvedUserInfo = UserInfo & {
  /** Whether any override is applied to this user */
  isOverridden: boolean;
  /** Original name before override */
  originalName: string;
  /** Original avatar URL before override */
  originalAvatarUrl: string | null;
  /** The user type (for key generation) */
  userType: UserType;
  /** The composite key for this user */
  compositeKey: string;
};

/**
 * Creates a composite key for a user in the format "{type}:{id}".
 * This key is used to look up overrides in the UserOverrides map.
 *
 * @param userId - The user's ID from DatoCMS
 * @param userType - The type of user
 * @returns Composite key string like "user:123" or "org:456"
 */
export function createUserKey(userId: string, userType: UserType): string {
  return `${userType}:${userId}`;
}

/**
 * Parses a composite key back into its components.
 *
 * Logs warnings for invalid keys in development mode to aid debugging
 * user override configuration issues. Production logs are suppressed
 * to avoid noise from edge cases.
 *
 * @param compositeKey - Key in format "{type}:{id}"
 * @returns Object with userType and userId, or null if invalid
 */
export function parseUserKey(
  compositeKey: string
): { userType: UserType; userId: string } | null {
  const colonIndex = compositeKey.indexOf(':');
  if (colonIndex === -1) {
    logWarn('parseUserKey: Invalid key format - missing colon separator', {
      compositeKey,
      hint: 'Expected format is "{type}:{id}" (e.g., "user:123", "sso:456")',
    });
    return null;
  }

  const type = compositeKey.slice(0, colonIndex);
  const id = compositeKey.slice(colonIndex + 1);

  if (!['user', 'sso', 'account', 'org'].includes(type)) {
    logWarn('parseUserKey: Invalid user type in composite key', {
      compositeKey,
      extractedType: type,
      validTypes: ['user', 'sso', 'account', 'org'],
    });
    return null;
  }

  if (!id) {
    logWarn('parseUserKey: Empty user ID in composite key', {
      compositeKey,
      hint: 'The ID portion after the colon must not be empty',
    });
    return null;
  }

  return { userType: type as UserType, userId: id };
}

/**
 * Gets the override for a specific user if one exists.
 *
 * @param userId - The user's ID
 * @param userType - The type of user
 * @param overrides - The overrides map from plugin parameters
 * @returns The override object or undefined
 */
export function getUserOverride(
  userId: string,
  userType: UserType,
  overrides: UserOverrides | undefined
): UserOverride | undefined {
  if (!overrides) {
    return undefined;
  }

  const key = createUserKey(userId, userType);
  return overrides[key];
}

/**
 * Resolves a user's display information by applying any configured overrides.
 *
 * @param user - The base user info from DatoCMS
 * @param userType - The type of user
 * @param overrides - The overrides map from plugin parameters
 * @param avatarCache - Cache mapping uploadId to resolved avatar URLs
 * @returns Resolved user info with overrides applied
 */
export function resolveUserDisplay(
  user: UserInfo,
  userType: UserType,
  overrides: UserOverrides | undefined,
  avatarCache?: Map<string, string>
): ResolvedUserInfo {
  const compositeKey = createUserKey(user.id, userType);
  const override = overrides?.[compositeKey];

  const baseResult: ResolvedUserInfo = {
    ...user,
    isOverridden: false,
    originalName: user.name,
    originalAvatarUrl: user.avatarUrl,
    userType,
    compositeKey,
  };

  if (!override) {
    return baseResult;
  }

  // Apply name override if present
  const resolvedName = override.nameOverride ?? user.name;

  // Apply avatar override if present and cached
  let resolvedAvatarUrl = user.avatarUrl;
  if (override.uploadId && avatarCache?.has(override.uploadId)) {
    resolvedAvatarUrl = avatarCache.get(override.uploadId) ?? user.avatarUrl;
  }

  const hasNameOverride = override.nameOverride !== undefined;
  const hasAvatarOverride =
    override.uploadId !== undefined && avatarCache?.has(override.uploadId);

  return {
    ...baseResult,
    name: resolvedName,
    avatarUrl: resolvedAvatarUrl,
    isOverridden: Boolean(hasNameOverride || hasAvatarOverride),
  };
}

/**
 * Represents a user with their type information for matching.
 */
export type TypedUserInfo = {
  user: UserInfo;
  userType: UserType;
};

/**
 * Matches a comment author (identified by name and email) to a known user.
 * This is necessary because comments store author as {name, email} without IDs.
 *
 * Matching strategy:
 * 1. Exact email match (most reliable)
 * 2. Exact name match (fallback for SSO users without email)
 *
 * @param author - The comment author info
 * @param allUsers - Array of all known users with their types
 * @returns The matched user with type, or null if no match
 */
export function matchAuthorToUser(
  author: { name: string; email: string },
  allUsers: TypedUserInfo[]
): TypedUserInfo | null {
  const authorEmail = author.email.toLowerCase().trim();
  const authorName = author.name.toLowerCase().trim();

  // Primary: exact email match (most reliable)
  if (authorEmail) {
    const emailMatch = allUsers.find(
      (u) => u.user.email && u.user.email.toLowerCase().trim() === authorEmail
    );
    if (emailMatch) {
      return emailMatch;
    }
  }

  // Secondary: exact name match (for SSO users without email-like username)
  if (authorName) {
    const nameMatch = allUsers.find(
      (u) => u.user.name.toLowerCase().trim() === authorName
    );
    if (nameMatch) {
      return nameMatch;
    }
  }

  return null;
}

/**
 * Resolves author display info by matching to a known user and applying overrides.
 * Falls back to original author info if no user match is found.
 *
 * @param author - The comment author info
 * @param allUsers - Array of all known users with their types
 * @param overrides - The overrides map from plugin parameters
 * @param avatarCache - Cache mapping uploadId to resolved avatar URLs
 * @param fallbackAvatarUrl - Avatar URL to use if no match and no override
 * @returns Resolved display info (name and avatarUrl)
 */
export function resolveAuthorDisplay(
  author: { name: string; email: string },
  allUsers: TypedUserInfo[],
  overrides: UserOverrides | undefined,
  avatarCache?: Map<string, string>,
  fallbackAvatarUrl?: string | null
): { name: string; avatarUrl: string | null; isOverridden: boolean } {
  const match = matchAuthorToUser(author, allUsers);

  if (!match) {
    // No user match - use original author info
    return {
      name: author.name,
      avatarUrl: fallbackAvatarUrl ?? null,
      isOverridden: false,
    };
  }

  // Apply overrides to the matched user
  const resolved = resolveUserDisplay(
    match.user,
    match.userType,
    overrides,
    avatarCache
  );

  return {
    name: resolved.name,
    avatarUrl: resolved.avatarUrl,
    isOverridden: resolved.isOverridden,
  };
}

/**
 * Resolves an upvoter's display name using overrides.
 * Upvoters are stored as {name, email} similar to authors.
 *
 * @param upvoter - The upvoter info
 * @param allUsers - Array of all known users with their types
 * @param overrides - The overrides map from plugin parameters
 * @returns The resolved display name
 */
export function resolveUpvoterName(
  upvoter: { name: string; email: string },
  allUsers: TypedUserInfo[],
  overrides: UserOverrides | undefined
): string {
  const match = matchAuthorToUser(upvoter, allUsers);

  if (!match) {
    // No match - use original name or email prefix
    return upvoter.name || upvoter.email.split('@')[0];
  }

  const override = getUserOverride(match.user.id, match.userType, overrides);

  return override?.nameOverride ?? match.user.name;
}

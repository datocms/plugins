import { getGravatarUrl } from '@/utils/helpers';

/**
 * Safely extract a string from an unknown value
 */
function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export type UserInfo = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

type RegularUser = {
  id: string;
  attributes: {
    email: string;
    full_name?: string | null;
  };
};

type SsoUser = {
  id: string;
  attributes: {
    username: string;
    first_name?: string | null;
    last_name?: string | null;
  };
};

type CurrentUser = {
  attributes: Record<string, unknown>;
};


/**
 * Safely extract the local part of an email address (before @).
 * Returns the original string if it doesn't contain '@'.
 *
 * @example
 * extractEmailLocalPart('user@example.com') // 'user'
 * extractEmailLocalPart('johndoe') // 'johndoe'
 * extractEmailLocalPart('') // ''
 */
function extractEmailLocalPart(emailOrUsername: string): string {
  const atIndex = emailOrUsername.indexOf('@');
  return atIndex > 0 ? emailOrUsername.slice(0, atIndex) : emailOrUsername;
}

/**
 * Transform a regular DatoCMS user to UserInfo
 */
export function regularUserToUserInfo(user: RegularUser, avatarSize = 48): UserInfo {
  return {
    id: user.id,
    email: user.attributes.email,
    name: user.attributes.full_name ?? extractEmailLocalPart(user.attributes.email),
    avatarUrl: getGravatarUrl(user.attributes.email, avatarSize),
  };
}

/**
 * Transform an SSO user to UserInfo
 *
 * ============================================================================
 * KNOWN LIMITATION: SSO USERS DO NOT HAVE EMAIL IN DATOCMS SDK
 * ============================================================================
 *
 * The DatoCMS Plugin SDK does not expose an `email` field for SSO users.
 * SSO users only have:
 * - `username`: An identifier from the SSO provider (may or may not be an email)
 * - `first_name`, `last_name`: Optional name fields
 *
 * IMPLICATIONS:
 * 1. The `email` field in the returned UserInfo contains the SSO username,
 *    which is NOT guaranteed to be a valid email address.
 *
 * 2. Gravatar URLs are only generated if the username looks like an email
 *    (contains '@'). Otherwise, avatarUrl will be null.
 *
 * 3. Any email-based operations (sending notifications, email matching) will
 *    NOT work correctly for SSO users whose username is not their email.
 *
 * WHY THIS CANNOT BE FULLY FIXED:
 * - The DatoCMS SDK (ctx.loadSsoUsers()) does not return email addresses
 * - This is a limitation of the DatoCMS API, not this plugin
 * - Accessing SSO provider data directly would require additional auth
 *
 * POTENTIAL FUTURE FIX:
 * If DatoCMS adds email to the SSO user attributes, update the SsoUser type
 * and use `user.attributes.email` instead of `user.attributes.username`.
 * ============================================================================
 */
export function ssoUserToUserInfo(user: SsoUser, avatarSize = 48): UserInfo {
  // username is used as the identifier - it may or may not be an email
  const username = user.attributes.username;

  const firstName = user.attributes.first_name ?? '';
  const lastName = user.attributes.last_name ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || extractEmailLocalPart(username);

  // Only generate Gravatar URL if username looks like an email (contains @)
  // Otherwise Gravatar will just return the default avatar anyway
  const looksLikeEmail = username.includes('@');
  const avatarUrl = looksLikeEmail ? getGravatarUrl(username, avatarSize) : null;

  return {
    id: user.id,
    // Note: This is the SSO username, not a guaranteed email address
    // See function documentation for details on this limitation
    email: username,
    name: fullName,
    avatarUrl,
  };
}

/**
 * Transform the project owner (Account or Organization) to UserInfo
 *
 * ============================================================================
 * TYPE FLEXIBILITY RATIONALE - DO NOT "FIX" WITHOUT READING
 * ============================================================================
 *
 * The `owner` parameter uses `Record<string, unknown>` intersection intentionally:
 *
 * WHY STRICT TYPING WON'T WORK:
 * - DatoCMS SDK types `ctx.account` as a generic object without precise property types
 * - Owner data structure varies by account type (individual vs organization)
 * - Properties may be at top level OR nested in `attributes` depending on SDK version
 * - Account: has email, first_name, last_name
 * - Organization: has name only, no email
 *
 * WHY THIS IS SAFE:
 * - We use `getString()` helper that safely returns null for missing/invalid properties
 * - All property accesses go through this null-safe extraction
 * - We provide sensible fallbacks when properties are missing
 *
 * WHAT WOULD BREAK IF STRICTLY TYPED:
 * - Type like `type Owner = { id: string; type: 'account'; email: string; ... }`
 *   would require callers to cast SDK data, moving the unsafety to call sites
 * - Union types for account/org would require type guards for every property access
 *
 * ============================================================================
 */
export function ownerToUserInfo(
  owner: { id: string; type: string } & Record<string, unknown>,
  avatarSize = 48
): UserInfo {
  // Check for attributes object (some SDK types nest data there)
  const attrs = (owner.attributes ?? {}) as Record<string, unknown>;

  if (owner.type === 'account') {
    // Account: email can be at top level or in attributes
    const email = getString(owner.email) ?? getString(attrs.email) ?? '';
    const firstName = getString(owner.first_name) ?? getString(attrs.first_name) ?? '';
    const lastName = getString(owner.last_name) ?? getString(attrs.last_name) ?? '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || extractEmailLocalPart(email) || 'Account Owner';
    return {
      id: String(owner.id),
      email,
      name: fullName,
      avatarUrl: email ? getGravatarUrl(email, avatarSize) : null,
    };
  }

  // Organization owner: name can be at top level or in attributes
  const orgName = getString(owner.name) ?? getString(attrs.name) ?? 'Organization';
  return {
    id: String(owner.id),
    email: '',
    name: orgName,
    avatarUrl: null,
  };
}

/**
 * Get basic info from the current user context
 */
export function getCurrentUserInfo(currentUser: CurrentUser): { email: string; name: string } {
  const attrs = currentUser.attributes;
  const email = getString(attrs.email) ?? 'unknown@email.com';
  const name = getString(attrs.full_name) ?? getString(attrs.name) ?? extractEmailLocalPart(email);
  return { email, name };
}

/**
 * Transform both regular and SSO users to a unified UserInfo array
 */
export function transformUsersToUserInfo(
  regularUsers: RegularUser[],
  ssoUsers: SsoUser[],
  avatarSize = 48
): UserInfo[] {
  return [
    ...regularUsers.map((user) => regularUserToUserInfo(user, avatarSize)),
    ...ssoUsers.map((user) => ssoUserToUserInfo(user, avatarSize)),
  ];
}

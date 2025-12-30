import { getGravatarUrl } from '@/utils/helpers';

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


/** Extract local part of email (before @), or return original if no @. */
function extractEmailLocalPart(emailOrUsername: string): string {
  const atIndex = emailOrUsername.indexOf('@');
  return atIndex > 0 ? emailOrUsername.slice(0, atIndex) : emailOrUsername;
}

export function regularUserToUserInfo(user: RegularUser, avatarSize = 48): UserInfo {
  return {
    id: user.id,
    email: user.attributes.email,
    name: user.attributes.full_name ?? extractEmailLocalPart(user.attributes.email),
    avatarUrl: getGravatarUrl(user.attributes.email, avatarSize),
  };
}

// SSO LIMITATION: DatoCMS SDK doesn't expose email for SSO users.
// `email` field contains username (may not be valid email). Gravatar only generated if username has '@'.
export function ssoUserToUserInfo(user: SsoUser, avatarSize = 48): UserInfo {
  const username = user.attributes.username;

  const firstName = user.attributes.first_name ?? '';
  const lastName = user.attributes.last_name ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || extractEmailLocalPart(username);
  const looksLikeEmail = username.includes('@');
  const avatarUrl = looksLikeEmail ? getGravatarUrl(username, avatarSize) : null;

  return {
    id: user.id,
    email: username,
    name: fullName,
    avatarUrl,
  };
}

// Record<string, unknown> intersection is intentional - SDK types ctx.account generically,
// and structure varies (account vs org, top level vs attributes). getString() ensures safety.
export function ownerToUserInfo(
  owner: { id: string; type: string } & Record<string, unknown>,
  avatarSize = 48
): UserInfo {
  const attrs = (owner.attributes ?? {}) as Record<string, unknown>;

  if (owner.type === 'account') {
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

  const orgName = getString(owner.name) ?? getString(attrs.name) ?? 'Organization';
  return {
    id: String(owner.id),
    email: '',
    name: orgName,
    avatarUrl: null,
  };
}

export function getCurrentUserInfo(currentUser: CurrentUser): { email: string; name: string } {
  const attrs = currentUser.attributes;
  const email = getString(attrs.email) ?? 'unknown@email.com';
  const name = getString(attrs.full_name) ?? getString(attrs.name) ?? extractEmailLocalPart(email);
  return { email, name };
}

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

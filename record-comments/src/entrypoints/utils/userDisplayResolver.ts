import type { UserInfo } from './userTransformers';
import { normalizeForComparison } from '@/utils/helpers';

/** 'user' = regular collaborator, 'sso' = SSO user, 'account' = owner, 'org' = org owner */
export type UserType = 'user' | 'sso' | 'account' | 'org';

export type TypedUserInfo = {
  user: UserInfo;
  userType: UserType;
};

/** Matches by email first, then name (for SSO users without email). */
export function matchAuthorToUser(
  author: { name: string; email: string },
  allUsers: TypedUserInfo[]
): TypedUserInfo | null {
  const authorEmail = normalizeForComparison(author.email);
  const authorName = normalizeForComparison(author.name);

  if (authorEmail) {
    const emailMatch = allUsers.find((u) => {
      const userEmail = normalizeForComparison(u.user.email);
      return userEmail && userEmail === authorEmail;
    });
    if (emailMatch) {
      return emailMatch;
    }
  }

  if (authorName) {
    const nameMatch = allUsers.find((u) => {
      const userName = normalizeForComparison(u.user.name);
      return userName === authorName;
    });
    if (nameMatch) {
      return nameMatch;
    }
  }

  return null;
}

export function resolveUpvoterName(
  upvoter: { name: string; email: string },
  allUsers: TypedUserInfo[]
): string {
  const match = matchAuthorToUser(upvoter, allUsers);

  if (!match) {
    return upvoter.name || upvoter.email.split('@')[0];
  }

  return match.user.name;
}

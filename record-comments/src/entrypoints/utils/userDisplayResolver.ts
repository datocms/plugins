import type { UserInfo } from './userTransformers';

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
  const authorEmail = author.email.toLowerCase().trim();
  const authorName = author.name.toLowerCase().trim();

  if (authorEmail) {
    const emailMatch = allUsers.find(
      (u) => u.user.email && u.user.email.toLowerCase().trim() === authorEmail
    );
    if (emailMatch) {
      return emailMatch;
    }
  }

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

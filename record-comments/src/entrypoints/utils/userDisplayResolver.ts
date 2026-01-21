import type { UserInfo } from './userTransformers';

/** 'user' = regular collaborator, 'sso' = SSO user, 'account' = owner, 'org' = org owner */
export type UserType = 'user' | 'sso' | 'account' | 'org';

export type TypedUserInfo = {
  user: UserInfo;
  userType: UserType;
};

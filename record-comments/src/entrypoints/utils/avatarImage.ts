/** The Gravatar URLs that the data layer builds (see getGravatarUrl) */
const GRAVATAR_URL_PREFIX = 'https://www.gravatar.com/avatar/';

/** The image props of the kit Avatar: one of the two, never both */
export type AvatarImage = { gravatar: true } | { imageUrl: string | null };

type Person = {
  email: string;
  avatarUrl: string | null;
};

/**
 * The image of a person's Avatar. The data layer only builds Gravatar URLs,
 * which show a grey silhouette when the email has no Gravatar image. The kit
 * asks Gravatar itself when it gets the email, and falls back to the initials
 * of the name, so a person looks the same as in the rest of the CMS.
 */
export function getAvatarImage(person: Person): AvatarImage {
  const { avatarUrl, email } = person;

  if (avatarUrl === null || avatarUrl.startsWith(GRAVATAR_URL_PREFIX)) {
    // Some people have a username in place of an email (SSO users, the
    // current user without an email): no Gravatar image can exist for them
    return email.includes('@') ? { gravatar: true } : { imageUrl: null };
  }

  return { imageUrl: avatarUrl };
}

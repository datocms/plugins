import type { UserRowPresentation } from 'datocms-react-ui/UserRow';

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

/**
 * The current user without an email gets an identifier in its place (see
 * getCurrentUserInfo): it is not an email to show
 */
const USER_ID_PLACEHOLDER_PREFIX = '__user_id:';

/** The name, the email and the image of a person, for the kit UserRow */
export function getUserRowPresentation(
  person: Person & { name: string; removed?: boolean },
): UserRowPresentation {
  const email =
    person.email && !person.email.startsWith(USER_ID_PLACEHOLDER_PREFIX)
      ? person.email
      : null;
  const image = getAvatarImage(person);

  return {
    name: person.name,
    // A person who left the project keeps only the words that name them
    email: person.removed ? null : email,
    imageUrl: 'imageUrl' in image ? image.imageUrl : null,
  };
}

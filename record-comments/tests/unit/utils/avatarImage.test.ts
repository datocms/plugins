import { getAvatarImage } from '@utils/avatarImage';
import { describe, expect, it } from 'vitest';
import { getGravatarUrl } from '@/utils/helpers';

describe('getAvatarImage', () => {
  it('lets the kit ask Gravatar for an email, so it can fall back to initials', () => {
    expect(
      getAvatarImage({
        email: 'ana@example.com',
        avatarUrl: getGravatarUrl('ana@example.com', 48),
      }),
    ).toEqual({ gravatar: true });
    expect(
      getAvatarImage({ email: 'ana@example.com', avatarUrl: null }),
    ).toEqual({ gravatar: true });
  });

  it('shows the initials when no Gravatar image can exist', () => {
    expect(
      getAvatarImage({
        email: 'sso-username',
        avatarUrl: getGravatarUrl('sso-username', 48),
      }),
    ).toEqual({ imageUrl: null });
    expect(getAvatarImage({ email: '', avatarUrl: null })).toEqual({
      imageUrl: null,
    });
  });

  it('keeps an image that is not a Gravatar', () => {
    expect(
      getAvatarImage({
        email: 'ana@example.com',
        avatarUrl: 'https://cdn.example.com/ana.png',
      }),
    ).toEqual({ imageUrl: 'https://cdn.example.com/ana.png' });
  });
});

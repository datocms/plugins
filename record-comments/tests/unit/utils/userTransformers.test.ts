import { describe, it, expect, vi } from 'vitest';
import {
  regularUserToUserInfo,
  ssoUserToUserInfo,
  ownerToUserInfo,
  getCurrentUserInfo,
  transformUsersToUserInfo,
} from '@utils/userTransformers';

// Mock the getGravatarUrl function
vi.mock('@/utils/helpers', () => ({
  getGravatarUrl: (email: string, size: number) => `https://gravatar.com/${email}?s=${size}`,
}));

describe('regularUserToUserInfo', () => {
  const sampleUser = {
    id: 'user-123',
    attributes: {
      email: 'john@example.com',
      full_name: 'John Doe',
    },
  };

  describe('basic transformation', () => {
    it('transforms regular user to UserInfo', () => {
      const result = regularUserToUserInfo(sampleUser);

      expect(result).toEqual({
        id: 'user-123',
        email: 'john@example.com',
        name: 'John Doe',
        avatarUrl: 'https://gravatar.com/john@example.com?s=48',
      });
    });

    it('uses default avatar size of 48', () => {
      const result = regularUserToUserInfo(sampleUser);

      expect(result.avatarUrl).toContain('s=48');
    });

    it('uses custom avatar size', () => {
      const result = regularUserToUserInfo(sampleUser, 96);

      expect(result.avatarUrl).toContain('s=96');
    });
  });

  describe('name fallback', () => {
    it('uses email local part when full_name is null', () => {
      const user = {
        id: 'user-123',
        attributes: {
          email: 'john.doe@example.com',
          full_name: null,
        },
      };

      const result = regularUserToUserInfo(user);

      expect(result.name).toBe('john.doe');
    });

    it('uses email local part when full_name is undefined', () => {
      const user = {
        id: 'user-123',
        attributes: {
          email: 'alice@company.com',
        },
      };

      const result = regularUserToUserInfo(user);

      expect(result.name).toBe('alice');
    });
  });
});

describe('ssoUserToUserInfo', () => {
  describe('name construction', () => {
    it('uses first and last name when both present', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'jdoe',
          first_name: 'John',
          last_name: 'Doe',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.name).toBe('John Doe');
    });

    it('uses only first name when last name is null', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'jdoe',
          first_name: 'John',
          last_name: null,
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.name).toBe('John');
    });

    it('uses only last name when first name is null', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'jdoe',
          first_name: null,
          last_name: 'Doe',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.name).toBe('Doe');
    });

    it('falls back to username local part when no names', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'john.doe@company.com',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.name).toBe('john.doe');
    });

    it('uses full username when no @ symbol', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'johndoe',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.name).toBe('johndoe');
    });
  });

  describe('avatar URL', () => {
    it('generates gravatar when username looks like email', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'john@company.com',
          first_name: 'John',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.avatarUrl).toBe('https://gravatar.com/john@company.com?s=48');
    });

    it('returns null when username is not email-like', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'johndoe',
          first_name: 'John',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.avatarUrl).toBeNull();
    });
  });

  describe('email field', () => {
    it('uses username as email', () => {
      const user = {
        id: 'sso-123',
        attributes: {
          username: 'sso-user-id',
        },
      };

      const result = ssoUserToUserInfo(user);

      expect(result.email).toBe('sso-user-id');
    });
  });
});

describe('ownerToUserInfo', () => {
  describe('account type', () => {
    it('extracts info from account owner', () => {
      const owner = {
        id: 'owner-123',
        type: 'account',
        email: 'owner@example.com',
        first_name: 'Jane',
        last_name: 'Smith',
      };

      const result = ownerToUserInfo(owner);

      expect(result).toEqual({
        id: 'owner-123',
        email: 'owner@example.com',
        name: 'Jane Smith',
        avatarUrl: 'https://gravatar.com/owner@example.com?s=48',
      });
    });

    it('reads from attributes if top-level missing', () => {
      const owner = {
        id: 'owner-123',
        type: 'account',
        attributes: {
          email: 'attr@example.com',
          first_name: 'Attr',
          last_name: 'User',
        },
      };

      const result = ownerToUserInfo(owner);

      expect(result.email).toBe('attr@example.com');
      expect(result.name).toBe('Attr User');
    });

    it('falls back to email local part when no names', () => {
      const owner = {
        id: 'owner-123',
        type: 'account',
        email: 'nameless@example.com',
      };

      const result = ownerToUserInfo(owner);

      expect(result.name).toBe('nameless');
    });

    it('falls back to "Account Owner" when no email or names', () => {
      const owner = {
        id: 'owner-123',
        type: 'account',
      };

      const result = ownerToUserInfo(owner);

      expect(result.name).toBe('Account Owner');
    });

    it('returns null avatar when no email', () => {
      const owner = {
        id: 'owner-123',
        type: 'account',
        first_name: 'Test',
      };

      const result = ownerToUserInfo(owner);

      expect(result.avatarUrl).toBeNull();
    });
  });

  describe('organization type', () => {
    it('extracts organization name', () => {
      const owner = {
        id: 'org-123',
        type: 'organization',
        name: 'Acme Corp',
      };

      const result = ownerToUserInfo(owner);

      expect(result).toEqual({
        id: 'org-123',
        email: '',
        name: 'Acme Corp',
        avatarUrl: null,
      });
    });

    it('reads name from attributes', () => {
      const owner = {
        id: 'org-123',
        type: 'organization',
        attributes: {
          name: 'Org from Attrs',
        },
      };

      const result = ownerToUserInfo(owner);

      expect(result.name).toBe('Org from Attrs');
    });

    it('falls back to "Organization" when no name', () => {
      const owner = {
        id: 'org-123',
        type: 'organization',
      };

      const result = ownerToUserInfo(owner);

      expect(result.name).toBe('Organization');
    });
  });
});

describe('getCurrentUserInfo', () => {
  it('extracts email and full_name', () => {
    const currentUser = {
      attributes: {
        email: 'current@example.com',
        full_name: 'Current User',
      },
    };

    const result = getCurrentUserInfo(currentUser);

    expect(result).toEqual({
      email: 'current@example.com',
      name: 'Current User',
    });
  });

  it('uses name attribute when full_name missing', () => {
    const currentUser = {
      attributes: {
        email: 'current@example.com',
        name: 'Alt Name',
      },
    };

    const result = getCurrentUserInfo(currentUser);

    expect(result.name).toBe('Alt Name');
  });

  it('falls back to email local part when no names', () => {
    const currentUser = {
      attributes: {
        email: 'fallback@example.com',
      },
    };

    const result = getCurrentUserInfo(currentUser);

    expect(result.name).toBe('fallback');
  });

  it('uses default email when missing', () => {
    const currentUser = {
      attributes: {
        full_name: 'Test User',
      },
    };

    const result = getCurrentUserInfo(currentUser);

    expect(result.email).toBe('unknown@email.com');
  });
});

describe('transformUsersToUserInfo', () => {
  it('transforms both regular and SSO users', () => {
    const regularUsers = [
      {
        id: 'reg-1',
        attributes: { email: 'regular@example.com', full_name: 'Regular User' },
      },
    ];

    const ssoUsers = [
      {
        id: 'sso-1',
        attributes: { username: 'sso@example.com', first_name: 'SSO', last_name: 'User' },
      },
    ];

    const result = transformUsersToUserInfo(regularUsers, ssoUsers);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('reg-1');
    expect(result[1].id).toBe('sso-1');
  });

  it('handles empty arrays', () => {
    const result = transformUsersToUserInfo([], []);

    expect(result).toEqual([]);
  });

  it('handles only regular users', () => {
    const regularUsers = [
      { id: 'reg-1', attributes: { email: 'test@example.com' } },
    ];

    const result = transformUsersToUserInfo(regularUsers, []);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('reg-1');
  });

  it('handles only SSO users', () => {
    const ssoUsers = [
      { id: 'sso-1', attributes: { username: 'sso-user' } },
    ];

    const result = transformUsersToUserInfo([], ssoUsers);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sso-1');
  });

  it('uses custom avatar size', () => {
    const regularUsers = [
      { id: 'reg-1', attributes: { email: 'test@example.com' } },
    ];

    const result = transformUsersToUserInfo(regularUsers, [], 128);

    expect(result[0].avatarUrl).toContain('s=128');
  });
});

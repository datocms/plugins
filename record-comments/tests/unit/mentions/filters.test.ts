import { describe, it, expect } from 'vitest';
import { filterUsers, filterFields, filterModels } from '@utils/mentions/filters';

describe('filterUsers', () => {
  const users = [
    { name: 'Alice Smith', email: 'alice@example.com' },
    { name: 'Bob Jones', email: 'bob@example.com' },
    { name: 'Charlie Brown', email: 'charlie@test.com' },
    { name: 'David Williams', email: 'david@example.org' },
  ];

  describe('filtering by name', () => {
    it('filters by exact name match', () => {
      const result = filterUsers(users, 'Alice Smith');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice Smith');
    });

    it('filters by partial name match', () => {
      const result = filterUsers(users, 'ali');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice Smith');
    });

    it('is case-insensitive for name', () => {
      const result = filterUsers(users, 'ALICE');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice Smith');
    });

    it('returns multiple matches', () => {
      const result = filterUsers(users, 'i'); // Alice, Charlie, David, Williams
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('filtering by email', () => {
    it('filters by exact email match', () => {
      const result = filterUsers(users, 'bob@example.com');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob Jones');
    });

    it('filters by partial email match', () => {
      const result = filterUsers(users, '@example');
      // Matches alice@example.com, bob@example.com, david@example.org
      expect(result).toHaveLength(3);
    });

    it('is case-insensitive for email', () => {
      const result = filterUsers(users, 'BOB@EXAMPLE');
      expect(result).toHaveLength(1);
    });

    it('matches email domain', () => {
      const result = filterUsers(users, '.org');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('David Williams');
    });
  });

  describe('edge cases', () => {
    it('returns all users for empty query', () => {
      const result = filterUsers(users, '');
      expect(result).toHaveLength(users.length);
    });

    it('returns empty array when no matches', () => {
      const result = filterUsers(users, 'xyz123');
      expect(result).toHaveLength(0);
    });

    it('handles empty users array', () => {
      const result = filterUsers([], 'alice');
      expect(result).toHaveLength(0);
    });

    it('preserves original user objects', () => {
      const usersWithExtra = [
        { name: 'Alice', email: 'alice@test.com', id: '123', role: 'admin' },
      ];
      const result = filterUsers(usersWithExtra, 'alice');
      expect(result[0]).toHaveProperty('id', '123');
      expect(result[0]).toHaveProperty('role', 'admin');
    });
  });
});

describe('filterFields', () => {
  const fields = [
    { apiKey: 'title', label: 'Title', displayLabel: 'Page Title' },
    { apiKey: 'description', label: 'Description' },
    { apiKey: 'hero_image', label: 'Hero Image', displayLabel: 'Main Image' },
    { apiKey: 'content', label: 'Content Body' },
  ];

  describe('filtering by apiKey', () => {
    it('filters by exact apiKey', () => {
      const result = filterFields(fields, 'title');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('title');
    });

    it('filters by partial apiKey', () => {
      const result = filterFields(fields, 'hero');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('hero_image');
    });

    it('is case-insensitive for apiKey', () => {
      const result = filterFields(fields, 'TITLE');
      expect(result).toHaveLength(1);
    });
  });

  describe('filtering by label', () => {
    it('filters by label', () => {
      const result = filterFields(fields, 'Description');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('description');
    });

    it('filters by partial label', () => {
      const result = filterFields(fields, 'Image');
      expect(result).toHaveLength(1);
    });
  });

  describe('filtering by displayLabel', () => {
    it('filters by displayLabel', () => {
      const result = filterFields(fields, 'Page Title');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('title');
    });

    it('filters by partial displayLabel', () => {
      const result = filterFields(fields, 'Main');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('hero_image');
    });

    it('handles undefined displayLabel', () => {
      const result = filterFields(fields, 'Content');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('content');
    });
  });

  describe('edge cases', () => {
    it('returns all fields for empty query', () => {
      const result = filterFields(fields, '');
      expect(result).toHaveLength(fields.length);
    });

    it('returns empty array when no matches', () => {
      const result = filterFields(fields, 'nonexistent');
      expect(result).toHaveLength(0);
    });

    it('handles empty fields array', () => {
      const result = filterFields([], 'title');
      expect(result).toHaveLength(0);
    });
  });
});

describe('filterModels', () => {
  const models = [
    { apiKey: 'blog_post', name: 'Blog Post' },
    { apiKey: 'page', name: 'Page' },
    { apiKey: 'author', name: 'Author' },
    { apiKey: 'hero_block', name: 'Hero Block' },
  ];

  describe('filtering by apiKey', () => {
    it('filters by exact apiKey', () => {
      const result = filterModels(models, 'blog_post');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('blog_post');
    });

    it('filters by partial apiKey', () => {
      const result = filterModels(models, 'block');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('hero_block');
    });

    it('is case-insensitive for apiKey', () => {
      const result = filterModels(models, 'BLOG');
      expect(result).toHaveLength(1);
    });
  });

  describe('filtering by name', () => {
    it('filters by name', () => {
      const result = filterModels(models, 'Author');
      expect(result).toHaveLength(1);
      expect(result[0].apiKey).toBe('author');
    });

    it('filters by partial name', () => {
      const result = filterModels(models, 'Post');
      expect(result).toHaveLength(1);
    });

    it('is case-insensitive for name', () => {
      const result = filterModels(models, 'page');
      expect(result).toHaveLength(1);
    });
  });

  describe('combined matching', () => {
    it('returns models matching either apiKey or name', () => {
      // "hero" matches hero_block apiKey and Hero Block name
      const result = filterModels(models, 'hero');
      expect(result).toHaveLength(1);
    });

    it('returns multiple matches when query is broad', () => {
      const result = filterModels(models, 'o'); // blog_post, author, hero_block
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('edge cases', () => {
    it('returns all models for empty query', () => {
      const result = filterModels(models, '');
      expect(result).toHaveLength(models.length);
    });

    it('returns empty array when no matches', () => {
      const result = filterModels(models, 'xyz');
      expect(result).toHaveLength(0);
    });

    it('handles empty models array', () => {
      const result = filterModels([], 'page');
      expect(result).toHaveLength(0);
    });

    it('preserves additional properties', () => {
      const modelsWithExtra = [
        { apiKey: 'page', name: 'Page', id: '123', isBlock: false },
      ];
      const result = filterModels(modelsWithExtra, 'page');
      expect(result[0]).toHaveProperty('id', '123');
      expect(result[0]).toHaveProperty('isBlock', false);
    });
  });
});

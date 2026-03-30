import { describe, it, expect } from 'vitest';
import {
  findCommentsModel,
  getValidItemTypes,
  getNonCommentsItemTypes,
  getItemTypeEmoji,
} from '@utils/itemTypeUtils';

// COMMENTS_MODEL_API_KEY = 'project_comment'

type ItemType = {
  id: string;
  attributes: {
    api_key: string;
    name: string;
    modular_block: boolean;
    singleton?: boolean;
    [key: string]: unknown;
  };
  relationships?: {
    [key: string]: unknown;
  };
};

describe('findCommentsModel', () => {
  it('finds model with project_comment api_key', () => {
    const itemTypes: Record<string, ItemType> = {
      '1': {
        id: '1',
        attributes: { api_key: 'blog_post', name: 'Blog Post', modular_block: false },
      },
      '2': {
        id: '2',
        attributes: { api_key: 'project_comment', name: 'Project Comment', modular_block: false },
      },
      '3': {
        id: '3',
        attributes: { api_key: 'author', name: 'Author', modular_block: false },
      },
    };

    const result = findCommentsModel(itemTypes);

    expect(result?.attributes.api_key).toBe('project_comment');
    expect(result?.id).toBe('2');
  });

  it('returns undefined when comments model not found', () => {
    const itemTypes: Record<string, ItemType> = {
      '1': {
        id: '1',
        attributes: { api_key: 'blog_post', name: 'Blog Post', modular_block: false },
      },
    };

    const result = findCommentsModel(itemTypes);

    expect(result).toBeUndefined();
  });

  it('handles empty itemTypes', () => {
    const result = findCommentsModel({});

    expect(result).toBeUndefined();
  });

  it('handles undefined values in map', () => {
    const itemTypes: Record<string, ItemType | undefined> = {
      '1': undefined,
      '2': {
        id: '2',
        attributes: { api_key: 'project_comment', name: 'Project Comment', modular_block: false },
      },
    };

    const result = findCommentsModel(itemTypes);

    expect(result?.id).toBe('2');
  });
});

describe('getValidItemTypes', () => {
  it('returns array of defined item types', () => {
    const itemTypes: Record<string, ItemType | undefined> = {
      '1': {
        id: '1',
        attributes: { api_key: 'blog_post', name: 'Blog Post', modular_block: false },
      },
      '2': undefined,
      '3': {
        id: '3',
        attributes: { api_key: 'author', name: 'Author', modular_block: false },
      },
    };

    const result = getValidItemTypes(itemTypes);

    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual(['1', '3']);
  });

  it('returns empty array for empty input', () => {
    const result = getValidItemTypes({});

    expect(result).toEqual([]);
  });

  it('returns empty array when all values are undefined', () => {
    const itemTypes: Record<string, ItemType | undefined> = {
      '1': undefined,
      '2': undefined,
    };

    const result = getValidItemTypes(itemTypes);

    expect(result).toEqual([]);
  });
});

describe('getNonCommentsItemTypes', () => {
  it('excludes project_comment model', () => {
    const itemTypes: Record<string, ItemType> = {
      '1': {
        id: '1',
        attributes: { api_key: 'blog_post', name: 'Blog Post', modular_block: false },
      },
      '2': {
        id: '2',
        attributes: { api_key: 'project_comment', name: 'Project Comment', modular_block: false },
      },
      '3': {
        id: '3',
        attributes: { api_key: 'author', name: 'Author', modular_block: false },
      },
    };

    const result = getNonCommentsItemTypes(itemTypes);

    expect(result).toHaveLength(2);
    expect(result.map(t => t.attributes.api_key)).toEqual(['blog_post', 'author']);
  });

  it('returns all models when no comments model exists', () => {
    const itemTypes: Record<string, ItemType> = {
      '1': {
        id: '1',
        attributes: { api_key: 'blog_post', name: 'Blog Post', modular_block: false },
      },
      '2': {
        id: '2',
        attributes: { api_key: 'author', name: 'Author', modular_block: false },
      },
    };

    const result = getNonCommentsItemTypes(itemTypes);

    expect(result).toHaveLength(2);
  });

  it('returns empty array when only comments model exists', () => {
    const itemTypes: Record<string, ItemType> = {
      '1': {
        id: '1',
        attributes: { api_key: 'project_comment', name: 'Project Comment', modular_block: false },
      },
    };

    const result = getNonCommentsItemTypes(itemTypes);

    expect(result).toEqual([]);
  });
});

describe('getItemTypeEmoji', () => {
  it('returns emoji when icon attribute exists', () => {
    const itemType: ItemType = {
      id: '1',
      attributes: {
        api_key: 'blog_post',
        name: 'Blog Post',
        modular_block: false,
        icon: '📝',
      },
    };

    const result = getItemTypeEmoji(itemType);

    expect(result).toBe('📝');
  });

  it('returns null when icon attribute is missing', () => {
    const itemType: ItemType = {
      id: '1',
      attributes: {
        api_key: 'blog_post',
        name: 'Blog Post',
        modular_block: false,
      },
    };

    const result = getItemTypeEmoji(itemType);

    expect(result).toBeNull();
  });

  it('returns null for undefined itemType', () => {
    const result = getItemTypeEmoji(undefined);

    expect(result).toBeNull();
  });

  it('returns null when icon is not a string', () => {
    const itemType = {
      id: '1',
      attributes: {
        api_key: 'blog_post',
        name: 'Blog Post',
        modular_block: false,
        icon: 123,
      },
    } as unknown as ItemType;

    const result = getItemTypeEmoji(itemType);

    expect(result).toBeNull();
  });

  it('returns empty string if icon is empty string', () => {
    const itemType: ItemType = {
      id: '1',
      attributes: {
        api_key: 'blog_post',
        name: 'Blog Post',
        modular_block: false,
        icon: '',
      },
    };

    const result = getItemTypeEmoji(itemType);

    expect(result).toBe('');
  });
});

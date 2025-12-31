import { describe, it, expect } from 'vitest';
import {
  insertUserMention,
  insertFieldMention,
  insertModelMention,
  insertToolbarMention,
} from '@utils/mentions/insertion';
import type { AssetMention, RecordMention, ModelMention } from '@ctypes/mentions';

describe('insertUserMention', () => {
  const sampleUser = {
    id: 'user-123',
    name: 'John Doe',
    email: 'john@example.com',
    avatarUrl: 'https://example.com/avatar.jpg',
  };

  describe('text replacement', () => {
    it('replaces trigger and query with mention text', () => {
      const result = insertUserMention('@john', 0, 5, sampleUser);

      expect(result.newText).toBe('@user-123 ');
    });

    it('preserves text before trigger', () => {
      const result = insertUserMention('Hello @john', 6, 11, sampleUser);

      expect(result.newText).toBe('Hello @user-123 ');
    });

    it('preserves text after cursor', () => {
      const result = insertUserMention('@john world', 0, 5, sampleUser);

      // The function adds a trailing space after mention, so ' world' becomes '  world'
      expect(result.newText).toBe('@user-123  world');
    });

    it('handles trigger in middle of text', () => {
      const result = insertUserMention('Hello @john world', 6, 11, sampleUser);

      // The function adds a trailing space after mention
      expect(result.newText).toBe('Hello @user-123  world');
    });
  });

  describe('cursor position', () => {
    it('places cursor after mention and space', () => {
      const result = insertUserMention('@john', 0, 5, sampleUser);

      expect(result.newCursorPosition).toBe(10); // '@user-123 '.length
    });

    it('calculates correct position with preceding text', () => {
      const result = insertUserMention('Hello @john', 6, 11, sampleUser);

      expect(result.newCursorPosition).toBe(16); // 'Hello '.length + '@user-123 '.length
    });
  });

  describe('mention object', () => {
    it('creates correct user mention structure', () => {
      const result = insertUserMention('@john', 0, 5, sampleUser);

      expect(result.mention).toEqual({
        type: 'user',
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
    });

    it('handles null avatar URL', () => {
      const userWithoutAvatar = { ...sampleUser, avatarUrl: null };
      const result = insertUserMention('@john', 0, 5, userWithoutAvatar);

      expect(result.mention.avatarUrl).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty query (just @)', () => {
      const result = insertUserMention('@', 0, 1, sampleUser);

      expect(result.newText).toBe('@user-123 ');
    });

    it('handles empty preceding text', () => {
      const result = insertUserMention('@john', 0, 5, sampleUser);

      expect(result.newText).toBe('@user-123 ');
    });

    it('handles empty following text', () => {
      const result = insertUserMention('Hi @john', 3, 8, sampleUser);

      expect(result.newText).toBe('Hi @user-123 ');
    });
  });
});

describe('insertFieldMention', () => {
  const sampleField = {
    apiKey: 'title',
    label: 'Title',
    localized: false,
    fieldPath: 'title',
    fieldType: 'string',
  };

  describe('text replacement', () => {
    it('replaces trigger and query with mention text', () => {
      const result = insertFieldMention('#title', 0, 6, sampleField);

      expect(result.newText).toBe('#title ');
    });

    it('encodes field path with dots', () => {
      const nestedField = {
        ...sampleField,
        apiKey: 'heading',
        fieldPath: 'sections.0.heading',
      };
      const result = insertFieldMention('#heading', 0, 8, nestedField);

      expect(result.newText).toBe('#sections::0::heading ');
    });

    it('preserves surrounding text', () => {
      const result = insertFieldMention('Check #title field', 6, 12, sampleField);

      // The function adds a trailing space after mention
      expect(result.newText).toBe('Check #title  field');
    });
  });

  describe('locale handling', () => {
    it('appends locale suffix when provided', () => {
      const localizedField = { ...sampleField, localized: true };
      const result = insertFieldMention('#title', 0, 6, localizedField, 'en');

      expect(result.newText).toBe('#title::en ');
    });

    it('does not append locale when not provided', () => {
      const result = insertFieldMention('#title', 0, 6, sampleField);

      expect(result.newText).toBe('#title ');
    });

    it('skips locale suffix when already in encoded path', () => {
      const nestedInLocalized = {
        ...sampleField,
        fieldPath: 'localized_content.en.title',
      };
      const result = insertFieldMention('#title', 0, 6, nestedInLocalized, 'en');

      // Path becomes localized_content::en::title, locale 'en' already present
      expect(result.newText).toBe('#localized_content::en::title ');
    });
  });

  describe('cursor position', () => {
    it('places cursor after mention and space', () => {
      const result = insertFieldMention('#title', 0, 6, sampleField);

      expect(result.newCursorPosition).toBe(7); // '#title '.length
    });

    it('accounts for locale suffix in cursor position', () => {
      const localizedField = { ...sampleField, localized: true };
      const result = insertFieldMention('#title', 0, 6, localizedField, 'en');

      expect(result.newCursorPosition).toBe(11); // '#title::en '.length
    });
  });

  describe('mention object', () => {
    it('creates correct field mention structure', () => {
      const result = insertFieldMention('#title', 0, 6, sampleField, 'en');

      expect(result.mention).toEqual({
        type: 'field',
        apiKey: 'title',
        label: 'Title',
        localized: false,
        fieldPath: 'title',
        locale: 'en',
        fieldType: 'string',
      });
    });

    it('handles undefined fieldType', () => {
      const fieldWithoutType = {
        apiKey: 'title',
        label: 'Title',
        localized: false,
        fieldPath: 'title',
      };
      const result = insertFieldMention('#title', 0, 6, fieldWithoutType);

      expect(result.mention.fieldType).toBeUndefined();
    });

    it('handles undefined locale', () => {
      const result = insertFieldMention('#title', 0, 6, sampleField);

      expect(result.mention.locale).toBeUndefined();
    });
  });
});

describe('insertModelMention', () => {
  const sampleModel = {
    id: 'model-456',
    apiKey: 'blog_post',
    name: 'Blog Post',
    isBlockModel: false,
  };

  describe('text replacement', () => {
    it('replaces trigger and query with mention text', () => {
      const result = insertModelMention('$blog', 0, 5, sampleModel);

      expect(result.newText).toBe('$model-456 ');
    });

    it('preserves surrounding text', () => {
      const result = insertModelMention('Use $blog model', 4, 9, sampleModel);

      // The function adds a trailing space after mention
      expect(result.newText).toBe('Use $model-456  model');
    });
  });

  describe('cursor position', () => {
    it('places cursor after mention and space', () => {
      const result = insertModelMention('$blog', 0, 5, sampleModel);

      expect(result.newCursorPosition).toBe(11); // '$model-456 '.length
    });

    it('calculates correct position with preceding text', () => {
      const result = insertModelMention('Use $blog', 4, 9, sampleModel);

      expect(result.newCursorPosition).toBe(15); // 'Use '.length + '$model-456 '.length
    });
  });

  describe('mention object', () => {
    it('creates correct model mention structure', () => {
      const result = insertModelMention('$blog', 0, 5, sampleModel);

      expect(result.mention).toEqual({
        type: 'model',
        id: 'model-456',
        apiKey: 'blog_post',
        name: 'Blog Post',
        isBlockModel: false,
      });
    });

    it('handles block model flag', () => {
      const blockModel = { ...sampleModel, isBlockModel: true };
      const result = insertModelMention('$hero', 0, 5, blockModel);

      expect(result.mention.isBlockModel).toBe(true);
    });
  });
});

describe('insertToolbarMention', () => {
  describe('asset mention', () => {
    const assetMention: AssetMention = {
      type: 'asset',
      id: 'asset-789',
      filename: 'image.jpg',
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    it('inserts asset mention at cursor', () => {
      const result = insertToolbarMention('Hello ', 6, assetMention);

      expect(result.newText).toBe('Hello ^asset-789 ');
    });

    it('calculates correct cursor position', () => {
      const result = insertToolbarMention('Hello ', 6, assetMention);

      expect(result.newCursorPosition).toBe(17); // 'Hello '.length + '^asset-789 '.length
    });

    it('inserts in middle of text', () => {
      const result = insertToolbarMention('Hello world', 6, assetMention);

      expect(result.newText).toBe('Hello ^asset-789 world');
    });
  });

  describe('record mention', () => {
    const recordMention: RecordMention = {
      type: 'record',
      id: 'record-101',
      title: 'My Record',
      modelName: 'Blog Post',
      thumbnailUrl: null,
    };

    it('inserts record mention at cursor', () => {
      const result = insertToolbarMention('See ', 4, recordMention);

      expect(result.newText).toBe('See &record-101 ');
    });

    it('calculates correct cursor position', () => {
      const result = insertToolbarMention('See ', 4, recordMention);

      expect(result.newCursorPosition).toBe(16); // 'See '.length + '&record-101 '.length
    });
  });

  describe('model mention', () => {
    const modelMention: ModelMention = {
      type: 'model',
      id: 'model-202',
      apiKey: 'author',
      name: 'Author',
      isBlockModel: false,
    };

    it('inserts model mention at cursor', () => {
      const result = insertToolbarMention('Use ', 4, modelMention);

      expect(result.newText).toBe('Use $model-202 ');
    });

    it('calculates correct cursor position', () => {
      const result = insertToolbarMention('Use ', 4, modelMention);

      expect(result.newCursorPosition).toBe(15); // 'Use '.length + '$model-202 '.length
    });
  });

  describe('edge cases', () => {
    const assetMention: AssetMention = {
      type: 'asset',
      id: 'asset-1',
      filename: 'test.png',
      thumbnailUrl: null,
    };

    it('handles insertion at start of text', () => {
      const result = insertToolbarMention('world', 0, assetMention);

      expect(result.newText).toBe('^asset-1 world');
      expect(result.newCursorPosition).toBe(9);
    });

    it('handles insertion at end of text', () => {
      const result = insertToolbarMention('Hello', 5, assetMention);

      expect(result.newText).toBe('Hello^asset-1 ');
      expect(result.newCursorPosition).toBe(14);
    });

    it('handles empty text', () => {
      const result = insertToolbarMention('', 0, assetMention);

      expect(result.newText).toBe('^asset-1 ');
      expect(result.newCursorPosition).toBe(9);
    });
  });
});

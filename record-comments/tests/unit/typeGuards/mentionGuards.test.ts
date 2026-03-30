import { describe, it, expect } from 'vitest';
import {
  isValidUserMentionAttrs,
  isValidFieldMentionAttrs,
  isValidAssetMentionAttrs,
  isValidRecordMentionAttrs,
  isValidModelMentionAttrs,
} from '@utils/typeGuards';
import {
  createUserMention,
  createFieldMention,
  createAssetMention,
  createRecordMention,
  createModelMention,
} from '../fixtures/mentions';

describe('isValidUserMentionAttrs', () => {
  describe('valid user mention attributes', () => {
    it('accepts valid user mention with all required fields', () => {
      const attrs = createUserMention();
      expect(isValidUserMentionAttrs(attrs)).toBe(true);
    });

    it('accepts avatarUrl as null', () => {
      const attrs = createUserMention({ avatarUrl: null });
      expect(isValidUserMentionAttrs(attrs)).toBe(true);
    });

    it('accepts avatarUrl as string', () => {
      const attrs = createUserMention({ avatarUrl: 'https://example.com/avatar.png' });
      expect(isValidUserMentionAttrs(attrs)).toBe(true);
    });

    it('accepts empty strings for required fields', () => {
      const attrs = createUserMention({
        id: '',
        name: '',
        email: '',
      });
      expect(isValidUserMentionAttrs(attrs)).toBe(true);
    });
  });

  describe('invalid user mention attributes', () => {
    it('rejects missing id', () => {
      const { id: _id, ...attrs } = createUserMention();
      expect(isValidUserMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects non-string id', () => {
      const attrs = { ...createUserMention(), id: 123 };
      expect(isValidUserMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing name', () => {
      const { name: _name, ...attrs } = createUserMention();
      expect(isValidUserMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing email', () => {
      const { email: _email, ...attrs } = createUserMention();
      expect(isValidUserMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects undefined avatarUrl', () => {
      const attrs = { ...createUserMention(), avatarUrl: undefined };
      expect(isValidUserMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects non-string avatarUrl (except null)', () => {
      const attrs = { ...createUserMention(), avatarUrl: 123 };
      expect(isValidUserMentionAttrs(attrs as any)).toBe(false);
    });
  });
});

describe('isValidFieldMentionAttrs', () => {
  describe('valid field mention attributes', () => {
    it('accepts valid field mention with required fields', () => {
      const attrs = createFieldMention();
      expect(isValidFieldMentionAttrs(attrs)).toBe(true);
    });

    it('accepts localized field', () => {
      const attrs = createFieldMention({ localized: true, locale: 'en-US' });
      expect(isValidFieldMentionAttrs(attrs)).toBe(true);
    });

    it('accepts field with fieldType', () => {
      const attrs = createFieldMention({ fieldType: 'string' });
      expect(isValidFieldMentionAttrs(attrs)).toBe(true);
    });

    it('accepts undefined for optional boolean localized', () => {
      const { localized: _localized, ...base } = createFieldMention();
      const attrs = { ...base };
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(true);
    });

    it('accepts undefined for optional locale', () => {
      const attrs = createFieldMention();
      delete (attrs as any).locale;
      expect(isValidFieldMentionAttrs(attrs)).toBe(true);
    });

    it('accepts null for optional locale (TipTap behavior)', () => {
      const attrs = { ...createFieldMention(), locale: null };
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(true);
    });
  });

  describe('invalid field mention attributes', () => {
    it('rejects missing apiKey', () => {
      const { apiKey: _apiKey, ...attrs } = createFieldMention();
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing label', () => {
      const { label: _label, ...attrs } = createFieldMention();
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing fieldPath', () => {
      const { fieldPath: _fieldPath, ...attrs } = createFieldMention();
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects non-boolean localized', () => {
      const attrs = { ...createFieldMention(), localized: 'true' };
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects non-string fieldType', () => {
      const attrs = { ...createFieldMention(), fieldType: 123 };
      expect(isValidFieldMentionAttrs(attrs as any)).toBe(false);
    });
  });
});

describe('isValidAssetMentionAttrs', () => {
  describe('valid asset mention attributes', () => {
    it('accepts valid asset mention', () => {
      const attrs = createAssetMention();
      expect(isValidAssetMentionAttrs(attrs)).toBe(true);
    });

    it('accepts null thumbnailUrl', () => {
      const attrs = createAssetMention({ thumbnailUrl: null });
      expect(isValidAssetMentionAttrs(attrs)).toBe(true);
    });

    it('accepts various mime types', () => {
      expect(isValidAssetMentionAttrs(createAssetMention({ mimeType: 'image/jpeg' }))).toBe(true);
      expect(isValidAssetMentionAttrs(createAssetMention({ mimeType: 'application/pdf' }))).toBe(true);
      expect(isValidAssetMentionAttrs(createAssetMention({ mimeType: 'video/mp4' }))).toBe(true);
    });
  });

  describe('invalid asset mention attributes', () => {
    it('rejects missing id', () => {
      const { id: _id, ...attrs } = createAssetMention();
      expect(isValidAssetMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing filename', () => {
      const { filename: _filename, ...attrs } = createAssetMention();
      expect(isValidAssetMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing url', () => {
      const { url: _url, ...attrs } = createAssetMention();
      expect(isValidAssetMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing mimeType', () => {
      const { mimeType: _mimeType, ...attrs } = createAssetMention();
      expect(isValidAssetMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects undefined thumbnailUrl', () => {
      const attrs = { ...createAssetMention(), thumbnailUrl: undefined };
      expect(isValidAssetMentionAttrs(attrs as any)).toBe(false);
    });
  });
});

describe('isValidRecordMentionAttrs', () => {
  describe('valid record mention attributes', () => {
    it('accepts valid record mention', () => {
      const attrs = createRecordMention();
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });

    it('accepts null modelEmoji', () => {
      const attrs = createRecordMention({ modelEmoji: null });
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });

    it('accepts string modelEmoji', () => {
      const attrs = createRecordMention({ modelEmoji: '📝' });
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });

    it('accepts null thumbnailUrl', () => {
      const attrs = createRecordMention({ thumbnailUrl: null });
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });

    it('accepts isSingleton as true', () => {
      const attrs = createRecordMention({ isSingleton: true });
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });

    it('accepts isSingleton as false', () => {
      const attrs = createRecordMention({ isSingleton: false });
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });

    it('accepts undefined isSingleton', () => {
      const attrs = createRecordMention();
      delete (attrs as any).isSingleton;
      expect(isValidRecordMentionAttrs(attrs)).toBe(true);
    });
  });

  describe('invalid record mention attributes', () => {
    it('rejects missing id', () => {
      const { id: _id, ...attrs } = createRecordMention();
      expect(isValidRecordMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing title', () => {
      const { title: _title, ...attrs } = createRecordMention();
      expect(isValidRecordMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing modelId', () => {
      const { modelId: _modelId, ...attrs } = createRecordMention();
      expect(isValidRecordMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing modelApiKey', () => {
      const { modelApiKey: _modelApiKey, ...attrs } = createRecordMention();
      expect(isValidRecordMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing modelName', () => {
      const { modelName: _modelName, ...attrs } = createRecordMention();
      expect(isValidRecordMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects non-boolean isSingleton', () => {
      const attrs = { ...createRecordMention(), isSingleton: 'true' };
      expect(isValidRecordMentionAttrs(attrs as any)).toBe(false);
    });
  });
});

describe('isValidModelMentionAttrs', () => {
  describe('valid model mention attributes', () => {
    it('accepts valid model mention', () => {
      const attrs = createModelMention();
      expect(isValidModelMentionAttrs(attrs)).toBe(true);
    });

    it('accepts block model', () => {
      const attrs = createModelMention({ isBlockModel: true });
      expect(isValidModelMentionAttrs(attrs)).toBe(true);
    });

    it('accepts non-block model', () => {
      const attrs = createModelMention({ isBlockModel: false });
      expect(isValidModelMentionAttrs(attrs)).toBe(true);
    });

    it('accepts undefined isBlockModel (TipTap omits default false)', () => {
      const { isBlockModel: _isBlockModel, ...base } = createModelMention();
      const attrs = { ...base };
      expect(isValidModelMentionAttrs(attrs as any)).toBe(true);
    });
  });

  describe('invalid model mention attributes', () => {
    it('rejects missing id', () => {
      const { id: _id, ...attrs } = createModelMention();
      expect(isValidModelMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing apiKey', () => {
      const { apiKey: _apiKey, ...attrs } = createModelMention();
      expect(isValidModelMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects missing name', () => {
      const { name: _name, ...attrs } = createModelMention();
      expect(isValidModelMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects non-boolean isBlockModel', () => {
      const attrs = { ...createModelMention(), isBlockModel: 'true' };
      expect(isValidModelMentionAttrs(attrs as any)).toBe(false);
    });

    it('rejects null isBlockModel', () => {
      const attrs = { ...createModelMention(), isBlockModel: null };
      expect(isValidModelMentionAttrs(attrs as any)).toBe(false);
    });
  });
});

describe('cross-mention type validation', () => {
  it('user mention attrs do not pass field validation', () => {
    const userAttrs = createUserMention();
    expect(isValidFieldMentionAttrs(userAttrs as any)).toBe(false);
  });

  it('field mention attrs do not pass asset validation', () => {
    const fieldAttrs = createFieldMention();
    expect(isValidAssetMentionAttrs(fieldAttrs as any)).toBe(false);
  });

  it('asset mention attrs do not pass record validation', () => {
    const assetAttrs = createAssetMention();
    expect(isValidRecordMentionAttrs(assetAttrs as any)).toBe(false);
  });

  it('record mention attrs do not pass model validation', () => {
    const recordAttrs = createRecordMention();
    expect(isValidModelMentionAttrs(recordAttrs as any)).toBe(false);
  });

  it('model mention attrs do not pass user validation', () => {
    const modelAttrs = createModelMention();
    expect(isValidUserMentionAttrs(modelAttrs as any)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  isBlockValue,
  isPlainObject,
  isFieldValueRecord,
  isBlockContainerType,
  hasBlockAttributes,
  isStructuredTextBlock,
  isFieldValidators,
  isFieldAppearance,
  getEditorType,
  getValidators,
  getBlockModelId,
  safeGetBlockAttributes,
  extractBlocksFromFieldValue,
  getBlockIndex,
} from '@utils/blockHelpers';
import type { BlockValue } from '@utils/blockHelpers';

describe('isBlockValue', () => {
  describe('valid block values', () => {
    it('returns true for object with id', () => {
      const result = isBlockValue({ id: 'block-1' });

      expect(result).toBe(true);
    });

    it('returns true for object with type', () => {
      const result = isBlockValue({ type: 'hero_block' });

      expect(result).toBe(true);
    });

    it('returns true for object with itemTypeId', () => {
      const result = isBlockValue({ itemTypeId: '12345' });

      expect(result).toBe(true);
    });

    it('returns true for object with attributes', () => {
      const result = isBlockValue({
        id: 'block-1',
        attributes: { title: 'Hello' },
      });

      expect(result).toBe(true);
    });
  });

  describe('invalid block values', () => {
    it('returns false for null', () => {
      expect(isBlockValue(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isBlockValue(undefined)).toBe(false);
    });

    it('returns false for array', () => {
      expect(isBlockValue([{ id: 'block-1' }])).toBe(false);
    });

    it('returns false for primitive', () => {
      expect(isBlockValue('string')).toBe(false);
      expect(isBlockValue(123)).toBe(false);
    });

    it('returns false for object without identifiers', () => {
      expect(isBlockValue({ title: 'Hello' })).toBe(false);
    });

    it('returns false for invalid attributes', () => {
      const result = isBlockValue({
        id: 'block-1',
        attributes: 'invalid',
      });

      expect(result).toBe(false);
    });
  });
});

describe('isPlainObject', () => {
  it('returns true for plain object', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ key: 'value' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for array', () => {
    expect(isPlainObject([])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(123)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe('isFieldValueRecord', () => {
  it('returns true for object', () => {
    expect(isFieldValueRecord({ field: 'value' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isFieldValueRecord(null)).toBe(false);
  });

  it('returns false for array', () => {
    expect(isFieldValueRecord([])).toBe(false);
  });
});

describe('isBlockContainerType', () => {
  it('returns true for modular_content', () => {
    expect(isBlockContainerType('modular_content')).toBe(true);
  });

  it('returns true for structured_text', () => {
    expect(isBlockContainerType('structured_text')).toBe(true);
  });

  it('returns true for single_block', () => {
    expect(isBlockContainerType('single_block')).toBe(true);
  });

  it('returns true for rich_text', () => {
    expect(isBlockContainerType('rich_text')).toBe(true);
  });

  it('returns false for non-container types', () => {
    expect(isBlockContainerType('string')).toBe(false);
    expect(isBlockContainerType('text')).toBe(false);
    expect(isBlockContainerType('boolean')).toBe(false);
  });
});

describe('hasBlockAttributes', () => {
  it('returns true when attributes is object', () => {
    const block: BlockValue = { id: 'block-1', attributes: { title: 'Hi' } };

    expect(hasBlockAttributes(block)).toBe(true);
  });

  it('returns false when attributes is undefined', () => {
    const block: BlockValue = { id: 'block-1' };

    expect(hasBlockAttributes(block)).toBe(false);
  });

  it('returns false when attributes is null', () => {
    const block = { id: 'block-1', attributes: null } as unknown as BlockValue;

    expect(hasBlockAttributes(block)).toBe(false);
  });
});

describe('isStructuredTextBlock', () => {
  it('returns true for structured text block', () => {
    const block: BlockValue = {
      id: 'block-1',
      __isStructuredTextBlock: true,
      __dastIndex: 0,
    };

    expect(isStructuredTextBlock(block)).toBe(true);
  });

  it('returns false without __isStructuredTextBlock flag', () => {
    const block: BlockValue = { id: 'block-1', __dastIndex: 0 };

    expect(isStructuredTextBlock(block)).toBe(false);
  });

  it('returns false without __dastIndex', () => {
    const block: BlockValue = { id: 'block-1', __isStructuredTextBlock: true };

    expect(isStructuredTextBlock(block)).toBe(false);
  });
});

describe('isFieldValidators', () => {
  it('returns true for empty object', () => {
    expect(isFieldValidators({})).toBe(true);
  });

  it('returns true for valid item_item_type', () => {
    const validators = {
      item_item_type: { item_types: ['type1', 'type2'] },
    };

    expect(isFieldValidators(validators)).toBe(true);
  });

  it('returns true for valid rich_text_blocks', () => {
    const validators = {
      rich_text_blocks: { item_types: ['block1'] },
    };

    expect(isFieldValidators(validators)).toBe(true);
  });

  it('returns true for valid structured_text_blocks', () => {
    const validators = {
      structured_text_blocks: { item_types: ['block1', 'block2'] },
    };

    expect(isFieldValidators(validators)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isFieldValidators(null)).toBe(false);
  });

  it('returns false for invalid item_types', () => {
    const validators = {
      item_item_type: { item_types: [1, 2] }, // numbers instead of strings
    };

    expect(isFieldValidators(validators)).toBe(false);
  });
});

describe('isFieldAppearance', () => {
  it('returns true for empty object', () => {
    expect(isFieldAppearance({})).toBe(true);
  });

  it('returns true for object with string editor', () => {
    expect(isFieldAppearance({ editor: 'wysiwyg' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isFieldAppearance(null)).toBe(false);
  });

  it('returns false for non-string editor', () => {
    expect(isFieldAppearance({ editor: 123 })).toBe(false);
  });
});

describe('getEditorType', () => {
  it('returns editor string for valid appearance', () => {
    const result = getEditorType({ editor: 'markdown' });

    expect(result).toBe('markdown');
  });

  it('returns undefined for invalid appearance', () => {
    const result = getEditorType(null);

    expect(result).toBeUndefined();
  });

  it('returns undefined when editor not present', () => {
    const result = getEditorType({});

    expect(result).toBeUndefined();
  });
});

describe('getValidators', () => {
  it('returns validators for valid input', () => {
    const validators = { item_item_type: { item_types: ['type1'] } };
    const result = getValidators(validators);

    expect(result).toEqual(validators);
  });

  it('returns undefined for invalid input', () => {
    const result = getValidators(null);

    expect(result).toBeUndefined();
  });
});

describe('getBlockModelId', () => {
  it('returns itemTypeId when present', () => {
    const block: BlockValue = { itemTypeId: '12345' };

    expect(getBlockModelId(block)).toBe('12345');
  });

  it('returns type when itemTypeId not present', () => {
    const block: BlockValue = { type: 'hero_block' };

    expect(getBlockModelId(block)).toBe('hero_block');
  });

  it('prefers itemTypeId over type', () => {
    const block: BlockValue = { itemTypeId: '12345', type: 'hero_block' };

    expect(getBlockModelId(block)).toBe('12345');
  });

  it('returns undefined when neither present', () => {
    const block: BlockValue = { id: 'block-1' };

    expect(getBlockModelId(block)).toBeUndefined();
  });
});

describe('safeGetBlockAttributes', () => {
  it('returns attributes when present', () => {
    const block: BlockValue = {
      id: 'block-1',
      attributes: { title: 'Hello', content: 'World' },
    };

    expect(safeGetBlockAttributes(block)).toEqual({ title: 'Hello', content: 'World' });
  });

  it('filters out metadata keys when no attributes', () => {
    const block = {
      id: 'block-1',
      type: 'hero',
      itemTypeId: '12345',
      title: 'Hello',
      content: 'World',
    } as BlockValue;

    const result = safeGetBlockAttributes(block);

    expect(result).toEqual({ title: 'Hello', content: 'World' });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('type');
    expect(result).not.toHaveProperty('itemTypeId');
  });
});

describe('extractBlocksFromFieldValue', () => {
  describe('modular_content', () => {
    it('returns array of blocks for modular content', () => {
      const fieldValue = [
        { itemTypeId: '123', attributes: { title: 'Block 1' } },
        { itemTypeId: '456', attributes: { title: 'Block 2' } },
      ];

      const result = extractBlocksFromFieldValue(fieldValue, 'modular_content');

      expect(result).toHaveLength(2);
      expect(result[0].itemTypeId).toBe('123');
    });

    it('returns empty array for null value', () => {
      const result = extractBlocksFromFieldValue(null, 'modular_content');

      expect(result).toEqual([]);
    });
  });

  describe('structured_text', () => {
    it('extracts blocks from document format', () => {
      const fieldValue = {
        schema: 'dast',
        document: {},
        blocks: [{ itemTypeId: '123' }],
      };

      const result = extractBlocksFromFieldValue(fieldValue, 'structured_text');

      expect(result).toHaveLength(1);
    });

    it('extracts blocks from value format', () => {
      const fieldValue = {
        value: {},
        blocks: [{ itemTypeId: '123' }],
      };

      const result = extractBlocksFromFieldValue(fieldValue, 'structured_text');

      expect(result).toHaveLength(1);
    });

    it('extracts blocks from DAST array with blockModelId', () => {
      const fieldValue = [
        { type: 'paragraph', children: [] },
        { blockModelId: '123', content: 'Hello' },
        { type: 'paragraph', children: [] },
        { blockModelId: '456', content: 'World' },
      ];

      const result = extractBlocksFromFieldValue(fieldValue, 'structured_text');

      expect(result).toHaveLength(2);
      expect(result[0].itemTypeId).toBe('123');
      expect(result[0].__dastIndex).toBe(1);
      expect(result[1].__dastIndex).toBe(3);
    });

    it('returns empty array when no blocks', () => {
      const fieldValue = {
        schema: 'dast',
        document: {},
      };

      const result = extractBlocksFromFieldValue(fieldValue, 'structured_text');

      expect(result).toEqual([]);
    });
  });

  describe('non-block field types', () => {
    it('returns empty array for non-array, non-structured values', () => {
      const result = extractBlocksFromFieldValue('string value', 'string');

      expect(result).toEqual([]);
    });
  });
});

describe('getBlockIndex', () => {
  it('returns __dastIndex for structured text blocks', () => {
    const block: BlockValue = {
      id: 'block-1',
      __isStructuredTextBlock: true,
      __dastIndex: 5,
    };

    expect(getBlockIndex(block, 0)).toBe(5);
  });

  it('returns array index for regular blocks', () => {
    const block: BlockValue = { id: 'block-1' };

    expect(getBlockIndex(block, 3)).toBe(3);
  });

  it('returns array index when __dastIndex is undefined', () => {
    const block: BlockValue = {
      id: 'block-1',
      __isStructuredTextBlock: true,
    };

    expect(getBlockIndex(block, 2)).toBe(2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  segmentsToTipTapDoc,
  tipTapDocToSegments,
  createEmptyDoc,
  isDocEmpty,
} from '@utils/tipTapSerializer';
import type { CommentSegment } from '@ctypes/mentions';
import {
  createUserMention,
  createFieldMention,
  createAssetMention,
  createRecordMention,
  createModelMention,
  createMentionSegment,
  createTextSegment,
  mentionFixtures,
  segmentFixtures,
} from '../fixtures/mentions';

describe('createEmptyDoc', () => {
  it('creates doc with single empty paragraph', () => {
    const doc = createEmptyDoc();

    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(1);
    expect(doc.content![0].type).toBe('paragraph');
  });

  it('creates consistent structure', () => {
    const doc1 = createEmptyDoc();
    const doc2 = createEmptyDoc();

    expect(doc1).toEqual(doc2);
  });
});

describe('isDocEmpty', () => {
  describe('empty documents', () => {
    it('returns true for createEmptyDoc output', () => {
      const doc = createEmptyDoc();
      expect(isDocEmpty(doc)).toBe(true);
    });

    it('returns true for doc with empty paragraph', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      };
      expect(isDocEmpty(doc)).toBe(true);
    });

    it('returns true for doc with whitespace-only text', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '   \n\t  ' }],
          },
        ],
      };
      expect(isDocEmpty(doc)).toBe(true);
    });

    it('returns true for doc with no content', () => {
      const doc = { type: 'doc' };
      expect(isDocEmpty(doc)).toBe(true);
    });
  });

  describe('non-empty documents', () => {
    it('returns false for doc with text content', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };
      expect(isDocEmpty(doc)).toBe(false);
    });

    it('returns false for doc with mention', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'userMention',
                attrs: createUserMention(),
              },
            ],
          },
        ],
      };
      expect(isDocEmpty(doc)).toBe(false);
    });

    it('returns false for text with leading whitespace but content', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '  Hello' }],
          },
        ],
      };
      expect(isDocEmpty(doc)).toBe(false);
    });
  });
});

describe('segmentsToTipTapDoc', () => {
  describe('empty segments', () => {
    it('creates empty doc for empty array', () => {
      const doc = segmentsToTipTapDoc([]);

      expect(doc.type).toBe('doc');
      expect(doc.content).toHaveLength(1);
      expect(doc.content![0].type).toBe('paragraph');
      expect(doc.content![0].content).toBeUndefined();
    });
  });

  describe('text segments', () => {
    it('converts simple text segment', () => {
      const segments: CommentSegment[] = [createTextSegment('Hello world')];

      const doc = segmentsToTipTapDoc(segments);

      expect(doc.content![0].content).toHaveLength(1);
      expect(doc.content![0].content![0]).toEqual({
        type: 'text',
        text: 'Hello world',
      });
    });

    it('converts multiple text segments', () => {
      const segments: CommentSegment[] = [
        createTextSegment('Hello '),
        createTextSegment('world'),
      ];

      const doc = segmentsToTipTapDoc(segments);

      expect(doc.content![0].content).toHaveLength(2);
    });

    it('converts newlines to hardBreak nodes', () => {
      const segments: CommentSegment[] = [createTextSegment('Line 1\nLine 2')];

      const doc = segmentsToTipTapDoc(segments);
      const content = doc.content![0].content!;

      expect(content).toHaveLength(3);
      expect(content[0]).toEqual({ type: 'text', text: 'Line 1' });
      expect(content[1]).toEqual({ type: 'hardBreak' });
      expect(content[2]).toEqual({ type: 'text', text: 'Line 2' });
    });

    it('handles multiple newlines', () => {
      const segments: CommentSegment[] = [createTextSegment('A\n\nB')];

      const doc = segmentsToTipTapDoc(segments);
      const content = doc.content![0].content!;

      // A, hardBreak, hardBreak, B
      expect(content).toHaveLength(4);
      expect(content[0]).toEqual({ type: 'text', text: 'A' });
      expect(content[1]).toEqual({ type: 'hardBreak' });
      expect(content[2]).toEqual({ type: 'hardBreak' });
      expect(content[3]).toEqual({ type: 'text', text: 'B' });
    });

    it('skips empty lines but preserves breaks', () => {
      const segments: CommentSegment[] = [createTextSegment('\nHello')];

      const doc = segmentsToTipTapDoc(segments);
      const content = doc.content![0].content!;

      // hardBreak, Hello
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'hardBreak' });
      expect(content[1]).toEqual({ type: 'text', text: 'Hello' });
    });
  });

  describe('mention segments', () => {
    it('converts user mention', () => {
      const mention = createUserMention();
      const segments: CommentSegment[] = [createMentionSegment(mention)];

      const doc = segmentsToTipTapDoc(segments);
      const content = doc.content![0].content!;

      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('userMention');
      expect(content[0].attrs).toEqual(mention);
    });

    it('converts field mention', () => {
      const mention = createFieldMention();
      const segments: CommentSegment[] = [createMentionSegment(mention)];

      const doc = segmentsToTipTapDoc(segments);

      expect(doc.content![0].content![0].type).toBe('fieldMention');
    });

    it('converts asset mention', () => {
      const mention = createAssetMention();
      const segments: CommentSegment[] = [createMentionSegment(mention)];

      const doc = segmentsToTipTapDoc(segments);

      expect(doc.content![0].content![0].type).toBe('assetMention');
    });

    it('converts record mention', () => {
      const mention = createRecordMention();
      const segments: CommentSegment[] = [createMentionSegment(mention)];

      const doc = segmentsToTipTapDoc(segments);

      expect(doc.content![0].content![0].type).toBe('recordMention');
    });

    it('converts model mention', () => {
      const mention = createModelMention();
      const segments: CommentSegment[] = [createMentionSegment(mention)];

      const doc = segmentsToTipTapDoc(segments);

      expect(doc.content![0].content![0].type).toBe('modelMention');
    });
  });

  describe('mixed segments', () => {
    it('converts text and mentions interleaved', () => {
      const segments = segmentFixtures.singleUserMention;

      const doc = segmentsToTipTapDoc(segments);
      const content = doc.content![0].content!;

      expect(content).toHaveLength(3);
      expect(content[0]).toEqual({ type: 'text', text: 'Hello ' });
      expect(content[1].type).toBe('userMention');
      expect(content[2]).toEqual({ type: 'text', text: '!' });
    });

    it('converts all mention types in one doc', () => {
      const segments = segmentFixtures.allMentionTypes;

      const doc = segmentsToTipTapDoc(segments);
      const content = doc.content![0].content!;

      const mentionTypes = content
        .filter((n: any) => n.type.endsWith('Mention'))
        .map((n: any) => n.type);

      expect(mentionTypes).toContain('userMention');
      expect(mentionTypes).toContain('fieldMention');
      expect(mentionTypes).toContain('assetMention');
      expect(mentionTypes).toContain('recordMention');
      expect(mentionTypes).toContain('modelMention');
    });
  });
});

describe('tipTapDocToSegments', () => {
  describe('empty documents', () => {
    it('returns empty array for empty doc', () => {
      const doc = createEmptyDoc();
      const segments = tipTapDocToSegments(doc);

      expect(segments).toEqual([]);
    });

    it('returns empty array for doc with no content', () => {
      const doc = { type: 'doc' };
      const segments = tipTapDocToSegments(doc);

      expect(segments).toEqual([]);
    });
  });

  describe('text nodes', () => {
    it('extracts simple text', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toEqual([{ type: 'text', content: 'Hello' }]);
    });

    it('merges adjacent text nodes', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world' },
            ],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toEqual([{ type: 'text', content: 'Hello world' }]);
    });

    it('converts hardBreak to newline', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Line 1' },
              { type: 'hardBreak' },
              { type: 'text', text: 'Line 2' },
            ],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toEqual([{ type: 'text', content: 'Line 1\nLine 2' }]);
    });

    it('handles multiple paragraphs with newlines', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Para 1' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Para 2' }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toEqual([{ type: 'text', content: 'Para 1\nPara 2' }]);
    });
  });

  describe('mention nodes', () => {
    it('extracts user mention', () => {
      const mention = createUserMention();
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'userMention', attrs: mention }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('mention');
      expect((segments[0] as any).mention.type).toBe('user');
    });

    it('extracts field mention with defaults applied', () => {
      const mention = createFieldMention({ localized: undefined as any });
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'fieldMention', attrs: mention }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect((segments[0] as any).mention.localized).toBe(false);
    });

    it('extracts model mention with defaults applied', () => {
      const { isBlockModel: _isBlockModel, ...mentionWithoutDefault } = createModelMention();
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'modelMention', attrs: mentionWithoutDefault }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect((segments[0] as any).mention.isBlockModel).toBe(false);
    });

    it('skips invalid mention nodes', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before ' },
              { type: 'userMention', attrs: { invalid: true } },
              { type: 'text', text: ' After' },
            ],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      // Text segments are kept separate (not merged)
      expect(segments).toEqual([
        { type: 'text', content: 'Before ' },
        { type: 'text', content: ' After' },
      ]);
    });
  });

  describe('mixed content', () => {
    it('handles text around mentions', () => {
      const mention = createUserMention();
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'userMention', attrs: mention },
              { type: 'text', text: '!' },
            ],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({ type: 'text', content: 'Hello ' });
      expect(segments[1].type).toBe('mention');
      expect(segments[2]).toEqual({ type: 'text', content: '!' });
    });

    it('handles consecutive mentions', () => {
      const user = createUserMention();
      const field = createFieldMention();
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'userMention', attrs: user },
              { type: 'fieldMention', attrs: field },
            ],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments).toHaveLength(2);
      expect(segments[0].type).toBe('mention');
      expect(segments[1].type).toBe('mention');
    });
  });

  describe('whitespace handling', () => {
    it('strips leading whitespace-only text segments', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments[0]).toEqual({ type: 'text', content: 'Hello' });
    });

    it('strips leading newlines from text', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '\n\n  Hello' }],
          },
        ],
      };

      const segments = tipTapDocToSegments(doc);

      expect(segments[0]).toEqual({ type: 'text', content: 'Hello' });
    });
  });
});

describe('round-trip conversion', () => {
  it('preserves simple text through round-trip', () => {
    const original: CommentSegment[] = [createTextSegment('Hello world')];

    const doc = segmentsToTipTapDoc(original);
    const result = tipTapDocToSegments(doc);

    expect(result).toEqual(original);
  });

  it('preserves user mention through round-trip', () => {
    const original: CommentSegment[] = [createMentionSegment(mentionFixtures.userJohn)];

    const doc = segmentsToTipTapDoc(original);
    const result = tipTapDocToSegments(doc);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('mention');
    expect((result[0] as any).mention.id).toBe(mentionFixtures.userJohn.id);
  });

  it('preserves mixed content through round-trip', () => {
    const original = segmentFixtures.singleUserMention;

    const doc = segmentsToTipTapDoc(original);
    const result = tipTapDocToSegments(doc);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'text', content: 'Hello ' });
    expect(result[1].type).toBe('mention');
    expect(result[2]).toEqual({ type: 'text', content: '!' });
  });

  it('preserves newlines through round-trip', () => {
    const original: CommentSegment[] = [createTextSegment('Line 1\nLine 2\nLine 3')];

    const doc = segmentsToTipTapDoc(original);
    const result = tipTapDocToSegments(doc);

    expect(result).toEqual(original);
  });

  it('preserves all mention types through round-trip', () => {
    const mentionTypes = ['user', 'field', 'asset', 'record', 'model'];

    for (const type of mentionTypes) {
      let mention;
      switch (type) {
        case 'user':
          mention = createUserMention();
          break;
        case 'field':
          mention = createFieldMention();
          break;
        case 'asset':
          mention = createAssetMention();
          break;
        case 'record':
          mention = createRecordMention();
          break;
        case 'model':
          mention = createModelMention();
          break;
      }

      const original: CommentSegment[] = [createMentionSegment(mention!)];
      const doc = segmentsToTipTapDoc(original);
      const result = tipTapDocToSegments(doc);

      expect(result[0].type).toBe('mention');
      expect((result[0] as any).mention.type).toBe(type);
    }
  });
});

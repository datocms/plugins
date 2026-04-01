/**
 * Tests for StructuredTextTranslation.ts
 * Tests translation of structured text fields with complex node structures.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { translateStructuredTextValue } from './StructuredTextTranslation';
import type { TranslationProvider } from './types';

// Mock translateArray
vi.mock('./translateArray', () => ({
  translateArray: vi.fn(),
}));

// Mock translateFieldValue for block translation
vi.mock('./TranslateField', () => ({
  translateFieldValue: vi.fn(),
}));

import { translateFieldValue } from './TranslateField';
import { translateArray } from './translateArray';

describe('StructuredTextTranslation', () => {
  const mockPluginParams: ctxParamsType = {
    apiKey: 'test-key',
    gptModel: 'gpt-4',
    translationFields: [],
    translateWholeRecord: false,
    translateBulkRecords: false,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };

  let mockProvider: TranslationProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      vendor: 'openai',
      streamText: vi.fn(),
      completeText: vi.fn(),
    };
  });

  describe('translateStructuredTextValue', () => {
    describe('empty/invalid value handling', () => {
      it('should return null for null value', async () => {
        const result = await translateStructuredTextValue(
          null,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(result).toBe(null);
        expect(translateArray).not.toHaveBeenCalled();
      });

      it('should return empty array for empty array', async () => {
        const result = await translateStructuredTextValue(
          [],
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(result).toEqual([]);
        expect(translateArray).not.toHaveBeenCalled();
      });

      it('should return non-array values as-is', async () => {
        const result = await translateStructuredTextValue(
          'not an array',
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(result).toBe('not an array');
      });
    });

    describe('simple paragraph translation', () => {
      it('should translate text nodes in paragraphs', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Hallo Welt']);

        const structuredText = [
          {
            type: 'paragraph',
            children: [{ text: 'Hello World' }],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Hello World'],
          'en',
          'de',
          { isHTML: false, recordContext: '' },
        );

        expect(result).toEqual([
          {
            type: 'paragraph',
            children: [{ text: 'Hallo Welt' }],
          },
        ]);
      });

      it('should translate multiple text nodes', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Eins', 'Zwei', 'Drei']);

        const structuredText = [
          {
            type: 'paragraph',
            children: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const firstParagraph = (
          result as Array<{ children: Array<{ text: string }> }>
        )[0];
        expect(firstParagraph.children[0].text).toBe('Eins');
        expect(firstParagraph.children[1].text).toBe('Zwei');
        expect(firstParagraph.children[2].text).toBe('Drei');
      });
    });

    describe('nested structure handling', () => {
      it('should translate span.value leaves without touching link metadata', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Clicca qui']);

        const structuredText = [
          {
            type: 'paragraph',
            children: [
              {
                type: 'link',
                url: 'https://example.com',
                meta: [{ id: 'target', value: '_blank' }],
                children: [{ type: 'span', value: 'Click here' }],
              },
            ],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'it',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Click here'],
          'en',
          'it',
          expect.any(Object),
        );

        const link = (
          result as Array<{
            children: Array<{
              meta: Array<{ value: string }>;
              children: Array<{ value: string }>;
            }>;
          }>
        )[0].children[0];
        expect(link.children[0].value).toBe('Clicca qui');
        expect(link.meta[0].value).toBe('_blank');
      });

      it('should translate text in nested links', async () => {
        vi.mocked(translateArray).mockResolvedValue([
          'Klicken Sie ',
          'hier',
          ' für mehr.',
        ]);

        const structuredText = [
          {
            type: 'paragraph',
            children: [
              { text: 'Click ' },
              {
                type: 'link',
                url: 'https://example.com',
                children: [{ text: 'here' }],
              },
              { text: ' for more.' },
            ],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Click ', 'here', ' for more.'],
          'en',
          'de',
          expect.any(Object),
        );

        // Verify structure is preserved
        const paragraph = (result as Array<{ children: unknown[] }>)[0];
        expect(paragraph.children).toHaveLength(3);
      });

      it('should preserve formatting marks', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Fett', 'Kursiv']);

        const structuredText = [
          {
            type: 'paragraph',
            children: [
              { text: 'Bold', bold: true },
              { text: 'Italic', italic: true },
            ],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const paragraph = (
          result as Array<{
            children: Array<{ text: string; bold?: boolean; italic?: boolean }>;
          }>
        )[0];
        expect(paragraph.children[0].text).toBe('Fett');
        expect(paragraph.children[0].bold).toBe(true);
        expect(paragraph.children[1].text).toBe('Kursiv');
        expect(paragraph.children[1].italic).toBe(true);
      });
    });

    describe('block node handling', () => {
      it('should separate block nodes for separate translation', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Übersetzter Text']);
        vi.mocked(translateFieldValue).mockResolvedValue([
          {
            type: 'block',
            item: 'block-123',
            originalIndex: 1,
          },
        ]);

        const structuredText = [
          {
            type: 'paragraph',
            children: [{ text: 'Translated text' }],
          },
          {
            type: 'block',
            item: 'block-123',
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(translateFieldValue).toHaveBeenCalled();
        expect(Array.isArray(result)).toBe(true);
        expect(translateFieldValue).toHaveBeenCalledWith(
          expect.any(Array),
          mockPluginParams,
          'de',
          'en',
          'rich_text',
          mockProvider,
          '',
          'api-token',
          '',
          'main',
          undefined,
          '',
          undefined,
          { bypassFieldTypeAllowlist: true },
        );
      });
    });

    describe('array length mismatch handling', () => {
      it('should pad with originals when translated array is shorter', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Eins']); // Only one translation

        const structuredText = [
          {
            type: 'paragraph',
            children: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const paragraph = (
          result as Array<{ children: Array<{ text: string }> }>
        )[0];
        expect(paragraph.children).toHaveLength(3);
        expect(paragraph.children[0].text).toBe('Eins');
        // Remaining should be originals
        expect(paragraph.children[1].text).toBe('Two');
        expect(paragraph.children[2].text).toBe('Three');
      });

      it('should truncate when translated array is longer', async () => {
        vi.mocked(translateArray).mockResolvedValue([
          'Eins',
          'Zwei',
          'Drei',
          'Vier',
        ]);

        const structuredText = [
          {
            type: 'paragraph',
            children: [{ text: 'One' }, { text: 'Two' }],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const paragraph = (
          result as Array<{ children: Array<{ text: string }> }>
        )[0];
        expect(paragraph.children).toHaveLength(2);
      });
    });

    describe('whitespace preservation', () => {
      it('should preserve pure whitespace nodes', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Wort', 'Anderes']);

        const structuredText = [
          {
            type: 'paragraph',
            children: [
              { text: 'Word' },
              { text: ' ' }, // Pure whitespace
              { text: 'Other' },
            ],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const paragraph = (
          result as Array<{ children: Array<{ text: string }> }>
        )[0];
        // Middle space should be preserved
        expect(paragraph.children[1].text).toBe(' ');
      });

      it('should preserve leading/trailing spaces on nodes', async () => {
        // The translation drops leading space, but original had one
        vi.mocked(translateArray).mockResolvedValue(['Hallo', 'Welt']);

        const structuredText = [
          {
            type: 'paragraph',
            children: [
              { text: 'Hello ' }, // Has trailing space
              { text: 'World' },
            ],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const paragraph = (
          result as Array<{ children: Array<{ text: string }> }>
        )[0];
        // Should restore trailing space that was on original
        expect(paragraph.children[0].text.endsWith(' ')).toBe(true);
      });
    });

    describe('id removal', () => {
      it('should remove id fields from nodes', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Hallo']);

        const structuredText = [
          {
            id: 'node-123',
            type: 'paragraph',
            children: [{ id: 'text-456', text: 'Hello' }],
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        const paragraph = result as Array<{
          id?: string;
          children: Array<{ id?: string }>;
        }>;
        expect(paragraph[0].id).toBeUndefined();
        expect(paragraph[0].children[0].id).toBeUndefined();
      });
    });

    describe('API response format handling', () => {
      it('should handle document.children wrapper format', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Hallo Welt']);

        const apiResponse = {
          document: {
            children: [
              {
                type: 'paragraph',
                children: [{ text: 'Hello World' }],
              },
            ],
            type: 'root',
          },
          schema: 'dast',
        };

        const result = await translateStructuredTextValue(
          apiResponse,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        // Should return in the same format
        expect(result).toHaveProperty('document');
        expect(result).toHaveProperty('schema', 'dast');
      });
    });

    describe('error handling', () => {
      it('should throw error when translation fails', async () => {
        vi.mocked(translateArray).mockRejectedValue(new Error('API Error'));

        const structuredText = [
          {
            type: 'paragraph',
            children: [{ text: 'Hello' }],
          },
        ];

        await expect(
          translateStructuredTextValue(
            structuredText,
            mockPluginParams,
            'de',
            'en',
            mockProvider,
            'api-token',
            'main',
          ),
        ).rejects.toThrow();
      });
    });

    describe('stream callbacks', () => {
      it('should pass stream callbacks to block translation', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Text']);
        vi.mocked(translateFieldValue).mockResolvedValue([
          { type: 'block', item: 'block-1', originalIndex: 1 },
        ]);

        const callbacks = {
          onStream: vi.fn(),
          onComplete: vi.fn(),
        };

        const structuredText = [
          { type: 'paragraph', children: [{ text: 'Text' }] },
          { type: 'block', item: 'block-1' },
        ];

        await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
          callbacks,
        );

        expect(translateFieldValue).toHaveBeenCalledWith(
          expect.any(Array),
          mockPluginParams,
          'de',
          'en',
          'rich_text',
          mockProvider,
          '',
          'api-token',
          '',
          'main',
          callbacks,
          '',
          undefined,
          { bypassFieldTypeAllowlist: true },
        );
      });
    });

    describe('record context', () => {
      it('should pass record context to translateArray', async () => {
        vi.mocked(translateArray).mockResolvedValue(['Translated']);

        const structuredText = [
          { type: 'paragraph', children: [{ text: 'Original' }] },
        ];

        await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
          undefined,
          'Blog post content',
        );

        expect(translateArray).toHaveBeenCalledWith(
          mockProvider,
          mockPluginParams,
          ['Original'],
          'en',
          'de',
          { isHTML: false, recordContext: 'Blog post content' },
        );
      });
    });

    describe('no text nodes', () => {
      it('should return original value when no text nodes found', async () => {
        const structuredText = [
          {
            type: 'thematicBreak',
          },
        ];

        const result = await translateStructuredTextValue(
          structuredText,
          mockPluginParams,
          'de',
          'en',
          mockProvider,
          'api-token',
          'main',
        );

        expect(translateArray).not.toHaveBeenCalled();
        expect(result).toEqual(structuredText);
      });
    });
  });
});

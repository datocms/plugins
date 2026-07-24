import {
  isRichTextFieldValueInRequest,
  isSingleBlockFieldValueInRequest,
  isStructuredTextFieldValueInRequest,
} from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import type { NestedBlockPath } from '../../types';
import {
  setNestedFieldValueInBlock,
  traverseAndRemoveBlocks,
  traverseAndUpdateNestedBlocks,
  traverseAndUpdateNestedBlocksAtLevel,
} from './traverse';

function block(
  id: string,
  itemTypeId: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: 'item',
    __itemTypeId: itemTypeId,
    relationships: {
      item_type: {
        data: { type: 'item_type', id: itemTypeId },
      },
    },
    meta: { created_at: '2026-01-01T00:00:00Z' },
    attributes,
  };
}

function updateBlock(
  id: string,
  itemTypeId: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'item',
    id,
    relationships: {
      item_type: {
        data: {
          type: 'item_type',
          id: itemTypeId,
        },
      },
    },
    attributes,
  };
}

function step(
  fieldApiKey: string,
  expectedBlockTypeId: string,
  fieldType: NestedBlockPath['path'][number]['fieldType'] = 'rich_text',
  localized = false,
): NestedBlockPath['path'][number] {
  return {
    fieldApiKey,
    expectedBlockTypeId,
    localized,
    fieldType,
  };
}

describe('nested block update requests', () => {
  it('emits a minimal block patch and ID references for untouched siblings', () => {
    const originalTarget = block('target-1', 'target-type', {
      heading: 'Keep me out of the update',
      link: ['stale-link-block'],
    });
    const originalSibling = block('sibling-1', 'other-type', {
      heading: 'Untouched',
    });

    const result = traverseAndUpdateNestedBlocksAtLevel(
      [originalTarget, originalSibling],
      step('content', 'target-type'),
      (currentBlock) =>
        setNestedFieldValueInBlock(currentBlock, 'converted_links', [
          'record-1',
        ]),
    );

    expect(result).toEqual({
      updated: true,
      newValue: [
        updateBlock('target-1', 'target-type', {
          converted_links: ['record-1'],
        }),
        'sibling-1',
      ],
    });
    expect(JSON.stringify(result.newValue)).not.toContain('stale-link-block');
    expect(JSON.stringify(result.newValue)).not.toContain('Keep me out');
    expect(isRichTextFieldValueInRequest(result.newValue)).toBe(true);
  });

  it('does not mark a matching no-op callback as updated', () => {
    const original = [
      block('target-1', 'target-type', {
        heading: 'No source value here',
      }),
    ];

    const result = traverseAndUpdateNestedBlocksAtLevel(
      original,
      step('content', 'target-type'),
      (currentBlock) => currentBlock,
    );

    expect(result.updated).toBe(false);
    expect(result.newValue).toBe(original);
  });

  it('uses ID references for unchanged locales in a localized update', () => {
    const localizedValue = {
      en: [
        block('target-en', 'target-type', {
          source: ['source-block'],
          link: ['stale-link-block'],
        }),
      ],
      'de-DE': [
        block('target-de', 'target-type', {
          source: null,
          link: ['stale-link-block'],
        }),
      ],
    };

    const result = traverseAndUpdateNestedBlocksAtLevel(
      localizedValue,
      step('content', 'target-type', 'rich_text', true),
      (currentBlock) => {
        const source = (
          currentBlock.attributes as Record<string, unknown> | undefined
        )?.source;
        return source
          ? setNestedFieldValueInBlock(
              currentBlock,
              'converted_links',
              ['record-1'],
            )
          : currentBlock;
      },
    );

    expect(result).toEqual({
      updated: true,
      newValue: {
        en: [
          updateBlock('target-en', 'target-type', {
            converted_links: ['record-1'],
          }),
        ],
        'de-DE': ['target-de'],
      },
    });
    expect(JSON.stringify(result.newValue)).not.toContain('stale-link-block');
  });

  it('keeps minimal patches through multiple nesting levels', () => {
    const target = block('target-1', 'target-type', {
      link: ['stale-link-block'],
      title: 'Target',
    });
    const childSibling = block('child-sibling-1', 'other-type', {
      title: 'Sibling',
    });
    const container = block('container-1', 'container-type', {
      title: 'Container',
      children: [target, childSibling],
    });
    const rootSibling = block('root-sibling-1', 'other-container', {
      title: 'Root sibling',
    });

    const path = [
      step('sections', 'container-type'),
      step('children', 'target-type'),
    ];
    const result = traverseAndUpdateNestedBlocks(
      [container, rootSibling],
      path,
      0,
      (currentBlock) =>
        setNestedFieldValueInBlock(currentBlock, 'converted_link', 'record-1'),
    );

    expect(result.newValue).toEqual([
      updateBlock('container-1', 'container-type', {
        children: [
          updateBlock('target-1', 'target-type', {
            converted_link: 'record-1',
          }),
          'child-sibling-1',
        ],
      }),
      'root-sibling-1',
    ]);
  });

  it('uses a minimal patch for single-block fields', () => {
    const original = block('target-1', 'target-type', {
      link: ['stale-link-block'],
    });

    const result = traverseAndUpdateNestedBlocksAtLevel(
      original,
      step('hero', 'target-type', 'single_block'),
      (currentBlock) =>
        setNestedFieldValueInBlock(currentBlock, 'converted_link', 'record-1'),
    );

    expect(result.newValue).toEqual(
      updateBlock('target-1', 'target-type', {
        converted_link: 'record-1',
      }),
    );
    expect(isSingleBlockFieldValueInRequest(result.newValue)).toBe(true);
  });

  it('uses request-safe block items in Structured Text', () => {
    const original = {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'block',
            item: block('target-1', 'target-type', {
              link: ['stale-link-block'],
            }),
          },
          {
            type: 'paragraph',
            children: [
              {
                type: 'span',
                value: 'Before ',
                marks: [],
              },
              {
                type: 'inlineBlock',
                item: block('sibling-1', 'other-type', {}),
              },
            ],
          },
        ],
      },
    };

    const result = traverseAndUpdateNestedBlocksAtLevel(
      original,
      step('body', 'target-type', 'structured_text'),
      (currentBlock) =>
        setNestedFieldValueInBlock(currentBlock, 'converted_link', 'record-1'),
    );

    expect(result.newValue).toEqual({
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'block',
            item: updateBlock('target-1', 'target-type', {
              converted_link: 'record-1',
            }),
          },
          {
            type: 'paragraph',
            children: [
              {
                type: 'span',
                value: 'Before ',
                marks: [],
              },
              {
                type: 'inlineBlock',
                item: 'sibling-1',
              },
            ],
          },
        ],
      },
    });
    expect(isStructuredTextFieldValueInRequest(result.newValue)).toBe(true);
  });

  it('removes blocks without round-tripping untouched block attributes', () => {
    const target = block('target-1', 'target-type', {
      link: ['stale-link-block'],
    });
    const sibling = block('sibling-1', 'other-type', {
      title: 'Untouched',
    });

    const result = traverseAndRemoveBlocks(
      [target, sibling],
      [step('content', 'target-type')],
      0,
      'target-type',
    );

    expect(result).toEqual({
      updated: true,
      newValue: ['sibling-1'],
    });
  });

  it('does not report a removal when the target type is absent', () => {
    const original = [
      block('sibling-1', 'other-type', {
        title: 'Untouched',
      }),
    ];

    const result = traverseAndRemoveBlocks(
      original,
      [step('content', 'target-type')],
      0,
      'target-type',
    );

    expect(result.updated).toBe(false);
    expect(result.newValue).toBe(original);
  });
});

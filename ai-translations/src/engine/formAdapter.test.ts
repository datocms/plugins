/**
 * Tests for formAdapter.ts — the JSON:API ⇄ simple-client-shape normalization
 * layer between `ctx.formValuesToItem`/`ctx.itemToFormValues` and the engine
 * (spec §2.1).
 */

import { describe, expect, it } from 'vitest';
import {
  assertNoBareBlockIds,
  EngineInputError,
  itemToSimpleShape,
  payloadToFormWrites,
} from './formAdapter';

describe('itemToSimpleShape', () => {
  it('round-trips a scalar localized field', () => {
    const item = {
      attributes: {
        title: { en: 'Hello', it: 'Ciao' },
      },
      relationships: {
        item_type: { data: { id: 'item-type-1' } },
      },
    };

    expect(itemToSimpleShape(item)).toEqual({
      itemTypeId: 'item-type-1',
      fields: {
        title: { en: 'Hello', it: 'Ciao' },
      },
    });
  });

  it('round-trips a single_block field value unchanged', () => {
    const singleBlockValue = {
      type: 'item',
      id: 'block-1',
      attributes: { text: { en: 'Block text' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    const item = {
      attributes: {
        hero: { en: singleBlockValue, it: null },
      },
      relationships: {
        item_type: { data: { id: 'item-type-1' } },
      },
    };

    expect(itemToSimpleShape(item)).toEqual({
      itemTypeId: 'item-type-1',
      fields: {
        hero: { en: singleBlockValue, it: null },
      },
    });
  });

  it('round-trips nested modular content (array of blocks) unchanged', () => {
    const blockA = {
      type: 'item',
      id: 'block-a',
      attributes: { text: { en: 'A' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    const blockB = {
      type: 'item',
      id: 'block-b',
      attributes: {
        // A block field can itself hold nested modular content.
        children: {
          en: [
            {
              type: 'item',
              id: 'block-c',
              attributes: { text: { en: 'C' } },
              relationships: { item_type: { data: { id: 'block-model-2' } } },
            },
          ],
        },
      },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    const item = {
      attributes: {
        body: { en: [blockA, blockB], it: [] },
      },
      relationships: {
        item_type: { data: { id: 'item-type-1' } },
      },
    };

    expect(itemToSimpleShape(item)).toEqual({
      itemTypeId: 'item-type-1',
      fields: {
        body: { en: [blockA, blockB], it: [] },
      },
    });
  });
});

describe('assertNoBareBlockIds', () => {
  it('does not throw for a scalar localized field', () => {
    expect(() =>
      assertNoBareBlockIds({
        attributes: { title: { en: 'Hello', it: 'Ciao' } },
        relationships: { item_type: { data: { id: 'item-type-1' } } },
      }),
    ).not.toThrow();
  });

  it('does not throw for a well-formed single_block value', () => {
    expect(() =>
      assertNoBareBlockIds({
        attributes: {
          hero: {
            en: {
              type: 'item',
              id: 'block-1',
              attributes: { text: { en: 'Block text' } },
              relationships: { item_type: { data: { id: 'block-model-1' } } },
            },
          },
        },
        relationships: { item_type: { data: { id: 'item-type-1' } } },
      }),
    ).not.toThrow();
  });

  it('does not throw for well-formed nested modular content', () => {
    const block = {
      type: 'item',
      id: 'block-a',
      attributes: { text: { en: 'A' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    expect(() =>
      assertNoBareBlockIds({
        attributes: { body: { en: [block, block] } },
        relationships: { item_type: { data: { id: 'item-type-1' } } },
      }),
    ).not.toThrow();
  });

  it('throws EngineInputError naming the path when a zero-field block collapses to a bare id', () => {
    const properBlock = {
      type: 'item',
      id: 'block-a',
      attributes: { text: { en: 'A' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    // A zero-field "Divider" block model serialises to a bare id string
    // (§2.1) instead of `{ type: 'item', id, attributes, relationships }`,
    // and cannot round-trip through `itemToFormValues`.
    const item = {
      attributes: {
        body: { en: [properBlock, 'divider-block-id'] },
      },
      relationships: { item_type: { data: { id: 'item-type-1' } } },
    };

    expect(() => assertNoBareBlockIds(item)).toThrow(EngineInputError);
    expect(() => assertNoBareBlockIds(item)).toThrow(
      /attributes\.body\.en\[1\]/,
    );
  });
});

describe('payloadToFormWrites', () => {
  it('emits one write per (field, newLocale) with dot-joined field paths', () => {
    const payload = {
      title: { en: 'Hello', it: 'Ciao' },
      slug: { en: 'hello-world', it: 'ciao-mondo' },
    };
    const writtenLocales = { title: ['it'], slug: ['it'] };

    expect(payloadToFormWrites(payload, writtenLocales)).toEqual([
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
      { fieldPath: 'slug.it', locale: 'it', value: 'ciao-mondo' },
    ]);
  });

  it('skips a locale not listed in writtenLocales (spread-in original, untouched)', () => {
    // `en` here is the spread-in original value the payload builder carries
    // forward for locale-sync bookkeeping — it must never be written back
    // into the live form.
    const payload = {
      title: { en: 'Hello', de: 'Hallo', it: 'Ciao' },
    };
    const writtenLocales = { title: ['it'] };

    const writes = payloadToFormWrites(payload, writtenLocales);

    expect(writes).toEqual([{ fieldPath: 'title.it', locale: 'it', value: 'Ciao' }]);
    expect(writes.some((w) => w.locale === 'en')).toBe(false);
    expect(writes.some((w) => w.locale === 'de')).toBe(false);
  });

  it('emits nothing for a field absent from writtenLocales', () => {
    const payload = { title: { en: 'Hello', it: 'Ciao' } };
    expect(payloadToFormWrites(payload, {})).toEqual([]);
  });
});

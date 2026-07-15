/**
 * Tests for formAdapter.ts — the JSON:API ⇄ simple-client-shape normalization
 * layer between `ctx.formValuesToItem`/`ctx.itemToFormValues` and the engine
 * (spec §2.1).
 */

import { describe, expect, it } from 'vitest';
import {
  assertNoBareBlockIds,
  EngineInputError,
  formShapeToFormWrites,
  itemToSimpleShape,
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
  it('does not throw for a scalar localized field not in the block-bearing set', () => {
    expect(() =>
      assertNoBareBlockIds(
        {
          attributes: { title: { en: 'Hello', it: 'Ciao' } },
          relationships: { item_type: { data: { id: 'item-type-1' } } },
        },
        [],
      ),
    ).not.toThrow();
  });

  it('does not throw for a scalar string that looks like an id but is not a block field', () => {
    // The schema-aware pass keys off `blockBearingFieldApiKeys`; a scalar
    // string field that happens to hold an id-shaped value is invisible to it
    // because it is not listed — no false positive.
    expect(() =>
      assertNoBareBlockIds(
        {
          attributes: { external_id: { en: 'abc123looksLikeAnId' } },
          relationships: { item_type: { data: { id: 'item-type-1' } } },
        },
        new Set<string>(),
      ),
    ).not.toThrow();
  });

  it('does not throw for a well-formed localized single_block value', () => {
    expect(() =>
      assertNoBareBlockIds(
        {
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
        },
        ['hero'],
      ),
    ).not.toThrow();
  });

  it('does not throw for a well-formed non-localized single_block value', () => {
    expect(() =>
      assertNoBareBlockIds(
        {
          attributes: {
            hero: {
              type: 'item',
              id: 'block-1',
              attributes: { text: 'Block text' },
              relationships: { item_type: { data: { id: 'block-model-1' } } },
            },
          },
          relationships: { item_type: { data: { id: 'item-type-1' } } },
        },
        ['hero'],
      ),
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
      assertNoBareBlockIds(
        {
          attributes: { body: { en: [block, block] } },
          relationships: { item_type: { data: { id: 'item-type-1' } } },
        },
        ['body'],
      ),
    ).not.toThrow();
  });

  it('throws EngineInputError naming the path for a LONE bare id under a single_block field (§2.1)', () => {
    // The exact §2.1 hazard: a zero-field block model serialises to a bare id
    // string sitting DIRECTLY under a `single_block` field (never an array
    // element), so the array-sibling heuristic can categorically never see it.
    // Only the schema-aware pass (this field is in `blockBearingFieldApiKeys`)
    // catches it.
    const item = {
      attributes: {
        hero: { en: 'zero-field-block-id' },
      },
      relationships: { item_type: { data: { id: 'item-type-1' } } },
    };

    expect(() => assertNoBareBlockIds(item, ['hero'])).toThrow(EngineInputError);
    expect(() => assertNoBareBlockIds(item, ['hero'])).toThrow(
      /attributes\.hero\.en/,
    );
  });

  it('throws for a bare id under a NON-localized single_block field', () => {
    const item = {
      attributes: {
        hero: 'zero-field-block-id',
      },
      relationships: { item_type: { data: { id: 'item-type-1' } } },
    };

    expect(() => assertNoBareBlockIds(item, new Set(['hero']))).toThrow(
      EngineInputError,
    );
    expect(() => assertNoBareBlockIds(item, new Set(['hero']))).toThrow(
      /attributes\.hero(?!\.)/,
    );
  });

  it('does not throw for a localized structured_text (DAST) field value', () => {
    // A structured_text field's value is `{ schema: 'dast', document: <tree> }`
    // — NOT a block object and NOT an array of blocks. The literal string
    // 'dast' sitting at `.schema` must never be mistaken for a bare block id.
    expect(() =>
      assertNoBareBlockIds(
        {
          attributes: {
            structured_body: {
              en: {
                schema: 'dast',
                document: {
                  schema: 'dast',
                  children: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'span', value: 'hi' }],
                    },
                  ],
                },
              },
            },
          },
          relationships: { item_type: { data: { id: 'item-type-1' } } },
        },
        ['structured_body'],
      ),
    ).not.toThrow();
  });

  it('still throws for a genuine bare-id single_block value alongside a structured_text field', () => {
    // Regression: fixing the structured_text false positive must not blunt
    // the schema-aware bare-id check for a real single_block hazard.
    const item = {
      attributes: {
        hero: { en: 'zero-field-block-id' },
      },
      relationships: { item_type: { data: { id: 'item-type-1' } } },
    };

    expect(() =>
      assertNoBareBlockIds(item, ['hero']),
    ).toThrow(EngineInputError);
  });

  it('throws when a structured_text document holds a bare id beside a proper block sibling', () => {
    // Coverage preserved: a genuinely bare block id nested inside a DAST
    // document (e.g. a zero-field block collapsed inside a `children` array
    // alongside a well-formed block sibling) must still be flagged.
    const properBlock = {
      type: 'item',
      id: 'block-a',
      attributes: { text: { en: 'A' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    const item = {
      attributes: {
        structured_body: {
          en: {
            schema: 'dast',
            document: {
              type: 'root',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'span', value: 'hi' }],
                },
                properBlock,
                'bare-block-id',
              ],
            },
          },
        },
      },
      relationships: { item_type: { data: { id: 'item-type-1' } } },
    };

    expect(() =>
      assertNoBareBlockIds(item, ['structured_body']),
    ).toThrow(EngineInputError);
    expect(() =>
      assertNoBareBlockIds(item, ['structured_body']),
    ).toThrow(/attributes\.structured_body\.en\.document/);
  });

  it('never flags the DAST schema scalar itself, even when nested blocks are present', () => {
    const properBlock = {
      type: 'item',
      id: 'block-a',
      attributes: { text: { en: 'A' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    expect(() =>
      assertNoBareBlockIds(
        {
          attributes: {
            structured_body: {
              en: {
                schema: 'dast',
                document: {
                  type: 'root',
                  children: [properBlock],
                },
              },
            },
          },
          relationships: { item_type: { data: { id: 'item-type-1' } } },
        },
        ['structured_body'],
      ),
    ).not.toThrow();
  });

  it('throws EngineInputError naming the indexed path when a modular-content array holds a bare id', () => {
    const properBlock = {
      type: 'item',
      id: 'block-a',
      attributes: { text: { en: 'A' } },
      relationships: { item_type: { data: { id: 'block-model-1' } } },
    };
    // A zero-field "Divider" block model serialises to a bare id string
    // (§2.1) inside a modular-content array and cannot round-trip.
    const item = {
      attributes: {
        body: { en: [properBlock, 'divider-block-id'] },
      },
      relationships: { item_type: { data: { id: 'item-type-1' } } },
    };

    expect(() => assertNoBareBlockIds(item, ['body'])).toThrow(EngineInputError);
    expect(() => assertNoBareBlockIds(item, ['body'])).toThrow(
      /attributes\.body\.en\[1\]/,
    );
  });
});

describe('formShapeToFormWrites', () => {
  it('emits one write per (field, newLocale) with dot-joined field paths', () => {
    // Converted form-shape values (from `ctx.itemToFormValues`): a block value
    // here carries its top-level `itemTypeId`, unlike the raw CMA payload.
    const formValues = {
      title: { en: 'Hello', it: 'Ciao' },
      hero: {
        en: { itemTypeId: 'b1', label: 'Hero' },
        it: { itemTypeId: 'b1', label: 'Eroe' },
      },
    };
    const writtenLocales = { title: ['it'], hero: ['it'] };

    expect(formShapeToFormWrites(formValues, writtenLocales)).toEqual([
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
      {
        fieldPath: 'hero.it',
        locale: 'it',
        value: { itemTypeId: 'b1', label: 'Eroe' },
      },
    ]);
  });

  it('skips a locale not listed in writtenLocales (spread-in original, untouched)', () => {
    // `en`/`de` here are the original values the converted item still carries —
    // they must never be written back into the live form.
    const formValues = {
      title: { en: 'Hello', de: 'Hallo', it: 'Ciao' },
    };
    const writtenLocales = { title: ['it'] };

    const writes = formShapeToFormWrites(formValues, writtenLocales);

    expect(writes).toEqual([{ fieldPath: 'title.it', locale: 'it', value: 'Ciao' }]);
    expect(writes.some((w) => w.locale === 'en')).toBe(false);
    expect(writes.some((w) => w.locale === 'de')).toBe(false);
  });

  it('emits nothing for a field absent from writtenLocales', () => {
    const formValues = { title: { en: 'Hello', it: 'Ciao' } };
    expect(formShapeToFormWrites(formValues, {})).toEqual([]);
  });

  it('skips a written locale missing from the converted form values', () => {
    // Defensive: writtenLocales names a locale the converter did not emit.
    const formValues = { title: { it: 'Ciao' } };
    const writtenLocales = { title: ['it', 'de'] };

    expect(formShapeToFormWrites(formValues, writtenLocales)).toEqual([
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
    ]);
  });
});

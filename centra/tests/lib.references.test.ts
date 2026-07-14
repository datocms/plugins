import { describe, expect, it } from 'vitest';
import type { CentraFieldParametersV1 } from '../src/types';
import {
  CentraReferenceError,
  buildReferenceDocument,
  dedupeReferences,
  moveReference,
  parseReferenceDocument,
} from '../src/lib/references';

const multipleVariants: CentraFieldParametersV1 = {
  paramsVersion: '1',
  kind: 'variant',
  cardinality: 'multiple',
};

describe('parseReferenceDocument', () => {
  it('accepts null and serialized null as the sole empty values', () => {
    expect(parseReferenceDocument(null, multipleVariants)).toMatchObject({
      ok: true,
      document: null,
      references: [],
    });
    expect(parseReferenceDocument('null', multipleVariants)).toMatchObject({
      ok: true,
      document: null,
      references: [],
    });
  });

  it('parses Dato JSON field strings without rewriting them', () => {
    const raw = JSON.stringify({
      version: 1,
      kind: 'variant',
      references: [{ displayItemId: 9 }, { displayItemId: 3 }],
    });
    const result = parseReferenceDocument(raw, multipleVariants);
    expect(result).toMatchObject({
      ok: true,
      references: [{ displayItemId: 9 }, { displayItemId: 3 }],
    });
  });

  it('preserves malformed and unsupported raw strings in errors', () => {
    const malformed = '{broken';
    expect(parseReferenceDocument(malformed, multipleVariants)).toMatchObject({
      ok: false,
      rawValue: malformed,
      error: { code: 'invalid-shape' },
    });

    const unsupported = JSON.stringify({
      version: 2,
      kind: 'variant',
      references: [{ displayItemId: 1 }],
    });
    expect(parseReferenceDocument(unsupported, multipleVariants)).toMatchObject({
      ok: false,
      rawValue: unsupported,
      error: { code: 'unsupported-version' },
    });
  });

  it('rejects incompatible kind, cardinality, empty documents, and duplicates', () => {
    expect(
      parseReferenceDocument(
        {
          version: 1,
          kind: 'item',
          references: [{ displayItemId: 1, itemId: 'size-1' }],
        },
        multipleVariants,
      ),
    ).toMatchObject({ ok: false, error: { code: 'kind-mismatch' } });

    expect(
      parseReferenceDocument(
        { version: 1, kind: 'variant', references: [] },
        multipleVariants,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-shape' } });

    expect(
      parseReferenceDocument(
        {
          version: 1,
          kind: 'variant',
          references: [{ displayItemId: 1 }, { displayItemId: 2 }],
        },
        { ...multipleVariants, cardinality: 'single' },
      ),
    ).toMatchObject({ ok: false, error: { code: 'cardinality-mismatch' } });

    expect(
      parseReferenceDocument(
        {
          version: 1,
          kind: 'variant',
          references: [{ displayItemId: 1 }, { displayItemId: 1 }],
        },
        multipleVariants,
      ),
    ).toMatchObject({ ok: false, error: { code: 'duplicate-reference' } });
  });

  it('rejects references containing stale snapshot metadata', () => {
    expect(
      parseReferenceDocument(
        {
          version: 1,
          kind: 'variant',
          references: [{ displayItemId: 1, name: 'Old name' }],
        },
        multipleVariants,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-reference' } });

    expect(
      parseReferenceDocument(
        {
          version: 1,
          kind: 'item',
          references: [
            { displayItemId: 1, itemId: 'size-1', sku: 'STALE-SKU' },
          ],
        },
        { paramsVersion: '1', kind: 'item', cardinality: 'single' },
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-reference' } });
  });
});

describe('reference construction helpers', () => {
  it('builds versioned product and item documents and deduplicates stably', () => {
    expect(
      buildReferenceDocument(multipleVariants, [
        { displayItemId: 2 },
        { displayItemId: 1 },
        { displayItemId: 2 },
      ]),
    ).toEqual({
      version: 1,
      kind: 'variant',
      references: [{ displayItemId: 2 }, { displayItemId: 1 }],
    });

    expect(
      buildReferenceDocument(
        { paramsVersion: '1', kind: 'item', cardinality: 'multiple' },
        [
          { displayItemId: 2, itemId: 'a' },
          { displayItemId: 2, itemId: 'b' },
        ],
      ),
    ).toEqual({
      version: 1,
      kind: 'item',
      references: [
        { displayItemId: 2, itemId: 'a' },
        { displayItemId: 2, itemId: 'b' },
      ],
    });
  });

  it('returns null for no references and rejects multiple single values', () => {
    expect(buildReferenceDocument(multipleVariants, [])).toBeNull();
    expect(() =>
      buildReferenceDocument(
        { ...multipleVariants, cardinality: 'single' },
        [{ displayItemId: 1 }, { displayItemId: 2 }],
      ),
    ).toThrow(CentraReferenceError);
  });

  it('deduplicates and reorders without mutating input arrays', () => {
    const references = [
      { displayItemId: 1 },
      { displayItemId: 2 },
      { displayItemId: 1 },
    ];
    expect(dedupeReferences('variant', references)).toEqual([
      { displayItemId: 1 },
      { displayItemId: 2 },
    ]);
    expect(moveReference(references, 0, 2)).toEqual([
      { displayItemId: 2 },
      { displayItemId: 1 },
      { displayItemId: 1 },
    ]);
    expect(references[0]).toEqual({ displayItemId: 1 });
  });
});

import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  createRestoreEntitySanitizer,
  equalRestoreEntities,
} from './restoreEntity';

const entity = (
  attributes: Record<string, unknown>,
  model = 'article',
  id = 'record-id',
): Record<string, unknown> => ({
  type: 'item',
  id,
  attributes,
  relationships: { item_type: { data: { type: 'item_type', id: model } } },
});
const read = <T>(operation: () => Promise<T>) => operation();

describe('restore entity sanitation at scale', () => {
  it('clones and compares 12000 levels of opaque metadata without recursive calls', async () => {
    const metadata: Record<string, unknown> = { id: 'metadata-root' };
    let leaf = metadata;
    for (let depth = 0; depth < 12000; depth++) {
      const child = { id: `metadata-${depth}` };
      leaf.child = child;
      leaf = child;
    }
    const list = vi
      .fn()
      .mockResolvedValue([
        { api_key: 'metadata', field_type: 'json', localized: false },
      ]);
    const sanitize = createRestoreEntitySanitizer(
      { fields: { list } } as unknown as Client,
      read,
    );
    const source = entity({ metadata });
    const result = await sanitize(source);
    expect(result.id).toBeUndefined();
    expect(equalRestoreEntities(result.attributes, source.attributes)).toBe(
      true,
    );
    let clonedLeaf = (result.attributes as Record<string, unknown>)
      .metadata as Record<string, unknown>;
    for (let depth = 0; depth < 12000; depth++)
      clonedLeaf = clonedLeaf.child as Record<string, unknown>;
    expect(clonedLeaf.id).toBe('metadata-11999');
    expect(clonedLeaf).not.toBe(leaf);
    clonedLeaf.id = 'changed';
    expect(leaf.id).toBe('metadata-11999');
    expect(equalRestoreEntities(result.attributes, source.attributes)).toBe(
      false,
    );
  });

  it('loads only the two referenced schemas across 200 locales and 2000 nested blocks', async () => {
    const list = vi.fn(async (id: string) =>
      id === 'article'
        ? [{ api_key: 'sections', field_type: 'rich_text', localized: true }]
        : [{ api_key: 'caption', field_type: 'string', localized: false }],
    );
    const locales: Record<string, unknown> = {};
    for (let locale = 0; locale < 200; locale++) {
      locales[`locale-${locale}`] = Array.from({ length: 10 }, (_, block) =>
        entity(
          { caption: `Caption-${locale}-${block}` },
          'block',
          `block-${locale}-${block}`,
        ),
      );
    }
    const sanitize = createRestoreEntitySanitizer(
      { fields: { list } } as unknown as Client,
      read,
    );
    const result = await sanitize(entity({ sections: locales }));
    const sections = (result.attributes as Record<string, unknown>)
      .sections as Record<string, Record<string, unknown>[]>;
    expect(Object.keys(sections)).toHaveLength(200);
    expect(sections['locale-199']).toHaveLength(10);
    expect(sections['locale-199'][9].id).toBeUndefined();
    expect(sections['locale-199'][9].attributes).toEqual({
      caption: 'Caption-199-9',
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('preserves literal prototype-like JSON keys and rejects circular non-JSON input', async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        { api_key: 'metadata', field_type: 'json', localized: false },
      ]);
    const sanitize = createRestoreEntitySanitizer(
      { fields: { list } } as unknown as Client,
      read,
    );
    const metadata = JSON.parse(
      '{"__proto__":{"id":"literal"},"constructor":{"id":"also-literal"}}',
    );
    const result = await sanitize(entity({ metadata }));
    expect((result.attributes as Record<string, unknown>).metadata).toEqual(
      metadata,
    );
    expect(
      Object.getPrototypeOf(
        (result.attributes as Record<string, unknown>).metadata,
      ),
    ).toBe(Object.prototype);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(sanitize(entity({ metadata: circular }))).rejects.toThrow(
      'circular',
    );
  });
});

describe('equalRestoreEntities', () => {
  it('ignores object key order but preserves array order and missing keys', () => {
    expect(equalRestoreEntities({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(
      true,
    );
    expect(equalRestoreEntities({ a: 1, b: [2, 3] }, { b: [3, 2], a: 1 })).toBe(
      false,
    );
    expect(equalRestoreEntities({ a: null }, {})).toBe(false);
  });
});

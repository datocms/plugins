import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import { createRestoreEntitySanitizer } from './restoreEntity';

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

describe('createRestoreEntitySanitizer', () => {
  it('preserves literal prototype-like JSON keys and rejects circular non-JSON input', async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        { api_key: 'metadata', field_type: 'json', localized: false },
      ]);
    const sanitize = createRestoreEntitySanitizer({
      fields: { list },
    } as unknown as Client);
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

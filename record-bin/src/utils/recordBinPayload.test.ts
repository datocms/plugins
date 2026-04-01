import { describe, expect, it } from 'vitest';
import {
  buildRecordBinCompatiblePayload,
  extractEntityModelId,
  normalizeRecordBinPayload,
} from './recordBinPayload';

const entityFixture = {
  type: 'item',
  id: 'item-1',
  relationships: {
    item_type: {
      data: {
        type: 'item_type',
        id: 'model-1',
      },
    },
  },
  attributes: {
    title: 'Hello world',
  },
  meta: {
    created_at: '2024-01-01T00:00:00.000Z',
    first_published_at: null,
  },
};

describe('buildRecordBinCompatiblePayload', () => {
  it('builds a webhook-compatible envelope', () => {
    const payload = buildRecordBinCompatiblePayload({
      environment: 'main',
      entity: entityFixture,
      capturedAt: '2026-02-25T00:00:00.000Z',
    });

    expect(payload).toEqual({
      event_type: 'to_be_restored',
      entity_type: 'item',
      environment: 'main',
      entity: entityFixture,
      event_triggered_at: '2026-02-25T00:00:00.000Z',
      related_entities: [],
      __record_bin: {
        source: 'onBeforeItemsDestroy',
        version: '2026-02-25',
      },
    });
  });
});

describe('normalizeRecordBinPayload', () => {
  it('normalizes synthetic payload envelopes', () => {
    const normalized = normalizeRecordBinPayload(
      buildRecordBinCompatiblePayload({
        environment: 'sandbox',
        entity: entityFixture,
      }),
      'main',
    );

    expect(normalized.environment).toBe('sandbox');
    expect(normalized.entity).toEqual(entityFixture);
    expect(normalized.eventType).toBe('to_be_restored');
  });

  it('normalizes legacy webhook payload envelopes', () => {
    const normalized = normalizeRecordBinPayload(
      {
        event_type: 'delete',
        environment: 'staging',
        entity: entityFixture,
      },
      'main',
    );

    expect(normalized.environment).toBe('staging');
    expect(normalized.entity).toEqual(entityFixture);
    expect(normalized.eventType).toBe('delete');
  });

  it('accepts raw entity payloads and applies fallback environment', () => {
    const normalized = normalizeRecordBinPayload(entityFixture, 'main');

    expect(normalized.environment).toBe('main');
    expect(normalized.entity).toEqual(entityFixture);
    expect(normalized.eventType).toBeUndefined();
  });

  it('throws for malformed payloads', () => {
    expect(() => normalizeRecordBinPayload('not-json', 'main')).toThrow(
      /Unexpected token/,
    );
    expect(() => normalizeRecordBinPayload({ foo: 'bar' }, 'main')).toThrow(
      /entity payload/,
    );
  });
});

describe('extractEntityModelId', () => {
  it('extracts the model id from raw entities', () => {
    expect(extractEntityModelId(entityFixture)).toBe('model-1');
  });
});

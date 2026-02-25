/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import { buildEnvelopeFingerprint } from './checkpoint';
import type { RecordExportEnvelope } from './types';

function envelopeFixture(): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T10:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [],
      fields: [],
      itemTypeIdToApiKey: {},
      fieldIdToApiKey: {},
      fieldsByItemType: {},
    },
    records: [
      { id: 'a', item_type: { id: 'model_a' } },
      { id: 'b', item_type: { id: 'model_b' } },
    ],
    referenceIndex: {
      recordRefs: [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
  };
}

describe('buildEnvelopeFingerprint', () => {
  test('is deterministic for the same envelope', () => {
    const one = buildEnvelopeFingerprint(envelopeFixture());
    const two = buildEnvelopeFingerprint(envelopeFixture());
    expect(one).toBe(two);
  });
});

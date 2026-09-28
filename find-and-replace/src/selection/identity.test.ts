import { describe, expect, it } from 'vitest';
import {
  areOverlappingFieldValueTargets,
  exactMatchIdentity,
  fieldValueIdentity,
  fingerprintString,
  fingerprintValue,
  stableSerialize,
} from './identity';
import type { ExactMatchRef, FieldValueRef } from './types';

function fieldRef(overrides: Partial<FieldValueRef> = {}): FieldValueRef {
  return {
    kind: 'field_value',
    siteId: 'site',
    environment: 'main',
    rootModelId: 'page',
    rootRecordId: 'page-1',
    rootRecordVersion: 'v1',
    ownerModelId: 'page',
    ownerRecordId: 'page-1',
    fieldId: 'title-field',
    fieldApiKey: 'title',
    fieldType: 'string',
    locale: 'en',
    blockAncestry: [],
    ancestorFieldValueIds: [],
    valuePath: ['attributes', 'title', 'en'],
    present: true,
    valueFingerprint: fingerprintValue('Title'),
    ...overrides,
  };
}

describe('fingerprints', () => {
  it('computes 64-bit FNV-1a over UTF-16 code units', () => {
    // Reference values of FNV-1a 64 (offset 0xcbf29ce484222325).
    expect(fingerprintString('')).toBe('fnv1a64:cbf29ce484222325');
    expect(fingerprintString('a')).toBe('fnv1a64:af63dc4c8601ec8c');
    expect(fingerprintString('foobar')).toBe('fnv1a64:85944171f73967e8');
    expect(fingerprintString('\uffff\u0000😀')).toMatch(
      /^fnv1a64:[0-9a-f]{16}$/,
    );
  });

  it('serializes keys in order, and marks only real cycles', () => {
    const shared = { x: 1 };
    const cyclic: Record<string, unknown> = { b: 2, a: shared };
    cyclic.self = cyclic;
    expect(stableSerialize({ b: 1, a: [shared, shared] })).toBe(
      '{"a":[{"x":1},{"x":1}],"b":1}',
    );
    expect(stableSerialize(cyclic)).toBe(
      '{"a":{"x":1},"b":2,"self":{"$cycle":true}}',
    );
  });
});

describe('selection identities', () => {
  it('uses semantic IDs while ignoring relocation and stale-check metadata', () => {
    const original = fieldRef();
    const rescanned = fieldRef({
      rootRecordVersion: 'v2',
      fieldApiKey: 'renamed_title',
      valuePath: ['attributes', 'renamed_title', 'en'],
      valueFingerprint: fingerprintValue('Changed title'),
    });

    expect(fieldValueIdentity(rescanned)).toBe(fieldValueIdentity(original));
  });

  it('keeps equal repeated matches distinct by deterministic occurrence order', () => {
    const fieldValue = fieldRef();
    const first: ExactMatchRef = {
      kind: 'exact_match',
      fieldValue,
      matcherFingerprint: 'matcher',
      occurrenceIndex: 0,
      matchedText: 'Title',
      context: {
        before: '',
        match: 'Title',
        after: ' Title',
        beforeTruncated: false,
        afterTruncated: false,
      },
      fragments: [{ path: [], start: 0, end: 5 }],
    };
    const second: ExactMatchRef = {
      ...first,
      occurrenceIndex: 1,
      context: {
        before: 'Title ',
        match: 'Title',
        after: '',
        beforeTruncated: false,
        afterTruncated: false,
      },
      fragments: [{ path: [], start: 6, end: 11 }],
    };

    expect(exactMatchIdentity(first)).not.toBe(exactMatchIdentity(second));
  });

  it('recognizes whole-container and descendant overlap', () => {
    const container = fieldRef({
      fieldId: 'modules',
      fieldApiKey: 'modules',
      fieldType: 'rich_text',
      locale: null,
    });
    const child = fieldRef({
      ownerModelId: 'block-model',
      ownerRecordId: 'block-1',
      fieldId: 'heading',
      ancestorFieldValueIds: [fieldValueIdentity(container)],
    });

    expect(areOverlappingFieldValueTargets(container, child)).toBe(true);
  });
});

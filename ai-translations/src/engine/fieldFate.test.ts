/**
 * Tests for fieldFate.ts
 * Verifies the two-list (excluded / copy) fate resolution, the §4.1
 * `cannotBeBlank` legacy auto-split, and the §7 run-bucket admin lock.
 */

import { describe, expect, it } from 'vitest';
import { resolveFieldFate } from './fieldFate';

const baseArgs = {
  fieldId: 'field-1',
  fieldApiKey: 'my_field',
  validators: {},
  excludedTokens: [] as string[],
  copyTokens: [] as string[],
};

describe('resolveFieldFate', () => {
  it('resolves a plain excluded optional field to exclude', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        validators: {},
        excludedTokens: ['field-1'],
      }),
    ).toBe('exclude');
  });

  it('auto-splits an excluded required field to copy (legacy behavior)', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        validators: { required: {} },
        excludedTokens: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('auto-splits an excluded field with length.min:1 and no required to copy', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        validators: { length: { min: 1 } },
        excludedTokens: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('resolves a field on copyTokens to copy regardless of validators', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        validators: {},
        copyTokens: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('resolves a field on neither list to translate', () => {
    expect(resolveFieldFate({ ...baseArgs })).toBe('translate');
  });

  it('matches excluded tokens via api_key fallback when fieldId is absent from the list', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        fieldId: 'some-other-id',
        fieldApiKey: 'my_field',
        excludedTokens: ['my_field'],
      }),
    ).toBe('exclude');
  });

  it('matches copyTokens via api_key fallback', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        fieldId: 'some-other-id',
        fieldApiKey: 'my_field',
        copyTokens: ['my_field'],
      }),
    ).toBe('copy');
  });

  it('copy list wins over exclude list when a field sits on both (defensive)', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        excludedTokens: ['field-1'],
        copyTokens: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('a run skip bucket excludes a non-admin-listed field', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        runSkipIds: ['field-1'],
      }),
    ).toBe('exclude');
  });

  it('a run copy bucket copies a non-admin-listed field', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        runCopyIds: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('a run skip bucket never overrides an admin-excluded field (locked)', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        excludedTokens: ['field-1'],
        runCopyIds: ['field-1'],
      }),
    ).toBe('exclude');
  });

  it('a run copy bucket never overrides an admin-copy field (locked)', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        copyTokens: ['field-1'],
        runCopyIds: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('a run skip bucket never overrides an admin-copy field (locked)', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        copyTokens: ['field-1'],
        runSkipIds: ['field-1'],
      }),
    ).toBe('copy');
  });

  it('auto-splits an excluded field with size.min:1 and no required to copy (multi-link/gallery path)', () => {
    expect(
      resolveFieldFate({
        ...baseArgs,
        validators: { size: { min: 1 } },
        excludedTokens: ['field-1'],
      }),
    ).toBe('copy');
  });
});

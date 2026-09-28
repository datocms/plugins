import { describe, expect, it } from 'vitest';
import {
  carryOver,
  hasManualSelection,
  type InclusionMatch,
  type InclusionState,
  initialInclusion,
  isIncluded,
  setAllIncluded,
  setMatchIncluded,
  setRecordIncluded,
  tristate,
} from './inclusion';

function match(
  key: string,
  recordKey: string,
  options: { slug?: boolean; fingerprint?: string; field?: string } = {},
): InclusionMatch {
  return {
    key,
    carryKey: `${key}|${options.fingerprint ?? 'v1'}`,
    fieldKey: options.field ?? `${recordKey}.${key}`,
    recordKey,
    isSlug: options.slug ?? false,
  };
}

const title = match('title', 'r1');
const body = match('body', 'r1');
const slug = match('slug', 'r1', { slug: true });
const r1 = [title, body, slug];
const other = match('other', 'r2');

function included(state: InclusionState, matches: InclusionMatch[]): boolean[] {
  return matches.map((entry) => isIncluded(state, entry));
}

describe('inclusion', () => {
  it('includes everything but slug matches by default', () => {
    const state = initialInclusion();
    expect(included(state, [...r1, other])).toEqual([true, true, false, true]);
    expect(hasManualSelection(state)).toBe(false);
  });

  it('excludes a whole record, and includes every match of it (slugs too) on the way back', () => {
    const excluded = setRecordIncluded(initialInclusion(), 'r1', false, r1);
    expect(included(excluded, [...r1, other])).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(hasManualSelection(excluded)).toBe(true);

    const back = setRecordIncluded(excluded, 'r1', true, r1);
    expect(included(back, r1)).toEqual([true, true, true]);
  });

  it('flips one match, and in an excluded record includes only that match', () => {
    const one = setMatchIncluded(initialInclusion(), body, false, r1);
    expect(included(one, r1)).toEqual([true, false, false]);

    const excluded = setRecordIncluded(initialInclusion(), 'r1', false, r1);
    const picked = setMatchIncluded(excluded, body, true, r1);
    expect(included(picked, r1)).toEqual([false, true, false]);
    expect(setMatchIncluded(excluded, body, false, r1)).toBe(excluded);
  });

  it('"Select all" on includes slugs; off makes later matches start excluded', () => {
    const custom = setRecordIncluded(
      setMatchIncluded(initialInclusion(), title, false, r1),
      'r2',
      false,
      [other],
    );
    const all = setAllIncluded(custom, true, {
      inScope: [...r1, other],
      outOfScope: [],
    });
    expect(included(all, [...r1, other])).toEqual([true, true, true, true]);

    const none = setAllIncluded(all, false, {
      inScope: [...r1, other],
      outOfScope: [],
    });
    expect(included(none, [...r1, other])).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(isIncluded(none, match('later', 'r3'))).toBe(false);
    expect(hasManualSelection(none)).toBe(true);
  });

  it('"Select all" leaves matches outside its scope as they were', () => {
    const state = setMatchIncluded(initialInclusion(), other, false, [other]);
    const hidden = match('hidden', 'r3');
    const none = setAllIncluded(state, false, {
      inScope: r1,
      outOfScope: [other, hidden],
    });
    expect(included(none, r1)).toEqual([false, false, false]);
    expect(isIncluded(none, other)).toBe(false);
    // Its default was baseline (true): it keeps it.
    expect(isIncluded(none, hidden)).toBe(true);
  });

  it('carries overrides only for unchanged field values, and record exclusions by key', () => {
    let state = setMatchIncluded(initialInclusion(), body, false, r1);
    state = setRecordIncluded(state, 'r2', false, [other]);
    const carried = carryOver(state, [...r1, other]);

    expect(isIncluded(carried, body)).toBe(false);
    expect(
      isIncluded(carried, match('body', 'r1', { fingerprint: 'v2' })),
    ).toBe(true);
    expect(isIncluded(carried, other)).toBe(false);
    expect(hasManualSelection(carried)).toBe(true);
  });

  it('starts matches excluded in a field a run wrote while one of its matches was left out', () => {
    const state = setMatchIncluded(initialInclusion(), body, false, r1);
    const carried = carryOver(state, r1, ['r1.body']);
    // After the write the value changed: the old key and fingerprint are gone.
    const leftOut = match('body-2', 'r1', {
      fingerprint: 'v2',
      field: 'r1.body',
    });
    const elsewhere = match('title-2', 'r1', {
      fingerprint: 'v2',
      field: 'r1.title',
    });

    expect(isIncluded(carried, leftOut)).toBe(false);
    expect(isIncluded(carried, elsewhere)).toBe(true);
    expect(hasManualSelection(carried)).toBe(true);
    // It carries on to the next search, and a click still wins.
    const again = carryOver(carried, [leftOut, elsewhere]);
    expect(isIncluded(again, leftOut)).toBe(false);
    expect(
      isIncluded(setMatchIncluded(again, leftOut, true, [leftOut]), leftOut),
    ).toBe(true);
    // "Select all" is a fresh choice.
    expect(
      isIncluded(
        setAllIncluded(again, true, { inScope: [leftOut], outOfScope: [] }),
        leftOut,
      ),
    ).toBe(true);
    expect(isIncluded(initialInclusion(), leftOut)).toBe(true);
  });

  it('computes tri-states', () => {
    expect(tristate([true, true])).toBe('all');
    expect(tristate([true, false])).toBe('some');
    expect(tristate([false])).toBe('none');
    expect(tristate([], 'all')).toBe('all');
  });
});

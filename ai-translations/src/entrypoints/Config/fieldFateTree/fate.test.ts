import { describe, expect, it } from 'vitest';
import { fateOf, setFate, summarize } from './fate';
import type { FateLists } from './types';

const lists = (excludedTokens: string[] = [], copyTokens: string[] = []): FateLists => ({
  excludedTokens,
  copyTokens,
});

describe('fateOf', () => {
  it('defaults to translate when in neither list', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: false }, lists())).toBe(
      'translate',
    );
  });
  it('resolves copy when the id is copy-listed', () => {
    expect(
      fateOf({ id: 'f1', apiKey: 'title', required: false }, lists([], ['f1'])),
    ).toBe('copy');
  });
  it('resolves skip when excluded and optional', () => {
    expect(
      fateOf({ id: 'f1', apiKey: 'title', required: false }, lists(['f1'])),
    ).toBe('skip');
  });
  it('a required field never resolves to skip even if excluded', () => {
    expect(
      fateOf({ id: 'f1', apiKey: 'title', required: true }, lists(['f1'])),
    ).toBe('translate');
  });
  it('a required field that is copy-listed still resolves to copy', () => {
    expect(
      fateOf({ id: 'f1', apiKey: 'title', required: true }, lists([], ['f1'])),
    ).toBe('copy');
  });
  it('copy wins over exclude if a field is somehow on both', () => {
    expect(
      fateOf(
        { id: 'f1', apiKey: 'title', required: false },
        lists(['f1'], ['f1']),
      ),
    ).toBe('copy');
  });
  it('matches by api_key fallback', () => {
    expect(
      fateOf({ id: 'f1', apiKey: 'title', required: false }, lists(['title'])),
    ).toBe('skip');
  });
});

describe('setFate', () => {
  it('adds to copy and removes from exclude (never both)', () => {
    const next = setFate('f1', 'title', 'copy', lists(['f1']));
    expect(next.copyTokens).toContain('f1');
    expect(next.excludedTokens).not.toContain('f1');
  });
  it('translate removes from both', () => {
    const next = setFate('f1', 'title', 'translate', lists(['f1'], ['f1']));
    expect(next.excludedTokens).not.toContain('f1');
    expect(next.copyTokens).not.toContain('f1');
  });
  it('skip removes any api_key token too (dedupes id + apiKey)', () => {
    const next = setFate('f1', 'title', 'skip', lists([], ['title']));
    expect(next.copyTokens).not.toContain('title');
    expect(next.excludedTokens).toContain('f1');
  });
  it('does not mutate the input arrays', () => {
    const input = lists(['f1']);
    setFate('f1', 'title', 'copy', input);
    expect(input.excludedTokens).toEqual(['f1']);
  });
});

describe('summarize', () => {
  it('counts each fate', () => {
    expect(summarize(['translate', 'translate', 'copy', 'skip'])).toEqual({
      translate: 2,
      copy: 1,
      skip: 1,
    });
  });
});

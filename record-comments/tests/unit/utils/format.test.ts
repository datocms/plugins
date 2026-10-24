import { describe, expect, it } from 'vitest';
import { formatCount } from '@/utils/format';

describe('formatCount', () => {
  it('names the thing counted, singular and plural', () => {
    expect(formatCount(0, 'comment', 'comments')).toBe('0 comments');
    expect(formatCount(1, 'comment', 'comments')).toBe('1 comment');
    expect(formatCount(12, 'comment', 'comments')).toBe('12 comments');
  });

  it('formats the number with the separators of the locale', () => {
    expect(formatCount(1204, 'comment', 'comments')).toBe('1,204 comments');
    expect(formatCount(1204, 'comment', 'comments', 'de')).toBe(
      '1.204 comments',
    );
  });

  it('picks the English plural, as the nouns are English', () => {
    expect(formatCount(0, 'model', 'models', 'fr')).toBe('0 models');
    expect(formatCount(21, 'comment', 'comments', 'ru')).toBe('21 comments');
  });
});

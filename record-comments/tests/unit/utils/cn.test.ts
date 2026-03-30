import { describe, it, expect } from 'vitest';
import { cn } from '@/utils/cn';

describe('cn', () => {
  describe('basic functionality', () => {
    it('joins multiple class names', () => {
      const result = cn('class1', 'class2', 'class3');

      expect(result).toBe('class1 class2 class3');
    });

    it('joins two classes', () => {
      const result = cn('foo', 'bar');

      expect(result).toBe('foo bar');
    });

    it('returns single class unchanged', () => {
      const result = cn('single');

      expect(result).toBe('single');
    });
  });

  describe('falsy value filtering', () => {
    it('filters out false values', () => {
      const result = cn('class1', false, 'class2');

      expect(result).toBe('class1 class2');
    });

    it('filters out null values', () => {
      const result = cn('class1', null, 'class2');

      expect(result).toBe('class1 class2');
    });

    it('filters out undefined values', () => {
      const result = cn('class1', undefined, 'class2');

      expect(result).toBe('class1 class2');
    });

    it('filters out multiple falsy values', () => {
      const result = cn('a', false, null, 'b', undefined, 'c');

      expect(result).toBe('a b c');
    });

    it('returns empty string when all values are falsy', () => {
      const result = cn(false, null, undefined);

      expect(result).toBe('');
    });
  });

  describe('conditional classes', () => {
    it('includes class based on true condition', () => {
      const isActive = true;
      const result = cn('base', isActive && 'active');

      expect(result).toBe('base active');
    });

    it('excludes class based on false condition', () => {
      const isActive = false;
      const result = cn('base', isActive && 'active');

      expect(result).toBe('base');
    });

    it('handles multiple conditional classes', () => {
      const isActive = true;
      const isDisabled = false;
      const isLarge = true;

      const result = cn(
        'button',
        isActive && 'button--active',
        isDisabled && 'button--disabled',
        isLarge && 'button--large'
      );

      expect(result).toBe('button button--active button--large');
    });
  });

  describe('edge cases', () => {
    it('returns empty string with no arguments', () => {
      const result = cn();

      expect(result).toBe('');
    });

    it('handles empty strings', () => {
      const result = cn('class1', '', 'class2');

      // Empty string is falsy, so filtered out
      expect(result).toBe('class1 class2');
    });

    it('handles classes with spaces (preserves them)', () => {
      const result = cn('class1 class2', 'class3');

      expect(result).toBe('class1 class2 class3');
    });

    it('handles numeric zero as falsy', () => {
      // 0 is not a valid class type, but testing edge behavior
      const classes: Array<string | false | null | undefined> = ['class1', false, 'class2'];
      const result = cn(...classes);

      expect(result).toBe('class1 class2');
    });
  });

  describe('real-world usage patterns', () => {
    it('handles common button pattern', () => {
      const variant = 'primary';
      const size = 'large';
      const disabled = false;

      const result = cn(
        'btn',
        `btn--${variant}`,
        `btn--${size}`,
        disabled && 'btn--disabled'
      );

      expect(result).toBe('btn btn--primary btn--large');
    });

    it('handles common card pattern', () => {
      const isSelected = true;
      const isHighlighted = false;

      const result = cn(
        'card',
        isSelected && 'card--selected',
        isHighlighted && 'card--highlighted'
      );

      expect(result).toBe('card card--selected');
    });
  });
});

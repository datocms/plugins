import { describe, expect, it, vi } from 'vitest';
import { handleListKeyNav } from '@hooks/useFieldNavigation';

describe('handleListKeyNav', () => {
  it('returns false for unhandled keys', () => {
    const setIndex = vi.fn();
    const onSelect = vi.fn();
    const onBack = vi.fn();

    const handled = handleListKeyNav('a', setIndex, 3, onSelect, onBack);

    expect(handled).toBe(false);
    expect(setIndex).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFrameSizedToContent } from './useFrameSizedToContent';

function SelfSizingFrame() {
  useFrameSizedToContent();
  return <p>Content</p>;
}

describe('useFrameSizedToContent', () => {
  it('gives html and body the content height while mounted, then restores them', () => {
    document.body.style.height = '100%';
    const { unmount } = render(<SelfSizingFrame />);
    expect(document.documentElement.style.height).toBe('auto');
    expect(document.body.style.height).toBe('auto');
    unmount();
    expect(document.documentElement.style.height).toBe('');
    expect(document.body.style.height).toBe('100%');
    document.body.style.height = '';
  });
});

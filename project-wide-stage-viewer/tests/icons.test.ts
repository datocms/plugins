import { describe, expect, it } from 'vitest';
import { ICON_OPTIONS, iconByName } from '../src/lib/icons';

describe('iconByName', () => {
  it('gives the Lucide glyph of each Font Awesome name the settings store', () => {
    expect(iconByName('list-check')?.id).toBe('list-checks');
    expect(iconByName('paper-plane')?.id).toBe('send');
    for (const option of ICON_OPTIONS) {
      expect(iconByName(option.value)?.icon).toBe(option.icon);
    }
  });

  it('keeps a glyph for the names the first settings screen offered', () => {
    expect(iconByName('diagram-project')?.id).toBe('workflow');
    expect(iconByName('screwdriver-wrench')?.id).toBe('wrench');
  });

  it('knows no other name', () => {
    expect(iconByName('not-an-icon')).toBeUndefined();
  });
});

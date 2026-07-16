import { describe, expect, it } from 'vitest';
import { partitionLocalesByPermission } from './permittedLocales';

const label = (l: string) =>
  ({ en: 'English', it: 'Italian', 'zh-CN': 'Chinese', de: 'German', fr: 'French', es: 'Spanish' })[
    l
  ] ?? l;

describe('partitionLocalesByPermission', () => {
  it('splits allowed vs excluded, preserving order, case-insensitively', () => {
    const { allowed, excluded } = partitionLocalesByPermission({
      candidateLocales: ['en', 'IT', 'de'],
      writableLocales: ['en', 'it'],
    });
    expect(allowed).toEqual(['en', 'IT']);
    expect(excluded).toEqual(['de']);
  });

  it('returns null hint when nothing is excluded', () => {
    const { hint } = partitionLocalesByPermission({
      candidateLocales: ['en', 'it'],
      writableLocales: ['en', 'it', 'de'],
    });
    expect(hint).toBeNull();
  });

  it('names a single excluded language', () => {
    const { hint } = partitionLocalesByPermission({
      candidateLocales: ['en', 'de'],
      writableLocales: ['en'],
      labelFor: label,
    });
    expect(hint).toBe("Excluding German you don't have permission to edit.");
  });

  it('summarizes many excluded languages as first-two + count', () => {
    const { hint } = partitionLocalesByPermission({
      candidateLocales: ['en', 'zh-CN', 'it', 'de', 'fr', 'es'],
      writableLocales: ['en'],
      labelFor: label,
    });
    expect(hint).toBe(
      "Excluding Chinese, Italian, and 3 other languages you don't have permission to edit.",
    );
  });

  it('lists two or three excluded languages inline', () => {
    const { hint } = partitionLocalesByPermission({
      candidateLocales: ['it', 'de'],
      writableLocales: [],
      labelFor: label,
    });
    expect(hint).toBe("Excluding Italian and German you don't have permission to edit.");
  });
});

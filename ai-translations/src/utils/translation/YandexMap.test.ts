import { describe, expect, it } from 'vitest';
import { normalizeYandexLocale, resolveYandexLocale } from './YandexMap';

const SUPPORTED_CODES = [
  'de',
  'en',
  'he',
  'id',
  'kazlat',
  'no',
  'pt',
  'pt-BR',
  'sr',
  'sr-Latn',
  'tl',
  'uzbcyr',
  'yi',
  'zh',
];

describe('normalizeYandexLocale', () => {
  it('normalizes whitespace, case, and underscore separators', () => {
    expect(normalizeYandexLocale('  PT_br ')).toBe('pt-br');
  });
});

describe('resolveYandexLocale', () => {
  it('preserves the canonical code returned by Yandex for exact matches', () => {
    expect(resolveYandexLocale('pt_br', SUPPORTED_CODES)).toBe('pt-BR');
    expect(resolveYandexLocale('SR-latn', SUPPORTED_CODES)).toBe('sr-Latn');
  });

  it('resolves legacy locale aliases', () => {
    expect(resolveYandexLocale('iw-IL', SUPPORTED_CODES)).toBe('he');
    expect(resolveYandexLocale('in_ID', SUPPORTED_CODES)).toBe('id');
    expect(resolveYandexLocale('fil-PH', SUPPORTED_CODES)).toBe('tl');
    expect(resolveYandexLocale('nb-NO', SUPPORTED_CODES)).toBe('no');
  });

  it('resolves common Chinese locale variants to Yandex Chinese', () => {
    expect(resolveYandexLocale('zh-Hans-CN', SUPPORTED_CODES)).toBe('zh');
    expect(resolveYandexLocale('zh_TW', SUPPORTED_CODES)).toBe('zh');
  });

  it('resolves the composite Serbian Latin locale alias', () => {
    expect(resolveYandexLocale('sr-Latn-RS', SUPPORTED_CODES)).toBe('sr-Latn');
  });

  it('resolves Yandex-specific Kazakh and Uzbek script codes', () => {
    expect(resolveYandexLocale('kk-Latn-KZ', SUPPORTED_CODES)).toBe('kazlat');
    expect(resolveYandexLocale('uz_Cyrl_UZ', SUPPORTED_CODES)).toBe('uzbcyr');
  });

  it('falls back to a supported base language', () => {
    expect(resolveYandexLocale('de-CH', SUPPORTED_CODES)).toBe('de');
    expect(resolveYandexLocale('pt-PT', SUPPORTED_CODES)).toBe('pt');
  });

  it('prefers an exact regional code over its base language', () => {
    expect(resolveYandexLocale('pt-BR', SUPPORTED_CODES)).toBe('pt-BR');
  });

  it('returns undefined for empty and unsupported locales', () => {
    expect(resolveYandexLocale('', SUPPORTED_CODES)).toBeUndefined();
    expect(resolveYandexLocale('xx-YY', SUPPORTED_CODES)).toBeUndefined();
  });
});

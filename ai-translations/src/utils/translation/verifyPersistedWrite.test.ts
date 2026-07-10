import { describe, expect, it } from 'vitest';
import { verifyPersistedWrite } from './verifyPersistedWrite';

describe('verifyPersistedWrite', () => {
  it('passes when every claim persisted', () => {
    const response = { headline: { fr: 'Bonjour' }, body: { fr: '<p>Salut</p>' } };
    expect(
      verifyPersistedWrite(response, [
        { field: 'headline', locale: 'fr' },
        { field: 'body', locale: 'fr' },
      ]),
    ).toEqual([]);
  });

  it('catches the reported bug: a claimed field came back null', () => {
    const response = { headline: { fr: 'Bonjour' }, body_text: { fr: null } };
    expect(
      verifyPersistedWrite(response, [{ field: 'body_text', locale: 'fr' }]),
    ).toEqual([{ field: 'body_text', locale: 'fr', reason: 'null' }]);
  });

  it('catches an absent locale key', () => {
    expect(
      verifyPersistedWrite({ headline: { it: 'Ciao' } }, [
        { field: 'headline', locale: 'fr' },
      ]),
    ).toEqual([{ field: 'headline', locale: 'fr', reason: 'absent' }]);
  });

  it('catches an absent field', () => {
    expect(verifyPersistedWrite({}, [{ field: 'headline', locale: 'fr' }])).toEqual([
      { field: 'headline', locale: 'fr', reason: 'absent' },
    ]);
  });

  it('catches whitespace-only strings', () => {
    expect(
      verifyPersistedWrite({ cta: { fr: '   ' } }, [{ field: 'cta', locale: 'fr' }]),
    ).toEqual([{ field: 'cta', locale: 'fr', reason: 'empty' }]);
  });

  it('catches empty arrays and empty objects', () => {
    expect(
      verifyPersistedWrite({ blocks: { fr: [] }, seo: { fr: {} } }, [
        { field: 'blocks', locale: 'fr' },
        { field: 'seo', locale: 'fr' },
      ]),
    ).toEqual([
      { field: 'blocks', locale: 'fr', reason: 'empty' },
      { field: 'seo', locale: 'fr', reason: 'empty' },
    ]);
  });

  it('accepts an array of bare block IDs as a successful write', () => {
    expect(
      verifyPersistedWrite({ blocks: { fr: ['123456', '123457'] } }, [
        { field: 'blocks', locale: 'fr' },
      ]),
    ).toEqual([]);
  });

  it('accepts a falsy-but-valid value like 0 or false', () => {
    expect(
      verifyPersistedWrite({ count: { fr: 0 }, flag: { fr: false } }, [
        { field: 'count', locale: 'fr' },
        { field: 'flag', locale: 'fr' },
      ]),
    ).toEqual([]);
  });
});

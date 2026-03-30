/**
 * Tests for DeepLMap.ts
 * Tests locale code mapping for DeepL and formality support checking.
 */

import { describe, it, expect } from 'vitest';
import { mapDatoToDeepL, isFormalitySupported } from './DeepLMap';

describe('DeepLMap.ts', () => {
  describe('mapDatoToDeepL', () => {
    describe('Portuguese variants', () => {
      it('should map pt-BR to PT-BR', () => {
        expect(mapDatoToDeepL('pt-BR', 'target')).toBe('PT-BR');
        expect(mapDatoToDeepL('pt-br', 'target')).toBe('PT-BR');
      });

      it('should map pt-PT to PT-PT', () => {
        expect(mapDatoToDeepL('pt-PT', 'target')).toBe('PT-PT');
        expect(mapDatoToDeepL('pt-pt', 'target')).toBe('PT-PT');
      });

      it('should map pt (without region) to PT-PT', () => {
        expect(mapDatoToDeepL('pt', 'target')).toBe('PT-PT');
      });
    });

    describe('English variants', () => {
      it('should map en-US to EN-US', () => {
        expect(mapDatoToDeepL('en-US', 'target')).toBe('EN-US');
        expect(mapDatoToDeepL('en-us', 'target')).toBe('EN-US');
      });

      it('should map en-GB to EN-GB', () => {
        expect(mapDatoToDeepL('en-GB', 'target')).toBe('EN-GB');
        expect(mapDatoToDeepL('en-gb', 'target')).toBe('EN-GB');
      });

      it('should map en to EN', () => {
        expect(mapDatoToDeepL('en', 'target')).toBe('EN');
      });

      it('should map other English variants to EN', () => {
        expect(mapDatoToDeepL('en-AU', 'target')).toBe('EN');
        expect(mapDatoToDeepL('en-CA', 'target')).toBe('EN');
      });
    });

    describe('Chinese', () => {
      it('should map zh to ZH', () => {
        expect(mapDatoToDeepL('zh', 'target')).toBe('ZH');
      });

      it('should map Chinese script variants to ZH', () => {
        expect(mapDatoToDeepL('zh-Hans', 'target')).toBe('ZH');
        expect(mapDatoToDeepL('zh-Hant', 'target')).toBe('ZH');
        expect(mapDatoToDeepL('zh-CN', 'target')).toBe('ZH');
        expect(mapDatoToDeepL('zh-TW', 'target')).toBe('ZH');
      });
    });

    describe('European languages', () => {
      it('should map Spanish variants to ES', () => {
        expect(mapDatoToDeepL('es', 'target')).toBe('ES');
        expect(mapDatoToDeepL('es-ES', 'target')).toBe('ES');
        expect(mapDatoToDeepL('es-MX', 'target')).toBe('ES');
      });

      it('should map French to FR', () => {
        expect(mapDatoToDeepL('fr', 'target')).toBe('FR');
        expect(mapDatoToDeepL('fr-FR', 'target')).toBe('FR');
        expect(mapDatoToDeepL('fr-CA', 'target')).toBe('FR');
      });

      it('should map German to DE', () => {
        expect(mapDatoToDeepL('de', 'target')).toBe('DE');
        expect(mapDatoToDeepL('de-DE', 'target')).toBe('DE');
        expect(mapDatoToDeepL('de-AT', 'target')).toBe('DE');
      });

      it('should map Italian to IT', () => {
        expect(mapDatoToDeepL('it', 'target')).toBe('IT');
        expect(mapDatoToDeepL('it-IT', 'target')).toBe('IT');
      });

      it('should map Dutch to NL', () => {
        expect(mapDatoToDeepL('nl', 'target')).toBe('NL');
        expect(mapDatoToDeepL('nl-NL', 'target')).toBe('NL');
        expect(mapDatoToDeepL('nl-BE', 'target')).toBe('NL');
      });

      it('should map Polish to PL', () => {
        expect(mapDatoToDeepL('pl', 'target')).toBe('PL');
        expect(mapDatoToDeepL('pl-PL', 'target')).toBe('PL');
      });
    });

    describe('Asian languages', () => {
      it('should map Japanese to JA', () => {
        expect(mapDatoToDeepL('ja', 'target')).toBe('JA');
        expect(mapDatoToDeepL('ja-JP', 'target')).toBe('JA');
      });

      it('should map Russian to RU', () => {
        expect(mapDatoToDeepL('ru', 'target')).toBe('RU');
        expect(mapDatoToDeepL('ru-RU', 'target')).toBe('RU');
      });
    });

    describe('fallback behavior', () => {
      it('should return EN for empty string', () => {
        expect(mapDatoToDeepL('', 'target')).toBe('EN');
      });

      it('should uppercase first two letters for unknown locales', () => {
        expect(mapDatoToDeepL('ko', 'target')).toBe('KO');
        expect(mapDatoToDeepL('sv', 'target')).toBe('SV');
        expect(mapDatoToDeepL('da', 'target')).toBe('DA');
      });

      it('should return EN for very short unknown locales', () => {
        expect(mapDatoToDeepL('x', 'target')).toBe('EN');
      });

      it('should handle locales with only region after hyphen', () => {
        expect(mapDatoToDeepL('ko-KR', 'target')).toBe('KO');
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase input', () => {
        expect(mapDatoToDeepL('EN', 'target')).toBe('EN');
        expect(mapDatoToDeepL('FR', 'target')).toBe('FR');
      });

      it('should handle mixed case input', () => {
        expect(mapDatoToDeepL('En-Us', 'target')).toBe('EN-US');
        expect(mapDatoToDeepL('Pt-Br', 'target')).toBe('PT-BR');
      });
    });

    describe('mode parameter', () => {
      it('should work the same for source and target modes', () => {
        expect(mapDatoToDeepL('en', 'source')).toBe('EN');
        expect(mapDatoToDeepL('en', 'target')).toBe('EN');
        expect(mapDatoToDeepL('pt-BR', 'source')).toBe('PT-BR');
        expect(mapDatoToDeepL('pt-BR', 'target')).toBe('PT-BR');
      });
    });
  });

  describe('isFormalitySupported', () => {
    describe('supported languages', () => {
      it('should return true for German', () => {
        expect(isFormalitySupported('DE')).toBe(true);
        expect(isFormalitySupported('de')).toBe(true);
      });

      it('should return true for French', () => {
        expect(isFormalitySupported('FR')).toBe(true);
        expect(isFormalitySupported('fr')).toBe(true);
      });

      it('should return true for Italian', () => {
        expect(isFormalitySupported('IT')).toBe(true);
        expect(isFormalitySupported('it')).toBe(true);
      });

      it('should return true for Spanish', () => {
        expect(isFormalitySupported('ES')).toBe(true);
        expect(isFormalitySupported('es')).toBe(true);
      });

      it('should return true for Dutch', () => {
        expect(isFormalitySupported('NL')).toBe(true);
        expect(isFormalitySupported('nl')).toBe(true);
      });

      it('should return true for Polish', () => {
        expect(isFormalitySupported('PL')).toBe(true);
        expect(isFormalitySupported('pl')).toBe(true);
      });

      it('should return true for Portuguese variants', () => {
        expect(isFormalitySupported('PT-PT')).toBe(true);
        expect(isFormalitySupported('PT-BR')).toBe(true);
        expect(isFormalitySupported('pt-pt')).toBe(true);
        expect(isFormalitySupported('pt-br')).toBe(true);
      });
    });

    describe('unsupported languages', () => {
      it('should return false for English', () => {
        expect(isFormalitySupported('EN')).toBe(false);
        expect(isFormalitySupported('EN-US')).toBe(false);
        expect(isFormalitySupported('EN-GB')).toBe(false);
      });

      it('should return false for Chinese', () => {
        expect(isFormalitySupported('ZH')).toBe(false);
      });

      it('should return false for Japanese', () => {
        expect(isFormalitySupported('JA')).toBe(false);
      });

      it('should return false for Russian', () => {
        expect(isFormalitySupported('RU')).toBe(false);
      });

      it('should return false for unknown languages', () => {
        expect(isFormalitySupported('XX')).toBe(false);
        expect(isFormalitySupported('')).toBe(false);
      });
    });
  });
});

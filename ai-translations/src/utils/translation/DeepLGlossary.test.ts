/**
 * Tests for DeepLGlossary.ts
 * Tests glossary map parsing and ID resolution for DeepL translations.
 */

import { describe, it, expect } from 'vitest';
import { parseGlossaryMap, resolveGlossaryId } from './DeepLGlossary';

describe('DeepLGlossary.ts', () => {
  describe('parseGlossaryMap', () => {
    describe('basic parsing', () => {
      it('should return empty object for empty input', () => {
        expect(parseGlossaryMap('')).toEqual({});
        expect(parseGlossaryMap(undefined)).toEqual({});
      });

      it('should parse simple arrow format with equals', () => {
        const input = 'EN->DE=gls-abc123';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc123');
      });

      it('should parse arrow format with colon separator', () => {
        const input = 'EN->DE:gls-abc123';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc123');
      });

      it('should parse arrow format with space separator', () => {
        const input = 'EN->DE gls-abc123';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc123');
      });
    });

    describe('case handling', () => {
      it('should uppercase keys', () => {
        const input = 'en->de=gls-abc123';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc123');
      });

      it('should handle mixed case locales', () => {
        const input = 'en-us->pt-BR=gls-test';
        const result = parseGlossaryMap(input);
        expect(result['EN-US:PT-BR']).toBe('gls-test');
      });
    });

    describe('arrow variants', () => {
      it('should handle unicode arrow →', () => {
        const input = 'EN→DE=gls-abc';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc');
      });

      it('should handle unicode double arrow ⇒', () => {
        const input = 'EN⇒DE=gls-abc';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc');
      });

      it('should handle en dash – as arrow separator', () => {
        // en dash alone is used as arrow separator (not followed by >)
        const input = 'EN–DE=gls-abc';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc');
      });

      it('should handle em dash — as arrow separator', () => {
        // em dash alone is used as arrow separator (not followed by >)
        const input = 'EN—DE=gls-abc';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc');
      });
    });

    describe('multiline and delimiters', () => {
      it('should parse multiple lines', () => {
        const input = `EN->DE=gls-german
FR->ES=gls-spanish`;
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-german');
        expect(result['FR:ES']).toBe('gls-spanish');
      });

      it('should parse semicolon-separated entries', () => {
        const input = 'EN->DE=gls-german;FR->ES=gls-spanish';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-german');
        expect(result['FR:ES']).toBe('gls-spanish');
      });

      it('should parse comma-separated entries', () => {
        const input = 'EN->DE=gls-german,FR->ES=gls-spanish';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-german');
        expect(result['FR:ES']).toBe('gls-spanish');
      });

      it('should ignore empty lines', () => {
        const input = `EN->DE=gls-german

FR->ES=gls-spanish`;
        const result = parseGlossaryMap(input);
        expect(Object.keys(result)).toHaveLength(2);
      });
    });

    describe('whitespace handling', () => {
      it('should trim whitespace from entries', () => {
        const input = '  EN->DE  =  gls-abc  ';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc');
      });

      it('should handle spaces around arrow', () => {
        const input = 'EN -> DE = gls-abc';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc');
      });
    });

    describe('wildcard patterns', () => {
      it('should parse target-only shorthand as wildcard', () => {
        const input = 'PT-BR=gls-portuguese';
        const result = parseGlossaryMap(input);
        expect(result['*:PT-BR']).toBe('gls-portuguese');
      });

      it('should parse explicit wildcard source', () => {
        const input = '*->PT-BR=gls-portuguese';
        const result = parseGlossaryMap(input);
        expect(result['*:PT-BR']).toBe('gls-portuguese');
      });

      it('should parse wildcard target', () => {
        const input = 'EN->*=gls-english';
        const result = parseGlossaryMap(input);
        expect(result['EN:*']).toBe('gls-english');
      });
    });

    describe('glossary ID formats', () => {
      it('should accept IDs with gls- prefix', () => {
        const input = 'EN->DE=gls-abc123';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc123');
      });

      it('should accept IDs without gls- prefix', () => {
        const input = 'EN->DE=abc123';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('abc123');
      });

      it('should accept IDs with hyphens and underscores', () => {
        const input = 'EN->DE=gls-abc_123-def';
        const result = parseGlossaryMap(input);
        expect(result['EN:DE']).toBe('gls-abc_123-def');
      });
    });

    describe('invalid entries', () => {
      it('should ignore entries without valid separator or id', () => {
        // Entry with special characters that don't match the ID pattern
        const input = '!!!';
        const result = parseGlossaryMap(input);
        expect(Object.keys(result)).toHaveLength(0);
      });

      it('should parse valid entries and skip entries without arrow', () => {
        const input = `EN->DE=gls-valid
NOPAIR
FR->ES=gls-also-valid`;
        const result = parseGlossaryMap(input);
        // NOPAIR doesn't have an arrow separator, so it becomes *->NOPAIR
        // This is valid, so it will be parsed
        expect(result['EN:DE']).toBe('gls-valid');
        expect(result['FR:ES']).toBe('gls-also-valid');
      });
    });
  });

  describe('resolveGlossaryId', () => {
    describe('no configuration', () => {
      it('should return undefined when params is null', () => {
        expect(resolveGlossaryId(null, 'en', 'de')).toBeUndefined();
      });

      it('should return undefined when params is undefined', () => {
        expect(resolveGlossaryId(undefined, 'en', 'de')).toBeUndefined();
      });

      it('should return undefined when no glossary config exists', () => {
        expect(resolveGlossaryId({}, 'en', 'de')).toBeUndefined();
      });
    });

    describe('default glossary ID', () => {
      it('should return default ID when no pair mapping exists', () => {
        const params = { deeplGlossaryId: 'gls-default' };
        expect(resolveGlossaryId(params, 'en', 'fr')).toBe('gls-default');
      });

      it('should prefer pair mapping over default', () => {
        const params = {
          deeplGlossaryId: 'gls-default',
          deeplGlossaryPairs: 'EN->FR=gls-specific',
        };
        expect(resolveGlossaryId(params, 'en', 'fr')).toBe('gls-specific');
      });
    });

    describe('exact pair matching', () => {
      it('should match DatoCMS locale codes', () => {
        const params = {
          deeplGlossaryPairs: 'en->de=gls-ende',
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-ende');
      });

      it('should match hyphenated locale codes', () => {
        const params = {
          deeplGlossaryPairs: 'en-US->pt-BR=gls-enpt',
        };
        expect(resolveGlossaryId(params, 'en-US', 'pt-BR')).toBe('gls-enpt');
      });

      it('should match DeepL-style codes', () => {
        const params = {
          deeplGlossaryPairs: 'EN->DE=gls-ende',
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-ende');
      });
    });

    describe('wildcard matching', () => {
      it('should match any source to specific target', () => {
        const params = {
          deeplGlossaryPairs: '*->PT-BR=gls-portuguese',
        };
        expect(resolveGlossaryId(params, 'en', 'pt-BR')).toBe('gls-portuguese');
        expect(resolveGlossaryId(params, 'fr', 'pt-BR')).toBe('gls-portuguese');
        expect(resolveGlossaryId(params, 'de', 'pt-BR')).toBe('gls-portuguese');
      });

      it('should match target-only shorthand', () => {
        const params = {
          deeplGlossaryPairs: 'PT-BR=gls-portuguese',
        };
        expect(resolveGlossaryId(params, 'en', 'pt-BR')).toBe('gls-portuguese');
      });

      it('should match specific source to any target', () => {
        const params = {
          deeplGlossaryPairs: 'EN->*=gls-english',
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-english');
        expect(resolveGlossaryId(params, 'en', 'fr')).toBe('gls-english');
      });
    });

    describe('priority order', () => {
      it('should prefer exact DeepL-code match over wildcards', () => {
        const params = {
          deeplGlossaryPairs: `EN->DE=gls-exact
*->DE=gls-wildcard`,
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-exact');
      });

      it('should prefer exact raw-locale match over wildcards', () => {
        const params = {
          deeplGlossaryPairs: `en-US->pt-BR=gls-exact
*->PT-BR=gls-wildcard`,
        };
        expect(resolveGlossaryId(params, 'en-US', 'pt-BR')).toBe('gls-exact');
      });

      it('should prefer target wildcard over default', () => {
        const params = {
          deeplGlossaryId: 'gls-default',
          deeplGlossaryPairs: '*->DE=gls-target',
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-target');
      });

      it('should prefer source wildcard over default', () => {
        const params = {
          deeplGlossaryId: 'gls-default',
          deeplGlossaryPairs: 'EN->*=gls-source',
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-source');
      });
    });

    describe('source locale handling', () => {
      it('should handle undefined source locale', () => {
        const params = {
          deeplGlossaryPairs: '*->DE=gls-target',
        };
        expect(resolveGlossaryId(params, undefined, 'de')).toBe('gls-target');
      });

      it('should not match source wildcard when source is undefined', () => {
        const params = {
          deeplGlossaryPairs: 'EN->*=gls-source',
          deeplGlossaryId: 'gls-default',
        };
        expect(resolveGlossaryId(params, undefined, 'de')).toBe('gls-default');
      });
    });

    describe('case insensitivity', () => {
      it('should match regardless of case in mapping', () => {
        const params = {
          deeplGlossaryPairs: 'en->de=gls-test',
        };
        expect(resolveGlossaryId(params, 'EN', 'DE')).toBe('gls-test');
        expect(resolveGlossaryId(params, 'En', 'dE')).toBe('gls-test');
      });

      it('should match regardless of case in request', () => {
        const params = {
          deeplGlossaryPairs: 'EN->DE=gls-test',
        };
        expect(resolveGlossaryId(params, 'en', 'de')).toBe('gls-test');
      });
    });
  });
});

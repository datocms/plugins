import { describe, expect, it } from 'vitest';
import {
  decodeMachineCell,
  encodeMachineCell,
  tryDecodeMachineCell,
  type MachineUnit,
} from './machineCell';

const unit = (over: Partial<MachineUnit> = {}): MachineUnit => ({
  recordId: '12345',
  locale: 'pt-BR',
  bucket: 'blocked',
  reasonCodes: ['required-blank', 'truncated'],
  flagCheckIds: [],
  ...over,
});

describe('machine cell', () => {
  it('round-trips a unit exactly', () => {
    const u = unit();
    const decoded = decodeMachineCell(encodeMachineCell(u));
    expect(decoded.recordId).toBe(u.recordId);
    expect(decoded.locale).toBe(u.locale);
    expect(decoded.bucket).toBe('blocked');
    expect(new Set(decoded.reasonCodes)).toEqual(new Set(u.reasonCodes));
  });

  it('round-trips a Written unit with heuristic flags', () => {
    const decoded = decodeMachineCell(
      encodeMachineCell(unit({ bucket: 'written', reasonCodes: [], flagCheckIds: ['length-ratio', 'markdown-structure'] })),
    );
    expect(decoded.bucket).toBe('written');
    expect(new Set(decoded.flagCheckIds)).toEqual(new Set(['length-ratio', 'markdown-structure']));
  });

  it('starts with a letter-prefixed, CSV-safe token', () => {
    const cell = encodeMachineCell(unit());
    expect(cell).toMatch(/^v1:[A-Za-z0-9_-]+$/); // formula-guard-safe + no CSV specials
  });

  it('round-trips all four buckets', () => {
    for (const bucket of ['written', 'blocked', 'not-attempted', 'written-unverified'] as const) {
      expect(decodeMachineCell(encodeMachineCell(unit({ bucket }))).bucket).toBe(bucket);
    }
  });

  it('preserves non-ASCII record ids and locales', () => {
    const decoded = decodeMachineCell(encodeMachineCell(unit({ recordId: 'réc-ord-Ω', locale: 'zh-CN' })));
    expect(decoded.recordId).toBe('réc-ord-Ω');
  });

  describe('validation (mangled cells are rejected, never misparsed)', () => {
    it('rejects an unknown version', () => {
      expect(() => decodeMachineCell('v2:AAAAAAAAAAAAAAAA')).toThrow(/unknown version/);
    });
    it('rejects a missing version prefix', () => {
      expect(() => decodeMachineCell('AAAA')).toThrow(/no version prefix/);
    });
    it('rejects an invalid base64url body', () => {
      expect(() => decodeMachineCell('v1:not*valid')).toThrow(/invalid character/);
    });
    it('rejects a too-short cell before reading fields', () => {
      expect(() => decodeMachineCell('v1:AAAA')).toThrow(/too short/);
    });
    it('rejects a single flipped character via the checksum', () => {
      const cell = encodeMachineCell(unit());
      const idx = cell.length - 2;
      const flipped = cell[idx] === 'A' ? 'B' : 'A';
      const corrupt = cell.slice(0, idx) + flipped + cell.slice(idx + 1);
      // Either the checksum catches it or (rarely) a structural read fails — both reject.
      expect(tryDecodeMachineCell(corrupt)).toBeNull();
    });
    it('rejects an empty recordId at encode time', () => {
      expect(() => encodeMachineCell(unit({ recordId: '' }))).toThrow(/empty recordId/);
    });
    it('tryDecode returns null instead of throwing', () => {
      expect(tryDecodeMachineCell('garbage-no-colon')).toBeNull();
      expect(tryDecodeMachineCell(encodeMachineCell(unit()))).not.toBeNull();
    });
  });
});

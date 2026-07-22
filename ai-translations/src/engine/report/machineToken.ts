/**
 * Bridges a canonical run unit to the machine cell token and back (persistence
 * spec §4/§6). The token is the cross-format integrity anchor: it is the JSON
 * per-unit `mrc` field ({@link ./jsonAdapter}) and the CSV `machine_readable_status`
 * column ({@link ./csvAdapter}, `serializeRunStateCsv`). The CSV projection is
 * deliberately lossy — `fieldPath` is dropped (the token carries only reason
 * CODES) — so a reconstructed unit's reasons have an empty fieldPath; the rich
 * IndexedDB/JSON tiers retain it.
 */
import { isHeuristicFlagId, type HeuristicFlagId } from './bitmaps';
import { decodeMachineCell, encodeMachineCell } from './machineCell';
import type { RunUnitState } from './runState';

/** Encodes a run unit (with its record id) as the machine cell token. */
export function machineTokenForUnit(recordId: string, unit: RunUnitState): string {
  const reasonCodes = [...new Set(unit.reasons.map((r) => r.code))];
  const flagCheckIds = unit.flagCheckIds.filter(isHeuristicFlagId) as HeuristicFlagId[];
  return encodeMachineCell({
    recordId,
    locale: unit.toLocale,
    bucket: unit.bucket,
    reasonCodes,
    flagCheckIds,
  });
}

/**
 * Reconstructs a run unit from a machine token. Lossy per §6: `fieldPath` is not
 * in the token, so reasons come back with an empty fieldPath, and `updatedAt` is
 * 0 (the run-level ordinal is supplied by the tier, not the cell).
 *
 * @throws If the token fails validation (unknown version, bad checksum, etc.).
 */
export function runUnitFromMachineToken(token: string): { recordId: string; unit: RunUnitState } {
  const decoded = decodeMachineCell(token);
  return {
    recordId: decoded.recordId,
    unit: {
      toLocale: decoded.locale,
      bucket: decoded.bucket,
      reasons: decoded.reasonCodes.map((code) => ({ fieldPath: '', code })),
      flagCheckIds: decoded.flagCheckIds,
      updatedAt: 0,
    },
  };
}

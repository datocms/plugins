/** Resilient report & persistence layer (persistence spec). Pure tiers only; the
 * IndexedDB/cloud storage adapters (spec §8 steps 5-6) are added later. */
export { writeVarint, readVarint } from './varint';
export { crc32 } from './crc32';
export { base64urlEncode, base64urlDecode } from './base64url';
export { describeReasonCode, describeBucket } from './messages';
export {
  reasonCodesToBits,
  bitsToReasonCodes,
  flagIdsToBits,
  bitsToFlagIds,
  isHeuristicFlagId,
  type HeuristicFlagId,
} from './bitmaps';
export {
  encodeMachineCell,
  decodeMachineCell,
  tryDecodeMachineCell,
  type MachineUnit,
} from './machineCell';
export {
  RUN_SCHEMA_VERSION,
  createRunState,
  bumpCheckpoint,
  foldOutcome,
  foldOutcomes,
  type RunState,
  type RunRecordState,
  type RunUnitState,
  type RunContext,
} from './runState';
export { machineTokenForUnit, runUnitFromMachineToken } from './machineToken';

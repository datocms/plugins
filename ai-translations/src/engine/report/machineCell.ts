/**
 * Encodes/decodes the self-sufficient, checksummed machine cell (persistence
 * spec §6): `v<wireVersion>:base64url(payload)` carrying one (record,locale)
 * unit's status, readable and validatable from that single cell alone. Decode is
 * defensive per the review: CRC-first gate, min-length precondition, and semantic
 * rejections (empty id/locale, bucket range, fatal UTF-8) so a mangled cell is
 * rejected, never silently misparsed into a bad resume.
 */
import type { Bucket, ReasonCode } from '../plan/types';
import { base64urlDecode, base64urlEncode } from './base64url';
import {
  bitsToFlagIds,
  bitsToReasonCodes,
  flagIdsToBits,
  reasonCodesToBits,
  type HeuristicFlagId,
} from './bitmaps';
import { crc32 } from './crc32';
import { readVarint, writeVarint } from './varint';

const WIRE_VERSION = 1;
const VER_PREFIX = `v${WIRE_VERSION}:`;
const CRC_LEN = 4;
/** recordIdLen(1)+id(1)+localeLen(1)+locale(1)+bucket(1)+reason(2)+flag(2)+crc(4). */
const MIN_DECODED = 13;

const BUCKET_INDEX: Record<Bucket, number> = {
  written: 0,
  blocked: 1,
  'not-attempted': 2,
  'written-unverified': 3,
};
const BUCKET_BY_INDEX = new Map<number, Bucket>(
  (Object.entries(BUCKET_INDEX) as [Bucket, number][]).map(([b, i]) => [i, b]),
);

/** One (record,locale) unit's status, the payload of a machine cell. */
export interface MachineUnit {
  recordId: string;
  locale: string;
  bucket: Bucket;
  reasonCodes: ReasonCode[];
  flagCheckIds: HeuristicFlagId[];
}

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder('utf-8', { fatal: true });

function pushUint16LE(value: number, out: number[]): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}
function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/** Encodes a unit into the `v<ver>:base64url(...)` machine cell. */
export function encodeMachineCell(unit: MachineUnit): string {
  const payload: number[] = [];
  const idBytes = utf8.encode(unit.recordId);
  const localeBytes = utf8.encode(unit.locale);
  if (idBytes.length === 0) throw new Error('encodeMachineCell: empty recordId');
  if (localeBytes.length === 0) throw new Error('encodeMachineCell: empty locale');

  writeVarint(idBytes.length, payload);
  payload.push(...idBytes);
  writeVarint(localeBytes.length, payload);
  payload.push(...localeBytes);
  payload.push(BUCKET_INDEX[unit.bucket]);
  pushUint16LE(reasonCodesToBits(unit.reasonCodes), payload);
  pushUint16LE(flagIdsToBits(unit.flagCheckIds), payload);

  // CRC covers the version byte (folded in though it lives in the text prefix)
  // plus the whole payload — a prefix swap or a body edit then fails validation.
  const crc = crc32(Uint8Array.from([WIRE_VERSION, ...payload]));
  const withCrc = [...payload, crc & 0xff, (crc >> 8) & 0xff, (crc >> 16) & 0xff, (crc >>> 24) & 0xff];
  return VER_PREFIX + base64urlEncode(Uint8Array.from(withCrc));
}

/**
 * Decodes and validates a machine cell.
 * @throws Error (with a specific reason) on any integrity or semantic failure —
 * callers catch and skip/log the row.
 */
export function decodeMachineCell(cell: string): MachineUnit {
  const colon = cell.indexOf(':');
  if (colon < 0) throw new Error('decodeMachineCell: no version prefix');
  const version = cell.slice(0, colon);
  if (version !== `v${WIRE_VERSION}`) throw new Error(`decodeMachineCell: unknown version "${version}"`);

  const bytes = base64urlDecode(cell.slice(colon + 1)); // throws on invalid chars
  if (bytes.length < MIN_DECODED) throw new Error('decodeMachineCell: cell too short');

  // CRC-first gate: verify integrity before parsing, so a corrupt cell is never
  // parsed into a plausible-but-wrong unit.
  const payload = bytes.subarray(0, bytes.length - CRC_LEN);
  const storedCrc = readUint32LE(bytes, bytes.length - CRC_LEN);
  const computedCrc = crc32(Uint8Array.from([WIRE_VERSION, ...payload]));
  if (storedCrc !== computedCrc) throw new Error('decodeMachineCell: checksum mismatch');

  let offset = 0;
  const readSlice = (): Uint8Array => {
    const { value: len, next } = readVarint(payload, offset);
    if (len === 0) throw new Error('decodeMachineCell: zero-length field');
    if (next + len > payload.length) throw new Error('decodeMachineCell: field overruns payload');
    const slice = payload.subarray(next, next + len);
    offset = next + len;
    return slice;
  };

  const recordId = utf8Fatal.decode(readSlice());
  const locale = utf8Fatal.decode(readSlice());
  if (offset + 5 > payload.length) throw new Error('decodeMachineCell: truncated status fields');
  const bucketIndex = payload[offset];
  const bucket = BUCKET_BY_INDEX.get(bucketIndex);
  if (bucket === undefined) throw new Error(`decodeMachineCell: invalid bucket ${bucketIndex}`);
  const reasonBits = readUint16LE(payload, offset + 1);
  const flagBits = readUint16LE(payload, offset + 3);

  return {
    recordId,
    locale,
    bucket,
    reasonCodes: bitsToReasonCodes(reasonBits),
    flagCheckIds: bitsToFlagIds(flagBits),
  };
}

/** Non-throwing decode: returns the unit, or null if the cell fails validation. */
export function tryDecodeMachineCell(cell: string): MachineUnit | null {
  try {
    return decodeMachineCell(cell);
  } catch {
    return null;
  }
}

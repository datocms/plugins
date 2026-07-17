/**
 * JSON serialization adapter for RunState (persistence spec §4/§8-step-4). Used
 * by the JSON export and the gzip'd cloud tier. Embeds the per-unit `mrc` machine
 * token — the cross-format integrity anchor (§4): normally redundant with the
 * structured fields, but on a serializer-mangled import the checksummed token
 * pinpoints which unit diverged. Deserialize gates on the artifact `schemaVersion`.
 */
import { machineTokenForUnit } from './machineToken';
import { RUN_SCHEMA_VERSION, type RunState, type RunUnitState } from './runState';
import { decodeMachineCell } from './machineCell';

/** A unit as it appears in the serialized JSON — structured fields plus the anchor. */
type SerializedUnit = RunUnitState & { mrc: string };

interface SerializedRecord {
  recordId: string;
  sourceVersion?: string;
  writtenVersion?: string;
  units: SerializedUnit[];
}
type SerializedRunState = Omit<RunState, 'records'> & { records: SerializedRecord[] };

/** Serializes RunState to JSON with a per-unit `mrc` integrity anchor. */
export function serializeRunState(state: RunState): string {
  return JSON.stringify({
    ...state,
    records: state.records.map((record) => ({
      ...record,
      units: record.units.map(
        (unit): SerializedUnit => ({ ...unit, mrc: machineTokenForUnit(record.recordId, unit) }),
      ),
    })),
  });
}

/** A per-unit divergence between the structured fields and the checksummed `mrc`. */
export interface TokenDivergence {
  recordId: string;
  toLocale: string;
  detail: string;
}

/**
 * Deserializes RunState from JSON. Gates on `schemaVersion`, strips the `mrc`
 * anchors back to the canonical shape, and (when `onDivergence` is given) reports
 * any unit whose structured bucket disagrees with its checksum-valid token — the
 * §4 divergence rule, surfaced for logging.
 *
 * @throws If the JSON is malformed or its schemaVersion is unknown.
 */
export function deserializeRunState(
  json: string,
  onDivergence?: (d: TokenDivergence) => void,
): RunState {
  const parsed = JSON.parse(json) as SerializedRunState;
  if (parsed.schemaVersion !== RUN_SCHEMA_VERSION) {
    throw new Error(`deserializeRunState: unknown schemaVersion ${parsed.schemaVersion}`);
  }

  const records = parsed.records.map((record) => ({
    recordId: record.recordId,
    sourceVersion: record.sourceVersion,
    writtenVersion: record.writtenVersion,
    units: record.units.map(({ mrc, ...unit }): RunUnitState => {
      if (onDivergence && mrc) {
        try {
          const decoded = decodeMachineCell(mrc);
          if (decoded.bucket !== unit.bucket) {
            onDivergence({
              recordId: record.recordId,
              toLocale: unit.toLocale,
              detail: `structured bucket "${unit.bucket}" ≠ token bucket "${decoded.bucket}"`,
            });
          }
        } catch {
          onDivergence({ recordId: record.recordId, toLocale: unit.toLocale, detail: 'mrc failed checksum' });
        }
      }
      return unit;
    }),
  }));

  return { ...parsed, records };
}

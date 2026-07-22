/**
 * CSV serialization adapter for RunState (persistence spec §5/§6 — the CSV half
 * of build-step 4, the JSON half being {@link ./jsonAdapter}). Emits one row per
 * (record, locale) unit carrying the checksummed `machine_readable_status` token
 * — the same {@link machineTokenForUnit} anchor the JSON `mrc` field uses — so a
 * report CSV can be re-imported and each unit validated from its single cell.
 *
 * A leading `#`-prefixed run-header line carries the run identity/checkpoint for
 * audit and import; parsers skip lines beginning with `#`.
 */
import type { Bucket } from '../plan/types';
import { machineTokenForUnit, runUnitFromMachineToken } from './machineToken';
import {
  RUN_SCHEMA_VERSION,
  type RunRecordState,
  type RunState,
  type RunUnitState,
} from './runState';

const CSV_HEADER = 'record_id,locale,bucket,machine_readable_status';

/** RFC-4180 cell: quote when the value contains a comma, quote, CR, or LF. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serializes RunState to the machine-readable CSV. Each row's
 * `machine_readable_status` decodes back to its unit via
 * {@link runUnitFromMachineToken}. A unit with an empty record id/locale (which
 * the token encoder rejects) yields an empty token cell rather than aborting the
 * whole export.
 */
export function serializeRunStateCsv(state: RunState): string {
  const unitCount = state.records.reduce((sum, r) => sum + r.units.length, 0);
  const runHeader = `# runId=${state.runId} checkpoint=${state.checkpoint} schemaVersion=${state.schemaVersion} units=${unitCount}`;

  const rows: string[] = [runHeader, CSV_HEADER];
  for (const record of state.records) {
    for (const unit of record.units) {
      let token = '';
      try {
        token = machineTokenForUnit(record.recordId, unit);
      } catch {
        // Empty record id/locale — keep the row, drop the (unbuildable) token.
      }
      rows.push(
        [record.recordId, unit.toLocale, unit.bucket, token].map(csvCell).join(','),
      );
    }
  }
  return rows.join('\r\n');
}

/** Reads `key=value` from the `#`-prefixed run-header line. */
function headerValue(headerLine: string, key: string): string | undefined {
  return new RegExp(`${key}=(\\S+)`).exec(headerLine)?.[1];
}

/**
 * Parses a machine-readable CSV (as produced by {@link serializeRunStateCsv})
 * back into a RunState — the import side of the report round-trip. Each row's
 * `machine_readable_status` token is authoritative (it carries the reason codes
 * + flags); the plain columns are the fallback when a token is absent. Fields the
 * CSV doesn't carry (fromLocale, deviceId, per-record itemTypeId) come back empty;
 * `toLocales` is reconstructed from the units. Cells never contain commas in this
 * format, so a plain split suffices.
 */
export function deserializeRunStateCsv(csv: string): RunState {
  const lines = csv.split(/\r?\n/);
  const headerLine = lines.find((line) => line.startsWith('#')) ?? '';
  const dataLines = lines.filter(
    (line) => line && !line.startsWith('#') && line !== CSV_HEADER,
  );

  const records = new Map<string, RunRecordState>();
  const toLocales = new Set<string>();

  for (const line of dataLines) {
    const [recordId, locale, bucket, token] = line.split(',');
    let recId = recordId;
    let unit: RunUnitState;
    if (token) {
      try {
        const decoded = runUnitFromMachineToken(token);
        recId = decoded.recordId;
        unit = decoded.unit;
      } catch {
        unit = fallbackUnit(locale, bucket);
      }
    } else {
      unit = fallbackUnit(locale, bucket);
    }
    toLocales.add(unit.toLocale);
    const existing = records.get(recId) ?? { recordId: recId, units: [] };
    existing.units.push(unit);
    records.set(recId, existing);
  }

  return {
    schemaVersion: Number(headerValue(headerLine, 'schemaVersion')) || RUN_SCHEMA_VERSION,
    runId: headerValue(headerLine, 'runId') ?? 'imported',
    checkpoint: Number(headerValue(headerLine, 'checkpoint')) || 0,
    deviceId: '',
    startedAt: 0,
    operation: 'translate',
    policyDigest: '',
    fromLocale: '',
    toLocales: [...toLocales],
    records: [...records.values()],
  };
}

function fallbackUnit(locale: string, bucket: string): RunUnitState {
  return {
    toLocale: locale ?? '',
    bucket: (bucket as Bucket) ?? 'not-attempted',
    reasons: [],
    flagCheckIds: [],
    updatedAt: 0,
  };
}

import { DateTime } from "luxon";

/**
 * Date/time helpers built on Luxon to keep logic minimal and predictable.
 *
 * These utilities avoid reinventing conversion rules and delegate timezone math
 * to Luxon and the runtime `Intl` implementation whenever possible.
 */

/**
 * Resolve a localized, human-friendly long time zone name for `timeZone` at `at`.
 * Falls back to `null` if the runtime cannot provide a name.
 *
 * @param locale - BCP47 locale tag (e.g., `en-US`) or `undefined` for default
 * @param timeZone - IANA time zone identifier (e.g., `America/Los_Angeles`)
 * @param at - Instant to evaluate (affects historical/DST names)
 * @returns Localized long name, or `null` if not available
 * @example
 * ```ts
 * getZoneLongName('en-US', 'America/Los_Angeles', new Date()); // 'Pacific Time'
 * ```
 */
export function getZoneLongName(
  locale: string | undefined,
  timeZone: string,
  at: Date
): string | null {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(at);
    const namePart = parts.find((p) => p.type === "timeZoneName");
    return namePart?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Format the UTC offset for `timeZone` at `at` as `UTC±H[:MM]`.
 * Uses Luxon to account for DST and historical offset changes.
 *
 * @param timeZone - IANA time zone identifier
 * @param at - Instant to evaluate
 * @returns Offset string such as `UTC+2` or `UTC-03:30`
 * @example
 * ```ts
 * utcOffsetStringForZone('Europe/Rome', new Date()); // 'UTC+2'
 * ```
 */
export function utcOffsetStringForZone(timeZone: string, at: Date): string {
  const dt = DateTime.fromJSDate(at, { zone: timeZone });
  const offsetMin = dt.offset; // minutes
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const mm = minutes ? `:${minutes.toString().padStart(2, "0")}` : "";
  return `UTC${sign}${hours}${mm}`;
}

/**
 * Internal shape used by the editor component: a wall-clock local datetime and
 * its IANA time zone. `dateTime` is stored without numeric offset (HH:mm:ss is
 * always present) so DST is re-evaluated when formatting.
 */
export type ZonedValue = { dateTime?: string | null; timeZone?: string | null };

export type DatoZonedOutput = {
  zonedDateTime: string; // IXDTF e.g. 2025-09-08T15:30:00+02:00[Europe/Rome]
  dateTime: string; // ISO8601 with numeric offset
  zone: string; // IANA time zone
  offset: string; // e.g. +02:00
  date: string; // yyyy-LL-dd
  time_24hr: string; // HH:mm:ss
  time_12hr: string; // hh:mm:ss (no AM/PM)
  ampm: "am" | "pm";
  timestamp: string; // epoch seconds as string
};

/**
 * Ensure seconds are present in a local datetime string.
 * We always store HH:mm:ss for clarity and consistency.
 *
 * @param dt - Local datetime string like `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`
 * @returns The same datetime with seconds ensured
 * @example
 * ```ts
 * ensureSeconds('2025-01-01T10:00'); // '2025-01-01T10:00:00'
 * ```
 */
export function ensureSeconds(dt: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) return dt + ":00";
  return dt;
}

/**
 * Parse an IXDTF string like `2025-09-08T15:30:00+02:00[Europe/Rome]` into
 * `{ dateTime, timeZone }` where `dateTime` is the wall time without offset.
 *
 * @param input - IXDTF string
 * @returns Parsed `{ dateTime, timeZone }`, or `{null, null}` if invalid
 * @example
 * ```ts
 * parseIxdtf('2025-01-01T10:00:00+01:00[Europe/Rome]');
 * // { dateTime: '2025-01-01T10:00:00', timeZone: 'Europe/Rome' }
 * ```
 */
export function parseIxdtf(input: string): ZonedValue {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { dateTime: null, timeZone: null };
  // Extract [Zone]
  const zoneMatch = trimmed.match(/\[([^\]]+)\]\s*$/);
  const timeZone = zoneMatch ? zoneMatch[1] : null;
  const withoutZone = zoneMatch
    ? trimmed.slice(0, zoneMatch.index).trim()
    : trimmed;
  // Extract local date-time portion (strip any offset)
  const localMatch = withoutZone.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/
  );
  const dateTime = localMatch ? ensureSeconds(localMatch[1]) : null;
  return { dateTime, timeZone };
}

/**
 * Parse any stored Dato value (legacy IXDTF string or current JSON object)
 * back into `{ dateTime, timeZone }`.
 *
 * Accepts several legacy shapes and prefers explicit fields.
 *
 * @param input - Unknown value from the field
 * @returns `{ dateTime, timeZone }` with `null` fields if parsing fails
 * @example
 * ```ts
 * parseDatoValue({ zone: 'Europe/Rome', dateTime: '2025-01-01T10:00:00+01:00' });
 * // { dateTime: '2025-01-01T10:00:00', timeZone: 'Europe/Rome' }
 * ```
 */
export function parseDatoValue(input: unknown): ZonedValue {
  if (input && typeof input === "object") {
    const anyVal = input as Record<string, unknown>;
    // Prefer explicit fields over parsing IXDTF from JSON payload
    const zone = typeof anyVal.zone === "string" ? anyVal.zone : null;
    const dateTime =
      typeof anyVal.dateTime === "string" ? anyVal.dateTime : null;
    if (zone && dateTime) {
      // Extract local wall time part from ISO8601 with offset
      const m = dateTime.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/);
      return { dateTime: m ? ensureSeconds(m[1]) : null, timeZone: zone };
    }
    // Fallback to separate date/time fields
    const date = typeof anyVal.date === "string" ? anyVal.date : null;
    const time24 =
      typeof (anyVal as any).time_24hr === "string"
        ? (anyVal as any).time_24hr
        : null;
    const time =
      typeof (anyVal as any).time === "string" ? (anyVal as any).time : null; // legacy
    if (zone && date && (time24 || time)) {
      const t = time24 ?? time!;
      return { dateTime: ensureSeconds(`${date}T${t}`), timeZone: zone };
    }
    // As a last resort, try parsing the embedded IXDTF
    const fromZdt =
      typeof anyVal.zonedDateTime === "string"
        ? parseIxdtf(anyVal.zonedDateTime)
        : null;
    if (fromZdt) return fromZdt;
  }
  return { dateTime: null, timeZone: null };
}

/**
 * Build the JSON payload expected by Dato consumers from `{ dateTime, timeZone }`.
 * Returns an empty object if invalid or incomplete.
 *
 * Notes
 * - Returns `{}` when incomplete/invalid; callers store the JSON string, so
 *   `{}` represents "no value" in the JSON field.
 * - Offsets are derived by Luxon given the wall time and IANA zone.
 *
 * @param value - `{ dateTime, timeZone }` with wall time and IANA zone
 * @returns A structured payload with IXDTF, ISO with offset, and derived fields, or `{}`
 * @example
 * ```ts
 * buildDatoOutput({ dateTime: '2025-01-01T10:00:00', timeZone: 'Europe/Rome' });
 * // {
 * //   zonedDateTime: '2025-01-01T10:00:00+01:00[Europe/Rome]',
 * //   dateTime: '2025-01-01T10:00:00+01:00',
 * //   zone: 'Europe/Rome',
 * //   offset: '+01:00',
 * //   date: '2025-01-01',
 * //   time_24hr: '10:00:00',
 * //   time_12hr: '10:00:00',
 * //   ampm: 'am',
 * //   timestamp: '1735725600'
 * // }
 * ```
 */
export function buildDatoOutput(value: ZonedValue): DatoZonedOutput | {} {
  const { dateTime, timeZone } = value;
  if (!dateTime || !timeZone) return {};
  const dt = DateTime.fromISO(dateTime, { zone: timeZone });
  if (!dt.isValid) return {};

  // ISO with numeric offset, without zone id
  const isoWithOffset = dt.toISO({
    suppressMilliseconds: true,
    includeOffset: true,
  });
  // IXDTF with zone id appended
  const ixdtf = `${isoWithOffset}[${timeZone}]`;
  const offset = dt.toFormat("ZZ");
  const date = dt.toFormat("yyyy-LL-dd");
  const time_24hr = dt.toFormat("HH:mm:ss");
  const time_12hr = dt.toFormat("hh:mm:ss");
  const ampm = dt.hour >= 12 ? "pm" : "am";
  const timestamp = String(dt.toUnixInteger());

  return {
    zonedDateTime: ixdtf,
    dateTime: isoWithOffset,
    zone: timeZone,
    offset,
    date,
    time_24hr,
    time_12hr,
    ampm,
    timestamp,
  };
}

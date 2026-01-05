/**
 * Time zone utilities.
 *
 * Provides helpers to read supported IANA time zones from the runtime and to
 * group a time zone into a top-level region label for UI grouping.
 *
 * Example
 *   import { getSupportedTimeZones, groupForTimeZone } from "../utils/timezones";
 *   const zones = getSupportedTimeZones();
 *   const group = groupForTimeZone("Europe/Rome"); // => "Europe"
 */

/**
 * Return the list of IANA time zones supported by the current runtime.
 * Falls back to an empty array if not available.
 *
 * @returns Read-only array of IANA zone IDs
 * @example
 * ```ts
 * const zones = getSupportedTimeZones();
 * zones.includes('Europe/Rome'); // boolean
 * ```
 */
export function getSupportedTimeZones(): readonly string[] {
  const anyIntl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => readonly string[];
  };
  if (typeof anyIntl.supportedValuesOf === "function") {
    try {
      return anyIntl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Return a top-level grouping label for an IANA time zone.
 * Examples: `Europe/Rome` -> `Europe`, `Etc/GMT` -> `Etc`.
 *
 * @param tz - IANA time zone identifier
 * @returns Group name used for UI grouping
 * @example
 * ```ts
 * groupForTimeZone('Europe/Rome'); // 'Europe'
 * ```
 */
export function groupForTimeZone(tz: string): string {
  if (tz === "UTC" || tz === "GMT" || tz.startsWith("Etc/")) return "Etc";
  const first = tz.split("/")[0];
  return first || "Other";
}

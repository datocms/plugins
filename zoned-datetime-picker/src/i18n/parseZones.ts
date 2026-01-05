/**
 * Parse official IANA tzdb zone.tab (ASCII, one country code per row)
 * to map time zone -> ISO 3166-1 alpha-2 country code.
 */

import zoneTabRaw from "./zone.tab?raw";

/**
 * Load and parse the bundled `src/i18n/zone.tab` file into a map of
 * IANA time zone → ISO 3166-1 alpha‑2 country code.
 *
 * About `zone.tab`
 * - ASCII, tab‑separated columns with optional trailing comment.
 * - Columns: 1) country code, 2) coordinates, 3) time zone ID, 4) comments.
 * - Lines starting with `#` are comments and must be ignored.
 * - This variant guarantees exactly one 2‑letter country code per row.
 *
 * Parsing approach
 * - Split the file into lines, skip blanks and comments.
 * - Split each line by tabs; if we have fewer than 3 columns, skip.
 * - Use column 1 for the country code and column 3 for the time zone ID.
 * - Insert the mapping only if the zone is not already present (first‑seen wins).
 *
 * @returns Map from zone ID to ISO 3166‑1 alpha‑2 country code
 * @example
 * ```ts
 * const map = loadZoneToCountryMap();
 * map.get('Europe/Rome'); // 'IT'
 * ```
 */
export function parseZones(): Map<string, string> {
  const zoneToCountry = new Map<string, string>();
  const zoneTabContent = zoneTabRaw || "";
  const rows = zoneTabContent.split(/\r?\n/);
  for (const row of rows) {
    // Ignore blank lines and comments
    if (!row || row.startsWith("#")) continue;
    const columns = row.split("\t");
    if (columns.length < 3) continue; // Not enough columns
    const countryCode = columns[0]?.trim();
    const timeZoneId = columns[2]?.trim();
    // Only set the first occurrence for a TZ (zone.tab has 1 CC per row)
    if (countryCode && timeZoneId && !zoneToCountry.has(timeZoneId)) {
      zoneToCountry.set(timeZoneId, countryCode.toUpperCase());
    }
  }
  return zoneToCountry;
}

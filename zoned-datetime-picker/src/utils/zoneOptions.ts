import { DateTime } from 'luxon';
import { getZoneLongName, utcOffsetStringForZone } from './datetime';
import { makeSearchHaystack, normalizeForSearch } from './search';
import { groupForTimeZone } from './timezones';

/**
 * Option shape consumed by the time zone select.
 *
 * - `value`: IANA time zone identifier.
 * - `group`: user-visible grouping header.
 * - `offsetMin`: numeric offset at `now` (used for sorting).
 * - `searchHay`: normalized text used by search filtering.
 */
export type ZoneOption = {
  value: string;
  group: string;
  label: string;
  offsetMin: number;
  searchHay: string;
};

/**
 * Construct a readable label for a time zone option.
 * Appends current UTC offset and a localized long name when available.
 *
 * The returned label is used for display and full-text search.
 *
 * @param tz - IANA time zone identifier
 * @param kind - Whether the option is in the "suggested" block or regular list
 * @param cfg - Rendering context (locale, now, site/browser zones, maps, flags)
 * @returns User-facing label
 * @example
 * ```ts
 * makeZoneLabel('Europe/Rome', 'regular', {
 *   now: new Date(),
 *   locale: 'en',
 *   zoneToCountry: new Map([['Europe/Rome','IT']]),
 *   labels: { browser: 'Your browser', site: 'This project' },
 *   browserTimeZone: 'Europe/Rome',
 *   siteTimeZone: 'UTC',
 *   toFlagEmoji: () => '🇮🇹',
 * });
 * // => "🇮🇹 Europe/Rome (UTC+2, Central European Summer Time)"
 * ```
 */
export function makeZoneLabel(
  tz: string,
  kind: 'suggested' | 'regular',
  cfg: {
    now: Date;
    locale?: string;
    zoneToCountry: Map<string, string>;
    labels: { browser: string; site: string };
    browserTimeZone: string;
    siteTimeZone?: string | null;
    toFlagEmoji: (cc: string) => string;
  },
): string {
  const {
    now,
    locale,
    zoneToCountry,
    labels,
    browserTimeZone,
    siteTimeZone,
    toFlagEmoji,
  } = cfg;
  const offset = utcOffsetStringForZone(tz, now);
  const localized = getZoneLongName(locale, tz, now) ?? tz;
  const cc = zoneToCountry.get(tz) ?? null;
  const flag = cc ? `${toFlagEmoji(cc)} ` : '';
  const base = `${tz} (${offset}${localized && localized !== tz ? `, ${localized}` : ''})`;
  if (tz === 'UTC') return `🌍 ${base}`;
  if (kind === 'suggested') {
    if (tz === browserTimeZone) return `${flag}${labels.browser}: ${base}`;
    if (siteTimeZone && tz === siteTimeZone)
      return `${flag}${labels.site}: ${base}`;
    return `${flag}${base}`;
  }
  return `${flag}${base}`;
}

/**
 * Build grouped, searchable options for the time zone select.
 *
 * - Suggested options are listed first under `suggestedLabel`.
 * - Regular options are grouped by region and sorted by offset then label.
 * - `offsetMin` is precomputed to speed up rendering and sorting.
 *
 * @param params - Full configuration: zones, suggested, i18n, and mapping helpers
 * @returns Flat array of options, Suggested first, then by region
 * @example
 * ```ts
 * buildZoneOptions({
 *   timeZones: ['UTC', 'Europe/Rome'],
 *   now: new Date(),
 *   suggestedTimeZones: ['UTC'],
 *   suggestedLabel: 'Suggested',
 *   browserTimeZone: 'Europe/Rome',
 *   siteTimeZone: 'UTC',
 *   locale: 'en',
 *   zoneToCountry: new Map([['Europe/Rome','IT']]),
 *   toFlagEmoji: () => '🇮🇹',
 *   labels: { browser: 'Your browser', site: 'This project' },
 * });
 * ```
 */
export function buildZoneOptions(params: {
  timeZones: readonly string[];
  now: Date;
  suggestedTimeZones: string[];
  suggestedLabel: string;
  browserTimeZone: string;
  siteTimeZone?: string | null;
  locale?: string;
  zoneToCountry: Map<string, string>;
  toFlagEmoji: (cc: string) => string;
  labels: { browser: string; site: string };
}): ZoneOption[] {
  const {
    timeZones,
    now,
    suggestedTimeZones,
    suggestedLabel,
    browserTimeZone,
    siteTimeZone,
    locale,
    zoneToCountry,
    toFlagEmoji,
    labels,
  } = params;

  const offsetCache = new Map<string, number>();
  const getOffset = (tz: string) => {
    if (!offsetCache.has(tz)) {
      const offset = DateTime.fromJSDate(now, { zone: tz }).offset;
      offsetCache.set(tz, offset);
    }
    // The map always has `tz` at this point because we set it above
    return offsetCache.get(tz) ?? 0;
  };

  const suggested: ZoneOption[] = suggestedTimeZones.map((tz) => {
    const offsetMin = getOffset(tz);
    const label = makeZoneLabel(tz, 'suggested', {
      now,
      locale,
      zoneToCountry,
      labels,
      browserTimeZone,
      siteTimeZone,
      toFlagEmoji,
    });
    return {
      value: tz,
      group: suggestedLabel,
      label,
      offsetMin,
      searchHay: makeSearchHaystack(tz, label),
    };
  });
  const priorityOf = (tz: string) =>
    tz === 'UTC'
      ? 0
      : siteTimeZone && tz === siteTimeZone
        ? 1
        : tz === browserTimeZone
          ? 2
          : 3;
  suggested.sort((a, b) => priorityOf(a.value) - priorityOf(b.value));

  const regular: ZoneOption[] = timeZones.map((tz) => {
    const offsetMin = getOffset(tz);
    const label = makeZoneLabel(tz, 'regular', {
      now,
      locale,
      zoneToCountry,
      labels,
      browserTimeZone,
      siteTimeZone,
      toFlagEmoji,
    });
    return {
      value: tz,
      group: groupForTimeZone(tz),
      label,
      offsetMin,
      searchHay: makeSearchHaystack(tz, label),
    };
  });
  regular.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.offsetMin - b.offsetMin || a.label.localeCompare(b.label);
  });

  return [...suggested, ...regular];
}

export type ZoneGroup = { label: string; options: ZoneOption[] };

/**
 * Fold the flat, already sorted options into the `{ label, options }` groups
 * of the select, one group for each run of options with the same `group`.
 */
export function groupZoneOptions(options: ZoneOption[]): ZoneGroup[] {
  const groups: ZoneGroup[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.label === option.group) {
      last.options.push(option);
    } else {
      groups.push({ label: option.group, options: [option] });
    }
  }
  return groups;
}

/**
 * Forgiving, token-based search for the select's `filterOption`: accents,
 * punctuation and case are ignored, and every whitespace-separated token of
 * the query must appear in the option's precomputed haystack.
 *
 * @example
 * ```ts
 * matchesZoneQuery({ data: romeOption }, 'rome utc 2'); // true
 * ```
 */
export function matchesZoneQuery(
  option: { data: ZoneOption },
  inputValue: string,
): boolean {
  const norm = normalizeForSearch(inputValue.trim());
  if (!norm) return true;
  const tokens = norm.split(/\s+/).filter(Boolean);
  return tokens.every((token) => option.data.searchHay.includes(token));
}

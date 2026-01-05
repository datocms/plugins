import { Box } from "@mui/material";
import React from "react";
import type { UILabels } from "../i18n/uiLabels";
import { toFlagEmoji } from "../utils/flags";
import { getZoneLongName, utcOffsetStringForZone } from "../utils/datetime";
import { normalizeForSearch } from "../utils/search";

import type { ZoneOption } from "../utils/zoneOptions.ts";

/**
 * Factory that returns an MUI Autocomplete `renderOption` implementation
 * for time zone options with flags, offset and localized long name.
 *
 * Splitting into a factory captures static data (labels, locale, maps) once.
 *
 * @param cfg - Static context for rendering (labels, zones, maps, locale)
 * @returns A function suitable for `renderOption` in MUI Autocomplete
 * @example
 * ```tsx
 * const renderOption = renderZoneOptionFactory({ labels, browserTimeZone, siteTimeZone, zoneToCountry, now, locale });
 * <Autocomplete renderOption={renderOption} ... />
 * ```
 */
export function renderZoneOptionFactory(cfg: {
  labels: UILabels;
  browserTimeZone: string;
  siteTimeZone?: string | null;
  zoneToCountry: Map<string, string>;
  now: Date;
  locale?: string;
}) {
  const { labels, browserTimeZone, siteTimeZone, zoneToCountry, now, locale } =
    cfg;
  return (props: React.HTMLAttributes<HTMLLIElement>, opt: ZoneOption) => {
    const isSuggested = opt.group === labels.suggested;
    const isBrowser = opt.tz === browserTimeZone;
    const isSite = !!siteTimeZone && opt.tz === siteTimeZone;
    const isUTC = opt.tz === "UTC";
    const countryCode = zoneToCountry.get(opt.tz) ?? null;
    const flag = countryCode ? `${toFlagEmoji(countryCode)} ` : "";
    const globe = isUTC ? "🌍 " : "";
    const offsetText = utcOffsetStringForZone(opt.tz, now);
    const localizedName = getZoneLongName(locale, opt.tz, now) ?? opt.tz;
    const suffix = `${offsetText}${localizedName !== opt.tz ? `, ${localizedName}` : ""}`;
    const prefix =
      isSuggested && (isBrowser || isSite)
        ? `${isBrowser ? labels.browser : labels.site}: `
        : "";
    return (
      <li {...props}>
        {globe}
        {flag}
        {prefix}
        <Box marginX={1}>
          <strong>{opt.tz}</strong>
        </Box>
        <Box
          component="span"
          sx={{
            color: "text.secondary",
          }}
        >
          ({suffix})
        </Box>
      </li>
    );
  };
}

/**
 * Filter options by user input using a forgiving, token-based search.
 * Matches tokens against a normalized haystack precomputed on each option.
 *
 * @param opts - All options
 * @param inputValue - User input text
 * @returns Filtered options
 * @example
 * ```ts
 * filterZoneOptions(options, 'rome utc+2');
 * ```
 */
export function filterZoneOptions(
  opts: ZoneOption[],
  inputValue: string
): ZoneOption[] {
  const q = (inputValue ?? "").trim();
  if (!q) return opts;
  const norm = normalizeForSearch(q);
  if (!norm) return opts;
  const tokens = norm.split(/\s+/).filter(Boolean);
  return opts.filter((o) => tokens.every((t) => o.searchHay.includes(t)));
}

/**
 * MUI `filterOptions` adapter that forwards to `filterZoneOptions`.
 * Keeps the filtering logic framework-agnostic and easily testable.
 *
 * @param opts - All options
 * @param state - MUI-provided state with `inputValue`
 * @returns Filtered options for MUI
 */
export function filterZoneOptionsMUI(
  opts: ZoneOption[],
  state: { inputValue: string }
) {
  return filterZoneOptions(opts, state.inputValue);
}

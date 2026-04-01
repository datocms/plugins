import { Box } from '@mui/material';
import type React from 'react';
import type { UILabels } from '../i18n/uiLabels';
import { getZoneLongName, utcOffsetStringForZone } from '../utils/datetime';
import { toFlagEmoji } from '../utils/flags';
import { normalizeForSearch } from '../utils/search';

import type { ZoneOption } from '../utils/zoneOptions.ts';

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
type ZoneRenderCfg = {
  labels: UILabels;
  browserTimeZone: string;
  siteTimeZone?: string | null;
  zoneToCountry: Map<string, string>;
  now: Date;
  locale?: string;
};

function buildZoneOptionPrefix(opt: ZoneOption, cfg: ZoneRenderCfg): string {
  const { labels, browserTimeZone, siteTimeZone } = cfg;
  const isSuggested = opt.group === labels.suggested;
  const isBrowser = opt.tz === browserTimeZone;
  const isSite = !!siteTimeZone && opt.tz === siteTimeZone;
  if (isSuggested && (isBrowser || isSite)) {
    return `${isBrowser ? labels.browser : labels.site}: `;
  }
  return '';
}

function buildZoneOptionSuffix(opt: ZoneOption, cfg: ZoneRenderCfg): string {
  const { now, locale } = cfg;
  const offsetText = utcOffsetStringForZone(opt.tz, now);
  const localizedName = getZoneLongName(locale, opt.tz, now) ?? opt.tz;
  const hasLocalizedName = localizedName !== opt.tz;
  return `${offsetText}${hasLocalizedName ? `, ${localizedName}` : ''}`;
}

function renderZoneOptionItem(
  props: React.HTMLAttributes<HTMLLIElement>,
  opt: ZoneOption,
  cfg: ZoneRenderCfg,
) {
  const { zoneToCountry } = cfg;
  const countryCode = zoneToCountry.get(opt.tz) ?? null;
  const flag = countryCode ? `${toFlagEmoji(countryCode)} ` : '';
  const globe = opt.tz === 'UTC' ? '🌍 ' : '';
  const prefix = buildZoneOptionPrefix(opt, cfg);
  const suffix = buildZoneOptionSuffix(opt, cfg);

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
          color: 'text.secondary',
        }}
      >
        ({suffix})
      </Box>
    </li>
  );
}

export function renderZoneOptionFactory(cfg: ZoneRenderCfg) {
  return (props: React.HTMLAttributes<HTMLLIElement>, opt: ZoneOption) =>
    renderZoneOptionItem(props, opt, cfg);
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
  inputValue: string,
): ZoneOption[] {
  const q = (inputValue ?? '').trim();
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
  state: { inputValue: string },
) {
  return filterZoneOptions(opts, state.inputValue);
}

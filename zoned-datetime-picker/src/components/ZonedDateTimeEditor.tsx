import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import { useMemo, useState } from 'react';
import { parseZones } from '../i18n/parseZones';
import { getUiLabels } from '../i18n/uiLabels';
import { buildDatoOutput, type ZonedValue } from '../utils/datetime';
import { toFlagEmoji } from '../utils/flags';
import { getSupportedTimeZones } from '../utils/timezones';
import {
  buildZoneOptions,
  groupZoneOptions,
  matchesZoneQuery,
  type ZoneOption,
} from '../utils/zoneOptions';

/**
 * The interactive editor, mounted only once the stored value parses cleanly.
 *
 * - State keeps the local wall-clock date-time (no offset) and the IANA zone.
 * - The date and time is a native `datetime-local` input, whose value is
 *   already that wall-clock string; it goes into state unchanged.
 * - The time zone is a searchable select, grouped with the suggested zones
 *   first and then every zone by region.
 * - On save, Luxon derives the correct numeric offset for that date-time/zone
 *   so DST is preserved in the stored string.
 */
export const ZonedDateTimeEditor = ({
  ctx,
  initialValue,
}: {
  ctx: RenderFieldExtensionCtx;
  initialValue: ZonedValue;
}) => {
  const {
    fieldPath,
    disabled,
    setFieldValue,
    ui: { locale: userPreferredLocale },
    site: {
      attributes: { timezone: siteTimeZone },
    },
    startAutoResizer,
    stopAutoResizer,
    updateHeight,
  } = ctx;

  const [zonedDateTime, setZonedDateTime] = useState<ZonedValue>(initialValue);

  // Update local state and persist the JSON payload to DatoCMS in one step.
  // Writing only from the user-driven handlers (never on mount) keeps the form
  // from being marked dirty and avoids re-serializing — and overwriting — a
  // stored value we couldn't fully parse.
  const commit = (next: ZonedValue) => {
    setZonedDateTime(next);
    setFieldValue(
      fieldPath,
      JSON.stringify(buildDatoOutput(next), null, 2),
    ).catch(console.error);
  };

  // Parse time zone dropdown data from raw data file
  const timeZones = useMemo(() => getSupportedTimeZones(), []);
  const now = useMemo(() => new Date(), []);

  // Suggested time zones shown first: UTC, Site default, Browser zone
  const browserTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );

  // Localized UI labels
  const labels = getUiLabels(userPreferredLocale);
  const suggestedLabel = labels.suggested;
  const suggestedTimeZones = useMemo(
    () => ['UTC', siteTimeZone, browserTimeZone],
    [siteTimeZone, browserTimeZone],
  );

  // Pre-load TZ -> country code map from IANA zone.tab
  const zoneToCountry = useMemo(() => parseZones(), []);

  const options: ZoneOption[] = useMemo(
    () =>
      buildZoneOptions({
        timeZones,
        now,
        suggestedTimeZones,
        suggestedLabel,
        browserTimeZone,
        siteTimeZone: siteTimeZone,
        locale: userPreferredLocale,
        zoneToCountry,
        toFlagEmoji,
        labels: { browser: labels.browser, site: labels.site },
      }),
    [
      timeZones,
      now,
      suggestedTimeZones,
      suggestedLabel,
      browserTimeZone,
      siteTimeZone,
      userPreferredLocale,
      zoneToCountry,
      labels.browser,
      labels.site,
    ],
  );
  const zoneGroups = useMemo(() => groupZoneOptions(options), [options]);

  // Prefer TZ from saved data, then site TZ, then first option (UTC). It is
  // only shown: nothing is written until the user picks a zone.
  const shownZone =
    (
      options.find((o) => o.value === zonedDateTime.timeZone) ??
      options.find((o) => o.value === siteTimeZone) ??
      options[0]
    )?.value ?? null;

  // The auto-resizer measures the bottom of every element, also the hundreds
  // of zones scrolled out of view inside the open menu, which would make the
  // frame thousands of pixels tall. While the menu is open, the frame takes
  // the scroll height of the page instead, which counts only the menu's box.
  // The menu is still mounted when it reports closing, so the auto-resizer
  // restarts on the next frame, once it is gone.
  const fitFrameToMenu = () => {
    stopAutoResizer();
    requestAnimationFrame(() =>
      updateHeight(document.documentElement.scrollHeight),
    );
  };

  return (
    <div className="form__field form__row">
      <div className="form__row__cell">
        <FieldWrapper label={labels.dateTime}>
          <StringInput
            type="datetime-local"
            value={zonedDateTime.dateTime ?? null}
            onChange={(next) =>
              commit({ ...zonedDateTime, dateTime: next || null })
            }
            disabled={disabled}
          />
        </FieldWrapper>
      </div>
      <div className="form__row__cell form__row__cell--wide">
        <FieldWrapper label={labels.timeZone}>
          <SelectInput
            options={zoneGroups}
            value={shownZone}
            onChange={(tz) => commit({ ...zonedDateTime, timeZone: tz })}
            filterOption={matchesZoneQuery}
            clearable={false}
            disabled={disabled}
            onMenuOpen={fitFrameToMenu}
            onMenuClose={() => requestAnimationFrame(startAutoResizer)}
          />
        </FieldWrapper>
      </div>
    </div>
  );
};

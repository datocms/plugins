import { Autocomplete, Stack, TextField } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseZones } from '../i18n/parseZones';
import { getUiLabels } from '../i18n/uiLabels';
import { createMuiThemeFromDato } from '../ui/theme';
import { CLOCK_VIEW_RENDERERS } from '../ui/timePicker';
import {
  filterZoneOptionsMUI,
  renderZoneOptionFactory,
} from '../ui/timeZoneAutocomplete';
import {
  buildDatoOutput,
  parseDatoValue,
  type ZonedValue,
} from '../utils/datetime';
import { toFlagEmoji } from '../utils/flags';
import { getSupportedTimeZones } from '../utils/timezones';
import { buildZoneOptions, type ZoneOption } from '../utils/zoneOptions';

/**
 * ZonedDateTime field editor
 *
 * Persists a JSON payload that includes timestamps and zone information.
 *
 * How it works
 * - State keeps the local wall-clock date-time (no offset) and the IANA zone.
 * - On save, Luxon derives the correct numeric offset for that date-time/zone
 *   so DST is preserved in the stored string.
 *
 * MUI integration
 * - DateTimePicker uses Luxon adapter and `viewRenderers` for the clock views.
 * - Autocomplete options are grouped and rendered with custom content
 *   (flag, UTC offset, localized long name) and a theme override for selected
 *   and hover states.
 */

export const ZonedDateTimePicker = ({
  ctx,
}: {
  ctx: RenderFieldExtensionCtx;
}) => {
  const {
    fieldPath,
    disabled,
    setFieldValue,
    ui: { locale: userPreferredLocale },
    site: {
      attributes: { timezone: siteTimeZone },
    },
    theme: { primaryColor, accentColor, lightColor, darkColor },
    setHeight,
    startAutoResizer,
    stopAutoResizer,
  } = ctx;

  // Parse current field value into internal state on mount.
  const [zonedDateTime, setZonedDateTime] = useState<ZonedValue>(() => {
    const rawField = ctx.formValues[fieldPath] as unknown as string;
    const parsedField = JSON.parse(rawField);
    return parseDatoValue(parsedField); // Supports legacy formats too
  });

  // Build JSON payload when local state changes
  const datoPayload = useMemo(
    () => JSON.stringify(buildDatoOutput(zonedDateTime), null, 2),
    [zonedDateTime],
  );

  // Track whether the user has made a change so we never write back on initial
  // mount — this prevents marking the form dirty and guards against accidentally
  // erasing a value we couldn't parse.
  const userHasEdited = useRef(false);

  // Persist JSON payload to DatoCMS only after the user has interacted.
  useEffect(() => {
    if (!userHasEdited.current) return;
    setFieldValue(fieldPath, datoPayload).catch(console.error);
  }, [datoPayload, setFieldValue, fieldPath]);

  // Map DatoCMS theme colors into an MUI theme
  const muiTheme = useMemo(
    () =>
      createMuiThemeFromDato(primaryColor, accentColor, lightColor, darkColor),
    [primaryColor, accentColor, lightColor, darkColor],
  );

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
  // Option labels and filtering are handled by the helper modules

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

  // Custom renderer to bold the TZ name and show suffix/flags
  const renderZoneOption = useMemo(
    () =>
      renderZoneOptionFactory({
        labels,
        browserTimeZone,
        siteTimeZone: siteTimeZone,
        zoneToCountry,
        now,
        locale: userPreferredLocale,
      }),
    [
      labels,
      browserTimeZone,
      siteTimeZone,
      zoneToCountry,
      now,
      userPreferredLocale,
    ],
  );

  // DateTimePicker value: Luxon DateTime in the selected zone
  const selectedDateTime: DateTime | null = useMemo(() => {
    if (!zonedDateTime?.dateTime) return null;
    const zone = zonedDateTime.timeZone ?? 'system';
    const parsed = DateTime.fromISO(zonedDateTime.dateTime, { zone });
    return parsed.isValid ? parsed : null;
  }, [zonedDateTime?.dateTime, zonedDateTime?.timeZone]);

  // When the user edits the date/time, keep local wall time (no offset).
  const handleDateChange = (newVal: DateTime | null) => {
    userHasEdited.current = true;
    setZonedDateTime((prev) => ({
      ...prev,
      dateTime: newVal ? newVal.toFormat("yyyy-LL-dd'T'HH:mm:ss") : null
    }));
  };

  // When the user picks a zone, update it and re-derive offset on save
  const handleTzChange = (_: unknown, newValue: string | null) => {
    userHasEdited.current = true;
    setZonedDateTime((prev) => ({ ...prev, timeZone: newValue }));
  };

  return (
    <Canvas ctx={ctx}>
      <ThemeProvider theme={muiTheme}>
        <LocalizationProvider
          dateAdapter={AdapterLuxon}
          adapterLocale={userPreferredLocale}
        >
          <Stack direction="row" spacing={1}>
            {/* Datetime picker*/}
            <DateTimePicker
              value={selectedDateTime}
              onChange={handleDateChange}
              disabled={disabled}
              timezone={zonedDateTime.timeZone ?? 'system'} // Sync with selected timezone if possible
              onOpen={() => {
                // Same iframe-resize pattern as the timezone Autocomplete:
                // stop auto-resizer and manually set enough height for the calendar.
                stopAutoResizer();
                setHeight(520);
              }}
              onClose={() => startAutoResizer()}
              slotProps={{
                textField: {
                  id: 'zdt-picker',
                  size: 'small',
                  label: labels.dateTime,
                },
                desktopPaper: {
                  sx: { marginBottom: 2 },
                },
                popper: {
                  disablePortal: true, // Render inline so it stays within the iframe
                },
              }}
              viewRenderers={CLOCK_VIEW_RENDERERS}
              sx={{ width: 310 }}
            />

            {/* Time zone picker*/}
            <Autocomplete
              id="zdt-tz"
              options={options}
              groupBy={(opt) => opt.group}
              getOptionLabel={(opt) => opt.label}

              // Prefer TZ from saved data, then site TZ, then first option in dropdown (UTC)
              value={
                options.find(
                  (o) => (zonedDateTime.timeZone && zonedDateTime.timeZone == o.tz) || (siteTimeZone == o.tz),
              ) ?? options[0]
              }

              disableClearable={true}
              isOptionEqualToValue={(opt, val) => opt.tz === val.tz}
              filterOptions={filterZoneOptionsMUI}
              renderOption={renderZoneOption}
              onChange={(_, newOption) => {
                handleTzChange(_, newOption?.tz ?? null);
                startAutoResizer();
              }}
              onClose={() => startAutoResizer()}
              slotProps={{
                listbox: {
                  sx: { maxHeight: 200, overflowY: 'auto' },
                },
                popper: {
                  disablePortal: true, // Keep the DOM node as a real child
                  keepMounted: true, // Preserve DOM for sizing and to avoid expensive re-mounts
                  modifiers: [
                    {
                      // Workaround for the popper node overflowing the iframe and causing a huge expansion
                      name: 'Manually resize on popup',
                      enabled: true,
                      phase: 'main',
                      fn() {
                        stopAutoResizer();
                        setHeight(300);
                      },
                    },
                  ],
                },
              }}
              renderInput={(params) => (
                <TextField {...params} size="small" label={labels.timeZone} />
              )}
              fullWidth
            />
          </Stack>
        </LocalizationProvider>
      </ThemeProvider>
    </Canvas>
  );
};

import { useDateSettings } from 'datocms-react-ui/DateSettings';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  formatFullDateTime,
  formatRelativeTime,
  toDateTimeAttribute,
} from 'datocms-react-ui/utils/formatDate';
import { memo, useEffect, useReducer } from 'react';

/** How often the text is written again, so "3 minutes ago" stays true */
const REFRESH_INTERVAL_MS = 60_000;

/** Under a minute, the time is "now" */
const NOW_THRESHOLD_MS = 60_000;

/**
 * The relative time of something that already happened. A time a little
 * ahead of the clock of the browser (a comment just sent) is now, never "in
 * 2 seconds"; under a minute it is "now", not "0 seconds ago".
 */
function formatPastTime(
  value: string,
  dateSettings: ReturnType<typeof useDateSettings>,
): string {
  const now = Date.now();
  const time = Math.min(Date.parse(value), now);
  if (now - time < NOW_THRESHOLD_MS) {
    return new Intl.RelativeTimeFormat(dateSettings.locale, {
      numeric: 'auto',
    }).format(0, 'second');
  }
  return formatRelativeTime(new Date(time), dateSettings);
}

type RelativeTimeProps = {
  /** An ISO 8601 instant, as the comments store it */
  value: string;
  /** For the place and the size of the text, and its focus ring */
  className?: string;
};

/**
 * When something happened, relative to now ("3 minutes ago"), with the exact
 * date and time in a tooltip. Both follow the date settings of the user.
 */
export const RelativeTime = memo(function RelativeTime({
  value,
  className,
}: RelativeTimeProps) {
  const dateSettings = useDateSettings();
  const [, refresh] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const dateTime = toDateTimeAttribute(value);

  // The formatters throw on a value that is not a date: show nothing, as
  // SmartDate does without a value
  if (!dateTime) {
    return null;
  }

  // The time takes the focus, thus the keyboard reaches the exact date too
  return (
    <Tooltip label={formatFullDateTime(value, dateSettings)}>
      <time className={className} dateTime={dateTime} tabIndex={0}>
        {formatPastTime(value, dateSettings)}
      </time>
    </Tooltip>
  );
});

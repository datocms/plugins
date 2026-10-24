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
        {formatRelativeTime(value, dateSettings)}
      </time>
    </Tooltip>
  );
});

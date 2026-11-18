import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import DateTimeInput from 'datocms-react-ui/DateTimeInput';
import { useMemo } from 'react';
import { instantOfWallClock, wallClockOfInstant } from '../utils/datetime';

/**
 * The date and time of the field: a wall clock of the time zone of the
 * field, with the calendar and the date settings of the user.
 *
 * The kit's `DateTimeInput` edits an instant, in the time zone of the date
 * settings of its `Canvas`, and has a menu that only shows the same instant
 * in another zone. The field stores a wall clock and its own zone, which the
 * zone select next to the input picks. Thus the input sits in a `Canvas`
 * whose time zone, and the time zone of the project, are the zone of the
 * field: it shows and writes the wall clock of that zone, and has no menu of
 * its own.
 *
 * @param ctx - The ctx of the field extension
 * @param timeZone - The IANA time zone of the field
 * @param dateTime - The wall-clock date-time (no offset), or `null`
 * @param disabled - The field cannot change
 * @param onChange - Gets the new wall-clock date-time, or `null` when cleared
 */
export const WallClockInput = ({
  ctx,
  timeZone,
  dateTime,
  disabled,
  onChange,
}: {
  ctx: RenderFieldExtensionCtx;
  timeZone: string;
  dateTime: string | null;
  disabled: boolean;
  onChange: (dateTime: string | null) => void;
}) => {
  const zonedCtx = useMemo<RenderFieldExtensionCtx>(
    () => ({
      ...ctx,
      // The outer Canvas already pads the frame
      bodyPadding: [0, 0, 0, 0],
      ui: { ...ctx.ui, timezone: timeZone },
      site: {
        ...ctx.site,
        attributes: { ...ctx.site.attributes, timezone: timeZone },
      },
    }),
    [ctx, timeZone],
  );

  return (
    // The outer Canvas resizes the frame. The input keys on the zone: it
    // reads the zone of its Canvas only when it mounts.
    <Canvas key={timeZone} ctx={zonedCtx} noAutoResizer>
      <DateTimeInput
        value={instantOfWallClock(dateTime, timeZone)}
        onChange={(next) => onChange(wallClockOfInstant(next, timeZone))}
        disabled={disabled}
        timezoneSelect="whenDifferent"
      />
    </Canvas>
  );
};

import { Item } from 'datocms-plugin-sdk';
import React, { useEffect, useMemo, useState } from 'react';
import { generateMatrix } from '../../utils/calendar';
import { addMonths, format, isSameDay, isSameMonth, isToday } from 'date-fns';
import classNames from 'classnames';
import { SiteClient } from 'datocms-client';
import s from './styles.module.css';
import { useDatoContext } from '../../utils/useDatoContext';
import CalendarItem from '../../components/CalendarItem';
import { Spinner } from 'datocms-react-ui';

type CalendarGridProps = {
  month: Date;
};

export default function CalendarGrid({ month }: CalendarGridProps) {
  const ctx = useDatoContext();
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const weekStartsOn = 1;

  const client = useMemo(
    () =>
      new SiteClient(ctx.currentUserAccessToken, {
        environment: ctx.environment,
      }),
    [ctx.currentUserAccessToken, ctx.environment],
  );

  useEffect(() => {
    async function run() {
      setIsLoading(true);
      setItems([]);

      const { data: items } = await client.items.all(
        {
          version: 'current',
          filter: {
            fields: {
              _publication_scheduled_at: {
                gt: month.toISOString(),
                lt: addMonths(month, 1).toISOString(),
              },
            },
          },
        },
        { deserializeResponse: false },
      );

      setItems(items);
      setIsLoading(false);
    }
    run();
  }, [month, setIsLoading, setItems, client]);

  const matrix = useMemo(
    () =>
      generateMatrix({
        year: month.getFullYear(),
        month: month.getMonth(),
        weekStartsOn,
      }),
    [month, weekStartsOn],
  );

  return (
    <>
      <div
        className={s['calendarGrid']}
        style={{ gridTemplateRows: `50px repeat(${matrix.length}, 1fr)` }}
      >
        {matrix[0].map((day, i) => (
          <div className={s['calendarWeekDay']} key={i}>
            {format(day, 'EEEE')}
          </div>
        ))}
        {matrix.map((week, i) => (
          <React.Fragment key={i}>
            {week.map((day) => (
              <div
                key={day.toISOString()}
                className={classNames(s['calendarDayCell'], {
                  [s['calendarDayCell--isToday']]: isToday(day),
                  [s['calendarDayCell--inAdjacentMonth']]: !isSameMonth(
                    day,
                    month,
                  ),
                })}
              >
                <div className={s['calendarDayCellHeader']}>
                  <div className={s['calendarDayCellHeaderDay']}>
                    <span>{format(day, 'd')}</span>
                  </div>
                </div>
                {items
                  .filter((item) =>
                    isSameDay(
                      new Date(item.meta.publication_scheduled_at as string),
                      day,
                    ),
                  )
                  .map((item) => (
                    <div key={item.id}>
                      <CalendarItem item={item} />
                    </div>
                  ))}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      {isLoading && <Spinner placement="centered" size={45} />}
    </>
  );
}

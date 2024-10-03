import React from 'react';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import classNames from 'classnames';
import s from './styles.module.css';
import CalendarItem from '../../components/CalendarItem';
import { Spinner } from 'datocms-react-ui';
import type { Criteria } from '../../types';
import type { SchemaTypes } from '@datocms/cma-client';

type CalendarGridProps = {
  month: Date;
  criteria: Criteria;
  items: SchemaTypes.Item[];
  matrix: Date[][];
  isLoading: boolean;
};

export default function CalendarGrid({
  month,
  criteria,
  items,
  matrix,
  isLoading,
}: CalendarGridProps) {
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
                    isSameDay(new Date(item.meta[criteria] as string), day),
                  )
                  .sort((a, b) =>
                    (a.meta[criteria] as string).localeCompare(
                      b.meta[criteria] as string,
                    ),
                  )
                  .map((item) => (
                    <div key={item.id}>
                      <CalendarItem item={item} criteria={criteria} />
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

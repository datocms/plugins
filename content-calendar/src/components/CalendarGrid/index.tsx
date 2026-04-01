import type { SchemaTypes } from '@datocms/cma-client';
import classNames from 'classnames';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { Spinner } from 'datocms-react-ui';
import React from 'react';
import CalendarItem from '../../components/CalendarItem';
import type { Criteria } from '../../types';
import s from './styles.module.css';

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
        className={s.calendarGrid}
        style={{ gridTemplateRows: `50px repeat(${matrix.length}, 1fr)` }}
      >
        {matrix[0].map((day) => (
          <div className={s.calendarWeekDay} key={format(day, 'EEEE')}>
            {format(day, 'EEEE')}
          </div>
        ))}
        {matrix.map((week) => (
          <React.Fragment key={week[0].toISOString()}>
            {week.map((day) => (
              <div
                key={day.toISOString()}
                className={classNames(s.calendarDayCell, {
                  [s['calendarDayCell--isToday']]: isToday(day),
                  [s['calendarDayCell--inAdjacentMonth']]: !isSameMonth(
                    day,
                    month,
                  ),
                })}
              >
                <div className={s.calendarDayCellHeader}>
                  <div className={s.calendarDayCellHeaderDay}>
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

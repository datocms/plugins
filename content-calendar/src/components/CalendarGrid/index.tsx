import type { SchemaTypes } from '@datocms/cma-client';
import classNames from 'classnames';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import type { CSSProperties } from 'react';
import CalendarItem from '../../components/CalendarItem';
import type { Criteria } from '../../types';
import s from './styles.module.css';

type CalendarGridProps = {
  month: Date;
  criteria: Criteria;
  items: SchemaTypes.Item[];
  matrix: Date[][];
};

export default function CalendarGrid({
  month,
  criteria,
  items,
  matrix,
}: CalendarGridProps) {
  return (
    <div
      className={s.grid}
      style={{ '--weeks': matrix.length } as CSSProperties}
    >
      {matrix[0].map((day) => (
        <div className={s.weekDay} key={format(day, 'EEEE')}>
          {format(day, 'EEE')}
        </div>
      ))}
      {matrix.flat().map((day) => {
        // The days are the days of the browser: the request of the records
        // asks for the days of the grid in that zone, thus the mark of today,
        // the day of each record and its time (see CalendarItem) use it too.
        const today = isToday(day);
        const dayItems = items
          .filter((item) =>
            isSameDay(new Date(item.meta[criteria] as string), day),
          )
          .sort((a, b) =>
            (a.meta[criteria] as string).localeCompare(
              b.meta[criteria] as string,
            ),
          );

        return (
          <div
            key={day.toISOString()}
            className={classNames(s.day, {
              [s.outside]: !isSameMonth(day, month),
              [s.today]: today,
            })}
            aria-current={today ? 'date' : undefined}
          >
            <time className={s.dayNumber} dateTime={format(day, 'yyyy-MM-dd')}>
              {format(day, 'd')}
            </time>
            {dayItems.length > 0 && (
              <ul className={s.items}>
                {dayItems.map((item) => (
                  <li key={item.id}>
                    <CalendarItem item={item} criteria={criteria} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

import {
  addDays,
  startOfWeek,
  differenceInCalendarWeeks,
  endOfMonth,
  startOfMonth,
} from 'date-fns';

type GenerateMatrixArgs = {
  year: number;
  month: number;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

export function generateMatrix({
  year,
  month,
  weekStartsOn,
}: GenerateMatrixArgs): Date[][] {
  let date = new Date(year, month);
  let startDay = startOfMonth(date);
  let lastDay = endOfMonth(date);

  const startDate = startOfWeek(startDay, { weekStartsOn });
  const rows =
    differenceInCalendarWeeks(lastDay, startDay, { weekStartsOn }) + 1;
  const cols = 7;
  const totalDays = rows * cols;

  return Array.from({ length: totalDays })
    .map((_, index) => addDays(startDate, index))
    .reduce<Date[][]>((matrix, current, index, days) => {
      return index % cols === 0
        ? [...matrix, days.slice(index, index + cols)]
        : matrix;
    }, []);
}

import {
  addDays,
  differenceInCalendarWeeks,
  endOfMonth,
  startOfMonth,
  startOfWeek,
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
  const date = new Date(year, month);
  const startDay = startOfMonth(date);
  const lastDay = endOfMonth(date);

  const startDate = startOfWeek(startDay, { weekStartsOn });
  const rows =
    differenceInCalendarWeeks(lastDay, startDay, { weekStartsOn }) + 1;
  const cols = 7;
  const totalDays = rows * cols;

  const allDays = Array.from({ length: totalDays }).map((_, index) =>
    addDays(startDate, index),
  );

  const matrix: Date[][] = [];
  for (let i = 0; i < allDays.length; i += cols) {
    matrix.push(allDays.slice(i, i + cols));
  }

  return matrix;
}

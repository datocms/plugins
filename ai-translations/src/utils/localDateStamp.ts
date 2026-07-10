/**
 * Formats a `Date` as a `YYYY-MM-DD` stamp in the VIEWER'S LOCAL timezone, for
 * use in downloaded report filenames.
 *
 * `new Date().toISOString().slice(0, 10)` emits the UTC calendar date, which is
 * off by a day for a user near local midnight in a non-UTC zone (e.g. 22:00 in
 * UTC-8 is already "tomorrow" in UTC), making saved reports appear misdated. The
 * local calendar fields keep the stamp on the day the user actually ran the run.
 */
export function formatLocalDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

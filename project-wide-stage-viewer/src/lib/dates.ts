/**
 * A record's system date, as the all-records-viewer shows it: the medium date
 * and short time ("Oct 3, 2026, 2:32 PM") in the project's timezone.
 */
export function formatDateTime(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    // An unknown timezone or locale: fall back to the browser's.
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}

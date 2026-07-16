/**
 * Splits a set of candidate target locales into the ones the current user's role
 * may write and the ones it may not, and builds the editor-facing hint naming the
 * excluded ones. Backs the per-run language picker's permission filter
 * (docs/superpowers/specs/2026-07-16-field-selection-ui-decisions.md §6): offer
 * only writable locales, and say plainly why the rest are missing.
 */

/** Human-readable list of the excluded locale names, or null when none. */
function formatExcludedHint(names: string[]): string | null {
  if (names.length === 0) return null;
  let subject: string;
  if (names.length === 1) {
    subject = names[0];
  } else if (names.length <= 3) {
    subject = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  } else {
    const others = names.length - 2;
    subject = `${names[0]}, ${names[1]}, and ${others} other languages`;
  }
  return `Excluding ${subject} you don't have permission to edit.`;
}

/**
 * Partitions `candidateLocales` by whether they appear in `writableLocales`
 * (case-insensitive), preserving candidate order, and produces the hint.
 *
 * @param args.candidateLocales - Locales offered for the run, in display order.
 * @param args.writableLocales - Locales the user's role can write.
 * @param args.labelFor - Optional locale → display-name resolver for the hint.
 */
export function partitionLocalesByPermission(args: {
  candidateLocales: string[];
  writableLocales: string[];
  labelFor?: (locale: string) => string;
}): { allowed: string[]; excluded: string[]; hint: string | null } {
  const { candidateLocales, writableLocales, labelFor } = args;
  const writable = new Set(writableLocales.map((l) => l.toLowerCase()));
  const allowed: string[] = [];
  const excluded: string[] = [];
  for (const locale of candidateLocales) {
    (writable.has(locale.toLowerCase()) ? allowed : excluded).push(locale);
  }
  const names = excluded.map((l) => labelFor?.(l) ?? l);
  return { allowed, excluded, hint: formatExcludedHint(names) };
}

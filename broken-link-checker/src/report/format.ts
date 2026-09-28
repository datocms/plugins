import type { LinkOccurrence } from '../types';

/** Separates facts in a line; the no-break space keeps the bullet off the start of a line. */
export const FACT_SEPARATOR = ' • ';

export function joinFacts(
  facts: readonly (string | false | null | undefined)[],
): string {
  return facts.filter(Boolean).join(FACT_SEPARATOR);
}

/** "Today, 02:32 PM" or "09/26/2026, 02:32 PM", in the user's locale and the browser timezone. */
export function formatDateTime(iso: string, locale: string, hour12?: boolean) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
  if (date.toDateString() === new Date().toDateString())
    return `Today, ${time}`;
  return `${date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })}, ${time}`;
}

/** For a date that follows other words: "Finished today, 14:32". */
export function inSentence(text: string): string {
  return text.startsWith('Today') ? `today${text.slice('Today'.length)}` : text;
}

type LanguageNames = { of(code: string): string | undefined };
type LanguageNamesConstructor = new (
  locales: string[],
  options: { type: 'language' },
) => LanguageNames;

const languageNames = new Map<string, LanguageNames | null>();

function languageNamesFor(uiLocale: string): LanguageNames | null {
  if (languageNames.has(uiLocale)) return languageNames.get(uiLocale) ?? null;
  let names: LanguageNames | null = null;
  try {
    const DisplayNames = (
      Intl as unknown as { DisplayNames?: LanguageNamesConstructor }
    ).DisplayNames;
    if (DisplayNames)
      names = new DisplayNames([uiLocale], { type: 'language' });
  } catch {
    names = null;
  }
  languageNames.set(uiLocale, names);
  return names;
}

/** "English" for `en`; the code itself when the name is unknown. */
export function localeName(code: string, uiLocale: string): string {
  try {
    return languageNamesFor(uiLocale)?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Whole-string plural branches: `other` receives the formatted count as `{n}`. */
export function countLabel(
  n: number,
  one: string,
  other: string,
  uiLocale?: string,
): string {
  if (n === 1) return one;
  return other.split('{n}').join(n.toLocaleString(uiLocale));
}

/** Where a link sits: the field itself, the fields and blocks around it, and its locale. */
export type LocationParts = {
  field: string;
  /** The containing fields and blocks, outermost first, joined with " > "; empty at the top level. */
  parents: string;
  /** The locale's name, when the location should show it. */
  locale?: string;
};

export function locationParts(
  occurrence: LinkOccurrence,
  uiLocale: string,
  showLocale: boolean,
): LocationParts {
  const parts: string[] = [];
  for (const part of [...occurrence.blockPath, occurrence.fieldLabel]) {
    // Container fields appear in the block path and again as the field label.
    if (part !== parts[parts.length - 1]) parts.push(part);
  }
  const field = parts.pop() ?? occurrence.fieldLabel;
  return {
    field,
    parents: parts.join(' > '),
    locale:
      showLocale && occurrence.locale
        ? localeName(occurrence.locale, uiLocale)
        : undefined,
  };
}

/**
 * A location in the order PlaceLabel shows it, for accessible names:
 * "Link, English, in Body > Hero 1".
 */
export function placeName(
  occurrence: LinkOccurrence,
  uiLocale: string,
  showLocale: boolean,
): string {
  const { field, parents, locale } = locationParts(
    occurrence,
    uiLocale,
    showLocale,
  );
  return [field, locale, parents && `in ${parents}`].filter(Boolean).join(', ');
}

/** The reading code joins warning paths with "›"; the UI writes every path with " > ". */
const WARNING_PATH_SEPARATOR = ' › ';

/** Ends each path the form reader couldn't read; the callout's intro already says it. */
const UNREAD_SUFFIX =
  ': Current content could not be fully read; some links could not be checked.';

/** Whole messages reworded for the record panel, whose action is "Check again". */
const WARNING_REWRITES: ReadonlyMap<string, string> = new Map([
  [
    'Content is still loading; some links could not be checked. Wait for the record to load and scan again.',
    'The record is still loading. Wait for it to load and check again.',
  ],
]);

/** A locale code closing a path part: "Body (en)", or "Sections (en) 2" before a block's position. */
const PART_LOCALE = / \(([a-z]{2}(?:-[A-Za-z\d]{2,8})*)\)(?=(?: \d+)?$)/;

function withLocaleName(part: string, uiLocale: string): string {
  return part.replace(PART_LOCALE, (group, code: string) => {
    const name = localeName(code, uiLocale);
    return name === code ? group : ` (${name})`;
  });
}

/** Like locationParts, a container repeated as the next part appears once. */
function formatWarningPath(
  path: string,
  uiLocale: string,
  withLocales: boolean,
): string {
  const parts: string[] = [];
  for (const raw of path.split(WARNING_PATH_SEPARATOR)) {
    const part = withLocales ? withLocaleName(raw, uiLocale) : raw;
    if (part !== parts[parts.length - 1]) parts.push(part);
  }
  return parts.join(' > ');
}

/** The form reader's own failure messages, which the panel shows reworded. */
export function hasWarningRewrite(message: string): boolean {
  return WARNING_REWRITES.has(message);
}

/**
 * A reading warning as the UI shows it. Paths use " > ", and the form reader's
 * paths (the only ones with locale codes) name their locales and drop the
 * clause the intro already says: "Body (en) › Hero › Link: Current content
 * could not be fully read; …" becomes "Body (English) > Hero > Link". Other
 * messages keep their wording.
 */
export function formatWarning(warning: string, uiLocale: string): string {
  const rewrite = WARNING_REWRITES.get(warning);
  if (rewrite) return rewrite;
  if (warning.endsWith(UNREAD_SUFFIX)) {
    const path = warning.slice(0, -UNREAD_SUFFIX.length);
    return path ? formatWarningPath(path, uiLocale, true) : warning;
  }
  const lastSeparator = warning.lastIndexOf(WARNING_PATH_SEPARATOR);
  if (lastSeparator < 0) return warning;
  // The path ends at the first ": " after its last separator.
  const end = warning.indexOf(': ', lastSeparator);
  const path = end < 0 ? warning : warning.slice(0, end);
  return `${formatWarningPath(path, uiLocale, false)}${warning.slice(path.length)}`;
}

/** "A", "A and B", "A, B and C" (no Oxford comma). */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

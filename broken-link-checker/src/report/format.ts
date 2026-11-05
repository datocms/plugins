import type { LinkOccurrence } from '../types';

/** Separates facts in a line; the no-break space keeps the bullet off the start of a line. */
export const FACT_SEPARATOR = ' • ';

export function joinFacts(
  facts: readonly (string | false | null | undefined)[],
): string {
  return facts.filter(Boolean).join(FACT_SEPARATOR);
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

/**
 * Whole-string plural branches: `other` receives the formatted count as `{n}`.
 * For a count in a plain string; a count in a Message prop is a text of
 * `TEXTS` (`src/texts.ts`).
 */
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
 * A location as one line of text, the field first:
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

/**
 * A block model that couldn't be read gives a line for its model ("Article:
 * Some blocks couldn't be read.") and one for each field that holds its blocks
 * ("Article › Content: Some blocks couldn't be read."). The model's line says
 * less, so it goes when a line of the same model gives the same reason.
 */
export function preciseWarnings(
  warnings: readonly string[],
): readonly string[] {
  const covered = new Set<string>();
  for (const warning of warnings) {
    const path = warning.indexOf(WARNING_PATH_SEPARATOR);
    const reason = path < 0 ? -1 : warning.indexOf(': ', path);
    if (reason >= 0)
      covered.add(`${warning.slice(0, path)}${warning.slice(reason)}`);
  }
  if (covered.size === 0) return warnings;
  return warnings.filter((warning) => !covered.has(warning));
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

/** A line names at most this many places, so a long list still pages. */
const PLACES_PER_LINE = 10;

/**
 * Formatted warnings that give the same reason become one line, their places
 * joined: "Event, Job posting: Your role can't see these records." The place
 * ends at the first ": " after the path's last " > ", as formatWarning reads
 * it; a line without a reason stays as it is.
 */
export function groupWarnings(lines: readonly string[]): string[] {
  const grouped: string[] = [];
  const open = new Map<string, { index: number; places: string[] }>();
  for (const line of new Set(lines)) {
    const end = line.indexOf(': ', line.lastIndexOf(' > ') + 1);
    if (end <= 0) {
      grouped.push(line);
      continue;
    }
    const reason = line.slice(end);
    const group = open.get(reason);
    if (group && group.places.length < PLACES_PER_LINE) {
      group.places.push(line.slice(0, end));
      grouped[group.index] = `${group.places.join(', ')}${reason}`;
    } else {
      open.set(reason, { index: grouped.length, places: [line.slice(0, end)] });
      grouped.push(line);
    }
  }
  return grouped;
}

/** "A", "A and B", "A, B and C" (no Oxford comma). */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

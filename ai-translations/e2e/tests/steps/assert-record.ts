import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { cmaClient } from '../setup/cma';

const MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../seed/seed-manifest.json',
);

/** One seeded record as recorded by the seed scripts. */
export type SeedRecord = {
  id: string;
  model: string;
  title: string;
  sourceLocales: string[];
  emptyTargetLocales: string[];
};

export type SeedManifest = {
  locales: string[];
  primaryLocale: string;
  schema: {
    models: Record<
      string,
      { id: string; fields: Array<{ api_key: string; editor: string; localized: boolean }> }
    >;
  };
  records: SeedRecord[];
};

export const loadManifest = (): SeedManifest =>
  JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

/**
 * Find the seeded record matching a model + exact source-locale set (the
 * manifest has no A1/A5 labels, so this is how the suite addresses the
 * purpose-built records). Throws if no unique match exists.
 */
export const findRecord = (
  manifest: SeedManifest,
  model: string,
  sourceLocales: string[],
): SeedRecord => {
  const want = [...sourceLocales].sort().join(',');
  const matches = manifest.records.filter(
    (r) => r.model === model && [...r.sourceLocales].sort().join(',') === want,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${model} record with sources [${sourceLocales.join('+')}], found ${matches.length}`,
    );
  }
  return matches[0];
};

/**
 * Find the seeded record matching a model + exact title. Needed when
 * {@link findRecord}'s (model, sourceLocales) key isn't unique — e.g. BV Probe
 * and BV Control are both `block_variants` records with the same `[en, it]`
 * source-locale set, so only the title disambiguates them. Throws if no unique
 * match exists.
 */
export const findRecordByTitle = (
  manifest: SeedManifest,
  model: string,
  title: string,
): SeedRecord => {
  const matches = manifest.records.filter((r) => r.model === model && r.title === title);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${model} record titled "${title}", found ${matches.length}`,
    );
  }
  return matches[0];
};

/** Localized fields come back as `{ locale: value }`; pull one locale's value. */
const localeValue = (raw: unknown, locale: string): unknown =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[locale] : undefined;

/** Placeholder shapes that must survive translation byte-identical. */
const TOKEN_PATTERNS = [
  /\{\{\s*[\w.]+\s*\}\}/g, // {{name}}
  /\{\s*[\w.]+\s*\}/g, // {count}
  /%(?:\d+\$)?[sd]/g, // %s, %d, %1$s
  /%\(\w+\)s/g, // %(name)s
  /(?<![\w/]):[a-z][\w]+/g, // :slug (route param), not http://
];

/** Extract every placeholder-shaped token from an arbitrary field value. */
export const extractTokens = (value: unknown): string[] => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const found = new Set<string>();
  for (const pattern of TOKEN_PATTERNS) {
    for (const m of text.matchAll(pattern)) found.add(m[0]);
  }
  return [...found];
};

/** Assert each listed localized field is EMPTY in a locale (negative coverage:
 * fields deliberately left out of a run must stay untouched). */
export const assertLocaleEmpty = async (
  envName: string,
  itemId: string,
  locale: string,
  fieldApiKeys: string[],
): Promise<void> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  for (const field of fieldApiKeys) {
    const value = localeValue(item[field], locale);
    const isEmpty =
      value == null || value === '' || (Array.isArray(value) && value.length === 0);
    expect(
      isEmpty,
      `${field}[${locale}] must remain empty — it was not selected for translation (got: ${JSON.stringify(value)?.slice(0, 120)})`,
    ).toBe(true);
  }
};

/** Assert each listed localized field is non-empty in each target locale. */
export const assertLocalesPopulated = async (
  envName: string,
  itemId: string,
  locales: string[],
  fieldApiKeys: string[],
): Promise<void> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  for (const field of fieldApiKeys) {
    for (const locale of locales) {
      const value = localeValue(item[field], locale);
      const isEmpty =
        value == null || value === '' || (Array.isArray(value) && value.length === 0);
      expect(isEmpty, `${field}[${locale}] should be populated after translation`).toBe(false);
    }
  }
};

/**
 * Assert every placeholder token present in the source-locale value of a field
 * also survives, byte-identical, into each target locale.
 */
export const assertPlaceholdersSurvive = async (
  envName: string,
  itemId: string,
  sourceLocale: string,
  targetLocales: string[],
  fieldApiKey: string,
): Promise<void> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  const tokens = extractTokens(localeValue(item[fieldApiKey], sourceLocale));
  expect(tokens.length, `${fieldApiKey}[${sourceLocale}] should contain placeholder tokens`)
    .toBeGreaterThan(0);

  for (const locale of targetLocales) {
    const text = JSON.stringify(localeValue(item[fieldApiKey], locale) ?? '');
    for (const token of tokens) {
      expect(text, `${token} must survive into ${fieldApiKey}[${locale}]`).toContain(token);
    }
  }
};

/**
 * Scan every field for placeholder tokens in the source locale and assert each
 * survives byte-identical into every target locale. Avoids coupling to a
 * specific seed field; asserts the record has at least one token somewhere.
 */
export const assertPlaceholdersSurviveAnyField = async (
  envName: string,
  itemId: string,
  sourceLocale: string,
  targetLocales: string[],
): Promise<void> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  let foundAny = false;
  for (const [field, raw] of Object.entries(item)) {
    const tokens = extractTokens(localeValue(raw, sourceLocale));
    if (tokens.length === 0) continue;
    foundAny = true;
    for (const locale of targetLocales) {
      const text = JSON.stringify(localeValue(raw, locale) ?? '');
      for (const token of tokens) {
        expect(text, `${token} must survive into ${field}[${locale}]`).toContain(token);
      }
    }
  }
  expect(foundAny, `${itemId} should carry placeholder tokens in ${sourceLocale}`).toBe(true);
};

/** Pull one locale's value of a localized field from a CMA item payload. */
export const getLocaleValue = async (
  envName: string,
  itemId: string,
  fieldApiKey: string,
  locale: string,
): Promise<unknown> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  return localeValue(item[fieldApiKey], locale);
};

/**
 * Snapshot one locale's slice of each listed localized field, for a later
 * "source locale left untouched" comparison — the regression guard for the
 * ≤3.4.5 in-place SEO mutation bug, where translating to several locales at
 * once corrupted the SOURCE locale's data (Basecamp: "Fixing corrupted AI
 * Translation SEO Fields").
 */
export const snapshotLocaleValues = async (
  envName: string,
  itemId: string,
  locale: string,
  fieldApiKeys: string[],
): Promise<Record<string, unknown>> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  return Object.fromEntries(
    fieldApiKeys.map((k) => [k, localeValue(item[k], locale)]),
  );
};

/** Assert a locale's slice of each snapshotted field is byte-for-byte unchanged. */
export const assertLocaleValuesUnchanged = async (
  envName: string,
  itemId: string,
  locale: string,
  snapshot: Record<string, unknown>,
): Promise<void> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  for (const [field, before] of Object.entries(snapshot)) {
    expect(
      JSON.stringify(localeValue(item[field], locale)),
      `${field}[${locale}] (the translation SOURCE) must never be mutated by a translation run`,
    ).toBe(JSON.stringify(before));
  }
};

/**
 * Count the top-level elements of an HTML fragment (depth-0 tags). The 3.5.6
 * over-split bug dropped whole top-level segments from translated WYSIWYG
 * values ("AI Translate truncating HTML response arrays"), so source/target
 * parity of this count is the regression signal. Void/self-closing tags (br,
 * img, hr…) don't nest, so they only count at depth 0.
 */
export const countTopLevelHtmlElements = (html: string): number => {
  const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'embed', 'wbr']);
  let depth = 0;
  let count = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const [, closing, rawTag, selfClosing] = m;
    const tag = rawTag.toLowerCase();
    if (VOID.has(tag) || selfClosing === '/') {
      if (depth === 0 && !closing) count += 1;
      continue;
    }
    if (closing) {
      depth = Math.max(0, depth - 1);
    } else {
      if (depth === 0) count += 1;
      depth += 1;
    }
  }
  return count;
};

/** Snapshot raw field values for later "untouched" comparison. */
export const snapshotFields = async (
  envName: string,
  itemId: string,
  fieldApiKeys: string[],
): Promise<Record<string, unknown>> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  return Object.fromEntries(fieldApiKeys.map((k) => [k, item[k]]));
};

/** Assert the given non-localized fields are unchanged versus a snapshot. */
export const assertFieldsUnchanged = async (
  envName: string,
  itemId: string,
  snapshot: Record<string, unknown>,
): Promise<void> => {
  const item = (await cmaClient(envName).items.find(itemId)) as Record<string, unknown>;
  for (const [field, before] of Object.entries(snapshot)) {
    expect(JSON.stringify(item[field]), `${field} should be left untouched`).toBe(
      JSON.stringify(before),
    );
  }
};

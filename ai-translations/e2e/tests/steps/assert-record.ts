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

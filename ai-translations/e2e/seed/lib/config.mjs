/**
 * Shared config + pre-authenticated CMA client for the AI Translation E2E project.
 * Token is read from the plugin repo's .env.testing (E2E_PROJECT_CMA_TOKEN).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildClient } from '@datocms/cma-client-node';

// .env.testing lives at the plugin repo root (e2e/seed/lib -> ../../..).
const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../.env.testing');

/** Parse a KEY=VALUE .env file into a plain object (no external dep). */
const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const eq = line.indexOf('=');
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );

const env = parseEnv(readFileSync(ENV_PATH, 'utf8'));
const apiToken = env.E2E_PROJECT_CMA_TOKEN;
if (!apiToken) throw new Error('E2E_PROJECT_CMA_TOKEN missing from .env.testing');

export const client = buildClient({ apiToken });

/**
 * World-spanning locale set. `en` stays primary (index 0).
 * Region coverage: N. America/global, Iberia+LatAm, S. America, W./C./S./E. Europe,
 * MENA (RTL), East Asia (x2 scripts), South Asia, Sub-Saharan Africa.
 */
export const LOCALES = [
  'en', // English — global / North America (PRIMARY)
  'es', // Spanish — Spain + Latin America
  'pt-BR', // Portuguese (Brazil) — South America
  'fr', // French — Western Europe / Francophone Africa
  'de', // German — Central Europe
  'it', // Italian — Southern Europe
  'ru', // Russian — Eastern Europe / Central Asia (Cyrillic)
  'ar', // Arabic — MENA (RTL)
  'ja', // Japanese — East Asia
  'zh-Hans', // Chinese (Simplified) — East Asia
  'hi', // Hindi — South Asia (Devanagari)
  'sw', // Swahili — Sub-Saharan Africa
];

/** Pretty console section header. */
export const section = (title) =>
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);

/** Run a labelled async step, logging success/failure without aborting the batch. */
export const step = async (label, fn) => {
  try {
    const result = await fn();
    console.log(`  ✓ ${label}`);
    return result;
  } catch (err) {
    const detail = err?.errors
      ? JSON.stringify(err.errors, null, 2)
      : err?.message || String(err);
    console.log(`  ✗ ${label}\n${detail}`);
    throw err;
  }
};

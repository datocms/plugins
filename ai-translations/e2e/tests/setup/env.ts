import { config as loadEnv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env.testing lives at the repo root (e2e/tests/setup -> ../../..).
loadEnv({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env.testing'),
});

/**
 * Infrastructure vars required for ANY run — without these nothing can fork an
 * environment, authenticate, or navigate. In one tuple so the runtime check and
 * the {@link TestEnv} type can never drift. Provider API keys are deliberately
 * NOT here: they are optional (see {@link PROVIDER_KEYS}).
 */
const REQUIRED = [
  'E2E_PROJECT_CMA_TOKEN',
  'E2E_DASHBOARD_EMAIL',
  'E2E_DASHBOARD_PASSWORD',
  'E2E_PROJECT_ID',
  'E2E_PROJECT_SUBDOMAIN',
] as const;

/**
 * Provider API keys — all optional. A provider lane runs only when its key is
 * present and non-empty in `.env.testing`; a missing or empty key skips that
 * lane, so populating a subset tests exactly that subset. See
 * {@link hasProviderKey} and `fixtures/providers.ts`.
 */
export const PROVIDER_KEYS = ['OPENAI', 'GEMINI', 'DEEPL', 'CLAUDE'] as const;

/** Optional vars — only consumed when present (provider keys + 2FA, currently off). */
const OPTIONAL = [
  'E2E_DASHBOARD_TOTP_SECRET',
  'OPENAI',
  'GEMINI',
  'DEEPL',
  'CLAUDE',
] as const;

type RequiredVar = (typeof REQUIRED)[number];
type OptionalVar = (typeof OPTIONAL)[number];

/** A provider API-key env name (each gates one matrix lane). */
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

/** Strongly-typed bag of validated, trimmed environment variables. */
export type TestEnv = Record<RequiredVar, string> & Partial<Record<OptionalVar, string>>;

/** True when an optional provider key is present and non-empty in the loaded env. */
export const hasProviderKey = (name: ProviderKey): boolean =>
  Boolean(process.env[name]?.trim());

/**
 * Validate every required env var at once and return a typed, trimmed bag.
 * Throws an actionable aggregate error naming all missing vars rather than
 * failing one at a time partway through a run.
 */
export const requireEnv = (): TestEnv => {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s) in .env.testing: ${missing.join(', ')}.\n` +
        'See e2e/README.md for where each value comes from.',
    );
  }

  const out = {} as TestEnv;
  for (const key of REQUIRED) out[key] = process.env[key]!.trim();
  for (const key of OPTIONAL) {
    if (process.env[key]?.trim()) out[key] = process.env[key]!.trim();
  }
  return out;
};

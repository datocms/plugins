import { config as loadEnv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env.testing lives at the repo root (e2e/tests/setup -> ../../..).
loadEnv({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env.testing'),
});

/**
 * Required env vars, in one tuple so the runtime check and the {@link TestEnv}
 * type can never drift. Dashboard creds use the existing `E2E_DASHBOARD_*`
 * names already present in `.env.testing`.
 */
const REQUIRED = [
  'OPENAI',
  'GEMINI',
  'DEEPL',
  'E2E_PROJECT_CMA_TOKEN',
  'E2E_DASHBOARD_EMAIL',
  'E2E_DASHBOARD_PASSWORD',
  'E2E_PROJECT_ID',
  'E2E_PROJECT_SUBDOMAIN',
] as const;

/** Optional vars — only consumed when present (2FA is currently off). */
const OPTIONAL = ['E2E_DASHBOARD_TOTP_SECRET'] as const;

type RequiredVar = (typeof REQUIRED)[number];
type OptionalVar = (typeof OPTIONAL)[number];

/** Strongly-typed bag of validated, trimmed environment variables. */
export type TestEnv = Record<RequiredVar, string> & Partial<Record<OptionalVar, string>>;

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

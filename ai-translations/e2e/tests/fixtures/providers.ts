import { ENV_NAME_PREFIX } from '../setup/constants';
import { hasProviderKey, type ProviderKey } from '../setup/env';

export type Vendor = 'openai' | 'google' | 'deepl' | 'anthropic';

/** One provider lane in the matrix: its vendor, key source, and forked env. */
export type ProviderSpec = {
  vendor: Vendor;
  /** Which `.env.testing` key holds this vendor's API key. */
  keyEnv: ProviderKey;
  /** Stable env name for this lane, e.g. `e2e-260624112233-openai`. */
  envName: string;
};

/**
 * Every lane the suite knows how to run. Env names are FIXED (not timestamped):
 * Playwright re-imports this module in each worker process separately from
 * `global-setup`, so any `new Date()`-derived name would diverge between the env
 * that gets forked and the name a worker navigates to. Fixed names stay identical
 * across every process; `dropEnvsIfPresent` in global-setup clears leftovers
 * before forking. The active LLM model is resolved dynamically at setup time
 * (see plugin-params).
 */
const ALL_PROVIDERS: ProviderSpec[] = [
  { vendor: 'openai', keyEnv: 'OPENAI', envName: `${ENV_NAME_PREFIX}openai` },
  { vendor: 'google', keyEnv: 'GEMINI', envName: `${ENV_NAME_PREFIX}google` },
  { vendor: 'deepl', keyEnv: 'DEEPL', envName: `${ENV_NAME_PREFIX}deepl` },
  { vendor: 'anthropic', keyEnv: 'CLAUDE', envName: `${ENV_NAME_PREFIX}anthropic` },
];

/**
 * Active lanes for this run: every provider whose API key is present and
 * non-empty in `.env.testing`. Providers with a missing/empty key are skipped, so
 * a partially-populated key file tests exactly the providers you have. The filter
 * is deterministic across worker processes because every process loads the same
 * `.env.testing`.
 */
export const PROVIDERS: ProviderSpec[] = ALL_PROVIDERS.filter((p) =>
  hasProviderKey(p.keyEnv),
);

/** Per-Playwright-project metadata, read back via `test.info().project.metadata`. */
export type ProjectMeta = { vendor: Vendor; envName: string };

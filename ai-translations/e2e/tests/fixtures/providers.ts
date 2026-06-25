import { ENV_NAME_PREFIX, RUN_ID } from '../setup/constants';
import { hasProviderKey, type ProviderKey } from '../setup/env';

export type Vendor = 'openai' | 'google' | 'deepl' | 'anthropic';

/** One provider lane in the matrix: its vendor, key source, and forked env. */
export type ProviderSpec = {
  vendor: Vendor;
  /** Which `.env.testing` key holds this vendor's API key. */
  keyEnv: ProviderKey;
  /** Per-run env name for this lane, e.g. `e2e-openai-1750000000`. */
  envName: string;
};

/**
 * Every lane the suite knows how to run. Each env is named
 * `e2e-<vendor>-<RUN_ID>`, where {@link RUN_ID} is the run's unix-seconds stamp
 * shared across all of the run's processes (see constants.ts for how it is
 * computed once and propagated). The per-run suffix lets multiple developers (or
 * CI jobs) run the suite at the same time without their forked envs colliding.
 * The longest name, `e2e-anthropic-<10-digit-seconds>` (24 chars), fits within
 * DatoCMS's environment-id length cap. The active LLM model is resolved
 * dynamically at setup time (see plugin-params).
 */
const ALL_PROVIDERS: ProviderSpec[] = [
  { vendor: 'openai', keyEnv: 'OPENAI', envName: `${ENV_NAME_PREFIX}openai-${RUN_ID}` },
  { vendor: 'google', keyEnv: 'GEMINI', envName: `${ENV_NAME_PREFIX}google-${RUN_ID}` },
  { vendor: 'deepl', keyEnv: 'DEEPL', envName: `${ENV_NAME_PREFIX}deepl-${RUN_ID}` },
  { vendor: 'anthropic', keyEnv: 'CLAUDE', envName: `${ENV_NAME_PREFIX}anthropic-${RUN_ID}` },
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

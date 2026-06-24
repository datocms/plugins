import { ENV_NAME_PREFIX } from '../setup/constants';
import type { TestEnv } from '../setup/env';

export type Vendor = 'openai' | 'google' | 'deepl';

/** One provider lane in the matrix: its vendor, key source, and forked env. */
export type ProviderSpec = {
  vendor: Vendor;
  /** Which `.env.testing` key holds this vendor's API key. */
  keyEnv: keyof TestEnv;
  /** Stable env name for this lane, e.g. `e2e-260624112233-openai`. */
  envName: string;
};

/**
 * The three provider lanes. Env names are FIXED (not timestamped): Playwright
 * re-imports this module in each worker process separately from `global-setup`,
 * so any `new Date()`-derived name would diverge between the env that gets forked
 * and the name a worker navigates to. Fixed names stay identical across every
 * process; `dropEnvsIfPresent` in global-setup clears leftovers before forking.
 * The active LLM model is resolved dynamically at setup time (see plugin-params).
 */
export const PROVIDERS: ProviderSpec[] = [
  { vendor: 'openai', keyEnv: 'OPENAI', envName: `${ENV_NAME_PREFIX}openai` },
  { vendor: 'google', keyEnv: 'GEMINI', envName: `${ENV_NAME_PREFIX}google` },
  { vendor: 'deepl', keyEnv: 'DEEPL', envName: `${ENV_NAME_PREFIX}deepl` },
];

/** Per-Playwright-project metadata, read back via `test.info().project.metadata`. */
export type ProjectMeta = { vendor: Vendor; envName: string };

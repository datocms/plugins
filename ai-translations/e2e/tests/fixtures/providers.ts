import { ENV_NAME_PREFIX, TIMESTAMP } from '../setup/constants';
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
 * The three provider lanes. The active LLM model is resolved dynamically at
 * setup time (top-ranked relevant model for the given key) rather than pinned
 * here, so a deprecated id can never break a run — see `plugin-params.ts`.
 */
export const PROVIDERS: ProviderSpec[] = [
  { vendor: 'openai', keyEnv: 'OPENAI', envName: `${ENV_NAME_PREFIX}${TIMESTAMP}-openai` },
  { vendor: 'google', keyEnv: 'GEMINI', envName: `${ENV_NAME_PREFIX}${TIMESTAMP}-google` },
  { vendor: 'deepl', keyEnv: 'DEEPL', envName: `${ENV_NAME_PREFIX}${TIMESTAMP}-deepl` },
];

/** Per-Playwright-project metadata, read back via `test.info().project.metadata`. */
export type ProjectMeta = { vendor: Vendor; envName: string };

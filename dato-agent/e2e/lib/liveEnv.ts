import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Secrets and IDs the live tests need. Every field is optional so suites can skip cleanly. */
export type LiveEnv = {
  projectId?: string;
  cmaToken?: string;
  mcpAccessToken?: string;
  anthropicApiKey?: string;
  openAiApiKey?: string;
};

const readEnvFile = (url: URL): Record<string, string | undefined> =>
  existsSync(url) ? parseEnv(readFileSync(url, 'utf8')) : {};

/**
 * Reads `e2e/.env.local` (seed project and MCP token) and the monorepo's root
 * `.env` (provider test keys). Real environment variables win over both files.
 */
export function loadLiveEnv(): LiveEnv {
  const values = {
    ...readEnvFile(new URL('../../../.env', import.meta.url)),
    ...readEnvFile(new URL('../.env.local', import.meta.url)),
    ...process.env,
  };
  return {
    projectId: values.E2E_PROJECT_ID,
    cmaToken: values.E2E_CMA_TOKEN,
    mcpAccessToken: values.E2E_MCP_ACCESS_TOKEN,
    anthropicApiKey: values.ANTHROPIC_PLUGIN_TESTING_KEY,
    openAiApiKey: values.OPENAI_PLUGIN_TESTING_KEY,
  };
}

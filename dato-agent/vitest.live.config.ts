import { defineConfig } from 'vitest/config';
import { recordCommentsAliases } from './configAliases';

/**
 * Live tests and evals: real provider APIs, the real DatoCMS MCP and a forked
 * environment of the seed project. Never part of `npm test`; run on demand
 * with `npm run test:live` or `npm run eval`.
 */
export default defineConfig({
  resolve: { alias: recordCommentsAliases },
  test: {
    environment: 'node',
    include: ['e2e/**/*.live.test.ts', 'e2e/**/*.eval.ts'],
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 5 * 60_000,
  },
});

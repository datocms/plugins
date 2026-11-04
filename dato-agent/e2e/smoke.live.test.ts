import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ForkedEnvironment,
  forkSeedEnvironment,
} from './lib/environments';
import { loadLiveEnv } from './lib/liveEnv';
import { runTask, settle } from './lib/runTask';

const env = loadLiveEnv();
const isConfigured = Boolean(
  env.projectId && env.cmaToken && env.mcpAccessToken && env.anthropicApiKey,
);

describe.skipIf(!isConfigured)('live smoke: one write, Anthropic', () => {
  let fork: ForkedEnvironment;
  beforeAll(async () => {
    fork = await forkSeedEnvironment(env.cmaToken ?? '', 'smoke');
  });
  afterAll(async () => {
    await fork?.destroy();
  });

  it('creates a draft article after one approval', async () => {
    const run = settle(
      await runTask({
        label: 'smoke',
        projectId: env.projectId ?? '',
        environment: fork.environment,
        message:
          'Create one draft Article titled "Live smoke test" with the body "Created by the live smoke test." Do not ask questions first.',
        config: {
          provider: 'anthropic',
          apiKey: env.anthropicApiKey,
          mcpAccessToken: env.mcpAccessToken ?? '',
          model: 'claude-haiku-5-5',
          modelMaxOutputTokens: 128_000,
          reasoningEffort: 'low',
        },
      }),
      'smoke',
    );
    console.log(
      `smoke: ${run.result.status}, ${run.approvals.length} approvals, ${run.calls.length} calls, $${run.usd.toFixed(4)}`,
    );

    const articles = await fork.client.items.list({
      filter: { type: 'article', fields: { title: { eq: 'Live smoke test' } } },
      version: 'current',
    });
    expect(run.result.status).toBe('completed');
    expect(articles).toHaveLength(1);
  });
});

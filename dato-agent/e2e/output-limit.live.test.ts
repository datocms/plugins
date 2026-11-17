import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const anthropicConfig = () => ({
  provider: 'anthropic' as const,
  apiKey: env.anthropicApiKey,
  mcpAccessToken: env.mcpAccessToken ?? '',
  model: 'claude-haiku-5-5',
  modelMaxOutputTokens: 128_000,
  reasoningEffort: 'low' as const,
});

const articleTitles = async (fork: ForkedEnvironment) =>
  (
    await fork.client.items.list({
      filter: { type: 'article' },
      version: 'current',
      page: { limit: 100 },
    })
  )
    .map((article) => String(article.title))
    .filter((title) => title !== 'Welcome');

describe.skipIf(!isConfigured)('live: Anthropic output limit', () => {
  let fork: ForkedEnvironment;
  beforeEach(async (context) => {
    fork = await forkSeedEnvironment(env.cmaToken ?? '', context.task.name);
  });
  afterEach(async () => {
    await fork?.destroy();
  });

  it('completes a large write of 30 long records with the default output limit', async () => {
    // Master's 16k low-effort limit truncated a single-script version of this request (PR #160).
    const run = settle(
      await runTask({
        label: 'output-limit:large-write',
        projectId: env.projectId ?? '',
        environment: fork.environment,
        message:
          'Create 30 new Article records, one per European city (30 different cities). Each body must be a travel guide of about 600 words covering history, neighbourhoods, food, transport and tips. Save them as drafts (do not publish) and do not ask any questions first.',
        config: anthropicConfig(),
      }),
      'output-limit:large-write',
    );

    const titles = await articleTitles(fork);
    expect(run.result.status).toBe('completed');
    expect(titles).toHaveLength(30);
    expect(new Set(titles).size).toBe(30);
  });

  it('discards a truncated reply, retries in smaller scripts, and writes each record once', async () => {
    // A deliberately low ceiling makes the first write script hit max_tokens.
    const run = settle(
      await runTask({
        label: 'output-limit:recovery',
        projectId: env.projectId ?? '',
        environment: fork.environment,
        message:
          'Create 6 new Article records, one per Italian city (6 different cities). Each body must be a travel guide of about 500 words. Save them as drafts and do not ask any questions first.',
        rewrite: (body) => {
          body.max_tokens = 5_000;
        },
        config: anthropicConfig(),
      }),
      'output-limit:recovery',
    );

    const titles = await articleTitles(fork);
    expect(
      run.calls.some((call) => call.stopReason === 'max_tokens'),
      'the low ceiling must truncate at least one reply',
    ).toBe(true);
    expect(run.result.status).toBe('completed');
    expect(titles).toHaveLength(6);
    expect(new Set(titles).size).toBe(6);
  });
});

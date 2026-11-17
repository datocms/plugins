/**
 * Eval for large writes against Anthropic's output limit (PR #160). Each case
 * asks for many long records in one request and varies what the request sends:
 * the max_tokens ceiling, the system prompt's script-size guidance, and an
 * advisory task budget. It reports rates and costs rather than pass/fail.
 *
 * Run: npm run eval -- e2e/output-limit.eval.ts
 * Narrow it: E2E_EVAL_CASES=64k-batch-nobudget E2E_EVAL_REPEATS=1 npm run eval -- e2e/output-limit.eval.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forkSeedEnvironment } from './lib/environments';
import { loadLiveEnv } from './lib/liveEnv';
import type { RequestRewrite } from './lib/providerTap';
import { runTask, settle } from './lib/runTask';

const RECORD_COUNT = 30;
const MIN_BODY_WORDS = 400;
const MESSAGE = `Create ${RECORD_COUNT} new Article records, one per European city (${RECORD_COUNT} different cities). Each body must be a travel guide of about 600 words covering history, neighbourhoods, food, transport and tips. Save them as drafts (do not publish) and do not ask any questions first.`;

/** The sentence in src/lib/systemPrompt.ts that steers the model toward one large script. */
export const CURRENT_SCRIPT_GUIDANCE =
  'Prepare one focused script containing the exact mutation set and result verification so a correct request normally needs one approval.';
export const BATCHED_SCRIPT_GUIDANCE =
  'Prepare focused scripts containing the exact mutation set and result verification. When a write creates or updates more than about 10 records, or includes long text, split it into batches of about 10 records per script and run them one after another. Never shorten the requested content to fit fewer scripts.';

const TASK_BUDGET_BETA = 'task-budgets-2026-03-13';
const TASK_BUDGET_TOKENS = 200_000;

type EvalCase = {
  name: string;
  maxTokens: number;
  isBatchedPrompt: boolean;
  hasTaskBudget: boolean;
  /** Strips the runtime's cache_control markers, to measure what caching saves. */
  isUncached?: boolean;
};

const variant = (
  maxTokens: number,
  isBatchedPrompt: boolean,
  hasTaskBudget: boolean,
  isUncached = false,
): EvalCase => ({
  name: `${maxTokens / 1000}k-${isBatchedPrompt ? 'batch' : 'current'}-${hasTaskBudget ? 'budget' : 'nobudget'}${isUncached ? '-nocache' : ''}`,
  maxTokens,
  isBatchedPrompt,
  hasTaskBudget,
  isUncached,
});

const ALL_CASES: EvalCase[] = [
  variant(64_000, false, false), // #160 as submitted, plus caching
  variant(64_000, true, false),
  variant(64_000, false, true),
  variant(64_000, true, true),
  variant(16_000, false, false), // master's low-effort limit, with #160's retry
  variant(64_000, false, false, true),
];

const selected = process.env.E2E_EVAL_CASES?.split(',');
const CASES = selected
  ? ALL_CASES.filter((evalCase) => selected.includes(evalCase.name))
  : ALL_CASES;
const REPEATS = Number(process.env.E2E_EVAL_REPEATS ?? 3);
const CONCURRENCY = Number(process.env.E2E_EVAL_CONCURRENCY ?? 4);

/** Rewrites each Anthropic request to match the case. */
const rewriteFor =
  (evalCase: EvalCase): RequestRewrite =>
  (body, headers) => {
    body.max_tokens = evalCase.maxTokens;
    if (evalCase.isUncached) {
      delete body.cache_control;
      body.system = (body.system as { cache_control?: unknown }[]).map(
        ({ cache_control: _, ...block }) => block,
      );
    }
    if (evalCase.isBatchedPrompt) {
      const system = JSON.stringify(body.system);
      // A retried request can arrive already rewritten; only fail when neither text is there.
      if (
        !system.includes(CURRENT_SCRIPT_GUIDANCE) &&
        !system.includes(BATCHED_SCRIPT_GUIDANCE)
      )
        throw new Error('System prompt no longer contains the script guidance');
      body.system = JSON.parse(
        system.replace(CURRENT_SCRIPT_GUIDANCE, BATCHED_SCRIPT_GUIDANCE),
      );
    }
    if (evalCase.hasTaskBudget) {
      body.output_config = {
        ...(body.output_config as object | undefined),
        task_budget: { type: 'tokens', total: TASK_BUDGET_TOKENS },
      };
      const betas = headers.get('anthropic-beta');
      headers.set(
        'anthropic-beta',
        betas ? `${betas},${TASK_BUDGET_BETA}` : TASK_BUDGET_BETA,
      );
    }
  };

type Outcome = {
  name: string;
  repeat: number;
  status: string;
  created: number;
  longBodies: number;
  meanBodyWords: number;
  approvals: number;
  truncations: number;
  outputTokens: number;
  /** Share of prompt tokens read from the cache. */
  cachedShare: number;
  usd: number;
  seconds: number;
  error?: string;
};

const env = loadLiveEnv();
const isConfigured = Boolean(
  env.projectId && env.cmaToken && env.mcpAccessToken && env.anthropicApiKey,
);

async function runCase(evalCase: EvalCase, repeat: number): Promise<Outcome> {
  const label = `${evalCase.name}-r${repeat}`;
  const startedAt = Date.now();
  const fork = await forkSeedEnvironment(env.cmaToken ?? '', label);
  try {
    const run = settle(
      await runTask({
        label: `output-limit:${label}`,
        projectId: env.projectId ?? '',
        environment: fork.environment,
        message: MESSAGE,
        rewrite: rewriteFor(evalCase),
        config: {
          provider: 'anthropic',
          apiKey: env.anthropicApiKey,
          mcpAccessToken: env.mcpAccessToken ?? '',
          model: 'claude-haiku-5-5',
          modelMaxOutputTokens: 128_000,
          reasoningEffort: 'low',
        },
      }),
      `output-limit:${label}`,
    );
    const articles = await fork.client.items.list({
      filter: { type: 'article' },
      version: 'current',
      page: { limit: 100 },
    });
    const created = articles.filter((article) => article.title !== 'Welcome');
    const bodyWords = created.map(
      (article) =>
        String(article.body ?? '')
          .split(/\s+/)
          .filter(Boolean).length,
    );
    return {
      name: evalCase.name,
      repeat,
      status: run.result.status,
      created: created.length,
      longBodies: bodyWords.filter((words) => words >= MIN_BODY_WORDS).length,
      meanBodyWords: Math.round(
        bodyWords.reduce((sum, words) => sum + words, 0) /
          Math.max(1, bodyWords.length),
      ),
      approvals: run.approvals.length,
      truncations: run.calls.filter((call) => call.stopReason === 'max_tokens')
        .length,
      outputTokens: run.calls.reduce((sum, call) => sum + call.outputTokens, 0),
      cachedShare:
        run.calls.reduce((sum, call) => sum + call.cacheReadTokens, 0) /
        Math.max(
          1,
          run.calls.reduce(
            (sum, call) =>
              sum +
              call.inputTokens +
              call.cacheReadTokens +
              call.cacheWriteTokens,
            0,
          ),
        ),
      usd: run.usd,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      ...(run.result.error ? { error: run.result.error.message } : {}),
    };
  } catch (error) {
    return {
      name: evalCase.name,
      repeat,
      status: 'harness_error',
      created: 0,
      longBodies: 0,
      meanBodyWords: 0,
      approvals: 0,
      truncations: 0,
      outputTokens: 0,
      cachedShare: 0,
      usd: 0,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fork.destroy();
  }
}

/** Runs jobs with at most `limit` in flight. */
async function pool<T>(
  jobs: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await (jobs[index] as () => Promise<T>)();
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/** Done, every record created, and at least 90% of bodies as long as asked. */
const isSuccess = (outcome: Outcome) =>
  outcome.status === 'completed' &&
  outcome.created === RECORD_COUNT &&
  outcome.longBodies >= RECORD_COUNT * 0.9;

function summarize(outcomes: Outcome[]): string {
  const rows = CASES.map((evalCase) => {
    const runs = outcomes.filter((outcome) => outcome.name === evalCase.name);
    const mean = (pick: (outcome: Outcome) => number) =>
      runs.reduce((sum, outcome) => sum + pick(outcome), 0) / runs.length;
    return `| ${evalCase.name} | ${runs.filter(isSuccess).length}/${runs.length} | ${mean((o) => o.created).toFixed(1)} | ${mean((o) => o.longBodies).toFixed(1)} | ${Math.round(mean((o) => o.meanBodyWords))} | ${mean((o) => o.truncations).toFixed(1)} | ${mean((o) => o.approvals).toFixed(1)} | ${Math.round(mean((o) => o.outputTokens)).toLocaleString('en')} | ${Math.round(mean((o) => o.cachedShare) * 100)}% | $${mean((o) => o.usd).toFixed(3)} | ${Math.round(mean((o) => o.seconds))} |`;
  });
  return [
    '| Case | Success | Records | Long bodies | Words/body | Truncations | Approvals | Output tokens | Cached input | Cost | Seconds |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

describe.skipIf(!isConfigured)('eval: large writes vs the output limit', () => {
  it('measures every case', async () => {
    const outcomes = await pool(
      CASES.flatMap((evalCase) =>
        Array.from(
          { length: REPEATS },
          (_, repeat) => () => runCase(evalCase, repeat + 1),
        ),
      ),
      CONCURRENCY,
    );
    const table = summarize(outcomes);
    const folder = new URL('./results/', import.meta.url);
    mkdirSync(folder, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    writeFileSync(
      new URL(`output-limit-${stamp}.json`, folder),
      JSON.stringify({ message: MESSAGE, cases: CASES, outcomes }, null, 2),
    );
    writeFileSync(new URL(`output-limit-${stamp}.md`, folder), `${table}\n`);
    console.log(`\n${table}\n`);
    expect(outcomes.filter((o) => o.status === 'harness_error')).toEqual([]);
  });
});

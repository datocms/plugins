# Live tests and evals

These tests run the real agent runtime against real provider APIs (Anthropic, OpenAI) and the real DatoCMS Remote MCP. Model output varies from run to run, so:

- **Live tests** (`*.live.test.ts`) check that something still works. Each task is small and likely to succeed, and each test asserts on the project's end state, never on the script text.
- **Evals** (`*.eval.ts`) compare request variants. They run each case several times and write a table of rates and costs to `e2e/results/`. They never fail on a model's choices, only on harness errors.

Neither one runs in `npm test`, and neither one gates commits, pushes or releases.

## Setup, once

1. Put the provider test keys in the monorepo's root `.env`:
   `ANTHROPIC_PLUGIN_TESTING_KEY=…` and `OPENAI_PLUGIN_TESTING_KEY=…`. Give each key a spend cap in the provider's console.
2. Put the seed project in `e2e/.env.local` (git-ignored): `E2E_PROJECT_ID`, and `E2E_CMA_TOKEN` (a full-access API token of that project).
3. Run `npm run e2e:seed` to create the schema the tests expect. It only adds what is missing.
4. Run `npm run e2e:login`. In the browser window:
   1. Sign in.
   2. Pick **Only selected projects**, then the seed project.
   3. Pick **Read and edit content**.
   4. Click **Authorize**.

   The script saves `E2E_MCP_ACCESS_TOKEN` to `e2e/.env.local`. When a test reports a 401 from the MCP, run it again.

## Run

```bash
npm run test:live                               # every live test
npm run eval -- e2e/output-limit.eval.ts        # one eval, every case, 3 repeats
E2E_EVAL_CASES=64k-batch-nobudget E2E_EVAL_REPEATS=1 npm run eval -- e2e/output-limit.eval.ts
```

## How a run works

1. `forkSeedEnvironment` forks the seed project's primary environment. Every run starts from the same schema and content, and the fork carries the seed's upgrade flags.
2. `runTask` builds the runtime with `createAgentRuntime`, as the inspector does. It sends one message and approves every script the model proposes, until the turn ends.
3. `installProviderTap` wraps `fetch` for provider calls. It records each response's usage and stop reason, and evals use it to rewrite requests (max_tokens, system prompt, beta features) without changing production code.
4. The test reads the fork with the CMA client and asserts on what it finds. Then it deletes the fork.

## Spend

Every provider call goes into `e2e/.spend.jsonl` (git-ignored) with its estimated cost. A run refuses to start once a provider's total reaches `E2E_SPEND_CAP_USD` (default $10). Prices live in `e2e/lib/spend.ts`; add a model there before a test uses it.

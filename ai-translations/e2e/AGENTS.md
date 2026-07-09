# AI Translations — E2E suite guide

Browser-driven end-to-end tests that exercise the plugin against a **real** DatoCMS
project (`E2E_PROJECT_ID`, currently `219952` / `ai-translation-e2e`), **real**
translation providers, and the **real** dashboard UI. This is the slow, expensive,
side-effecting tier — it forks environments, briefly toggles the project into
maintenance mode, and spends provider credits. Unit tests (`src/**/*.test.ts`) are
the fast tier; reach for E2E only to prove a whole flow works through the UI + CMA.

Companion docs: [`docs/superpowers/specs/2026-06-24-ai-translations-e2e-design.md`](../docs/superpowers/specs/2026-06-24-ai-translations-e2e-design.md)
(design + intended test matrix) and [`docs/superpowers/specs/2026-06-23-translation-qc-design.md`](../docs/superpowers/specs/2026-06-23-translation-qc-design.md)
(the QC feature this suite validates).

## Running

All commands run from `ai-translations/` (not `e2e/`). Playwright's `webServer`
auto-starts `npm run dev` and waits for `localhost:5173`, so the dev-URL plugin is
live during the run (`reuseExistingServer: true` — it reuses an already-running dev
server). Chromium must be installed once: `npm run install:browsers`.

```bash
npm run test:e2e            # full matrix: every provider lane × every test
npm run test:e2e:ui         # Playwright UI mode
npm run test:e2e:report     # open the last HTML report
```

**Scope a run while debugging** (the full matrix forks one env per keyed provider
and the chat per-record lanes can take many minutes):

```bash
# One provider lane only. Blank the OTHER keys on the command line: dotenv does NOT
# override already-set process.env, so an empty value wins and PROVIDERS drops that
# lane (see fixtures/providers.ts). This also forks only that provider's env.
OPENAI= GEMINI= CLAUDE= npx playwright test --project=deepl

# One test (grep by title). NB: "-g per-record" also matches the bulk test whose
# title contains "per-record outcome report" — grep "bulk:" to isolate the bulk one.
OPENAI= GEMINI= CLAUDE= npx playwright test --project=deepl -g "bulk:"
```

**DeepL is the debugging lane of choice:** fast (batch API, no chat rate limits),
deterministic, and it exercises setup + bulk + per-record end to end. Prove the
harness on DeepL first, then widen to the matrix.

## Prerequisites (`.env.testing` at the package root)

Loaded by `tests/setup/env.ts` via `dotenv`. `requireEnv()` fails fast, naming every
missing var at once.

- **Required:** `E2E_PROJECT_CMA_TOKEN`, `E2E_DASHBOARD_EMAIL`,
  `E2E_DASHBOARD_PASSWORD`, `E2E_PROJECT_ID`, `E2E_PROJECT_SUBDOMAIN`.
- **Optional:** `E2E_DASHBOARD_TOTP_SECRET` (only if the login account has 2FA),
  and the provider keys `OPENAI`, `GEMINI`, `DEEPL`, `CLAUDE` — **each optional**: a
  lane runs only when its key is present and non-empty, so a partially-populated
  file tests exactly the providers you have.
- **One-time, manual, not in the file:** a private dev-URL plugin pointing at
  `http://localhost:5173` (granting `currentUserAccessToken`) is installed in `main`.
  `global-setup` auto-installs it if absent (`plugin-params.ts` → `resolvePluginId`),
  so normally you never touch this. Every fork inherits it.

## Architecture (`playwright.config.ts` + `tests/setup/`)

- **Provider matrix → Playwright projects.** `PROVIDERS` (`fixtures/providers.ts`) is
  `ALL_PROVIDERS` filtered to those with a key set. `playwright.config.ts` turns each
  into a `project` carrying `{ vendor, envName }` in `metadata`, with `workers =
  PROVIDERS.length` — so the **same spec runs once per provider, fully parallel,
  each against its own forked env** (≈1× wall-clock, not N×). The spec reads its lane
  from `test.info().project.metadata`.
- **`global-setup.ts`** (once, headless, CMA): validate env → reset the outcome ledger
  → ensure the dev-URL plugin is in `main` → sweep stale `e2e-*` envs → drop any
  same-named leftovers → **fast-fork one sandbox env per provider** → pin each env's
  plugin params to its vendor (model resolved live) → **log in once and save
  `storageState`**. Fork needs the source read-only, so it flips **maintenance mode
  ON around the fork and OFF in a `finally`** — the project is never left locked.
- **`global-teardown.ts`** is **result-gated**: it reads the outcome ledger and
  destroys only the envs of projects that passed; **failed lanes are kept for
  debugging** and reaped later by the age-sweep. The ledger is a plain file the spec
  appends to in `afterEach` (`setup/outcomes.ts`) — the Playwright JSON report isn't
  written until after teardown, so we can't read test results there.

## Environments & cleanup

- **Naming:** `e2e-<vendor>-<RUN_ID>` (`ENV_NAME_PREFIX = 'e2e-'`), where `RUN_ID` is a
  unix-seconds stamp resolved **once** and propagated to worker processes via
  `E2E_RUN_ID` (`setup/constants.ts`). Pin it yourself (`E2E_RUN_ID=… npx playwright
  test`) if you need a predictable name. The per-run suffix lets concurrent runs not
  collide. Longest name (`e2e-anthropic-<10 digits>`) fits DatoCMS's env-id length cap.
- **Fork** is `environments.fork(main, {id}, {fast: true})` then poll until
  `meta.status === 'ready'` (`setup/fork-environments.ts`).
- **Self-healing cleanup:** `sweepStaleEnvs()` (in `global-setup`) reaps any `e2e-*`
  env older than `ENV_MAX_AGE_DAYS` (currently **1 day**). So a crashed run's orphans
  disappear on the next run's setup — but not sooner. To drop fresh orphans now, list
  `environments` via the CMA token and `environments.destroy` the `e2e-*` ones (they
  are always sandbox forks, safe to delete). Never destroy `main`.

## The seed (`e2e/seed/`) — the fork source

`main`'s schema + content is the fixture every run forks. The suite **does not**
re-seed; the seed scripts are run **by hand** to build/repair `main`. Full details in
[`e2e/seed/README.md`](seed/README.md). Run from `e2e/seed/` (its own
`package.json`; reads `../.env.testing`):

```bash
node 1-schema.mjs            # locales + models + fields   — IDEMPOTENT (skips existing by api_key)
node 2-uploads.mjs           # assets → uploads.json        — IDEMPOTENT
node 3-records.mjs           # the core records             — NOT idempotent (creates duplicates on re-run)
node 3b-coverage-records.mjs # A6/A7 + A5 top-up            — idempotent
node 3c-catalog-records.mjs  # catalog_entry records for reference-copy + length-validator paths — idempotent
node 4-verify.mjs            # coverage report + assertions (records ≥ 8, ≥2 locales each, editors present)
node 5-manifest.mjs          # writes seed-manifest.json (committed; the suite loads it)
```

**Applying a schema change to `main`:** edit `1-schema.mjs` and re-run it (idempotent,
adds new item types/fields). Because `3-records.mjs` is **not** idempotent, do **not**
re-run it to backfill data — write a small idempotent top-up script (guard on an
existence check) like `3b`, or update specific records by id. Then re-run
`4-verify.mjs` and `5-manifest.mjs`, and commit the regenerated `seed-manifest.json`.

**Schema shape today:** 12 locales (`en` primary); two content models `article` +
`product`; five block models. Every translatable editor appears as a localized field;
a few non-localized/numeric fields give negative coverage (must be left untouched).
Ten records (A1–A7, P1–P3) each populate two locales, leaving the rest empty for the
suite to translate into. `seed-manifest.json` lists every record's `sourceLocales` +
`emptyTargetLocales`; the suite iterates it (`steps/assert-record.ts` → `loadManifest`,
`findRecord`).

## Steps & the UI contract (`tests/steps/`)

- **`per-record.ts`** — `openRecord` → `translateRecordViaSidebar` (drives the "AI
  Translations" sidebar panel) → `saveRecord` (returns `{ status, fieldErrors }` so a
  test can assert a graceful save-validation error). Per-record is skipped on
  free-tier lanes (`FREE_TIER_VENDORS = google, anthropic` in the spec) because a
  whole-record sidebar run exceeds the budget on rate-limited free keys; openai + deepl
  cover it, bulk covers everyone.
- **`dropdown-actions.ts`** — the plugin's two DASHBOARD-chrome surfaces.
  `translateFieldViaDropdown` drives a field's kebab menu (`[id="field--<path>"]
  button.Dropdown__icon-trigger` → hover the "Translate to/from" group → click the
  "<Label> [<code>]" entry, or a named entry via `entryText`; pass
  `completionPattern` for flows that end in something other than the
  'Translated "…"' notice — and make it match the COMPLETION toast, not the
  immediate 'Translating …' warning). It retries opening the menu because the
  plugin's actions register only after its hidden frame boots.
  `fieldMenuEntries` opens a kebab and returns every entry's text (the built-in
  "Go to <field> field" entry is the rendered-signal) — the deterministic way
  to assert an action's absence. `runItemsDropdownTranslation` drives the
  record-list batch action ("AI Translate these records" → picker → confirm →
  progress). Multi-selection ONLY exists in the `table` collection appearance —
  flip the model via CMA in the fork first (`itemTypes.update(id,
  { collection_appearance: 'table' })`); `selectAllRecords` handles the header
  checkbox (with a retry — a click during table hydration can lose the
  selection) and waits for the batch trigger
  (`button.Dropdown__icon-trigger--reverse`). Gotcha: the picker and the confirm
  modal both expose a "Translate N records" button — `frameWithButton`'s
  `withoutText: 'Fields to translate'` filter is how the confirm frame is told
  apart from the (closing) picker frame.
- **`plugin-config.ts`** — `getPluginParams`/`setPluginParams`: the lever behind
  the surface-gating, unconfigured-provider, and broken-key tests (CMA param
  flips in the disposable fork). RULE: any test that mutates params must
  snapshot + restore in try/finally, and such tests sit at the END of the spec
  so a mid-test failure can't sabotage translation tests behind them.
- **`bulk.ts`** — `runBulkTranslation(page, { modelCode, toLocale, vendor })` drives the
  Bulk Translations page. **`modelCode` is the model's `api_key`** (matched via the
  `<code>` chip in the model dropdown). It waits for the progress modal's Close button
  to enable, then parses the report. It also captures the **Export CSV** download
  (blob → page `download` event) and detects record links, returning
  `{ total, completed, withWarnings, errors, csv, hasRecordLink, summary }`.
- **`assert-record.ts`** — CMA re-fetch assertions (`assertLocalesPopulated`,
  `assertPlaceholdersSurviveAnyField`) via `setup/cma.ts` (`cmaClient(env)`), so every
  UI outcome is double-checked against stored content.

**The stats-line contract:** `bulk.ts::parseReport` reads
`.TranslationProgressModal__progress-text` ("… of N records processed") and
`.TranslationProgressModal__stats`, whose exact text is **"X successful, Y with
warnings, Z failed"**. If you change that line in `TranslationProgressModal.tsx`, update
the `parseReport` regex in lockstep, or every bulk test silently reads zeros.

## Hard-won gotchas (read before debugging)

- **Editing-session locks outlive tests — bulk tests run FIRST in the spec.**
  Opening a record in the editor takes a lock that persists for minutes after the
  test's page closes, and any later bulk translation that CMA-saves the same
  record fails with "the record is locked because it is being edited" — the
  plugin correctly reports it, but the bulk test then fails (or worse, "passes"
  with a lock error satisfying a `errors ≥ 1` assertion that was meant to prove
  a validator failure). The spec is therefore ordered bulk-tests-first, editor
  tests after; keep it that way, and when asserting a specific failure kind,
  match on the CSV `notes` reason, not just the error count.
- **Never wait on `networkidle` against the dashboard.** It holds long-lived
  connections (websockets/long-polling) and never goes idle → a 30s timeout that fails
  `global-setup` intermittently. `dato-auth.ts` confirms auth by the URL leaving
  `/sign_in`, then waits for a bounded `load` + short settle. Same rule for any new
  dashboard navigation.
- **Stage-3 seeding is not idempotent** — see the seed section. Re-running
  `3-records.mjs` duplicates records.
- **Provider scoping via blanked keys** relies on dotenv not overriding set env vars.
- **Anthropic is a free-tier lane and can fail for non-code reasons** — e.g. an
  `HTTP 400 "credit balance is too low"`. The plugin correctly reports every record as
  failed with the reason (that's the feature), so the bulk test still passes; a lane
  that fails *all* records usually means credits/rate-limit on that key, not a bug.
  Probe a provider key directly (a one-off `fetch` to the provider) to distinguish.
- **Record editor links** need `ctx.site.attributes.internal_domain` +
  `ctx.isEnvironmentPrimary` (`buildRecordEditorUrl`) — the plugin iframe origin is not
  the admin origin.
- **Reference-copy / warned records** surface as `completed-with-warnings` and MUST
  appear in the Export CSV (`csvExport.ts` maps that status to a `warning` row). A bulk
  assertion of `csv rows === total + 1` catches a warned record being dropped.
- **Result-gated teardown can destroy a lane's env after a worker crash.** The outcome
  ledger only records tests that reached `afterEach`; if a worker process dies mid-test,
  the lane can look all-green and its env gets destroyed, losing the debug state.
  Accepted trade-off — rerun to reproduce; the age-sweep would otherwise leak envs.

## Self-healing failing tests

`npm run self-heal` launches Claude Code with the **playwright-test-healer** agent
([.claude/agents/playwright-test-healer.md](../.claude/agents/playwright-test-healer.md),
ported from `vercel-deployment-e2e-tests`): it re-runs the failing tests live
through Playwright's test MCP server ([.mcp.json](../.mcp.json)), drives the real
browser to see what the dashboard actually renders now, patches
selectors/waits in `tests/steps/`, and re-runs until green — logging every
iteration.

- **Guardrail:** the agent may repair *how* a step is located/awaited, never
  *whether* it must succeed — no skipped tests, no weakened assertions. If the
  plugin itself broke, it stops and reports a suspected real regression instead
  of forcing green. That split matters here: this suite's whole job is catching
  plugin bugs.
- **Cost scoping:** the npm script blanks `OPENAI= GEMINI= CLAUDE=` so every
  heal run forks/spends only the DeepL lane.
- **First run:** Claude prompts you to enable the `playwright-test` MCP server
  (or pre-approve it with `"enabledMcpjsonServers": ["playwright-test"]` in
  `.claude/settings.local.json` — that file is gitignored, per-machine).
- **Unattended variant** (careful — auto-approves its own edits):
  `OPENAI= GEMINI= CLAUDE= claude -p --agent playwright-test-healer --permission-mode bypassPermissions --mcp-config .mcp.json --strict-mcp-config "run and heal the failing E2E tests"`.

## Adding coverage

1. Prefer a unit test if the behavior is pure (QC checks, CSV rows, counters live in
   `src/**` with fast tests). Use E2E only for whole-flow / UI / CMA-write proof.
2. If the scenario needs data the seed lacks, extend `1-schema.mjs` + an idempotent
   top-up record script, re-run `4-verify`/`5-manifest`, commit the manifest, and apply
   to `main` (see the seed section).
3. For **provider-independent** behavior (e.g. the locale-sync reference-copy path),
   gate the new test to a single reliable lane (DeepL) instead of the whole matrix —
   it's deterministic there and avoids 3× real-provider cost.
4. Validate locally on DeepL (`--project=deepl`) before assuming the matrix is green.

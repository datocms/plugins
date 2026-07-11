# AI Translations — E2E suite guide

Browser-driven tests that exercise the plugin against a **real** DatoCMS project
(`E2E_PROJECT_ID`, currently `219952` / `ai-translation-e2e`), **real** translation
providers, and the **real** dashboard UI. This is the slow, expensive, side-effecting
tier — it forks environments, briefly toggles maintenance mode, and spends provider
credits. Unit tests (`src/**/*.test.ts`) are the fast tier; reach for E2E only to
prove a whole flow through the UI + CMA.

Companion docs: [`docs/superpowers/specs/2026-06-24-ai-translations-e2e-design.md`](../docs/superpowers/specs/2026-06-24-ai-translations-e2e-design.md)
(design + test matrix) and [`docs/superpowers/specs/2026-06-23-translation-qc-design.md`](../docs/superpowers/specs/2026-06-23-translation-qc-design.md)
(the QC feature this suite validates).

## Running

All commands run from `ai-translations/` (not `e2e/`). Playwright's `webServer`
auto-starts `npm run dev` on `localhost:5173` (`reuseExistingServer: true`).
Chromium once: `npm run install:browsers`.

```bash
npm run test:e2e            # full matrix: every provider lane × every test
npm run test:e2e:ui         # Playwright UI mode
npm run test:e2e:report     # open the last HTML report
```

**Scope a run while debugging** (the full matrix forks one env per keyed provider;
chat per-record lanes take many minutes):

```bash
# One provider lane. Blank the OTHER keys on the command line: dotenv does NOT
# override already-set process.env, so an empty value wins and PROVIDERS drops
# that lane (fixtures/providers.ts). Also forks only that provider's env.
OPENAI= GEMINI= CLAUDE= npx playwright test --project=deepl

# One test by title. NB: "-g per-record" also matches the bulk test titled
# "…per-record outcome report" — grep "bulk:" to isolate bulk tests.
OPENAI= GEMINI= CLAUDE= npx playwright test --project=deepl -g "bulk:"
```

**DeepL is the debugging lane of choice:** fast (batch API, no chat rate limits),
deterministic, and it exercises setup + bulk + per-record end to end. Prove the
harness on DeepL first, then widen to the matrix.

## Prerequisites (`.env.testing` at the package root)

Loaded by `tests/setup/env.ts` via dotenv; `requireEnv()` fails fast, naming every
missing var at once.

- **Required:** `E2E_PROJECT_CMA_TOKEN`, `E2E_DASHBOARD_EMAIL`,
  `E2E_DASHBOARD_PASSWORD`, `E2E_PROJECT_ID`, `E2E_PROJECT_SUBDOMAIN`.
- **Optional:** `E2E_DASHBOARD_TOTP_SECRET` (only if the account has 2FA), and the
  provider keys `OPENAI`, `GEMINI`, `DEEPL`, `CLAUDE` — each optional: a lane runs
  only when its key is present and non-empty.
- **One-time, not in the file:** a private dev-URL plugin pointing at
  `http://localhost:5173` (granting `currentUserAccessToken`) installed in `main`.
  `global-setup` auto-installs it if absent (`plugin-params.ts` → `resolvePluginId`);
  every fork inherits it.

## Architecture (`playwright.config.ts` + `tests/setup/`)

- **Provider matrix → Playwright projects.** `PROVIDERS` (`fixtures/providers.ts`) is
  `ALL_PROVIDERS` filtered to keyed providers. Each becomes a `project` carrying
  `{ vendor, envName }` in `metadata`, with `workers = PROVIDERS.length` — the same
  spec runs once per provider, fully parallel, each against its own forked env
  (≈1× wall-clock). Specs read their lane from `test.info().project.metadata`.
- **`global-setup.ts`** (once, headless, CMA): validate env → reset the outcome
  ledger → ensure the dev-URL plugin in `main` → sweep stale `e2e-*` envs → drop
  same-named leftovers → fast-fork one sandbox env per provider → pin each env's
  plugin params to its vendor → log in once and save `storageState`. Forking needs
  the source read-only, so maintenance mode is flipped ON around the fork and OFF in
  a `finally` — the project is never left locked.
- **`global-teardown.ts`** is **result-gated**: it destroys only the envs of lanes
  that passed; failed lanes are kept for debugging and reaped later by the age-sweep.
  The ledger is a plain file the spec appends to in `afterEach` (`setup/outcomes.ts`)
  — the Playwright JSON report isn't written until after teardown, so results can't
  be read from there.

## Environments & cleanup

- **Naming:** `e2e-<vendor>-<RUN_ID>` (`ENV_NAME_PREFIX = 'e2e-'`); `RUN_ID` is a
  unix-seconds stamp resolved once and propagated via `E2E_RUN_ID`
  (`setup/constants.ts`) — pin it (`E2E_RUN_ID=… npx playwright test`) for a
  predictable name. The suffix keeps concurrent runs from colliding; the longest
  name fits DatoCMS's env-id length cap.
- **Fork:** `environments.fork(main, {id}, {fast: true})`, then poll until
  `meta.status === 'ready'` (`setup/fork-environments.ts`).
- **Self-healing cleanup:** `sweepStaleEnvs()` (run in `global-setup`) reaps any
  `e2e-*` env older than `ENV_MAX_AGE_DAYS` (currently 1 day), so a crashed run's
  orphans disappear on the next run. To drop fresh orphans now, list `environments`
  via the CMA token and `environments.destroy` the `e2e-*` ones (always sandbox
  forks, safe to delete). Never destroy `main`.

## The seed (`e2e/seed/`) — the fork source

`main`'s schema + content is the fixture every run forks. The suite does **not**
re-seed; the seed scripts are run by hand to build/repair `main`. Full details in
[`e2e/seed/README.md`](seed/README.md). Run from `e2e/seed/` (own `package.json`,
reads `../.env.testing`):

```bash
node 1-schema.mjs            # locales + models + fields   — IDEMPOTENT (skips existing by api_key)
node 2-uploads.mjs           # assets → uploads.json        — IDEMPOTENT
node 3-records.mjs           # the core records             — NOT idempotent (duplicates on re-run)
node 3b-coverage-records.mjs # A6/A7 + A5 top-up            — idempotent
node 3c-catalog-records.mjs  # catalog_entry records (reference-copy + length-validator) — idempotent
node 4-verify.mjs            # coverage report + assertions
node 5-manifest.mjs          # writes seed-manifest.json (committed; the suite loads it)
```

**Applying a schema change to `main`:** edit `1-schema.mjs` and re-run it. Because
`3-records.mjs` is NOT idempotent, never re-run it to backfill data — write a small
idempotent top-up script (guard on an existence check, like `3b`) or update records
by id. Then re-run `4-verify.mjs` + `5-manifest.mjs` and commit the regenerated
`seed-manifest.json`.

**Schema shape:** 12 locales (`en` primary); content models `article` + `product`;
five block models. Every translatable editor appears as a localized field; a few
non-localized/numeric fields give negative coverage (must be left untouched). Ten
records (A1–A7, P1–P3) each populate two locales, leaving the rest empty for the
suite to translate into. `seed-manifest.json` lists each record's `sourceLocales` +
`emptyTargetLocales`; the suite iterates it (`steps/assert-record.ts` →
`loadManifest`, `findRecord`).

## Steps & the UI contract (`tests/steps/`)

- **`per-record.ts`** — `openRecord` → `translateRecordViaSidebar` (drives the "AI
  Translations" sidebar panel) → `saveRecord` (returns `{ status, fieldErrors }` for
  asserting a graceful save-validation error). Per-record is skipped on free-tier
  lanes (`FREE_TIER_VENDORS = google, anthropic` in the spec) — a whole-record
  sidebar run exceeds free-key rate budgets; openai + deepl cover it, bulk covers
  everyone.
- **`dropdown-actions.ts`** — the plugin's two dashboard-chrome surfaces.
  `translateFieldViaDropdown` drives a field's kebab menu (`[id="field--<path>"]
  button.Dropdown__icon-trigger` → hover "Translate to/from" → click the
  "<Label> [<code>]" entry, or a named entry via `entryText`; pass
  `completionPattern` for flows ending in something other than the 'Translated "…"'
  notice — match the COMPLETION toast, not the immediate 'Translating …' warning).
  It retries opening the menu because plugin actions register only after the hidden
  frame boots. `fieldMenuEntries` returns every kebab entry's text (the built-in
  "Go to <field> field" entry is the rendered-signal) — the deterministic way to
  assert an action's absence. `runItemsDropdownTranslation` drives the record-list
  batch action (picker → confirm → progress). Multi-selection only exists in the
  `table` collection appearance — flip the model via CMA in the fork first
  (`itemTypes.update(id, { collection_appearance: 'table' })`); `selectAllRecords`
  handles the header checkbox (with a retry — a click during table hydration can
  lose the selection) and waits for the batch trigger
  (`button.Dropdown__icon-trigger--reverse`). Gotcha: the picker and confirm modal
  both expose a "Translate N records" button — `frameWithButton`'s
  `withoutText: 'Fields to translate'` filter tells the confirm frame from the
  (closing) picker frame.
- **`plugin-config.ts`** — `getPluginParams`/`setPluginParams`: the lever behind the
  surface-gating, unconfigured-provider, and broken-key tests. RULE: any test that
  mutates params must snapshot + restore in try/finally, and such tests sit at the
  END of the spec so a mid-test failure can't sabotage the tests behind them.
- **`bulk.ts`** — `runBulkTranslation(page, { modelCode, toLocale, vendor })` drives
  the Bulk Translations page. `modelCode` is the model's **`api_key`** (matched via
  the `<code>` chip in the model dropdown). Waits for the progress modal's Close
  button to enable, parses the report, captures the Export CSV download, and returns
  `{ total, completed, withWarnings, errors, csv, hasRecordLink, summary }`.
  `startBulkRun` starts without waiting for Close — use it whenever a run is
  expected to PAUSE rather than complete (a paused run never enables Close).
- **`fault-injection.ts`** — `page.route()` interception for the reliability spec;
  host patterns per vendor live in `PROVIDER_HOST_PATTERNS` (`fixtures/providers.ts`).
- **`assert-record.ts`** — CMA re-fetch assertions (`assertLocalesPopulated`,
  `assertPlaceholdersSurviveAnyField`) via `setup/cma.ts`, so every UI outcome is
  double-checked against stored content.

**The stats-line contract:** `bulk.ts::parseReport` reads
`.TranslationProgressModal__progress-text` ("… of N records processed") and
`.TranslationProgressModal__stats`, whose exact text is **"X successful, Y with
warnings, Z failed"**. If you change that line in `TranslationProgressModal.tsx`,
update the `parseReport` regex in lockstep, or every bulk test silently reads zeros.

## Hard-won gotchas (read before debugging)

- **Editing-session locks outlive tests — bulk tests run FIRST in the spec.**
  Opening a record in the editor takes a lock that persists for minutes after the
  page closes; a later bulk CMA-save of the same record fails with "record is
  locked". Keep the bulk-first ordering, and when asserting a specific failure kind,
  match on the CSV `notes` reason, not just the error count (a lock error can
  satisfy an `errors ≥ 1` assertion meant for a validator failure).
- **Never wait on `networkidle` against the dashboard.** It holds long-lived
  connections and never goes idle → intermittent 30s timeouts. `dato-auth.ts`
  confirms auth by the URL leaving `/sign_in`, then a bounded `load` + short settle.
  Same rule for any new dashboard navigation.
- **DeepL fault injection must target the CORS proxy, not `*.deepl.com`.** DeepL is
  the only vendor routed through the DatoCMS CORS proxy
  (`cors-proxy.datocms.com/?url=<encoded url>`, see `DeepLProvider`), so
  `PROVIDER_HOST_PATTERNS.deepl` is `**/cors-proxy.datocms.com/**` — a
  `*.deepl.com` pattern silently matches nothing and every injected fault misses
  (the run translates for real and pause/content-error assertions fail). If you add
  a proxied vendor, fault its proxy host. Chat vendors go direct to their own hosts.
- **A dead provider key PAUSES the bulk run (auth is systemic); it does not fail
  every record.** The broken-key test asserts the pause panel + reason via
  `startBulkRun`, then cancels.
- **Provider scoping via blanked keys** relies on dotenv not overriding set env vars.
- **Free-tier lanes can fail for non-code reasons.** Anthropic: e.g. HTTP 400
  "credit balance is too low" — the plugin correctly reports every record failed
  with the reason, so the bulk test still passes; a lane failing *all* records
  usually means credits/rate-limit, not a bug. Google/Gemini: the un-faulted
  "bulk: produces a per-record outcome report" test can hit a REAL 429 mid-run; the
  plugin correctly PAUSES, so Close never enables and `runBulkTranslation` times
  out. Not a regression (the pause is separately asserted by
  `bulk-reliability.spec`) — re-run after the quota window resets, or probe the key
  directly with a one-off `fetch` to distinguish.
- **Record editor links** need `ctx.site.attributes.internal_domain` +
  `ctx.isEnvironmentPrimary` (`buildRecordEditorUrl`) — the plugin iframe origin is
  not the admin origin.
- **Reference-copy / warned records** surface as `completed-with-warnings` and MUST
  appear in the Export CSV (`csvExport.ts` maps that status to a `warning` row). A
  bulk assertion of `csv rows === total + 1` catches a warned record being dropped.
- **Result-gated teardown can destroy a lane's env after a worker crash.** The
  ledger only records tests that reached `afterEach`; a worker dying mid-test can
  make the lane look all-green, so its env is destroyed with the debug state.
  Accepted trade-off — rerun to reproduce.

## Self-healing failing tests

`npm run self-heal` launches Claude Code with the **playwright-test-healer** agent
([.claude/agents/playwright-test-healer.md](../.claude/agents/playwright-test-healer.md)):
it re-runs failing tests live through Playwright's test MCP server
([.mcp.json](../.mcp.json)), watches what the dashboard actually renders, patches
selectors/waits in `tests/steps/`, and re-runs until green.

- **Guardrail:** the agent may repair *how* a step is located/awaited, never
  *whether* it must succeed — no skipped tests, no weakened assertions. If the
  plugin itself broke, it stops and reports a suspected regression instead of
  forcing green (this suite's whole job is catching plugin bugs).
- **Cost scoping:** the npm script blanks `OPENAI= GEMINI= CLAUDE=`, so heal runs
  fork/spend only the DeepL lane.
- **First run:** Claude prompts to enable the `playwright-test` MCP server
  (pre-approve with `"enabledMcpjsonServers": ["playwright-test"]` in the
  gitignored `.claude/settings.local.json`).
- **Unattended variant** (auto-approves its own edits):
  `OPENAI= GEMINI= CLAUDE= claude -p --agent playwright-test-healer --permission-mode bypassPermissions --mcp-config .mcp.json --strict-mcp-config "run and heal the failing E2E tests"`.

## Adding coverage

1. Prefer a unit test if the behavior is pure (QC checks, CSV rows, counters live in
   `src/**`). Use E2E only for whole-flow / UI / CMA-write proof.
2. If the scenario needs data the seed lacks, extend `1-schema.mjs` + an idempotent
   top-up record script, re-run `4-verify`/`5-manifest`, commit the manifest, and
   apply to `main` (see the seed section).
3. For provider-independent behavior (e.g. the locale-sync reference-copy path),
   gate the new test to a single reliable lane (DeepL) instead of the whole matrix.
4. Validate locally on DeepL (`--project=deepl`) before assuming the matrix is green.

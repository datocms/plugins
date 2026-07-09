# AI Translations — End-to-End tests

Browser-driven Playwright suite that exercises the plugin's **per-record** and
**bulk** translation workflows against the real DatoCMS dashboard, across
providers (OpenAI / Google / DeepL / Anthropic) in parallel — one fast-forked
sandbox per provider **whose key is present in `.env.testing`**. See the design + plan under
`docs/superpowers/specs/` and `docs/superpowers/plans/`.

The `seed/` subfolder builds the fixture project this suite forks from; it has
its own README.

## What a run does

1. **global-setup** (`tests/setup/global-setup.ts`):
   - validates `.env.testing`,
   - ensures the dev-URL plugin is installed in `main` (auto-installs if absent),
   - reaps stale `e2e-*` environments,
   - puts the project in maintenance mode and **fast-forks** one sandbox env per
     active provider, named `e2e-<vendor>-<run-id>` (e.g. `e2e-openai-1750000000`,
     where the run id is the run's unix-seconds stamp), then takes it back out,
   - pins each env's plugin `parameters` to its vendor (env-scoped),
   - logs in once and saves the session to `.auth/state.json`.
2. **The suite** (`tests/ai-translations.spec.ts`) runs one project per active
   provider, each against its own environment, fully in parallel. Every test
   runs on every lane unless gated; provider-independent behaviour is asserted
   once on the deterministic DeepL lane. Coverage spans (see
   [`AGENTS.md`](AGENTS.md) and the coverage-status doc for the full matrix):
   - bulk translations (product/catalog/article models: outcome report + CSV,
     reference-copy + length-validator paths, empty-target proof with
     heavy-editor structure parity, partial field selection);
   - per-record sidebar flows (kitchen-sink translate + save, placeholder
     survival, non-Latin sources, pre-filled targets, QC length alerts,
     single-locale guard);
   - field dropdown actions (Translate to / from / All locales, empty-source
     guard) and the records-list batch action (picker → confirm → progress);
   - the config screen (vendor switch, Save gating) and surface gating for
     every plugin parameter (feature toggles, model/field/role exclusions,
     unconfigured and broken-key degradation);
   - dead-end states (records-less model, untranslatable model, readiness
     blockers).
3. **global-teardown** destroys each provider's env **only if its project
   passed**; failed projects' envs are left for debugging and reaped by the next
   run's stale-env sweep.

## One-time setup

### 1. Credentials in `.env.testing` (repo root)

Reused by the seed + suite:

| Var | What |
| - | - |
| `OPENAI`, `GEMINI`, `DEEPL`, `CLAUDE` | provider API keys — **all optional**; the matrix runs only providers whose key is set (missing/empty are skipped) |
| `E2E_PROJECT_CMA_TOKEN` | CMA token for the fixture project (full-access) |
| `E2E_DASHBOARD_EMAIL` / `E2E_DASHBOARD_PASSWORD` | dashboard login for the fixture project |
| `E2E_PROJECT_ID` | `219952` |
| `E2E_PROJECT_SUBDOMAIN` | `ai-translation-e2e` |
| `E2E_DASHBOARD_TOTP_SECRET` | *(optional)* only if the account has 2FA |
| `E2E_RUN_ID` | *(optional)* pins the per-run id used in forked env names; auto-generated from unix-seconds when unset (see "Per-run env names" below) |

> **Quote values containing `#`.** `dotenv` treats an unquoted `#` as the start of
> an inline comment and silently truncates the value — wrap such values in
> double quotes (e.g. `E2E_DASHBOARD_PASSWORD="…#…"`).

### 2. The dev-URL plugin

The suite drives **this branch's** build via the Vite dev server. Playwright's
`webServer` config starts `npm run dev` automatically (and reuses an
already-running one). The plugin is auto-installed in `main` on first run
(private plugin → `http://localhost:5173`, `currentUserAccessToken`); every fork
inherits it. No manual install needed.

### 3. Browsers

```bash
npm run install:browsers
```

## Running

```bash
npm run test:e2e            # every provider with a key set, parallel
npm run test:e2e -- --project=anthropic   # one provider (openai|google|deepl|anthropic)
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:report    # open the last HTML report
```

A green run self-cleans its environments; a failed run leaves them in place for
debugging (and they're reaped on the next run).

## Reading the run output

Because every provider lane runs in parallel, output is tagged so interleaved
lines stay legible. Each line is `[<tag> +<elapsed>s] message`:

- **`[setup …]` / `[teardown …]`** — the `globalSetup`/`globalTeardown` phases
  (validate env → install plugin → sweep → fork each env → pin each env's model →
  log in; and on teardown, which envs were destroyed/kept). The slow bits
  (forking, login) now report progress, so a stuck run shows *where* it stuck.
- **`[e2e-<vendor> …]`** — per-environment fork progress (`forking… 40%`, `ready ✓`).
- **`[<vendor> …]`** — per-lane test progress. A `▶` line is a `test.step` starting;
  the matching duration prints when it finishes. Long waits (`waiting … up to 10
  min`) emit a breadcrumb *before* the wait so the lane never looks hung.

Each lane's resolved model is logged at setup (`[anthropic …] configured
e2e-anthropic-1750000000 → claude-haiku-4-5-…`), so you can see exactly what each
provider ran. The opening `[setup …] run <id> — …` line prints the run id, so you
can tell which forked envs are yours.

The same milestones are recorded as named, timed **`test.step`s**, so they also
show up in the HTML report, the trace viewer (`test:e2e:report`), and UI mode
(`test:e2e:ui`) — the best place to see *where* a failed lane broke.

## Implementation notes / gotchas

- **Plugins are environment-scoped.** Forking copies the plugin *and its
  parameters*, so each env carries its own provider config — which is what makes
  the parallel per-provider matrix safe. `main`'s params stay neutral.
- **Local Network Access + mixed content.** The plugin iframe is
  `http://localhost:5173` inside the `https` admin and is a "local network"
  resource; headless Chromium blocks both. The config passes
  `--allow-running-insecure-content`, `--disable-features=LocalNetworkAccessChecks`
  and `ignoreHTTPSErrors`. Without them the plugin never loads
  (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`).
- **Wide viewport required.** The record's right sidebar (the AI Translations
  panel) auto-collapses when narrow, so each project overrides the
  `devices['Desktop Chrome']` 1280px viewport to 2000×1200.
- **Project metadata, not `use`.** Each project's `{ vendor, envName }` lives in
  project-level `metadata` (read via `test.info().project.metadata`), *not* under
  `use` — nesting it under `use` leaves it `undefined` and navigation falls back
  to `main`.
- **Per-run env names + concurrency.** Each run's envs are named
  `e2e-<vendor>-<unix-seconds>`, so multiple developers (or CI jobs) can run the
  suite at the same time without their forked envs colliding. Playwright
  re-imports the config in every worker process, so the run stamp can't be
  recomputed per process — it would diverge between the forked env and the name a
  worker navigates to. Instead the first process stamps it into the `E2E_RUN_ID`
  env var (constants.ts) and the workers Playwright forks afterwards inherit it;
  set `E2E_RUN_ID` yourself to pin a run. Orphaned envs from a crashed run no
  longer collide with a later run, so they're reclaimed by the next run's
  age-based stale-env sweep — which reads each env's server-side `created_at`
  (older than `ENV_MAX_AGE_DAYS`), so it works for any run-id shape — rather than
  by same-name replacement. The one residual collision is two runs starting in the
  *same* wall-clock second — vanishingly rare for human-initiated runs.
- **Free-tier rate limits (Gemini, Claude).** The per-record sidebar makes one
  provider call per field, sequentially; free-tier Gemini and the free-plan Claude
  key rate-limit hard enough that a whole record blows the budget. The two
  per-record tests are therefore skipped for `google` and `anthropic` (openai +
  deepl cover per-record; bulk covers every provider). With a paid key, drop the
  vendor from `FREE_TIER_VENDORS` in the spec to re-enable.
- **Heavy editors: DeepL lane only.** `structured_text` and `rich_text` are
  dropped from the CHAT lanes' translated field set (`plugin-params.ts`) — each
  expands into many sequential calls that rate-limited free tiers can't afford.
  The DeepL lane keeps EVERY editor (its batch API absorbs the fan-out), so
  heavy-editor behaviour is proven end-to-end there.
- **Per-record vs bulk scope.** The sidebar translates among a record's *active*
  locales (writes to the form → the suite saves, then asserts via CMA). The bulk
  page is CMA-based and fills any target locale.
- **Record locks.** A record opened by a stale session shows "Take over"; the
  suite handles it. Saves assert the record-update PUT status, retrying once on a
  transient `ITEM_LOCKED`.

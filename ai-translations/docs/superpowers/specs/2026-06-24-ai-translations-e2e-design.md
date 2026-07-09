# AI Translations — End-to-End test suite (design)

**Status:** approved (2026-06-24)
**Branch:** `feature/translation-qc`
**Companion:** [translation QC design](./2026-06-23-translation-qc-design.md) — the feature this suite validates
**Driver:** [Basecamp card #10030318843](https://3.basecamp.com/5656352/buckets/33592869/card_tables/cards/10030318843) — "AI Translation bugs & user-facing warnings"

## 1. Goal

Validate the AI Translations plugin end-to-end against a **real** DatoCMS project,
real translation providers, and the real dashboard UI — proving the
`feature/translation-qc` work satisfies the Basecamp card:

1. Field validation errors on save are handled gracefully (not silent truncation).
2. Single-quote / placeholder tokens survive translation.
3. The post-response QC layer surfaces user-facing warnings & errors.
4. Heuristic "looks broken" checks (e.g. length-ratio) warn without blocking.
5. Bulk translation produces a per-record report of what failed and why.

The suite mirrors the **workflow** of `~/sites/vercel-deployment-e2e-tests` (the
DatoCMS part): Playwright harness, timestamp-named ephemeral resources, async
provisioning with polling, and prefix-based idempotent cleanup.

## 2. Key facts that shaped the design

- **Two plugin workflows, different surfaces.** The per-record sidebar flow
  (`translateRecordFields`) is UI-coupled — it writes through `ctx.setFieldValue`
  inside the dashboard iframe. The bulk flow (`buildTranslatedUpdatePayload`) is
  CMA-native. Both collect QC findings via an `onQcFlag` sink. Because the
  per-record flow only exists inside the UI, the suite is **browser-driven**.
- **Provider is config-time.** The plugin stores a single active
  `vendor` (`openai|google|anthropic|deepl`) plus per-vendor keys/models in the
  plugin's `parameters`. The bulk page's "models" are DatoCMS *content models*,
  not LLM models. Selecting a provider therefore means writing `parameters`, not
  a per-translation toggle.
- **Plugins are environment-scoped schema.** Forking an environment copies the
  plugin *and its `parameters`*; updating params in one env does not affect
  another. This is what makes a parallel per-provider matrix safe: each forked
  env carries its own config copy, with zero write contention, and shows exactly
  one `AI Translations` panel (no install/label disambiguation needed).
- **The seed is purpose-built for the assertions.** `e2e/seed/` already builds 12
  locales, a model covering every translatable editor, and 10 permuted records.
  A5/A6/A7 each target a specific QC path; the suite asserts against
  `e2e/seed/seed-manifest.json`.

## 3. Architecture

Playwright is the harness. Config lives at the repo root (the existing
`e2e/tsconfig.json` already expects `../playwright.config.ts`).

```
ai-translations/
  playwright.config.ts                 # root: webServer→`npm run dev`, 3 projects, workers:3
  e2e/
    seed/                              # EXISTING — the fork source; untouched by the suite
    tests/
      ai-translations.spec.ts         # provider-agnostic suite (replaces example.spec.ts)
      setup/
        env.ts                        # requireEnv(): single source of truth + typed bag
        constants.ts                  # TIMESTAMP, ENV_NAME_PREFIX="e2e-", PROVIDERS, TIMEOUTS, PROJECT_ID/SUBDOMAIN
        global-setup.ts               # validate env → maintenance-mode fast-fork ×3 → set per-env params → save storageState
        fork-environments.ts          # maintenance mode + fast fork + poll-until-ready (CMA)
        plugin-params.ts              # per-env `plugins.update(parameters)` for a given vendor (CMA)
        cleanup.ts                    # delete THIS run's envs on success; prefix age-sweep
        cma.ts                        # buildClient helpers scoped per environment
      steps/
        dato-auth.ts                  # dashboard login + TOTP (otplib) → storageState
        per-record.ts                 # open record in env → AI Translations sidebar → run → progress modal
        bulk.ts                       # open Bulk Translations page → select models/locales → run → report
        assert-record.ts             # CMA re-fetch + structural/content assertions
      fixtures/
        providers.ts                  # the openai/google/deepl matrix (vendor, key env, default model, env suffix)
```

### 3.1 Provider matrix → Playwright projects

`playwright.config.ts` defines three `projects`, one per provider, each carrying
its context in `use.metadata` (or a typed fixture): `{ vendor, envName, modelLabel }`.
`workers: 3`, projects fully parallel. The single spec reads its provider from the
project metadata, so the **same tests run three times concurrently**, each against
its own forked env. The full per-record + bulk set runs on **all three** providers
(parallelism makes this ~1× wall-clock, not 3×).

### 3.2 One-time setup (documented, not per-run)

The dev-URL private plugin is installed **once** in `main` (dashboard → Plugins →
private plugin pointing at `http://localhost:5173`, granting
`currentUserAccessToken`), with neutral params. Every fork inherits it. Documented
in `e2e/README.md`; the suite does not install plugins per run.

## 4. Data flow (per run)

1. **global-setup (CMA, headless):**
   - `requireEnv()` — fail fast on every missing var at once.
   - Activate **maintenance mode** (`force: true`) → project read-only.
   - **Fast-fork** three envs in parallel from `main`:
     `e2e-<ts>-openai`, `e2e-<ts>-google`, `e2e-<ts>-deepl` (`fork(main, {id}, {fast:true})`).
   - Poll each until `meta.status === 'ready'`.
   - **`finally`: deactivate maintenance mode** — always, even if a fork throws,
     so the project can never be left locked.
   - For each env, `plugins.update(parameters)` **scoped to that env** to pin its
     vendor + API key (from `.env.testing`) + default model + enable
     `translateWholeRecord` / `translateBulkRecords`.
   - Reap stale `e2e-*` envs older than the cutoff (idempotent self-heal).
   - Browser login once (email/password + TOTP) → persist `storageState`.
2. **Tests (browser, ×3 parallel):** each project navigates to
   `https://<subdomain>.admin.datocms.com/environments/<its-env>/editor/...`,
   reusing the saved session, and exercises per-record then bulk flows.
3. **teardown:** on a green project, `environments.destroy(<its-env>)`; on failure,
   leave it for debugging (reaped later by the age-sweep). All via the CMA token —
   no account token required.

## 5. Test matrix & QC assertion targets

Per provider, iterating `e2e/seed/seed-manifest.json`:

| Flow | Record | Card objective → assertion |
| - | - | - |
| Per-record sidebar | A1 kitchen-sink | every empty target locale populated; block structure + non-localized/numeric fields untouched (CMA re-fetch) |
| Per-record sidebar | A5 torture | `placeholder-loss` survives (tokens byte-identical across locales); `length-ratio`/`truncated` warning shown in progress modal; **over-limit SEO → graceful save-validation error**, surfaced, not silently truncated |
| Per-record sidebar | A6 RTL/CJK | hyphenated source drives the `from-to` action-id splitter; block-only structured text + mixed empty/filled blocks complete; RTL/CJK output written |
| Per-record sidebar | A7 pre-filled ru | overwrite-vs-preserve branch behaves as configured; placeholder in JSON field survives |
| Bulk page | article + product, all locales | bulk **report** lists per-record outcome incl. `completed-with-warnings` + reasons; the validation-error record is **reported, not dropped** |

**Dual assertion** for each: (a) **UI** — the progress modal / bulk report shows the
expected warning state (the card's "user-facing warnings"); (b) **CMA** — re-fetch
the record from the forked env and verify field contents/structure.

Provider nuance (expected, asserted as such): DeepL is immune to the multi-block
array crop and lacks the chat-vendor placeholder/HTML failure modes, so it exercises
the happy path more; OpenAI/Gemini are where the defect-path warnings fire.

## 6. Error handling & idempotency

- **Fail-fast env validation** in global-setup (report all missing vars at once).
- **Bounded waits:** fork/poll get explicit multi-minute timeouts; everything else
  is the 30s Playwright default.
- **Maintenance mode** is always deactivated in a `finally`.
- **Idempotent cleanup:** envs are named `e2e-<ts>-<vendor>`; a green project deletes
  its own by exact name; an age-sweep reaps `e2e-*` older than N days so failed
  runs self-heal. No account token — all via the CMA token.

## 7. Environment variables (`.env.testing`)

Reused: `OPENAI`, `GEMINI`, `DEEPL`, `E2E_PROJECT_CMA_TOKEN`.

Added:
- `E2E_DASHBOARD_EMAIL`, `E2E_DASHBOARD_PASSWORD` — dashboard login.
- `E2E_DASHBOARD_TOTP_SECRET` — only if the account has 2FA enabled.
- `E2E_PROJECT_ID=219952`, `E2E_PROJECT_SUBDOMAIN=ai-translation-e2e`.

No plugin-id var: one install in `main`, inherited by every fork.

## 8. Tooling

Add to root `package.json` devDependencies: `@playwright/test`, `dotenv`, `otplib`,
`tsx`. (`@datocms/cma-client-node` lives in `e2e/seed`; the suite either reuses it or
adds it at the e2e level.) Scripts: `test:e2e`, `test:e2e:ui`, `test:e2e:report`,
`install:browsers`. Playwright `webServer` auto-starts `npm run dev` and waits for
`localhost:5173` so the dev-URL plugin is live during the run.

## 9. Out of scope (v1)

- GitHub Actions CI wiring (cleanup age-sweep is written to support a future cron;
  no workflow yaml yet).
- The Anthropic provider (no key in `.env.testing`). [Update: an Anthropic lane was added after this design; it runs when a CLAUDE key is present.]
- Per-run Slack failure summary.
- Automated plugin install (one-time manual install in `main`, documented).

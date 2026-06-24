# AI Translations — End-to-End tests

Browser-driven Playwright suite that exercises the plugin's **per-record** and
**bulk** translation workflows against the real DatoCMS dashboard, across three
providers (OpenAI / Google / DeepL) in parallel — one fast-forked sandbox
environment per provider. See the design + plan under
`docs/superpowers/specs/` and `docs/superpowers/plans/`.

The `seed/` subfolder builds the fixture project this suite forks from; it has
its own README.

## What a run does

1. **global-setup** (`tests/setup/global-setup.ts`):
   - validates `.env.testing`,
   - ensures the dev-URL plugin is installed in `main` (auto-installs if absent),
   - reaps stale `e2e-*` environments,
   - puts the project in maintenance mode and **fast-forks** three sandbox envs
     (`e2e-openai`, `e2e-google`, `e2e-deepl`), then takes it back out,
   - pins each env's plugin `parameters` to its vendor (env-scoped),
   - logs in once and saves the session to `.auth/state.json`.
2. **The suite** (`tests/ai-translations.spec.ts`) runs three tests per provider,
   each project against its own environment, fully in parallel:
   - per-record sidebar translation of a kitchen-sink record (translate + save),
   - per-record placeholder survival / graceful save-error handling,
   - bulk translation with a per-record outcome report.
3. **global-teardown** destroys each provider's env **only if its project
   passed**; failed projects' envs are left for debugging and reaped by the next
   run's stale-env sweep.

## One-time setup

### 1. Credentials in `.env.testing` (repo root)

Reused by the seed + suite:

| Var | What |
| - | - |
| `OPENAI`, `GEMINI`, `DEEPL` | provider API keys |
| `E2E_PROJECT_CMA_TOKEN` | CMA token for the fixture project (full-access) |
| `E2E_DASHBOARD_EMAIL` / `E2E_DASHBOARD_PASSWORD` | dashboard login for the fixture project |
| `E2E_PROJECT_ID` | `219952` |
| `E2E_PROJECT_SUBDOMAIN` | `ai-translation-e2e` |
| `E2E_DASHBOARD_TOTP_SECRET` | *(optional)* only if the account has 2FA |

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
npm run test:e2e            # all three providers, parallel
npm run test:e2e -- --project=openai   # one provider
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:report    # open the last HTML report
```

A green run self-cleans its environments; a failed run leaves them in place for
debugging (and they're reaped on the next run).

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
- **Fixed env names.** Playwright re-imports the config per worker, so a
  timestamped name would diverge between the forked env and the name a worker
  navigates to. Names are fixed (`e2e-<vendor>`); `dropEnvsIfPresent` handles
  idempotency.
- **Gemini free-tier rate limits.** The per-record sidebar makes one provider
  call per field, sequentially; Gemini's free tier rate-limits hard enough that a
  whole record blows the budget. The two per-record tests are therefore skipped
  for `google` (openai + deepl cover per-record; bulk covers all three). Supply a
  paid Gemini key and delete the `skipPerRecordOnGoogle()` guard to re-enable.
- **Heavy editors excluded.** `structured_text` and `rich_text` are dropped from
  the translated field set (`plugin-params.ts`) — each expands into many
  sequential calls. The retained editors still cover the QC paths (placeholders
  in json/text/markdown, slug, SEO).
- **Per-record vs bulk scope.** The sidebar translates among a record's *active*
  locales (writes to the form → the suite saves, then asserts via CMA). The bulk
  page is CMA-based and fills any target locale.
- **Record locks.** A record opened by a stale session shows "Take over"; the
  suite handles it. Saves assert the record-update PUT status, retrying once on a
  transient `ITEM_LOCKED`.

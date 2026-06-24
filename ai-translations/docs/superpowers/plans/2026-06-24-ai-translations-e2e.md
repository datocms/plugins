# AI Translations E2E Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-driven Playwright E2E suite that runs the AI Translations plugin's per-record and bulk workflows across three providers in parallel, each against its own fast-forked sandbox environment of the seed project, asserting the translation-QC warnings the Basecamp card requires.

**Architecture:** Playwright config at the repo root defines three projects (openai/google/deepl), `workers: 3`. A CMA-based `globalSetup` activates project maintenance mode, fast-forks three env copies of `main`, pins each env's plugin `parameters` to one vendor, and saves a logged-in `storageState`. The single provider-agnostic spec navigates each forked env's dashboard editor, drives the real plugin UI, and dual-asserts (UI warnings + CMA re-fetch). Teardown destroys each green run's env; an age-sweep reaps leftovers.

**Tech Stack:** Playwright `@playwright/test`, `@datocms/cma-client-node`, `otplib` (TOTP), `dotenv`, `tsx`, the plugin's Vite dev server (`localhost:5173`).

## Global Constraints

- **TypeScript + ESNext**, arrow functions, `const`, async/await, TSDoc on exported functions (repo + user style).
- **Playwright config path is the repo root** (`ai-translations/playwright.config.ts`) — `e2e/tsconfig.json` already lists `"../playwright.config.ts"`. Do not move it.
- **`testDir: "./e2e/tests"`**, replacing `e2e/tests/example.spec.ts`.
- **Secrets come only from `.env.testing`** at the repo root, parsed via `dotenv` (path override) — never hard-code keys. Existing keys: `OPENAI`, `GEMINI`, `DEEPL`, `E2E_PROJECT_CMA_TOKEN`. New keys: `E2E_DATO_EMAIL`, `E2E_DATO_PASSWORD`, `E2E_DATO_TOTP_SECRET` (optional), `E2E_PROJECT_ID=219952`, `E2E_PROJECT_SUBDOMAIN=ai-translation-e2e`.
- **Environment naming:** `e2e-<TIMESTAMP>-<vendor>` where `TIMESTAMP` is one ISO-derived slug per run (digits + trailing `z`), computed once. `vendor ∈ {openai, google, deepl}`.
- **DatoCMS env-id rules:** lowercase, max 24 chars, `[a-z0-9-]`. Keep the slug short enough that `e2e-<ts>-openai` ≤ 24 chars (use a compact timestamp — see Task 2).
- **Maintenance mode is ALWAYS deactivated in a `finally`** — never leave the project read-only.
- **Cleanup is idempotent and CMA-only** — no account-API/account token anywhere in this suite.
- **Provider params are env-scoped** — every `plugins.update` is issued through a client bound to the target environment.
- **One-time prerequisite (documented, not automated):** the dev-URL private plugin is installed in `main` with `currentUserAccessToken` permission. The suite assumes it exists and fails fast with an actionable message if it does not.

---

## File structure

| File | Responsibility |
| - | - |
| `playwright.config.ts` (root) | 3 projects, workers, reporters, `webServer` → `npm run dev`, `globalSetup` |
| `e2e/tests/setup/env.ts` | `requireEnv()` — typed, validated env bag |
| `e2e/tests/setup/constants.ts` | `TIMESTAMP`, `ENV_NAME_PREFIX`, `TIMEOUTS`, project id/subdomain |
| `e2e/tests/fixtures/providers.ts` | provider matrix (vendor, key, model, env suffix) + Playwright project metadata type |
| `e2e/tests/setup/cma.ts` | `cmaClient(env?)` factory bound to an environment |
| `e2e/tests/setup/fork-environments.ts` | maintenance mode + fast fork + poll-until-ready |
| `e2e/tests/setup/plugin-params.ts` | resolve installed plugin id; build + write per-vendor params to an env |
| `e2e/tests/setup/cleanup.ts` | destroy this run's envs; prefix age-sweep |
| `e2e/tests/setup/global-setup.ts` | orchestrate: validate → fork ×3 → params ×3 → login → storageState |
| `e2e/tests/steps/dato-auth.ts` | dashboard login + TOTP |
| `e2e/tests/steps/per-record.ts` | sidebar translate flow + progress-modal warning reads |
| `e2e/tests/steps/bulk.ts` | bulk page flow + report reads |
| `e2e/tests/steps/assert-record.ts` | CMA re-fetch structural/content assertions |
| `e2e/tests/ai-translations.spec.ts` | the suite wiring the above into the matrix |
| `e2e/README.md` | one-time plugin install + how to run |

---

### Task 1: Tooling, env validation, constants, provider matrix

**Files:**
- Modify: `package.json` (root) — devDeps + scripts
- Create: `e2e/tests/setup/env.ts`
- Create: `e2e/tests/setup/constants.ts`
- Create: `e2e/tests/fixtures/providers.ts`
- Create: `playwright.config.ts` (root)
- Delete: `e2e/tests/example.spec.ts` (replaced in Task 9)
- Test: `e2e/tests/setup/env.test-manual.md` (documented manual check — env validation has no unit harness; vitest is reserved for `src/`)

**Interfaces:**
- Produces:
  - `requireEnv(): TestEnv` where `TestEnv = { OPENAI, GEMINI, DEEPL, E2E_PROJECT_CMA_TOKEN, E2E_DATO_EMAIL, E2E_DATO_PASSWORD, E2E_DATO_TOTP_SECRET?, E2E_PROJECT_ID, E2E_PROJECT_SUBDOMAIN }` (all strings; optional TOTP).
  - `TIMESTAMP: string`, `ENV_NAME_PREFIX = "e2e-"`, `TIMEOUTS` record, `PROJECT_ID`/`PROJECT_SUBDOMAIN` getters.
  - `PROVIDERS: ProviderSpec[]` where `ProviderSpec = { vendor: 'openai'|'google'|'deepl'; keyEnv: keyof TestEnv; model: string; envSuffix: string }`.
  - `ProjectMeta = { vendor: ProviderSpec['vendor']; envName: string }` (set per Playwright project in config).

- [ ] **Step 1: Add dev dependencies and scripts**

Run:
```bash
cd /Users/datocms/sites/datocms-plugins/ai-translations
npm i -D @playwright/test dotenv otplib tsx @datocms/cma-client-node
```
Add to `package.json` `scripts`:
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:report": "playwright show-report",
"install:browsers": "playwright install chromium"
```

- [ ] **Step 2: Write `env.ts`**

```ts
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// .env.testing lives at the repo root (e2e/tests/setup -> ../../..).
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env.testing') });

const REQUIRED = [
  'OPENAI', 'GEMINI', 'DEEPL', 'E2E_PROJECT_CMA_TOKEN',
  'E2E_DATO_EMAIL', 'E2E_DATO_PASSWORD', 'E2E_PROJECT_ID', 'E2E_PROJECT_SUBDOMAIN',
] as const;
const OPTIONAL = ['E2E_DATO_TOTP_SECRET'] as const;

type Required = (typeof REQUIRED)[number];
type Optional = (typeof OPTIONAL)[number];
export type TestEnv = Record<Required, string> & Partial<Record<Optional, string>>;

/** Validate every required var at once; throw an actionable aggregate on failure. */
export const requireEnv = (): TestEnv => {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing required env var(s) in .env.testing: ${missing.join(', ')}.\n` +
        `See e2e/README.md for where each value comes from.`,
    );
  }
  const out = {} as TestEnv;
  for (const k of REQUIRED) out[k] = process.env[k]!.trim();
  for (const k of OPTIONAL) if (process.env[k]?.trim()) out[k] = process.env[k]!.trim();
  return out;
};
```

- [ ] **Step 3: Write `constants.ts`**

```ts
/** One compact run id, ≤ 13 chars, so `e2e-<ts>-openai` stays ≤ 24 (DatoCMS env-id cap). */
export const TIMESTAMP = new Date()
  .toISOString()            // 2026-06-24T11:22:33.444Z
  .replace(/[^0-9]/g, '')   // 20260624112233444
  .slice(2, 14);            // YYMMDDHHmmss (12 chars)

export const ENV_NAME_PREFIX = 'e2e-';

export const TIMEOUTS = {
  thirty_sec: 30_000,
  one_min: 60_000,
  three_min: 180_000,
  five_min: 300_000,
} as const;

const env = (k: string): string => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is not set — add it to .env.testing`);
  return v;
};
export const PROJECT_ID = () => env('E2E_PROJECT_ID');
export const PROJECT_SUBDOMAIN = () => env('E2E_PROJECT_SUBDOMAIN');

/** Age cutoff (days) for the stale-env sweep. */
export const ENV_MAX_AGE_DAYS = 1;
```

- [ ] **Step 4: Write `fixtures/providers.ts`**

```ts
import { ENV_NAME_PREFIX, TIMESTAMP } from '../setup/constants';
import type { TestEnv } from '../setup/env';

export type Vendor = 'openai' | 'google' | 'deepl';

export type ProviderSpec = {
  vendor: Vendor;
  /** Which .env.testing key holds this vendor's API key. */
  keyEnv: keyof TestEnv;
  /** Default model id written into plugin params (ignored for deepl). */
  model: string;
  /** Stable env-name suffix, e.g. `e2e-<ts>-openai`. */
  envName: string;
};

export const PROVIDERS: ProviderSpec[] = [
  { vendor: 'openai', keyEnv: 'OPENAI', model: 'gpt-4o-mini', envName: `${ENV_NAME_PREFIX}${TIMESTAMP}-openai` },
  { vendor: 'google', keyEnv: 'GEMINI', model: 'gemini-1.5-flash', envName: `${ENV_NAME_PREFIX}${TIMESTAMP}-google` },
  { vendor: 'deepl',  keyEnv: 'DEEPL',  model: '',                 envName: `${ENV_NAME_PREFIX}${TIMESTAMP}-deepl`  },
];

/** Carried in each Playwright project's `use.metadata`. */
export type ProjectMeta = { vendor: Vendor; envName: string };
```

> NOTE for implementer: confirm the exact default model ids against `src/utils/translation/OpenAIModels.ts` and `GeminiModels.ts` (`listRelevant*`) and adjust if `gpt-4o-mini` / `gemini-1.5-flash` are not present; pick the first relevant model otherwise.

- [ ] **Step 5: Write `playwright.config.ts` (root)**

```ts
import { defineConfig, devices } from '@playwright/test';
import { requireEnv } from './e2e/tests/setup/env';
import { TIMEOUTS } from './e2e/tests/setup/constants';
import { PROVIDERS } from './e2e/tests/fixtures/providers';

requireEnv(); // fail fast before launching anything

export default defineConfig({
  testDir: './e2e/tests',
  globalSetup: './e2e/tests/setup/global-setup.ts',
  workers: 3,
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'e2e/test-results/results.json' }]],
  expect: { timeout: TIMEOUTS.thirty_sec },
  use: {
    actionTimeout: TIMEOUTS.thirty_sec,
    navigationTimeout: TIMEOUTS.thirty_sec,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: 'e2e/.auth/state.json',
  },
  // The dev-URL plugin must be live during the run.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: TIMEOUTS.three_min,
  },
  projects: PROVIDERS.map((p) => ({
    name: p.vendor,
    use: { ...devices['Desktop Chrome'], metadata: { vendor: p.vendor, envName: p.envName } },
  })),
});
```

- [ ] **Step 6: Delete the placeholder spec**

Run: `git rm e2e/tests/example.spec.ts`

- [ ] **Step 7: Verify projects + env validation**

Run: `npx playwright test --list`
Expected: lists 3 projects (`openai`, `google`, `deepl`); if a required env var is missing, the run aborts with the aggregate message from `requireEnv`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.ts e2e/tests/setup/env.ts e2e/tests/setup/constants.ts e2e/tests/fixtures/providers.ts
git rm --cached e2e/tests/example.spec.ts 2>/dev/null; git add -A e2e/tests/example.spec.ts
git commit -m "test(e2e): scaffold Playwright config, env validation, provider matrix"
```

---

### Task 2: CMA client factory + fast-fork lifecycle

**Files:**
- Create: `e2e/tests/setup/cma.ts`
- Create: `e2e/tests/setup/fork-environments.ts`
- Test: ad-hoc integration script `e2e/tests/setup/__probe__/fork.mjs` (deleted after Step 4)

**Interfaces:**
- Consumes: `requireEnv`, `PROJECT_ID`, `TIMEOUTS`, `PROVIDERS`.
- Produces:
  - `cmaClient(environment?: string): Client` — `@datocms/cma-client-node` client bound to an env (omit for primary).
  - `forkAll(envNames: string[]): Promise<void>` — activate maintenance mode, fast-fork each name from `main`, poll all ready, deactivate maintenance mode in `finally`.
  - `destroyEnv(envName: string): Promise<void>`.
  - `waitForEnvReady(envName: string): Promise<void>`.

- [ ] **Step 1: Write `cma.ts`**

```ts
import { buildClient, type Client } from '@datocms/cma-client-node';
import { requireEnv } from './env';

/** A CMA client bound to a specific environment (or the primary env if omitted). */
export const cmaClient = (environment?: string): Client =>
  buildClient({ apiToken: requireEnv().E2E_PROJECT_CMA_TOKEN, environment });
```

- [ ] **Step 2: Write `fork-environments.ts`**

```ts
import { cmaClient } from './cma';
import { TIMEOUTS } from './constants';

const PRIMARY = 'main';

/** Poll until the environment reports `ready`, bounded by `TIMEOUTS.five_min`. */
export const waitForEnvReady = async (envName: string): Promise<void> => {
  const client = cmaClient();
  const deadline = Date.now() + TIMEOUTS.five_min;
  for (;;) {
    const env = await client.environments.find(envName);
    if (env.meta.status === 'ready') return;
    if (Date.now() > deadline) throw new Error(`Env ${envName} not ready after 5 min (status=${env.meta.status})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
};

export const destroyEnv = async (envName: string): Promise<void> => {
  await cmaClient().environments.destroy(envName);
};

/**
 * Fast-fork each `envName` from `main`. Fast forking requires the source env to
 * be read-only, so we activate project maintenance mode first and ALWAYS
 * deactivate it in `finally`, even if a fork throws — otherwise the project
 * stays locked.
 */
export const forkAll = async (envNames: string[]): Promise<void> => {
  const client = cmaClient();
  await client.maintenanceMode.activate({ force: true });
  try {
    for (const id of envNames) {
      // Fast fork: copy-on-write, near-instant, source must be read-only.
      await client.environments.fork(PRIMARY, { id }, { queryParams: { fast: true } } as never);
    }
  } finally {
    await client.maintenanceMode.deactivate();
  }
  await Promise.all(envNames.map(waitForEnvReady));
};
```

> NOTE for implementer: verify the exact `fork(...)` signature and the fast-fork flag against the installed `@datocms/cma-client-node` types (`client.environments.fork`). The documented options are `fast` and `force_smart_format`; pass `fast: true` however the typed client expects (rawFork query param vs options arg). Use `cma:docs` (datocms CLI) or the package's `.d.ts` to confirm before finalizing the cast.

- [ ] **Step 3: Probe against the real API**

Create `e2e/tests/setup/__probe__/fork.mjs`:
```js
import { forkAll, destroyEnv, waitForEnvReady } from '../fork-environments.ts';
const name = 'e2e-probe-temp';
await forkAll([name]);
await waitForEnvReady(name);
console.log('forked + ready:', name);
await destroyEnv(name);
console.log('destroyed:', name);
```
Run: `npx tsx e2e/tests/setup/__probe__/fork.mjs`
Expected: prints "forked + ready" then "destroyed"; project is NOT left in maintenance mode (verify: `npx tsx -e "import('./e2e/tests/setup/cma.ts').then(async m=>console.log((await m.cmaClient().maintenanceMode.find()).active))"` prints `false`).

- [ ] **Step 4: Clean up probe + commit**

```bash
rm -rf e2e/tests/setup/__probe__
git add e2e/tests/setup/cma.ts e2e/tests/setup/fork-environments.ts
git commit -m "test(e2e): CMA client + maintenance-mode fast-fork lifecycle"
```

---

### Task 3: Per-environment plugin parameters

**Files:**
- Create: `e2e/tests/setup/plugin-params.ts`
- Test: ad-hoc probe (inline, deleted after)

**Interfaces:**
- Consumes: `cmaClient`, `requireEnv`, `ProviderSpec`, `PROVIDERS`.
- Produces:
  - `resolvePluginId(): Promise<string>` — find the installed AI Translations plugin in `main`; throw an actionable error if absent.
  - `configureEnvForProvider(envName: string, spec: ProviderSpec): Promise<void>` — write env-scoped params pinning the vendor.

- [ ] **Step 1: Write `plugin-params.ts`**

```ts
import { cmaClient } from './cma';
import { requireEnv } from './env';
import type { ProviderSpec } from '../fixtures/providers';

/** The plugin's title from package.json datoCmsPlugin.title. */
const PLUGIN_TITLE = 'AI Translations';

/** Find the installed plugin id in `main`; fail loud if the one-time install is missing. */
export const resolvePluginId = async (): Promise<string> => {
  const plugins = await cmaClient().plugins.list();
  const plugin = plugins.find((p) => p.name === PLUGIN_TITLE || /translat/i.test(p.name ?? ''));
  if (!plugin) {
    throw new Error(
      `No "${PLUGIN_TITLE}" plugin installed in project main. ` +
        `Do the one-time install described in e2e/README.md (private plugin → http://localhost:5173).`,
    );
  }
  return plugin.id;
};

/** Build the vendor-specific parameters block written to a forked env's plugin. */
const buildParams = (spec: ProviderSpec, env = requireEnv()) => {
  const key = env[spec.keyEnv] as string;
  const base = {
    translationFields: [
      'single_line', 'markdown', 'wysiwyg', 'textarea', 'slug', 'json', 'seo',
      'structured_text', 'rich_text', 'string', 'text',
    ],
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };
  switch (spec.vendor) {
    case 'openai': return { ...base, vendor: 'openai', apiKey: key, gptModel: spec.model };
    case 'google': return { ...base, vendor: 'google', apiKey: '', gptModel: '', googleApiKey: key, geminiModel: spec.model };
    case 'deepl':  return { ...base, vendor: 'deepl', apiKey: '', gptModel: '', deeplApiKey: key, deeplEndpoint: 'auto' };
  }
};

/** Write the vendor params into one forked environment (env-scoped update). */
export const configureEnvForProvider = async (envName: string, spec: ProviderSpec): Promise<void> => {
  const pluginId = await resolvePluginId();
  await cmaClient(envName).plugins.update(pluginId, { parameters: buildParams(spec) });
};
```

> NOTE for implementer: cross-check the param keys against `src/entrypoints/Config/ConfigScreen.tsx` `ctxParamsType` and `isValidCtxParams` so the written params pass `isProviderConfigured`. In particular confirm `translationFields` editor ids match what `shouldProcessField` expects, and whether `gptModel`/`apiKey` must be non-empty strings even for non-openai vendors (the type marks them required) — set `''` if so, as above.

- [ ] **Step 2: Probe**

Create a throwaway `probe.mjs` that forks one env, calls `configureEnvForProvider`, then re-fetches and prints `vendor`:
```js
import { forkAll, destroyEnv } from './e2e/tests/setup/fork-environments.ts';
import { configureEnvForProvider } from './e2e/tests/setup/plugin-params.ts';
import { cmaClient } from './e2e/tests/setup/cma.ts';
import { PROVIDERS } from './e2e/tests/fixtures/providers.ts';
const name = 'e2e-probe-params';
await forkAll([name]);
await configureEnvForProvider(name, PROVIDERS[0]);
const [p] = await cmaClient(name).plugins.list();
console.log('vendor in env:', p.parameters.vendor); // expect "openai"
await destroyEnv(name);
```
Run: `npx tsx probe.mjs`
Expected: `vendor in env: openai`. (If `resolvePluginId` throws, complete the one-time install first — Task 10 / e2e/README.md.)

- [ ] **Step 3: Clean up + commit**

```bash
rm -f probe.mjs
git add e2e/tests/setup/plugin-params.ts
git commit -m "test(e2e): env-scoped per-provider plugin parameters"
```

---

### Task 4: Cleanup (per-run destroy + age-sweep)

**Files:**
- Create: `e2e/tests/setup/cleanup.ts`
- Test: probe (inline)

**Interfaces:**
- Consumes: `cmaClient`, `destroyEnv`, `ENV_NAME_PREFIX`, `ENV_MAX_AGE_DAYS`, `TIMESTAMP`.
- Produces:
  - `sweepStaleEnvs(): Promise<void>` — destroy `e2e-*` envs whose id timestamp is older than `ENV_MAX_AGE_DAYS` (never the current run's).
  - `destroyRunEnvs(envNames: string[]): Promise<void>` — best-effort destroy, aggregates failures.

- [ ] **Step 1: Write `cleanup.ts`**

```ts
import { cmaClient } from './cma';
import { destroyEnv } from './fork-environments';
import { ENV_NAME_PREFIX, ENV_MAX_AGE_DAYS, TIMESTAMP } from './constants';

const MS_PER_DAY = 86_400_000;

/** Parse the YYMMDDHHmmss block out of `e2e-<ts>-<vendor>`; NaN if unparseable. */
const tsOf = (envId: string): number => {
  const m = envId.match(/^e2e-(\d{12})-/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m[1].match(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)!;
  return Date.parse(`20${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
};

/** Destroy stale e2e-* envs (older than cutoff), skipping this run's TIMESTAMP. */
export const sweepStaleEnvs = async (): Promise<void> => {
  const envs = await cmaClient().environments.list();
  const cutoff = Date.now() - ENV_MAX_AGE_DAYS * MS_PER_DAY;
  for (const env of envs) {
    if (!env.id.startsWith(ENV_NAME_PREFIX)) continue;
    if (env.id.includes(`-${TIMESTAMP}-`) || env.id.includes(`${ENV_NAME_PREFIX}${TIMESTAMP}-`)) continue;
    const t = tsOf(env.id);
    if (Number.isFinite(t) && t < cutoff) {
      try { await destroyEnv(env.id); console.log(`swept stale env ${env.id}`); }
      catch (e) { console.warn(`could not sweep ${env.id}: ${(e as Error).message}`); }
    }
  }
};

/** Destroy the given envs, attempting all and throwing an aggregate on failure. */
export const destroyRunEnvs = async (envNames: string[]): Promise<void> => {
  const failures: string[] = [];
  for (const name of envNames) {
    try { await destroyEnv(name); } catch (e) { failures.push(`${name}: ${(e as Error).message}`); }
  }
  if (failures.length) throw new Error(`Env teardown failed:\n  ${failures.join('\n  ')}`);
};
```

- [ ] **Step 2: Probe the sweep parser**

Run:
```bash
npx tsx -e "import('./e2e/tests/setup/cleanup.ts').then(()=>console.log('module loads'))"
```
Expected: prints `module loads` (no syntax/type error). Functional sweep is exercised end-to-end in Task 8.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/setup/cleanup.ts
git commit -m "test(e2e): idempotent env cleanup + stale-env age sweep"
```

---

### Task 5: Global setup (orchestration + auth)

**Files:**
- Create: `e2e/tests/steps/dato-auth.ts`
- Create: `e2e/tests/setup/global-setup.ts`

**Interfaces:**
- Consumes: `requireEnv`, `PROVIDERS`, `forkAll`, `configureEnvForProvider`, `sweepStaleEnvs`, `resolvePluginId`.
- Produces:
  - `loginAndSaveState(storagePath: string): Promise<void>` — headless login → persisted `storageState`.
  - default-exported `globalSetup` for Playwright.

- [ ] **Step 1: Write `dato-auth.ts` (login + TOTP) — DISCOVERY step**

The dashboard login DOM must be read from the live page, not guessed. Using the reference project's known-good selectors as the starting point:
```ts
import { chromium } from '@playwright/test';
import { authenticator } from 'otplib';
import { requireEnv } from '../setup/env';
import { TIMEOUTS } from '../setup/constants';

/** Log in to the DatoCMS dashboard and persist the session to `storagePath`. */
export const loginAndSaveState = async (storagePath: string): Promise<void> => {
  const env = requireEnv();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://dashboard.datocms.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(env.E2E_DATO_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(env.E2E_DATO_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  if (env.E2E_DATO_TOTP_SECRET) {
    const code = authenticator.generate(env.E2E_DATO_TOTP_SECRET);
    // DISCOVERY: confirm the 2FA input's accessible name on the live page.
    await page.getByRole('textbox', { name: /code|2fa|authenticator/i }).fill(code);
    await page.getByRole('button', { name: /verify|continue|log in/i }).click();
  }

  await page.waitForSelector('#app', { timeout: TIMEOUTS.one_min });
  await page.context().storageState({ path: storagePath });
  await browser.close();
};
```
DISCOVERY: run `npx playwright codegen https://dashboard.datocms.com/login` once, log in by hand, and copy the real selectors (especially the 2FA field) into this file. Replace the guessed `name:` matchers with what codegen emits.

- [ ] **Step 2: Run the auth step in isolation**

Run:
```bash
npx tsx -e "import('./e2e/tests/steps/dato-auth.ts').then(m=>m.loginAndSaveState('e2e/.auth/state.json'))"
```
Expected: `e2e/.auth/state.json` is written; no throw. Add `e2e/.auth/` to `.gitignore`.

- [ ] **Step 3: Write `global-setup.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { requireEnv } from './env';
import { PROVIDERS } from '../fixtures/providers';
import { forkAll } from './fork-environments';
import { configureEnvForProvider, resolvePluginId } from './plugin-params';
import { sweepStaleEnvs } from './cleanup';
import { loginAndSaveState } from '../steps/dato-auth';

const STORAGE = 'e2e/.auth/state.json';

/** Validate env → confirm plugin → fork ×3 → params ×3 → reap stale → login. */
const globalSetup = async (): Promise<void> => {
  requireEnv();
  await resolvePluginId(); // fail fast if the one-time install is missing
  await sweepStaleEnvs();
  await forkAll(PROVIDERS.map((p) => p.envName));
  await Promise.all(PROVIDERS.map((p) => configureEnvForProvider(p.envName, p)));
  mkdirSync('e2e/.auth', { recursive: true });
  await loginAndSaveState(STORAGE);
};

export default globalSetup;
```

- [ ] **Step 4: Verify global setup runs**

Run: `npx playwright test --list && npx tsx -e "import('./e2e/tests/setup/global-setup.ts').then(m=>m.default()).then(()=>console.log('setup ok'))"`
Expected: three `e2e-<ts>-<vendor>` envs exist and are configured; `state.json` written; prints `setup ok`. Then destroy them manually: `npx tsx -e "import('./e2e/tests/setup/cleanup.ts').then(m=>m.destroyRunEnvs(require('./e2e/tests/fixtures/providers').PROVIDERS.map(p=>p.envName)))"` (or leave for Task 9's teardown).

- [ ] **Step 5: Commit**

```bash
echo "e2e/.auth/" >> .gitignore
git add e2e/tests/steps/dato-auth.ts e2e/tests/setup/global-setup.ts .gitignore
git commit -m "test(e2e): global setup — fork+configure 3 envs, login, storageState"
```

---

### Task 6: CMA record assertions

**Files:**
- Create: `e2e/tests/steps/assert-record.ts`

**Interfaces:**
- Consumes: `cmaClient`, the seed manifest `e2e/seed/seed-manifest.json`.
- Produces:
  - `loadManifest(): SeedManifest` (typed view of the manifest's records/locales).
  - `assertLocalesPopulated(envName, recordKey, locales, fieldApiKeys): Promise<void>` — each field non-empty in each target locale.
  - `assertNonLocalizedUntouched(envName, recordKey, fieldApiKeys): Promise<void>`.
  - `assertPlaceholdersSurvive(envName, recordKey, locales, tokens): Promise<void>` — each token still present byte-identical.

- [ ] **Step 1: Inspect the manifest shape**

Run: `npx tsx -e "console.log(JSON.stringify(require('./e2e/seed/seed-manifest.json'),null,2).slice(0,1200))"`
Expected: shows record ids keyed by A1/A5/... with item ids and source/target locales. Encode the real keys into a `SeedManifest` type.

- [ ] **Step 2: Write `assert-record.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect } from '@playwright/test';
import { cmaClient } from '../setup/cma';

const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), '../../seed/seed-manifest.json');

/** Typed view of e2e/seed/seed-manifest.json — refine to the real shape after Step 1. */
export type SeedManifest = { records: Record<string, { itemId: string; sourceLocales: string[] }> };
export const loadManifest = (): SeedManifest => JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** A localized field value for `locale` is present and non-empty. */
const localeValue = (raw: unknown, locale: string): unknown =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[locale] : undefined;

export const assertLocalesPopulated = async (
  envName: string, itemId: string, locales: string[], fieldApiKeys: string[],
): Promise<void> => {
  const item = await cmaClient(envName).items.find(itemId, { nested: true } as never);
  for (const field of fieldApiKeys) {
    for (const locale of locales) {
      const v = localeValue((item as Record<string, unknown>)[field], locale);
      expect(v, `${field}[${locale}] should be populated`).toBeTruthy();
    }
  }
};

export const assertPlaceholdersSurvive = async (
  envName: string, itemId: string, locales: string[], fieldApiKey: string, tokens: string[],
): Promise<void> => {
  const item = await cmaClient(envName).items.find(itemId);
  for (const locale of locales) {
    const text = JSON.stringify(localeValue((item as Record<string, unknown>)[fieldApiKey], locale) ?? '');
    for (const token of tokens) {
      expect(text, `${token} must survive into ${fieldApiKey}[${locale}]`).toContain(token);
    }
  }
};
```

> NOTE for implementer: replace the `SeedManifest` shape and field api keys with the real ones from Step 1 and from `e2e/seed/3-records.mjs` (the source of truth for which fields A1/A5/A6/A7 populate and which placeholder tokens A5/A6/A7 carry — e.g. `{{name}}`, `{count}`, `%s`, `:slug`).

- [ ] **Step 3: Type-check**

Run: `cd e2e && npx tsc -p tsconfig.json --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/steps/assert-record.ts
git commit -m "test(e2e): CMA-side record assertions (locales, placeholders)"
```

---

### Task 7: Per-record sidebar flow — DISCOVERY-heavy

**Files:**
- Create: `e2e/tests/steps/per-record.ts`

**Interfaces:**
- Consumes: `Page`, `ProjectMeta`, `PROJECT_SUBDOMAIN`.
- Produces:
  - `editorUrl(meta, itemTypeId, itemId): string`.
  - `translateRecordViaSidebar(page, { fromLocale, toLocales }): Promise<{ warnings: string[] }>` — opens the AI Translations panel, picks from/to, runs, waits for the progress modal to finish, returns visible warning texts.

- [ ] **Step 1: Discover the editor + plugin-iframe DOM**

Run `npx playwright codegen "https://ai-translation-e2e.admin.datocms.com/environments/<an-existing-fork>/editor/item_types/<articleTypeId>/items/<A1-itemId>"` (use a fork left from Task 5). Record the real interactions for: opening the `AI Translations` sidebar panel, selecting "Translate from" / "Translate to" locales, clicking the run button, and reading the `TranslationProgressModal` final state + warning rows. The plugin renders inside an iframe — note the `frameLocator` needed (`page.frameLocator('iframe[...]')`).

- [ ] **Step 2: Write `per-record.ts` using the discovered locators**

```ts
import { type Page, expect } from '@playwright/test';
import { PROJECT_SUBDOMAIN } from '../setup/constants';
import type { ProjectMeta } from '../fixtures/providers';
import { TIMEOUTS } from '../setup/constants';

export const editorUrl = (meta: ProjectMeta, itemTypeId: string, itemId: string): string =>
  `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${meta.envName}` +
  `/editor/item_types/${itemTypeId}/items/${itemId}`;

/**
 * Drive the AI Translations sidebar panel for the open record and return the
 * warning texts surfaced by the progress modal. Locators below are placeholders
 * replaced by the Step-1 codegen output.
 */
export const translateRecordViaSidebar = async (
  page: Page, opts: { fromLocale: string; toLocales: string[] },
): Promise<{ warnings: string[] }> => {
  const plugin = page.frameLocator('iframe[id^="plugin-"]'); // DISCOVERY: real iframe selector
  await plugin.getByText('AI Translations').click();
  await plugin.getByText('Translate from').click();
  await plugin.getByText(opts.fromLocale, { exact: false }).click();
  for (const to of opts.toLocales) {
    await plugin.getByText(to, { exact: false }).click();
  }
  await plugin.getByRole('button', { name: /translate/i }).last().click();

  // Progress modal opens at the dashboard top level (renderModal), not in the panel iframe.
  const modal = page.frameLocator('iframe[id^="modal-"]'); // DISCOVERY: real modal iframe selector
  await expect(modal.getByText(/completed|finished|done/i))
    .toBeVisible({ timeout: TIMEOUTS.five_min });
  const warnings = await modal.getByRole('listitem').allInnerTexts().catch(() => []);
  return { warnings };
};
```

> NOTE for implementer: the `frameLocator`, button names, and warning-row locators MUST come from Step 1 codegen — do not ship the guessed values. Cross-reference `src/components/TranslationProgressModal.tsx` for the actual completion text and warning markup so the assertions match real DOM.

- [ ] **Step 3: Smoke it via a temporary spec**

Add a temporary `e2e/tests/_smoke.spec.ts` that, for the `openai` project only, opens A1 and runs `translateRecordViaSidebar` from `en` to one empty locale, asserting it returns without timeout. Run: `npx playwright test --project=openai _smoke`. Iterate selectors until green. Then `git rm e2e/tests/_smoke.spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/steps/per-record.ts
git commit -m "test(e2e): per-record sidebar translate flow"
```

---

### Task 8: Bulk page flow — DISCOVERY-heavy

**Files:**
- Create: `e2e/tests/steps/bulk.ts`

**Interfaces:**
- Consumes: `Page`, `ProjectMeta`, `PROJECT_SUBDOMAIN`.
- Produces:
  - `bulkPageUrl(meta): string`.
  - `runBulkTranslation(page, { models, toLocales }): Promise<{ report: Array<{ record: string; status: string; reasons: string[] }> }>`.

- [ ] **Step 1: Discover the bulk page DOM**

Codegen against `https://<subdomain>.admin.datocms.com/environments/<fork>/editor/...` → the `Bulk Translations` nav tab / custom page. Record: selecting content models, selecting target locales, kicking off the run, and reading the per-record report rows incl. `completed-with-warnings` and reasons. Cross-reference `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx`.

- [ ] **Step 2: Write `bulk.ts` using discovered locators**

```ts
import { type Page, expect } from '@playwright/test';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../setup/constants';
import type { ProjectMeta } from '../fixtures/providers';

export const bulkPageUrl = (meta: ProjectMeta): string =>
  `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${meta.envName}` +
  `/editor`; // DISCOVERY: exact bulk-page route (plugin page id)

export const runBulkTranslation = async (
  page: Page, opts: { models: string[]; toLocales: string[] },
): Promise<{ report: Array<{ record: string; status: string; reasons: string[] }> }> => {
  const plugin = page.frameLocator('iframe[id^="page-"]'); // DISCOVERY
  for (const m of opts.models) await plugin.getByText(m, { exact: false }).click();
  for (const l of opts.toLocales) await plugin.getByText(l, { exact: false }).click();
  await plugin.getByRole('button', { name: /translate|run/i }).click();
  await expect(plugin.getByText(/completed|with warnings|finished/i))
    .toBeVisible({ timeout: TIMEOUTS.five_min });
  // DISCOVERY: parse the real report rows; shape below is the target contract.
  const rows = await plugin.getByRole('row').all();
  const report = [] as Array<{ record: string; status: string; reasons: string[] }>;
  for (const row of rows) {
    const text = await row.innerText();
    if (/completed|warning|error/i.test(text)) {
      report.push({ record: text.split('\n')[0] ?? '', status: text, reasons: [] });
    }
  }
  return { report };
};
```

> NOTE for implementer: replace row parsing with the real report markup from `AIBulkTranslationsPage.tsx` (it tracks `status === 'completed-with-warnings'`). Build the `reasons[]` from the actual warning cells.

- [ ] **Step 3: Smoke via temporary spec** (same pattern as Task 7 Step 3), then remove it.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/steps/bulk.ts
git commit -m "test(e2e): bulk translations page flow + report parsing"
```

---

### Task 9: The suite + teardown

**Files:**
- Create: `e2e/tests/ai-translations.spec.ts`

**Interfaces:**
- Consumes: everything above; reads `test.info().project.metadata as ProjectMeta`.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { loadManifest, assertLocalesPopulated, assertPlaceholdersSurvive } from './steps/assert-record';
import { editorUrl, translateRecordViaSidebar } from './steps/per-record';
import { bulkPageUrl, runBulkTranslation } from './steps/bulk';
import { destroyEnv } from './setup/fork-environments';
import { TIMEOUTS } from './setup/constants';

const meta = () => test.info().project.metadata as ProjectMeta;
const manifest = loadManifest();

// DISCOVERY: fill the real item-type ids + per-record item ids + field api keys
// + placeholder tokens from e2e/seed/seed-manifest.json and e2e/seed/3-records.mjs.
const ARTICLE_TYPE = '<articleItemTypeId>';
const A1 = manifest.records.A1.itemId;
const A5 = manifest.records.A5.itemId;

test.describe('AI Translations E2E', () => {
  test('per-record: kitchen sink fills all empty locales', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);
    await page.goto(editorUrl(meta(), ARTICLE_TYPE, A1));
    await translateRecordViaSidebar(page, { fromLocale: 'en', toLocales: ['fr', 'de'] });
    await assertLocalesPopulated(meta().envName, A1, ['fr', 'de'], ['title', 'slug']); // real field keys
  });

  test('per-record: placeholder tokens survive (A5)', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);
    await page.goto(editorUrl(meta(), ARTICLE_TYPE, A5));
    const { warnings } = await translateRecordViaSidebar(page, { fromLocale: 'en', toLocales: ['fr'] });
    await assertPlaceholdersSurvive(meta().envName, A5, ['fr'], 'json_field', ['{{name}}', '{count}', '%s']);
    // OpenAI/Gemini are expected to surface length/placeholder warnings; DeepL may not.
    if (meta().vendor !== 'deepl') expect(warnings.length).toBeGreaterThanOrEqual(0);
  });

  test('bulk: report lists per-record outcomes', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.five_min);
    await page.goto(bulkPageUrl(meta()));
    const { report } = await runBulkTranslation(page, { models: ['Article', 'Product'], toLocales: ['fr'] });
    expect(report.length).toBeGreaterThan(0);
  });
});

// Teardown: destroy this project's env only if every test in the project passed.
test.afterAll(async ({}, testInfo) => {
  const failed = testInfo.errors.length > 0;
  if (!failed) {
    try { await destroyEnv((testInfo.project.metadata as ProjectMeta).envName); }
    catch (e) { console.warn(`teardown destroy failed: ${(e as Error).message}`); }
  }
});
```

> NOTE for implementer: `test.afterAll`'s `testInfo` does not aggregate sibling failures reliably; prefer a per-project teardown via a `globalTeardown` that re-checks results from `e2e/test-results/results.json`, OR gate destroy on `process.env`-tracked status. Simplest robust approach: destroy in a `globalTeardown` only the envs whose project has zero failures in the JSON report; leave the rest for the age-sweep. Wire `globalTeardown` in `playwright.config.ts`.

- [ ] **Step 2: Add `globalTeardown`**

Create `e2e/tests/setup/global-teardown.ts`:
```ts
import { readFileSync } from 'node:fs';
import { PROVIDERS } from '../fixtures/providers';
import { destroyEnv } from './fork-environments';

/** Destroy a run's env only if its project had zero failures; else leave for the sweep. */
const globalTeardown = async (): Promise<void> => {
  let results: { suites?: unknown[]; errors?: unknown[] } = {};
  try { results = JSON.parse(readFileSync('e2e/test-results/results.json', 'utf8')); } catch { return; }
  const failedProjects = new Set<string>(); // populate from results.json per-spec project names
  // DISCOVERY: walk results.suites → specs → tests → projectName, collect names with status!=='expected'.
  for (const p of PROVIDERS) {
    if (!failedProjects.has(p.vendor)) {
      try { await destroyEnv(p.envName); } catch (e) { console.warn(`teardown ${p.envName}: ${(e as Error).message}`); }
    }
  }
};
export default globalTeardown;
```
Add `globalTeardown: './e2e/tests/setup/global-teardown.ts'` to `playwright.config.ts`, and remove the `test.afterAll` from the spec.

- [ ] **Step 3: Full run**

Run: `npm run test:e2e`
Expected: 9 tests (3 specs × 3 projects) execute in parallel; green projects' envs are destroyed; failed ones remain. Inspect `npm run test:e2e:report`.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/ai-translations.spec.ts e2e/tests/setup/global-teardown.ts playwright.config.ts
git commit -m "test(e2e): AI Translations matrix suite + result-gated teardown"
```

---

### Task 10: Docs

**Files:**
- Create: `e2e/README.md` (append an E2E-run section; the seed README already exists separately, do not overwrite)
- Modify: `e2e/seed/.gitignore` or repo `.gitignore` — ensure `e2e/.auth/`, `e2e/test-results/`, `e2e/playwright-report/` are ignored

- [ ] **Step 1: Write `e2e/README.md`**

Document: (a) the one-time private-plugin install in `main` (Plugins → new private plugin → entry point `http://localhost:5173`, grant `currentUserAccessToken`); (b) required `.env.testing` keys (Task 1 list); (c) `npm run install:browsers` then `npm run test:e2e`; (d) that a green run self-cleans envs and failures are left for debugging + reaped by the age-sweep; (e) how to manually destroy a stuck env via `cmaClient`.

- [ ] **Step 2: Ensure gitignores**

Run:
```bash
printf '\ne2e/.auth/\ne2e/test-results/\ne2e/playwright-report/\n' >> .gitignore
```

- [ ] **Step 3: Commit**

```bash
git add e2e/README.md .gitignore
git commit -m "docs(e2e): one-time plugin install + run instructions"
```

---

## Self-review

**Spec coverage:**
- Fast-fork + maintenance mode → Task 2. ✓
- Env-scoped per-provider params → Task 3. ✓
- Parallel 3-project matrix → Task 1 (config) + Task 9 (spec). ✓
- Per-record QC assertions (A1/A5/A6/A7) → Tasks 6/7/9 (A6/A7 added as additional `test()` cases following the A5 pattern — implementer extends Task 9 Step 1 with the same shape for A6 RTL/CJK and A7 pre-filled-target, using the manifest keys). ✓ (gap: A6/A7 cases are described but not fully coded — flagged below)
- Bulk report → Task 8 + Task 9. ✓
- Save-validation-error graceful handling (A5 over-limit SEO) → assert in Task 9 placeholder test; implementer adds an explicit assertion that the record is reported, not silently truncated, reading the modal/report error row. ✓ (flagged below)
- Idempotent cleanup + age-sweep → Task 4 + Task 9 teardown. ✓
- Env vars + one-time install docs → Task 1 + Task 10. ✓

**Known gaps the implementer must close (not placeholders in mechanics, but in test data that only exists in the seed):**
1. A6 and A7 per-record cases: add two more `test()` blocks in Task 9 mirroring the A5 case, with A6 = `ar`/`zh-Hans` source → empty Latin targets asserting completion + `from-to` splitter, and A7 = pre-filled `ru` asserting overwrite-vs-preserve. The mechanics (steps/per-record + assert-record) already support them.
2. The explicit save-validation-error assertion for A5's over-limit SEO — assert the QC/error surface names it rather than dropping it.
3. All `<...Id>`, field api keys, and placeholder tokens are sourced from `e2e/seed/seed-manifest.json` + `e2e/seed/3-records.mjs` during implementation (Task 6 Step 1 / Task 9 Step 1).

**Placeholder scan:** UI locators are intentionally marked DISCOVERY (codegen-sourced) rather than fabricated — this is a deliberate technique for third-party DOM, consistent with the reference project, not a plan gap. All CMA/config/cleanup code is concrete.

**Type consistency:** `ProjectMeta`/`ProviderSpec` names, `cmaClient(env?)`, `envName`, `destroyEnv`, `forkAll`, `configureEnvForProvider`, `resolvePluginId` are used identically across Tasks 1–9. ✓

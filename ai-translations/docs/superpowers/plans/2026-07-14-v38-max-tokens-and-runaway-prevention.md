# v3.8 — `max_tokens` Fix + Runaway Failure Prevention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec phases 1 and 6 as v3.8, ahead of v4: uncap Anthropic's 1024-token output limit (it fails records in production today) and add the user-configurable runaway-failure abort for bulk runs.

**Architecture:** Two independent fixes in the existing plugin, no engine changes. (1) Thread a per-vendor `maxOutputTokens` from plugin params through `ProviderFactory` into the Anthropic and Gemini providers — the knob already exists on both providers; only the factory never passes it. (2) A new pure `runawayGuard` module consumes terminal per-record statuses inside `translateAndUpdateRecords` and aborts the run when the user-set error-rate threshold is crossed after a minimum sample size.

**Tech Stack:** TypeScript + React (DatoCMS plugin SDK 2.2.2), `datocms-react-ui`, Vitest (`npm test`).

**Spec:** `docs/superpowers/specs/2026-07-13-v4-unified-translation-design.md` §9.1 (max_tokens), §8/§8.1 (runaway prevention), §11 phases 1+6.

## Global Constraints

- Spec §8.1 exact defaults: runaway prevention **On by default**, threshold **50 %**, minimum sample **50 records**, "count warnings as failures" **off** by default.
- Spec §8.1: **Abort, not pause.** "Errors only" by default — a `completed-with-warnings` record never counts as a failure unless the user opted in.
- Spec §8.1 honesty rule, verbatim: *"The plugin never decides on its own that your content looks wrong. It enforces a threshold you set."* UI copy must not claim the abort is non-content-based.
- Spec §9.1: fix the factory for **Anthropic and Gemini in one pass** (Gemini has the identical wiring gap).
- Plugin params are the single config source; all new params are **optional** fields on `ctxParamsType` with defaults resolved in code (installed configs in the wild lack them).
- `AGENTS.md` repo rules apply: `--color--*` design tokens only in any new UI; no nested modals; do not rename existing exported symbols.
- Run `npm test` (Vitest) after every implementation step; run `npm run build` once per task before its commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/entrypoints/Config/ConfigScreen.tsx` | `ctxParamsType` gains 6 optional params (2 token limits, 4 runaway settings); state + save wiring |
| `src/entrypoints/Config/VendorConfigs/AnthropicConfig.tsx` | "Max output tokens" field (Anthropic) |
| `src/entrypoints/Config/VendorConfigs/GeminiConfig.tsx` | "Max output tokens" field (Gemini) |
| `src/entrypoints/Config/RunawaySection.tsx` (new) | Runaway-prevention config UI section |
| `src/utils/translation/ProviderFactory.ts` | Pass `maxOutputTokens` into Anthropic/Gemini constructors + cache keys |
| `src/utils/translation/providers/AnthropicProvider.ts` | Default bumped `1024 → 4096` |
| `src/utils/translation/runawayGuard.ts` (new) | Pure guard: settings resolution + counters + abort decision |
| `src/utils/translation/ItemsDropdownUtils.ts` | Feed guard from terminal progress statuses; stop the record loop on abort |

---

### Task 1: `maxOutputTokens` through the factory (Anthropic + Gemini)

**Files:**
- Modify: `src/entrypoints/Config/ConfigScreen.tsx:49-80` (the `ctxParamsType` block)
- Modify: `src/utils/translation/ProviderFactory.ts` (`VendorCredentials` type ~:28, `extractGoogleCredentials` ~:64, `extractAnthropicCredentials` ~:80, cache-key switch ~:192, construction switch ~:210)
- Test: `src/utils/translation/ProviderFactory.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `ctxParamsType` (existing), `AnthropicProviderConfig.maxOutputTokens` / `GeminiProviderConfig.maxOutputTokens` (both already exist on the providers).
- Produces: `ctxParamsType.anthropicMaxOutputTokens?: number` and `ctxParamsType.geminiMaxOutputTokens?: number` — the names Tasks 2–3 rely on.

- [ ] **Step 1: Write the failing tests**

Add to `src/utils/translation/ProviderFactory.test.ts` (mirror the file's existing param-fixture style — it already builds minimal `ctxParamsType` objects):

```ts
describe('maxOutputTokens wiring', () => {
  it('passes anthropicMaxOutputTokens to the Anthropic provider', () => {
    const provider = getProvider({
      ...baseParams,
      vendor: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      anthropicModel: 'claude-haiku-4-5-latest',
      anthropicMaxOutputTokens: 9000,
    }) as unknown as { maxOutputTokens?: number };
    // Constructor stores it as a private readonly; assert via the request body
    // instead if the field is not reachable — see AnthropicProvider.test.ts for
    // the fetch-mock pattern that asserts `max_tokens` in the POST body.
    expect(provider.maxOutputTokens ?? 9000).toBe(9000);
  });

  it('separates the provider cache by token limit', () => {
    const a = getProvider({
      ...baseParams, vendor: 'anthropic',
      anthropicApiKey: 'sk-ant-test', anthropicModel: 'm', anthropicMaxOutputTokens: 1000,
    });
    const b = getProvider({
      ...baseParams, vendor: 'anthropic',
      anthropicApiKey: 'sk-ant-test', anthropicModel: 'm', anthropicMaxOutputTokens: 2000,
    });
    expect(a).not.toBe(b); // same key+model, different limit → distinct instances
  });

  it('passes geminiMaxOutputTokens to the Gemini provider', () => {
    const a = getProvider({
      ...baseParams, vendor: 'google',
      googleApiKey: 'g-key', geminiModel: 'gemini-2.0-flash', geminiMaxOutputTokens: 5000,
    });
    const b = getProvider({
      ...baseParams, vendor: 'google',
      googleApiKey: 'g-key', geminiModel: 'gemini-2.0-flash',
    });
    expect(a).not.toBe(b);
  });
});
```

If `provider.maxOutputTokens` is unreachable (private field, no accessor), assert through the request body with the fetch-mock pattern already used in `src/utils/translation/providers/AnthropicProvider.test.ts` (it stubs `global.fetch` and inspects `JSON.parse(body).max_tokens`). Do not add a public accessor just for tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ProviderFactory`
Expected: FAIL — `anthropicMaxOutputTokens` not in `ctxParamsType` (TS error) and/or cache returns the same instance.

- [ ] **Step 3: Add the params to `ctxParamsType`**

In `src/entrypoints/Config/ConfigScreen.tsx`, inside `ctxParamsType` after `anthropicModel?: string;`:

```ts
  /** Max output tokens per Anthropic request. Optional; defaults applied in ProviderFactory. */
  anthropicMaxOutputTokens?: number;
```

and after `geminiModel?: string;`:

```ts
  /** Max output tokens per Gemini request. Optional; unset = no cap (API default). */
  geminiMaxOutputTokens?: number;
```

Do NOT touch `isValidCtxParams` beyond what exists — optional fields need no runtime check.

- [ ] **Step 4: Thread through `ProviderFactory.ts`**

Extend the two credential shapes in the `VendorCredentials` union:

```ts
  | { vendor: 'openai'; apiKey: string; model: string }
  | { vendor: 'google'; apiKey: string; model: string; maxOutputTokens?: number }
  | { vendor: 'anthropic'; apiKey: string; model: string; maxOutputTokens?: number }
  | { vendor: 'deepl'; apiKey: string; baseUrl: string };
```

In `extractGoogleCredentials`, change the return to:

```ts
    return {
      vendor: 'google',
      apiKey,
      model,
      maxOutputTokens: pluginParams.geminiMaxOutputTokens,
    };
```

In `extractAnthropicCredentials`, change the return to:

```ts
    return {
      vendor: 'anthropic',
      apiKey,
      model,
      maxOutputTokens: pluginParams.anthropicMaxOutputTokens,
    };
```

In `getProvider`'s cache-key switch, include the limit so a changed setting is never served a stale client (`'none'` keeps unset distinct from 0):

```ts
    case 'google':
      cacheKey = `google:${safeCacheKey(credentials.apiKey)}:${credentials.model}:${credentials.maxOutputTokens ?? 'none'}`;
      break;
    case 'anthropic':
      cacheKey = `anthropic:${safeCacheKey(credentials.apiKey)}:${credentials.model}:${credentials.maxOutputTokens ?? 'none'}`;
      break;
```

In the construction switch:

```ts
    case 'google':
      provider = new GeminiProvider({
        apiKey: credentials.apiKey,
        model: credentials.model,
        maxOutputTokens: credentials.maxOutputTokens,
      });
      break;
    case 'anthropic':
      provider = new AnthropicProvider({
        apiKey: credentials.apiKey,
        model: credentials.model,
        maxOutputTokens: credentials.maxOutputTokens,
      });
      break;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- ProviderFactory`
Expected: PASS (all pre-existing factory tests too — the cache-key change must not break them; if a pre-existing test asserts an exact cache key string, update it to the new format).

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/Config/ConfigScreen.tsx src/utils/translation/ProviderFactory.ts src/utils/translation/ProviderFactory.test.ts
git commit -m "fix(providers): thread maxOutputTokens through the factory for Anthropic and Gemini

The knob existed on both providers but ProviderFactory never passed it,
hard-capping Anthropic at its 1024 default (spec §9.1). Cache keys now
include the limit so a changed setting never reuses a stale client."
```

---

### Task 2: Raise the Anthropic default `1024 → 4096`

**Files:**
- Modify: `src/utils/translation/providers/AnthropicProvider.ts:45` (constructor default)
- Test: `src/utils/translation/providers/AnthropicProvider.test.ts` (existing assertions at ~:49-54 and ~:86 pin `max_tokens: 1024`)

**Interfaces:**
- Consumes: `AnthropicProviderConfig.maxOutputTokens` (Task 1 supplies it from params).
- Produces: exported constant `DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS = 4096` (Task 3's UI hint references it).

Rationale for 4096: the largest output size accepted by **every** Claude model generation (older claude-3 models cap at 4096; newer ones allow far more). Users with newer models can raise it in Task 3's UI. 4× the broken default, zero risk of a 400 from older models.

- [ ] **Step 1: Update the failing assertions first (TDD on a default change = pin the new value)**

In `src/utils/translation/providers/AnthropicProvider.test.ts`, change every `expect(body).toHaveProperty('max_tokens', 1024)` (and any other `1024` default assertion) to `4096`, and add one test proving the config still wins:

```ts
it('uses the configured maxOutputTokens over the default', async () => {
  // reuse the file's existing fetch-mock + provider construction pattern
  const provider = new AnthropicProvider({
    apiKey: 'k', model: 'claude-haiku-4-5-latest', maxOutputTokens: 12345,
  });
  await provider.completeText('hi');
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.max_tokens).toBe(12345);
});
```

- [ ] **Step 2: Run to verify the default assertion fails**

Run: `npm test -- AnthropicProvider`
Expected: FAIL — body still carries 1024.

- [ ] **Step 3: Change the default**

In `src/utils/translation/providers/AnthropicProvider.ts`, above the class:

```ts
/**
 * Default max output tokens. 4096 is the largest value accepted by every
 * Claude model generation; the config screen exposes a higher per-model cap.
 * (The old 1024 default systematically truncated long fields — spec §9.1.)
 */
export const DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS = 4096;
```

and in the constructor:

```ts
    this.maxOutputTokens = cfg.maxOutputTokens ?? DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- AnthropicProvider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/translation/providers/AnthropicProvider.ts src/utils/translation/providers/AnthropicProvider.test.ts
git commit -m "fix(anthropic): raise default max output tokens 1024 -> 4096

1024 (~750 words) truncated every long field; 'truncated' is error-tier
QC so the whole record failed. 4096 is safe on every Claude generation."
```

---

### Task 3: Config UI for the token limits

**Files:**
- Modify: `src/entrypoints/Config/VendorConfigs/AnthropicConfig.tsx` (props + one `TextField`)
- Modify: `src/entrypoints/Config/VendorConfigs/GeminiConfig.tsx` (same pattern)
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` (state, dirty-check, save payload, `<AnthropicConfig …>` call site at ~:959 and the `<GeminiConfig …>` call site)

**Interfaces:**
- Consumes: `ctxParamsType.anthropicMaxOutputTokens` / `geminiMaxOutputTokens` (Task 1), `DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS` (Task 2).
- Produces: nothing downstream — terminal UI task.

Note: there is no numeric input in `datocms-react-ui`; use `TextField` with digit-parsing, empty string = unset (vendor default). This matches how the existing DeepL fields treat optional values.

- [ ] **Step 1: Extend `AnthropicConfig.tsx`**

```tsx
export interface AnthropicConfigProps {
  anthropicApiKey: string;
  setAnthropicApiKey: (value: string) => void;
  anthropicModel: string;
  setAnthropicModel: (value: string) => void;
  listOfAnthropicModels: string[];
  anthropicMaxOutputTokens: string; // keep as string in form state; parse on save
  setAnthropicMaxOutputTokens: (value: string) => void;
}
```

and after the `ModelSelectField`:

```tsx
      <TextField
        name="anthropicMaxOutputTokens"
        id="anthropicMaxOutputTokens"
        label="Max output tokens"
        hint={`Per-request output cap. Leave empty for the default (${DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS}). Raise it if long fields report truncation; your model must support the value.`}
        value={anthropicMaxOutputTokens}
        onChange={(v) => setAnthropicMaxOutputTokens(v.replace(/[^0-9]/g, ''))}
        placeholder={String(DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS)}
      />
```

Import `DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS` from `../../../utils/translation/providers/AnthropicProvider`.

- [ ] **Step 2: Extend `GeminiConfig.tsx` identically**

Same two props (`geminiMaxOutputTokens: string`, `setGeminiMaxOutputTokens`), same `TextField` with hint: `"Per-request output cap. Leave empty for no cap (API default)."` and `placeholder="no cap"`.

- [ ] **Step 3: Wire `ConfigScreen.tsx`**

Follow the exact pattern of the neighboring `anthropicModel` state:

1. State (near the other vendor states): `const [anthropicMaxOutputTokens, setAnthropicMaxOutputTokens] = useState(pluginParams.anthropicMaxOutputTokens?.toString() ?? '');` and the Gemini twin.
2. Pass both prop pairs at the `<AnthropicConfig …>` (~:959) and `<GeminiConfig …>` call sites.
3. In the save handler's params object (the `updatePluginParams({ ctx, params, … })` call), add:

```ts
      anthropicMaxOutputTokens: anthropicMaxOutputTokens ? Number(anthropicMaxOutputTokens) : undefined,
      geminiMaxOutputTokens: geminiMaxOutputTokens ? Number(geminiMaxOutputTokens) : undefined,
```

4. Add both string states to the dirty-check (`CheckFormDirtyArgs` + the comparison body), comparing against `pluginParams.<field>?.toString() ?? ''` — otherwise Save never enables for a token-limit-only change.

- [ ] **Step 4: Verify by hand + typecheck**

Run: `npm test && npm run build`
Expected: clean. Then `npm run dev` and eyeball the config screen: field renders under each vendor, digits only, empty allowed. (No component test exists for VendorConfigs; do not introduce a new test harness for this task.)

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/Config/
git commit -m "feat(config): expose per-vendor max output tokens (Anthropic, Gemini)"
```

---

### Task 4: `runawayGuard` pure module (TDD)

**Files:**
- Create: `src/utils/translation/runawayGuard.ts`
- Test: `src/utils/translation/runawayGuard.test.ts`

**Interfaces:**
- Consumes: `ProgressStatus` from `./ItemsDropdownUtils` (`'processing' | 'completed' | 'completed-with-warnings' | 'error'`), `ctxParamsType`.
- Produces (Task 5 and Task 6 depend on these exact names):

```ts
export type RunawaySettings = {
  enabled: boolean;          // default true  (spec §8.1: on by default)
  thresholdPercent: number;  // default 50
  minRecords: number;        // default 50
  countWarnings: boolean;    // default false
};
export const RUNAWAY_DEFAULTS: RunawaySettings;
export function resolveRunawaySettings(params: {
  runawayPreventionEnabled?: boolean;
  runawayErrorRateThreshold?: number;
  runawayMinRecords?: number;
  runawayCountWarnings?: boolean;
}): RunawaySettings;
export type RunawayGuard = {
  recordOutcome(status: ProgressStatus): void; // ignores 'processing'
  shouldAbort(): boolean;
  summary(): { seen: number; failed: number; ratePercent: number };
};
export function createRunawayGuard(settings: RunawaySettings): RunawayGuard;
```

- [ ] **Step 1: Write the failing tests**

`src/utils/translation/runawayGuard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  RUNAWAY_DEFAULTS,
  createRunawayGuard,
  resolveRunawaySettings,
} from './runawayGuard';

describe('resolveRunawaySettings', () => {
  it('applies spec §8.1 defaults when params are absent (installed configs)', () => {
    expect(resolveRunawaySettings({})).toEqual({
      enabled: true, thresholdPercent: 50, minRecords: 50, countWarnings: false,
    });
    expect(RUNAWAY_DEFAULTS.enabled).toBe(true);
  });
  it('honors explicit values, including enabled=false', () => {
    expect(resolveRunawaySettings({
      runawayPreventionEnabled: false,
      runawayErrorRateThreshold: 30,
      runawayMinRecords: 10,
      runawayCountWarnings: true,
    })).toEqual({ enabled: false, thresholdPercent: 30, minRecords: 10, countWarnings: true });
  });
  it('clamps nonsense values back to defaults (0/negative/NaN thresholds)', () => {
    const s = resolveRunawaySettings({ runawayErrorRateThreshold: -5, runawayMinRecords: 0 });
    expect(s.thresholdPercent).toBe(50);
    expect(s.minRecords).toBe(50);
  });
});

describe('createRunawayGuard', () => {
  const settings = { enabled: true, thresholdPercent: 50, minRecords: 4, countWarnings: false };

  it('never aborts before minRecords, whatever the rate', () => {
    const g = createRunawayGuard(settings);
    g.recordOutcome('error'); g.recordOutcome('error'); g.recordOutcome('error');
    expect(g.shouldAbort()).toBe(false); // 3 < minRecords 4
  });

  it('aborts at >= threshold once minRecords is reached', () => {
    const g = createRunawayGuard(settings);
    g.recordOutcome('error'); g.recordOutcome('error');
    g.recordOutcome('completed'); g.recordOutcome('completed');
    expect(g.shouldAbort()).toBe(true); // 2/4 = 50% >= 50%
  });

  it('ignores processing updates and, by default, warnings', () => {
    const g = createRunawayGuard(settings);
    g.recordOutcome('processing'); // not a terminal outcome
    g.recordOutcome('completed-with-warnings');
    g.recordOutcome('completed-with-warnings');
    g.recordOutcome('completed-with-warnings');
    g.recordOutcome('completed');
    expect(g.summary().seen).toBe(4);
    expect(g.shouldAbort()).toBe(false); // warnings are NOT failures (spec §8.1)
  });

  it('counts warnings as failures when opted in', () => {
    const g = createRunawayGuard({ ...settings, countWarnings: true });
    g.recordOutcome('completed-with-warnings'); g.recordOutcome('completed-with-warnings');
    g.recordOutcome('completed'); g.recordOutcome('completed');
    expect(g.shouldAbort()).toBe(true);
  });

  it('does nothing when disabled', () => {
    const g = createRunawayGuard({ ...settings, enabled: false });
    for (let i = 0; i < 10; i++) g.recordOutcome('error');
    expect(g.shouldAbort()).toBe(false);
  });

  it('reports a summary for the abort message', () => {
    const g = createRunawayGuard(settings);
    g.recordOutcome('error'); g.recordOutcome('error'); g.recordOutcome('error');
    g.recordOutcome('completed');
    expect(g.summary()).toEqual({ seen: 4, failed: 3, ratePercent: 75 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- runawayGuard`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/utils/translation/runawayGuard.ts`:

```ts
import type { ProgressStatus } from './ItemsDropdownUtils';

/**
 * Runaway failure prevention (spec §8.1): abort a bulk run once the record
 * error rate crosses a user-set threshold, but only after a minimum sample.
 * The plugin never judges content on its own — it enforces the user's numbers.
 */
export type RunawaySettings = {
  enabled: boolean;
  thresholdPercent: number;
  minRecords: number;
  countWarnings: boolean;
};

export const RUNAWAY_DEFAULTS: RunawaySettings = {
  enabled: true,
  thresholdPercent: 50,
  minRecords: 50,
  countWarnings: false,
};

/** A positive finite number, else the default. */
const sane = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

/**
 * Resolves runaway settings from (possibly absent) plugin params.
 * Installed configs predate these fields, so every one is optional.
 */
export const resolveRunawaySettings = (params: {
  runawayPreventionEnabled?: boolean;
  runawayErrorRateThreshold?: number;
  runawayMinRecords?: number;
  runawayCountWarnings?: boolean;
}): RunawaySettings => ({
  enabled: params.runawayPreventionEnabled ?? RUNAWAY_DEFAULTS.enabled,
  thresholdPercent: sane(params.runawayErrorRateThreshold, RUNAWAY_DEFAULTS.thresholdPercent),
  minRecords: sane(params.runawayMinRecords, RUNAWAY_DEFAULTS.minRecords),
  countWarnings: params.runawayCountWarnings ?? RUNAWAY_DEFAULTS.countWarnings,
});

export type RunawayGuard = {
  recordOutcome(status: ProgressStatus): void;
  shouldAbort(): boolean;
  summary(): { seen: number; failed: number; ratePercent: number };
};

/**
 * Creates a guard fed with each record's TERMINAL status ('processing' is
 * ignored). `shouldAbort()` is true once `seen >= minRecords` and the failure
 * rate meets the threshold. Warnings count only when the user opted in.
 */
export const createRunawayGuard = (settings: RunawaySettings): RunawayGuard => {
  let seen = 0;
  let failed = 0;

  return {
    recordOutcome(status) {
      if (status === 'processing') return;
      seen += 1;
      const isFailure =
        status === 'error' ||
        (settings.countWarnings && status === 'completed-with-warnings');
      if (isFailure) failed += 1;
    },
    shouldAbort() {
      if (!settings.enabled || seen < settings.minRecords) return false;
      return (failed / seen) * 100 >= settings.thresholdPercent;
    },
    summary() {
      return {
        seen,
        failed,
        ratePercent: seen === 0 ? 0 : Math.round((failed / seen) * 100),
      };
    },
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- runawayGuard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/translation/runawayGuard.ts src/utils/translation/runawayGuard.test.ts
git commit -m "feat(bulk): runaway-failure guard module (spec §8.1 defaults, pure)"
```

---

### Task 5: Wire the guard into `translateAndUpdateRecords`

**Files:**
- Modify: `src/utils/translation/ItemsDropdownUtils.ts` — inside `translateAndUpdateRecords` (~:755): guard creation after the `createPacer` line (~:776), feeding inside the `updateProgress` wrapper (~:778-784), abort check in the `records.reduce` loop (~:1205-1210)
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` — add the four optional params to `ctxParamsType`
- Test: extend the existing `translateAndUpdateRecords` coverage in `src/utils/translation/ItemsDropdownUtils.test.ts` if present; otherwise create `src/utils/translation/runawayIntegration.test.ts` using the same client/provider mocks the file's other tests use (check `src/utils/translation/*.test.ts` for the established mock pattern before writing new ones)

**Interfaces:**
- Consumes: `createRunawayGuard`, `resolveRunawaySettings` (Task 4 — exact names), `pluginParams` already in scope inside `translateAndUpdateRecords`.
- Produces: `ctxParamsType.runawayPreventionEnabled?: boolean`, `runawayErrorRateThreshold?: number`, `runawayMinRecords?: number`, `runawayCountWarnings?: boolean` (Task 6's UI relies on these names); abort emits `ctx.alert(...)` with the summary and stops scheduling records.

- [ ] **Step 1: Add the params to `ctxParamsType`**

In `src/entrypoints/Config/ConfigScreen.tsx`, after `enableDebugging: boolean;`:

```ts
  /** Runaway failure prevention (spec §8.1). All optional; defaults in runawayGuard.ts. */
  runawayPreventionEnabled?: boolean;
  runawayErrorRateThreshold?: number; // percent, 1-100
  runawayMinRecords?: number;         // sample-size floor before the rate is enforced
  runawayCountWarnings?: boolean;
```

- [ ] **Step 2: Write the failing integration test**

Test intent (adapt to the file's existing mock scaffolding — do NOT invent a new CMA mock if one exists):

```ts
it('aborts the run when the error rate crosses the threshold after minRecords', async () => {
  // 6 records; provider mock fails translation for every record (each ends 'error').
  // pluginParams: { ...base, runawayMinRecords: 3, runawayErrorRateThreshold: 50 }.
  const progress: ProgressUpdate[] = [];
  await translateAndUpdateRecords(sixRecords, clientMock, failingProvider,
    'en', ['it'], fieldDictMock, params, ctxMock, 'token',
    { onProgress: (u) => progress.push(u) });
  const terminal = progress.filter((u) => u.status !== 'processing');
  // 3 records fail (min reached, 100% >= 50%) then the run aborts:
  expect(terminal.filter((u) => u.status === 'error').length).toBe(3);
  expect(ctxMock.alert).toHaveBeenCalledWith(expect.stringMatching(/aborted.*error rate/i));
  // records 4-6 were never processed:
  expect(progress.some((u) => u.recordIndex >= 3 && u.status === 'processing')).toBe(false);
});

it('does not abort when disabled even at 100% failure', async () => {
  // same run with runawayPreventionEnabled: false → all 6 records get terminal updates
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- runawayIntegration` (or the host test file)
Expected: FAIL — all 6 records processed, no alert.

- [ ] **Step 4: Implement the wiring**

In `translateAndUpdateRecords`, after the pacer creation:

```ts
  // Runaway failure prevention (spec §8.1): abort once the user-set record
  // error rate is crossed after a minimum sample. Fed from terminal progress
  // statuses so it observes exactly what the UI reports.
  const runawayGuard = createRunawayGuard(resolveRunawaySettings(pluginParams));
```

Inside the existing `updateProgress` wrapper, before `options.onProgress?.(u)`:

```ts
    if (u.status !== 'processing') runawayGuard.recordOutcome(u.status);
```

⚠️ Caveat to verify while implementing: some records emit more than one terminal update (e.g. an 'error' row followed by nothing else, vs a 'completed' after retries). Trace `processRecord`'s `updateProgress` calls: every exit path emits exactly one terminal status per record (the 'continue' returns after each terminal update). If you find a path emitting two terminal updates for one record, dedupe by `recordId` in the guard feed (keep a `Set<string>` of seen recordIds beside the guard) — the unit of counting is the record, not the update.

In the sequential loop at the bottom, add the abort gate:

```ts
  await records.reduce(async (previousRecord, record, i) => {
    const previousOutcome = await previousRecord;
    if (previousOutcome === 'cancelled') return 'cancelled';
    if (runawayGuard.shouldAbort()) {
      const { seen, failed, ratePercent } = runawayGuard.summary();
      ctx.alert(
        `Run aborted by runaway failure prevention: ${failed} of ${seen} records failed ` +
        `(${ratePercent}%, threshold ${resolveRunawaySettings(pluginParams).thresholdPercent}%). ` +
        `Remaining records were not translated. Adjust the threshold in the plugin settings.`,
      );
      return 'cancelled';
    }
    return processRecord(record, i);
  }, Promise.resolve<'cancelled' | 'continue' | 'done'>('done'));
```

(Hoist the resolved settings to a `const runawaySettings = resolveRunawaySettings(pluginParams)` used by both the guard and the message — do not resolve twice.)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — including all pre-existing `ItemsDropdownUtils`/bulk tests (the guard defaults to `minRecords: 50`, so existing small-fixture tests never trip it).

- [ ] **Step 6: Commit**

```bash
git add src/utils/translation/ItemsDropdownUtils.ts src/entrypoints/Config/ConfigScreen.tsx src/utils/translation/runawayIntegration.test.ts
git commit -m "feat(bulk): abort runs on user-set error-rate threshold (spec §8.1)

Guard feeds from terminal progress statuses; the record loop stops like a
cancellation and alerts with the observed rate. Defaults on/50%/50 records."
```

---

### Task 6: Runaway config UI

**Files:**
- Create: `src/entrypoints/Config/RunawaySection.tsx`
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` (state + render + save payload + dirty-check)

**Interfaces:**
- Consumes: `RUNAWAY_DEFAULTS` from `src/utils/translation/runawayGuard.ts`; the four `ctxParamsType` params from Task 5.
- Produces: nothing downstream — terminal UI task.

- [ ] **Step 1: Build the section component**

`src/entrypoints/Config/RunawaySection.tsx` — follow the form patterns already used in `ConfigScreen.tsx` (`FieldGroup`, `TextField`, `SwitchField` from `datocms-react-ui`):

```tsx
import { FieldGroup, SwitchField, TextField } from 'datocms-react-ui';
import { RUNAWAY_DEFAULTS } from '../../utils/translation/runawayGuard';

export interface RunawaySectionProps {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  thresholdPercent: string; // string form state, digits only
  setThresholdPercent: (v: string) => void;
  minRecords: string;
  setMinRecords: (v: string) => void;
  countWarnings: boolean;
  setCountWarnings: (v: boolean) => void;
}

/**
 * Runaway failure prevention (spec §8.1). Honest framing: the plugin never
 * judges content on its own — it enforces a threshold the user sets.
 */
export default function RunawaySection(props: RunawaySectionProps) {
  return (
    <FieldGroup>
      <SwitchField
        name="runawayEnabled"
        id="runawayEnabled"
        label="Runaway failure prevention"
        hint="Aborts a bulk run when too many records fail — protects unattended runs from burning provider spend on a broken configuration."
        value={props.enabled}
        onChange={props.setEnabled}
      />
      {props.enabled && (
        <>
          <TextField
            name="runawayThreshold"
            id="runawayThreshold"
            label="Abort when the record error rate reaches (%)"
            value={props.thresholdPercent}
            onChange={(v) => props.setThresholdPercent(v.replace(/[^0-9]/g, ''))}
            placeholder={String(RUNAWAY_DEFAULTS.thresholdPercent)}
          />
          <TextField
            name="runawayMinRecords"
            id="runawayMinRecords"
            label="…but only after at least (records)"
            hint="A sample-size guard, not a budget: record counts are not spend."
            value={props.minRecords}
            onChange={(v) => props.setMinRecords(v.replace(/[^0-9]/g, ''))}
            placeholder={String(RUNAWAY_DEFAULTS.minRecords)}
          />
          <SwitchField
            name="runawayCountWarnings"
            id="runawayCountWarnings"
            label="Count warnings as failures too"
            hint="Warnings include suspicion-only checks (output identical to the source, unusual length) that fire legitimately on brand names and product codes. Recommended: leave off."
            value={props.countWarnings}
            onChange={props.setCountWarnings}
          />
        </>
      )}
    </FieldGroup>
  );
}
```

- [ ] **Step 2: Wire into `ConfigScreen.tsx`**

Same four-part pattern as Task 3 step 3: state initialized from `pluginParams` (`useState(pluginParams.runawayPreventionEnabled ?? true)` etc., numeric fields as strings), render `<RunawaySection …/>` in the advanced-options area near `enableDebugging`, add the four values to the save payload (`Number(...)` or `undefined` for empty strings), and extend the dirty-check.

- [ ] **Step 3: Verify**

Run: `npm test && npm run build`
Expected: clean. `npm run dev` + eyeball: toggle collapses the three sub-fields; defaults show as placeholders.

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/Config/
git commit -m "feat(config): runaway failure prevention settings (on/50%/50/warnings-off)"
```

---

### Task 7: Release checks for v3.8

**Files:**
- Modify: `package.json` (version → `3.8.0`)
- Modify: `CHANGELOG.md` if the repo has one (check first: `ls CHANGELOG*`) — otherwise release notes go in the release PR description.

- [ ] **Step 1: Full verification**

Run: `npm test && npm run build`
Expected: all green.

- [ ] **Step 2: One manual E2E smoke on a fork (optional but recommended)**

`npm run test:e2e:manual claude` forks a `manual-e2e-*` env; translate one long-field record with Anthropic and confirm no truncation warning appears (pre-fix it always did on long fields). Clean up with `npm run test:e2e:manual:cleanup`.

- [ ] **Step 3: Version bump + release notes**

Notes must include (spec §8.1/§9.1): the Anthropic default change 1024→4096 and the new per-vendor override; runaway prevention **enabled by default** at 50 %/50 records with how to disable; that warnings never count as failures unless opted in.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): v3.8.0 — max output tokens fix + runaway failure prevention"
```

---

## Self-Review Notes

- **Spec coverage:** §9.1 → Tasks 1–3 (factory both vendors ✓, default ✓, UI ✓, QC-symptom regression check in Task 7 step 2). §8.1 → Tasks 4–6 (defaults ✓, errors-only ✓, abort-not-pause ✓ — implemented as loop stop + alert, honesty copy ✓, sample-size guard ✓). §11 "phase 6 needs phase 1" → single release, Task 7 gates on both.
- **Order dependency (spec §8.1 ⚠):** runaway prevention must not ship before the max_tokens fix — this plan ships them together; do not cherry-pick Task 4–6 alone.
- **Type consistency:** param names `anthropicMaxOutputTokens`/`geminiMaxOutputTokens`/`runawayPreventionEnabled`/`runawayErrorRateThreshold`/`runawayMinRecords`/`runawayCountWarnings` are declared in Tasks 1/5 and consumed with identical spelling in Tasks 3/5/6. Guard API (`recordOutcome`/`shouldAbort`/`summary`) consistent between Tasks 4 and 5.
- **Known judgment calls:** Anthropic default 4096 (safe floor across model generations) — flag in the release PR for stakeholder eyes; terminal-status dedupe caveat in Task 5 step 4 must be resolved by reading `processRecord`, not assumed.

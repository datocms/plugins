# Config Screen Wizard Redesign — Design Spec

**Plugin:** `automatic-environment-backups`
**File under redesign:** `src/entrypoints/ConfigScreen.tsx` (currently ~1,863 lines)
**Date:** 2026-06-30
**Status:** Approved design, pending spec review → writing-plans

---

## 1. Problem

The current config screen is one monolithic component that presents three flat cards
(Lambda setup, Backup schedule, Backup overview) with no ordering or per-section status.
This produced the issues in the support ticket:

1. The auth secret has **three out-of-sync representations** — the input field
   (`lambdaAuthSecretInput`), an in-memory snapshot (`savedFormValues.lambdaAuthSecret`),
   and the persisted plugin parameter. "Connect" reads the input; the overview and
   "Backup now" read the snapshot. Editing the secret without a full Save leaves them
   desynced → the plugin sends the wrong/old token → HTTP 401.
2. Connection errors surface only as a tiny status dot at the top; the actual error text
   is buried several screens down under "Backup overview".
3. New users have no guided order (set secret → deploy → connect → schedule), and no
   per-section success/failure feedback.
4. Returning users can't tell at a glance whether their setup is still healthy.

## 2. Goals / Non-goals

**Goals**
- A guided, ordered **gated accordion** of setup steps, each with its own status and save.
- **Single source of truth:** the saved plugin parameters, re-read from `ctx`. No React
  state snapshot that can lag/race.
- **Explicit per-step saves.** Every user change is committed by an explicit step action
  before anything acts on it.
- Clear per-step status: **Current step → OK / Error**.
- A **Status overview** checklist that redundantly surfaces every OK/error condition.
- Auto-generate a strong secret on fresh install; preserve any existing secret.
- Preserve existing users' working setups (persisted-parameter schema unchanged).

**Non-goals**
- No change to the persisted plugin-parameter schema (backward compatibility).
- No changes to the external lambda repo (`datocms-backups-scheduled-function`).
- No change to backup mechanics (cadences, cron, environment creation).
- **No new test infrastructure** (no jsdom/testing-library). Reuse existing `vitest`.

## 3. Status vocabulary

Setup steps (1–3) each resolve to exactly one of:

| Status | Label | Meaning / display |
|--------|-------|-------------------|
| `ok` | **OK** (green) | Saved params for this step are valid (and, for Connect, the live ping is healthy). Collapses to a one-line summary with **[Edit]**. |
| `current` | **Current step** (neutral, highlighted, expanded) | The first step that is not `ok`. Being worked on; no error yet. |
| `error` | **Error** (red, expanded) | The current step whose last save/test failed, or whose live validation now fails (e.g. secret rotated on the provider). |
| `disabled` | *(no label, grayed)* | A step after the current one. Visible but non-interactive. No "locked" chrome. |

Flow: the `current` step transitions to `ok` (next step becomes `current`) or `error`
(stays the focus until resolved). **At most one** setup step is `current`/`error` at a
time; earlier steps are `ok`, later steps `disabled`. When all three are `ok` (fully
configured), no step is `current` — every step shows its collapsed **OK** summary.

Section 4 (**Status overview**) is **not** a gated step — it is an always-visible,
read-only checklist that reflects live state and mirrors per-step errors.

## 4. Source of truth & save model

- **`ctx.plugin.attributes.parameters` is authoritative.** All status derivation and all
  actions read from it (via typed getters), re-reading from `ctx` at render/action time.
- **Remove `savedFormValues`.** The in-memory snapshot that races today is deleted.
- **Input fields are ephemeral edit-state** (`secretInput`, `urlInput`, cadence selection).
  They exist only so the user can type before committing.
- **Every user change requires an explicit per-step save.** No lambda-facing action ever
  reads unsaved input. A step action is atomic: *persist the input → then act on the
  just-persisted value.* Within a save+act handler, the code acts on the value it just
  wrote (equal to what was persisted), never on a lagging read.
- `persistPluginParameters` keeps its authoritative CMA re-read + queued merge, so
  concurrent saves serialize and never clobber unrelated keys.

This structurally eliminates the desync class of bug (#1): there is only one place a
value lives (the params), and only one way to change it (an explicit save).

## 5. Architecture / file decomposition

Split the monolith into small, single-purpose units. Pure modules are unit-testable with
the existing `vitest` (no DOM).

```
src/entrypoints/ConfigScreen.tsx      orchestrator: reads ctx params, derives step
                                       statuses, renders the accordion + Status overview
src/config/
  pluginParams.ts            (pure)   typed getters/setters over ctx params
                                       (secret, deploymentURL, connection, schedule, debug)
  deriveStepStatuses.ts      (pure)   (params + live connection) → { step1, step2, step3 }
                                       statuses + which step is current + checklist items
  generateAuthSecret.ts      (pure)   128-bit crypto → 32-char lowercase hex
  useBackupsConfig.ts        (hook)   shared edit-state, per-step save handlers,
                                       mount health ping, overview + env-list loading
  StepSection.tsx                     accordion chrome: header, status badge, expand/
                                       collapse, disabled state, one-line summary + [Edit]
  StepSecret.tsx                      Step 1
  StepConnect.tsx                     Step 2
  StepSchedule.tsx                    Step 3
  StatusOverview.tsx                  Section 4 (checklist)
  StatusBox.tsx                       neutral / success / error panel (reused in steps)
  AdvancedSettings.tsx                debug toggle (collapsible, persists on change)
```

Reused unchanged: `verifyLambdaHealth`, `lambdaAuth`, `lambdaHttp`,
`fetchLambdaBackupStatus`, `triggerLambdaBackupNow`, `backupSchedule`,
`buildBackupOverviewRows`, `deployProviders`, `pluginParameterMerging`, `debugLogger`.

## 6. Step specifications

Each setup step shows a one-sentence "what & why", its inputs, a single primary save
action, and a `StatusBox` reflecting its result.

### Step 1 — Auth secret & deploy
> *Create a shared secret the plugin and your deployed function use to authenticate with each other, then deploy the scheduler.*

- **Secret field** (`secretInput`) + **[Generate]** + **[Copy]**.
  - Fresh install (no saved secret): auto-generate a value into the field on first load
    (unsaved). Existing saved secret: load it as-is.
- **[Save secret]** — primary. Persists `lambdaAuthSecret`. Marks Step 1 `ok`.
- After the secret is saved, reveal **[Deploy to ▾]** (Vercel / Netlify / Cloudflare —
  unchanged menu) and a callout: *"Paste this value as `DATOCMS_BACKUPS_SHARED_SECRET`
  on your provider, then come back with the deployed URL."* Deploy is **disabled until the
  secret is saved** and simply opens the provider tab (no auto-injection — providers can't
  receive the value programmatically).
- If a healthy connection already exists and the secret field is edited: inline warning
  *"Changing this means updating `DATOCMS_BACKUPS_SHARED_SECRET` on your deployment and
  redeploying, or the connection will fail."* Saving a changed secret re-gates Step 2.
- **Complete when:** non-empty `lambdaAuthSecret` is saved.

### Step 2 — Connect & test connection
> *Tell the plugin where your function is deployed and verify it responds and authenticates.*

- **URL field** (`urlInput`) + **[Save & test connection]**.
- Action: persist `deploymentURL` (+ legacy `netlifyURL`/`vercelURL` for compat) → run
  `verifyLambdaHealth` using the **saved** secret + saved URL → persist the resulting
  `lambdaConnection` + `connectionValidationMode`.
- **StatusBox** shows *testing… / ✓ Connected / ✕ Failed* **in the step**, with the exact
  reason from the existing connection state machine (`errorCode`, `errorMessage`,
  `httpStatus`, response snippet) and remediation. Example (401):
  *"Auth failed — the secret here doesn't match `DATOCMS_BACKUPS_SHARED_SECRET` on your
  deployment. Update one so they match, then redeploy if you changed the provider."*
- **Complete when:** `deploymentURL` saved **and** live ping `connected`. **Error when:**
  live ping fails.

### Step 3 — Backup cadence
> *Choose how often backups run. The scheduler runs once daily and creates the sandbox backups you enable.*

- Cadence switches (Daily / Weekly / Bi-weekly / Monthly) + **[Save & continue]**.
- Action: persist `backupSchedule` → run `ensureBackupsExistForCadences` with a
  *"Creating initial backups…"* progress state; created/failed environments reported.
- **Complete when:** `backupSchedule.enabledCadences` has ≥1.

### Section 4 — Status overview (always visible, read-only)
> *Everything at a glance — nothing else to do here.*

A checklist reflecting live state, redundant with per-step errors on purpose:

- ✓/✗ Auth secret set *(warn if it's still the example default)*
- ✓/✗ Function reachable & authenticating *(mirrors Step 2 error verbatim if failing)*
- ✓/✗ Backup cadence configured — lists enabled cadences
- ✓/pending Backup environments created — e.g. "2 of 2 created" / "pending"
- Per-cadence rows: last backup / next backup / environment, with **[Backup now]** (kept).
- Summary banner: **"✓ Configured and ready — backups run daily at 02:05 UTC. You can
  leave this screen."** or **"Needs attention — see the highlighted step above."**

## 7. Existing-user & resume behavior

Derived entirely from saved params + the mount ping (which always re-validates on load):

- **Fully configured & healthy:** all setup steps `ok` (collapsed summaries), Status
  overview all green. Any step expandable via **[Edit]**.
- **Broke since last visit** (the ticket case): mount ping fails → Step 2 becomes `error`,
  auto-expanded with the exact reason; Status overview shows the red item too.
- **Partially configured:** first non-`ok` step is `current`/auto-expanded; earlier steps
  `ok`, later steps `disabled`.
- Editing an earlier step re-gates later steps (e.g. changing the secret un-verifies the
  connection → Step 2 must be re-tested).

## 8. Persistence & backward compatibility

- Persisted-parameter schema is **unchanged**: `deploymentURL`, `netlifyURL`, `vercelURL`,
  `lambdaConnection`, `connectionValidationMode`, `lambdaAuthSecret`, `backupSchedule`,
  `debug`. Existing installs load and work without migration.
- `netlifyURL`/`vercelURL` continue to be written in lockstep with `deploymentURL` (harmless,
  preserves any external readers). Reads prefer `deploymentURL`.
- `debug` persists immediately on toggle (Advanced settings), consistent with per-step saves.

## 9. Secret generation

- 16 random bytes from `crypto.getRandomValues` → lowercase hex → **32 characters**,
  charset `[0-9a-f]` (inherently URL-safe).
- 128 bits of entropy; short and well under every provider's env-var value limit
  (Vercel ~64 KB, Netlify/Cloudflare ~5 KB per value).
- `[Generate]` replaces the field value (unsaved until [Save secret]). Regenerating while
  connected triggers the Step 1 warning (see §6).

## 10. Testing

Use the **existing** `vitest` setup only. New pure modules get unit tests:

- `generateAuthSecret`: length = 32, charset `[0-9a-f]`, high-probability uniqueness across
  calls, uses `crypto.getRandomValues`.
- `deriveStepStatuses`: every permutation — fresh, secret-only, connected, connect-error,
  schedule set, fully configured, and "broke since last visit" — asserting the correct
  `current`/`ok`/`error`/`disabled` per step and the checklist items.
- A regression guard asserting a per-step save updates the param that all reads consume
  (encodes the desync fix — reads come from params, not a snapshot).

Component/accordion interaction tests are **out of scope** for now (would need a jsdom +
`@testing-library/react` harness we are deliberately not adding yet).

## 11. Risks / open items

- **DatoCMS `ctx` staleness within a handler:** immediately after `updatePluginParameters`,
  the in-scope `ctx` may not reflect the write until re-render. Mitigation: within a
  save+act handler, act on the value just persisted (in hand); rendering/derivation reads
  from the re-rendered `ctx`. `persistPluginParameters` already re-reads authoritative
  params via the CMA client before merging.
- **StrictMode / run-once effects:** the mount health ping keeps the existing run-once
  guard from the loop fix; the decomposition must preserve it.
- **"Still the default secret" detection:** the Status-overview warning compares the saved
  secret against the known example default to nudge rotation; purely advisory.

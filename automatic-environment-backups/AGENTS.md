# Automatic Environment Backups — agent notes

The configuration screen is a gated four-step wizard. All of its UI and state
live under `src/config/`; `src/entrypoints/ConfigScreen.tsx` is a thin
orchestrator.

## Architecture
- **Single source of truth:** the persisted plugin parameters
  (`ctx.plugin.attributes.parameters`), read via the pure getters in
  `src/config/pluginParams.ts`. Never keep a parallel React snapshot of saved
  values — that desync is what made the plugin send the wrong auth token.
- **Per-step saves:** every user change is committed by an explicit step action
  (`useBackupsConfig` handlers for the secret, deployment URL, connection test,
  schedule, and debug setting). There is no global Save button. A save+act
  handler acts on the value it just persisted, never on unsaved input. The four
  completion signals are: a saved secret, a saved deployment URL, a healthy
  connection, and a saved schedule.
- **Pure, unit-tested modules** (vitest, no DOM harness): `generateAuthSecret.ts`
  (128-bit hex secret), `pluginParams.ts` (typed param getters), and
  `deriveStepStatuses.ts` (step gating + status helpers). Put new
  logic behind pure functions and test it here; there is intentionally no
  component/render test harness.
- **Orchestration hook** `useBackupsConfig.ts`: edit-state, a queued
  authoritative-merge persister, the run-once mount health ping, overview/env
  loaders, and `ensureBackupsExistForCadences` (sequential creation with a 409
  retry).
- **Components:** `StepSection` (numbered-card chrome), `StepSecret` /
  `StepDeploy` / `StepConnect` / `StepSchedule`, `StatusOverview`, `StatusBox`,
  `AdvancedSettings`, and `StepTimeline` (top progress stepper). `StepDeploy`
  owns provider guidance and deployment-URL saving; `StepConnect` tests the
  already-saved URL.

## Gotchas
- DatoCMS `ctx` gets a **new identity after every `updatePluginParameters`**, and
  the app wraps in `<StrictMode>` (dev double-invoke). The mount health ping must
  run **once** via the `hasRunMountCheckRef` / `isMountCheckUnmountedRef` guard
  with an empty-deps effect. An effect that persists params *and* depends on
  ctx-derived callbacks will re-fire forever — that was a real infinite-loop bug.
- The accordion is **multi-open** (an open-step `Set`) on purpose: automatic
  progression replaces the open set with only the current step, while a user
  can manually re-open completed steps to review values such as the auth
  secret. Single-open behavior collapsed a section above the clicked one and
  caused a scroll-jump (CLS).
- An expanded step can be collapsed from any non-interactive point in its card,
  not only its header. Buttons, links, native controls, labels, and complete
  field groups marked with `data-step-interactive` are excluded from that click
  and hover behavior.
- Once all four steps are complete, the whole setup flow is wrapped in a native
  **Installation** disclosure that starts collapsed. Its open state is
  controlled so a successful **Save schedule & finish** always collapses it;
  failed validation or persistence leaves it open. Expanding it reveals the
  existing multi-open step accordions without changing their state model.
- Every incomplete step ends with a consistent action footer: supporting and
  destructive actions stay on the left, while the single step-completing
  primary action is right-aligned and carries a forward arrow. On narrow
  screens, the primary action stacks last and full-width.
- A saved deployment URL is the completion signal for **Deploy**. A healthy
  `lambdaConnection` plus `connectionValidationMode: 'health'` is the separate
  completion signal for **Connect**. Keep those gates distinct so the wizard
  resumes at the correct step after a reload.
- The **persisted-parameter schema must stay backward-compatible**:
  `deploymentURL` / `netlifyURL` / `vercelURL`, `lambdaConnection`,
  `connectionValidationMode`, `lambdaAuthSecret`, `backupSchedule`, `debug`.
- The actual backup work runs in an **external scheduled function** (repo:
  `marcelofinamorvieira/datocms-backups-scheduled-function`), `executionMode:
  'lambda_cron'`, daily at 02:05 UTC. This plugin only configures and monitors
  it — nothing runs from the browser.

## Validate
- `npm run test` (tsc + vitest) and `npm run build`. No lint script is wired
  locally; the repo-root `biome.json` is the formatting baseline.
- Original design spec (predates the Secret/Deploy split):
  `docs/superpowers/specs/2026-06-30-config-wizard-design.md`.

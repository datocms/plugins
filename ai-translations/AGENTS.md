# Repository Guidelines

## Project Structure & Module Organization
This package is a Vite + React + TypeScript DatoCMS plugin for translating localized content through external providers.

- `src/main.tsx`: registers field actions, sidebar behavior, bulk actions, modal rendering, the config screen, and the custom page.
- `src/entrypoints/Config/`: plugin settings UI, including vendor selection, prompt settings, exclusions, and feature toggles.
- `src/entrypoints/Sidebar/` (whole-record) and `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx` (bulk page) host the translation UIs; shared modals and pickers live in `src/components/` (`AITranslationsPickerModal`, `TranslationConfirmModal`, `TranslationProgressModal`) and `src/components/BulkTranslations/` (`ModelFieldPicker`, chip renderers).
- `src/utils/translation/`: provider abstraction, translation core, field-specific translators, shared guards, and vendor helpers.
- `src/utils/translation/qc/`: translation quality control — pure check functions (`checks.ts`, `structuralChecks.ts`) and the `QcFlag` model (`types.ts`) used to detect incomplete/degraded translations.
- `src/prompts/`: prompt templates used by translation flows.
- `src/**/*.test.ts(x)`: Vitest coverage lives next to the code it exercises.
- `test/fixtures/provider-responses/`: sanitized real provider response envelopes (no secrets) that ground the parser/QC tests; regenerate with `test/capture-provider-responses.mjs`.
- `docs/superpowers/`: design specs and implementation plans for larger features.
- `dist/`: generated plugin bundle; do not edit manually.

## Build, Test, and Development Commands
Run from `ai-translations/`:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run lint:fix`
- `npm run test`
- `npm run test:watch`
- `npm run coverage`

## Coding Style & Naming Conventions
- This package follows the repo-wide Biome rules; it does not use ESLint.
- Keep provider-specific code inside `src/utils/translation/providers/` and route provider selection through `ProviderFactory.ts`.
- Keep field-type behavior in the translation utility layer instead of hardcoding it in entrypoints.
- Follow the existing file style in the touched area instead of normalizing unrelated formatting.

## UI & Modals
- Style plugin UI with the semantic `--color--*` Canvas tokens so it follows the user's light/dark theme. Do not use the deprecated legacy tokens (`--base-body-color`, `--accent-color`, `--border-color`, …), `ctx.theme` colors, or hardcoded hex/rgb.
- Never call `ctx.openModal` or `ctx.openConfirm` from inside a `renderModal`: DatoCMS renders the nested dialog *behind* the current modal and the await never resolves (the UI hangs on "Working…"). Instead, have the modal `ctx.resolve(...)` its result, then open any confirm/follow-up modal from the top-level handler (`executeItemsDropdownAction`, `renderPage`, …).
- Render locale/model chips through the shared `chipOption` renderer (single source of truth in `src/components/BulkTranslations/chipOption.tsx`). Pass `classNamePrefix={CHIP_SELECT_CLASS_PREFIX}` to chip `SelectField`s so single- and multi-selects render matching chips.
- Bulk progress is structured, not stringly-typed: carry per-record data on `ProgressUpdate` (`statusText`, `recordLabel`, `itemTypeId`, `updatedAt`, `translated*/copiedLink*` field lists, `warnings`), never concatenated into `message`. `ProgressRow` (`src/components/BulkTranslations/ProgressRow.tsx`) renders each row — amber icon + "— with warnings" + a custom hover tooltip for warned records, and the title as a link (new tab) via `buildRecordEditorUrl` (`src/utils/recordUrl.ts`), which needs `ctx.site.attributes.internal_domain` + `ctx.isEnvironmentPrimary` because the plugin iframe's own origin is not the admin origin. The tooltip uses `position: fixed` at coordinates measured from the row on hover — do NOT switch it to a CSS `:hover` absolute tooltip, it gets clipped by the `.__updates` scroll container.
- The modal's Export CSV button builds its report through the pure `toCsv` / `buildTranslationReportRows` helpers in `src/utils/csvExport.ts` (unit-tested); keep new CSV columns there and add them to `TRANSLATION_REPORT_HEADERS`. `downloadCsv` prepends a UTF-8 BOM and falls back to opening a new tab if the sandbox blocks the download.

## Translation Workflow Notes
- Supported providers are currently OpenAI, Gemini, Anthropic, and DeepL.
- There are three main flows: field-level translation, whole-record translation, and bulk translation. Changes that affect one flow often also need review in the shared translation utilities.
- Prompt placeholders and locale handling are shared behavior; treat them as cross-cutting concerns, not one-off UI details.
- If you touch provider errors, batching, locale mapping, or translation routing, review the corresponding tests before finishing.
- Cancellation flags — and anything the long-running translation loop reads through `checkCancellation` — must live in a `useRef`, not `useState`. The loop closes over its start-time snapshot, so a state value is read stale and the run never stops cooperatively (the user clicks Cancel but records keep translating). Keep a parallel `useState` only when the UI must re-render off the flag (e.g. a "Cancelling…" button label), and write both.
- Quality control: the engine emits `QcFlag`s (`length-mismatch`, `placeholder-loss`, `truncated`, `html-structure`, `markdown-structure`, `no-op`, `length-ratio`, plus the schema-side `length-validator` from `checkFieldLength`) through a non-breaking `onQcFlag` callback threaded via the translation options. `translateFieldValue` stamps each flag with its field path + locale; entrypoints collect them and surface a review summary (sidebar / field-dropdown alert+notice). In bulk, **severity drives the per-record status**: an `error`-severity flag marks the record a failure (`status: 'error'`, even when some fields wrote) while `warning`-severity flags mark it `completed-with-warnings`; both are kept in the retained review list. `BuildTranslatedUpdatePayloadResult.errorCount` carries the escalation signal — when you add a status branch, key off it, not off the warning strings (severity is otherwise lost into display text). Repairs are flagged, never silent — a wrong-length response is repaired (over-split single HTML segments are rejoined) and flagged; a truncated/unparseable response falls back to source and is flagged. Redundant overlaps are pruned in `suppressRedundantFlags`: `length-ratio` is dropped when a field-wide error (length-mismatch/truncated, no `segmentIndex`) condemns the value, or when a per-segment error already fired on that same `segmentIndex`. When you add a field-type translator, forward `onQcFlag` and the `kind` (html/markdown/text) hint down to `translateArray`; for a batch of **independent sub-fields** (e.g. SEO title+description, file alt/title/metadata) also pass `qcAtomicSegments: true` so `no-op` is evaluated per segment instead of aggregated across the batch.
- `translateField` returns a `FieldOutcome` (`translated` | `untranslatable` | `failed`). **Only `untranslatable` fields may receive a locale-sync fallback.** Filling a `failed` field writes `null` into the target locale because a provider 429'd — this was a real, shipped bug. The old sentinel-by-absence guard (`if (updatePayload[field]) continue`) could not tell the two apart; do not reintroduce it.
- Success is accounted per `(record, locale)`, never per record. Summing translated-field counts across locales lets a healthy locale mask a wholly-dead sibling — `summarizeLocaleOutcomes` fails the record if any locale has a failed field.
- Provider errors are classified by `isSystemicError`. Systemic (`rate_limit`, `auth`, `quota`, `network`) pauses the run; content-scoped (`model`, `plugin`, `unknown`, `datocms`) fails the field and its record, then continues.
- `Retry-After` is an optimization, never a precondition. Browser callers cannot read the header unless the server sets `Access-Control-Expose-Headers`, so the exponential backoff must be correct on its own.
- Link/Links (reference) fields are never translated — references are shared across locales. The locale-sync fallback in `buildTranslatedUpdatePayload` (`ItemsDropdownUtils.ts`) copies their source references into new locales so the update is valid. This also satisfies min-count `size` validators, which links/gallery fields use *instead of* `required` (detect via `hasMinItemsValidator`/`isReferenceField` in `SharedFieldUtils.ts`, keyed on validators, not editor names). Copies are shallow: linked records are not followed or re-translated (avoids deep/infinite recursion). Each copy is recorded as a structured `ReferenceCopy` and consolidated to one per-record warning via `summarizeReferenceCopies`. A record that only had references copied still counts as an update (`referenceFieldsCopied`) and surfaces as `completed-with-warnings`, not "no fields updated". When both QC flags and reference copies apply to a record, `error`-severity QC flags win (status `error`); otherwise the record is `completed-with-warnings`.

## Testing Guidelines
- Use `npm run build` as the baseline validation step.
- Add or update Vitest coverage when changing translation logic, provider selection, locale behavior, or error normalization.
- Prefer targeted unit coverage around `src/utils/translation/` over manual-only verification for core translation behavior.
- The parser/QC tests are grounded in real provider response shapes under `test/fixtures/provider-responses/` (fenced JSON, truncation, multi-candidate, structured output, over-split). To refresh them, put keys in a gitignored `.env.testing` and run `node --env-file=.env.testing test/capture-provider-responses.mjs`; the script writes only sanitized envelopes (no keys, no real customer content).
- `e2e/tests/bulk-reliability.spec.ts` injects faults with `page.route()` rather than hitting a real provider. Because provider calls run in the browser (`dangerouslyAllowBrowser: true`), they are interceptable — **this lane needs no API key** and runs with an empty `.env.testing`.
- **Browser-driven E2E lives in `e2e/`** and runs the plugin against a real DatoCMS project + real providers (`npm run test:e2e`). It is the slow, side-effecting tier (forks environments, spends provider credits) — reach for it only to prove a whole flow through the UI + CMA, not for logic covered by unit tests. Before running, debugging, or extending it — or touching the seed, the provider matrix, environment forking/cleanup, or dashboard auth — read [`e2e/AGENTS.md`](e2e/AGENTS.md): it documents the harness, the (partly non-idempotent) seed, how to scope a run to one provider, the fork/teardown lifecycle, and the hard-won gotchas (e.g. never wait on `networkidle` against the dashboard; the modal stats-line ↔ `parseReport` contract). Keep that file in sync when you change the suite's internals.

# Repository Guidelines

Vite + React + TypeScript DatoCMS plugin that translates localized content through external providers (OpenAI, Gemini, Anthropic, DeepL). Three flows — field-level, whole-record (sidebar), and bulk — share the translation utilities, so a change to one flow usually needs review in the others.

## Project Structure

- `src/main.tsx`: registers field actions, sidebar, bulk actions, modals, config screen, and the custom page.
- `src/entrypoints/Config/`: settings UI (vendor selection, prompts, exclusions, feature toggles).
- `src/entrypoints/Sidebar/` and `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx`: translation UIs; shared modals/pickers in `src/components/` and `src/components/BulkTranslations/`.
- `src/utils/translation/`: provider abstraction (`providers/` + `ProviderFactory.ts`), translation core, field-specific translators, shared guards.
- `src/utils/translation/qc/`: quality control — pure check functions and the `QcFlag` model (`types.ts`).
- `src/prompts/`: prompt templates.
- `src/**/*.test.ts(x)`: Vitest coverage lives next to the code it exercises.
- `test/fixtures/provider-responses/`: sanitized real provider response envelopes grounding the parser/QC tests; regenerate with `test/capture-provider-responses.mjs`.
- `docs/superpowers/`: design specs and implementation plans for larger features.
- `dist/`: generated bundle; never edit manually.

## Commands

Run from `ai-translations/`: `npm run dev` / `build` / `lint` / `lint:fix` (Biome, not ESLint) / `test` / `test:watch` / `coverage`.

## Coding Style

- Keep provider-specific code in `src/utils/translation/providers/`; route selection through `ProviderFactory.ts`.
- Keep field-type behavior in the translation utility layer, not hardcoded in entrypoints.
- Follow the existing file style in the touched area; don't normalize unrelated formatting.

## UI & Modals

- Style with the semantic `--color--*` Canvas tokens only — no deprecated legacy tokens (`--base-body-color`, `--accent-color`, …), no `ctx.theme` colors, no hardcoded hex/rgb.
- Never call `ctx.openModal`/`ctx.openConfirm` from inside a `renderModal` — the nested dialog renders *behind* the modal and the await never resolves. Have the modal `ctx.resolve(...)`, then open the follow-up from the top-level handler.
- Render locale/model chips through the shared `chipOption` renderer (`src/components/BulkTranslations/chipOption.tsx`) and pass `classNamePrefix={CHIP_SELECT_CLASS_PREFIX}` so single- and multi-selects match.
- Bulk progress is structured, not stringly-typed: carry per-record data on `ProgressUpdate` fields (`statusText`, `recordLabel`, `translated*/copiedLink*` lists, `warnings`, …), never concatenated into `message`. `ProgressRow` renders each row; record-title links use `buildRecordEditorUrl` (`src/utils/recordUrl.ts`), which needs `ctx.site.attributes.internal_domain` + `ctx.isEnvironmentPrimary` because the plugin iframe's origin is not the admin origin. The warning tooltip is `position: fixed` at hover-measured coordinates — a CSS `:hover` absolute tooltip gets clipped by the `.__updates` scroll container.
- CSV export goes through the pure, unit-tested `toCsv`/`buildTranslationReportRows` helpers in `src/utils/csvExport.ts`; add new columns there and to `TRANSLATION_REPORT_HEADERS`. `downloadCsv` prepends a UTF-8 BOM and falls back to a new tab when the sandbox blocks downloads.

## Translation Engine Rules

### Field exclusion
Vendor-agnostic and block-aware. The config screen's `listOfFields` is built from `ctx.loadItemTypeFields` over **every** item type — models AND blocks (labelled "\<name> block" via `buildFieldListEntries`). It is DatoCMS schema, not a provider call: never gate it on the provider key/vendor. Enforcement is shared — `translateFieldValue` checks `isFieldExcluded([fieldId, fieldApiKey])` for top-level fields and recursively for block sub-fields, covering both the sidebar/form flow and the CMA/bulk flow. Exclusion tokens are field **ids** (what the picker stores), with `api_key` as fallback.

### Cancellation
Anything the long-running loop reads through `checkCancellation` must live in a `useRef`, not `useState` — the loop closes over a stale snapshot, so a state flag never stops it. Keep a parallel `useState` only when the UI must re-render off the flag, and write both.

### Quality control (QC)
The engine emits `QcFlag`s through a non-breaking `onQcFlag` callback threaded via translation options; `translateFieldValue` stamps each flag with field path + locale, and entrypoints collect them into a review summary.

- **Severity reflects certainty.** `error` = known corruption: `truncated`, `placeholder-loss`, the structural checks (`html-structure`/`markdown-structure`), and `length-validator`. `warning` = suspicion only: `length-mismatch`, `source-fallback`, `no-op`, `length-ratio`, `seo-truncated`. A warning must never by itself fail a record.
- In bulk, severity drives per-record status: any `error` flag ⇒ `status: 'error'` (even if some fields wrote); warnings ⇒ `completed-with-warnings`. Key new status branches off `BuildTranslatedUpdatePayloadResult.errorCount`, not off warning strings.
- **Repairs are flagged, never silent.** Wrong-length responses are repaired (over-split HTML/Markdown segments rejoined) and flagged `length-mismatch`; a positional slot with missing/non-string output keeps the source and is flagged `source-fallback` — except when the *source* slot is blank (echoing empty back loses nothing; don't raise a spurious review). Truncated/unparseable responses fall back to source and are flagged.
- `length-validator` (`checkFieldLength`) fires when a value violates `max`/`min`/`eq` — **including a blank value against `min`/`eq`**, because DatoCMS enforces `length` independently of `required` and 422s it. Only a `max`-only validator lets a blank through.
- `suppressRedundantFlags` prunes overlaps (e.g. `length-ratio` under a field-wide error/`length-mismatch`; field-wide `source-fallback` under a `truncated` or field-wide `length-mismatch`), and `coalesceSourceFallbackFlags` merges per-chunk `source-fallback` flags into one with the field-level denominator — long fields are translated in independent chunks, so per-chunk counts misreport the total.
- When adding a field-type translator: forward `onQcFlag` and the `kind` (html/markdown/text) hint down to `translateArray`; for a batch of independent sub-fields (SEO title+description, file alt/title/metadata) also pass `qcAtomicSegments: true` so `no-op` is evaluated per segment.

### Field outcomes & the null-guard
`translateField` returns a `FieldOutcome` (`translated` | `untranslatable` | `failed`) and never mutates the payload — the caller writes from the outcome. A `failed` field must never overwrite an *existing* target-locale value with `null` (e.g. after a provider 429). This is enforced in the locale-sync loop by the `existingTargetKey` skip (target locale already holds a value), **not** by excluding `failed` fields wholesale — an `if (updatePayload[field]) continue` sentinel can't tell `failed` from `untranslatable`; do not reintroduce it.

### Locale sync
When a locale is ADDED to a record, **every** localized field must carry it or `items.update` is rejected with `VALIDATION_INVALID_LOCALES` — losing the successfully-translated siblings too. So `shouldApplyLocaleSyncFallback` returns `true` for `failed` as well as `untranslatable`/never-attempted: the loop fills a not-yet-present target locale for every non-`translated` field (source value for required fields, `null` for optional), while the `existingTargetKey` skip preserves the null-guard. Net effect: a content-scoped failure into a new locale partial-saves the record (siblings kept, failed field empty) and is still reported as a failure.

### Success accounting
Per `(record, locale)`, never per record — summing translated-field counts across locales lets a healthy locale mask a dead sibling. `summarizeLocaleOutcomes` fails the record if any locale has a failed field.

### Provider errors
`isSystemicError` classifies: systemic (`rate_limit`, `auth`, `quota`, `network`) pauses the run; content-scoped (`model`, `plugin`, `unknown`, `datocms`) fails the field + record and continues. **Preserve classification across throw boundaries**: rethrow as `NormalizedError` (carrying the `NormalizedProviderError`), never a bare `Error` — a bare rethrow drops the status and re-normalizes `auth` → `unknown`, so an invalid API key silently fails every field instead of pausing. `translateArray`'s catch and `handleTranslationError` do this; `normalizeProviderError` short-circuits on an already-`NormalizedError` input so code/hint/`retryAfterMs` survive.

### Retry-After
An optimization, never a precondition — browsers can't read the header without `Access-Control-Expose-Headers`, so exponential backoff must be correct on its own. `computeRetryDelay` treats a parsed hint of `0` as *no* hint (zero-delay retry hammers the still-limited endpoint); only a strictly positive hint short-circuits the backoff.

### Bulk report
`buildBulkReportRows` (`bulkReport.ts`) is the durable "which records failed and why" list. Each QC flag is mirrored into `ProgressUpdate.warnings` (live tooltip) AND kept structurally in `qcFlags`; the report renders the structured flag and drops the mirrored free-text (matched via `QC_WARNING_PREFIXES` from `ItemsDropdownUtils`) so one flag isn't counted twice. A free-text warning row takes the record's *status* severity. The modal resolves with its `progress` on **both** Close and Cancel — cancelling mid-run still yields the partial report.

### File/gallery fields
Translate `alt`/`title` (plus extra string metadata); when blank on the field value, `FileFieldTranslation.ts` enriches from the upload's `default_field_metadata`. That structure has **two live shapes** and `readUploadDefaultAltTitle` must read both: legacy locale-first `{ en: { alt, title, focal_point } }` and field-first `{ alt: { en, it }, focal_point: { x, y } }` (from the [non-localized focal points](https://www.datocms.com/product-updates/non-localized-focal-points) update — default for projects created after 2026-06-11). Detection keys on whether a top-level key matches the source locale; locale codes never collide with `alt`/`title`/`focal_point`. Reading only one shape silently disables enrichment on half the projects in the wild.

### Link/Links (reference) fields
Never translated — references are shared across locales. The locale-sync fallback in `buildTranslatedUpdatePayload` (`ItemsDropdownUtils.ts`) shallow-copies source references into new locales (linked records are not followed or re-translated). This also satisfies min-count `size` validators, which links/gallery fields use *instead of* `required` — detect via `hasMinItemsValidator`/`isReferenceField` in `SharedFieldUtils.ts`, keyed on validators, not editor names. Each copy is recorded as a structured `ReferenceCopy` and consolidated via `summarizeReferenceCopies`; a reference-copy-only record still counts as an update and surfaces as `completed-with-warnings`. When QC flags and reference copies both apply, `error`-severity QC flags win.

### Grapheme-safe truncation
Any length-based truncation of DatoCMS text — record labels (`deriveRecordLabel`), SEO title/description (`SeoTranslation.ts`) — must go through `segmentGraphemes`/`truncateToGraphemes` (`utils/graphemes.ts`), never `.substring`/`.slice`/`.length`. UTF-16 slicing persists lone surrogates; even code-point slicing splits grapheme clusters (ZWJ emoji, flags, combining marks).

### ConfigScreen field-list load
Vendor-agnostic (every vendor, including block sub-fields) but must run **once**: the SDK re-renders with a fresh `ctx` on every state change, so a `[ctx]`-only effect without a `useRef` load-once guard re-issues the full `loadItemTypeFields` sweep on each render — a schema-read burst that can hit rate limits.

## Testing

- `npm run build` is the baseline validation step.
- Add/update Vitest coverage when changing translation logic, provider selection, locale behavior, or error normalization; prefer targeted unit coverage around `src/utils/translation/` over manual-only verification.
- Parser/QC tests are grounded in real provider response shapes under `test/fixtures/provider-responses/` (fenced JSON, truncation, multi-candidate, structured output, over-split). To refresh: put keys in a gitignored `.env.testing` and run `node --env-file=.env.testing test/capture-provider-responses.mjs` — it writes only sanitized envelopes.
- `e2e/tests/bulk-reliability.spec.ts` injects faults with `page.route()` (provider calls run in the browser, so they're interceptable). Pure-fault tests (429/401 pause tests, every call faulted) need no API key; tests that let calls fall through to a real provider are gated to the deterministic DeepL lane and need a key.
- Know *which* fault reaches *which* path: a 429 is systemic, so the run pauses before `items.update` — a rate-limit test proves "nothing was written", not "a failed field wasn't nulled". A **content-scoped error (400)** is the only way into the locale-sync fallback loop, so it's the only honest end-to-end test of the null-write guard.
- **Browser-driven E2E lives in `e2e/`** (`npm run test:e2e`) and runs against a real DatoCMS project + real providers — slow and side-effecting (forks environments, spends provider credits); use it only to prove a whole flow, not logic covered by unit tests. Before touching the suite, seed, provider matrix, or fork/teardown lifecycle, read [`e2e/AGENTS.md`](e2e/AGENTS.md) and keep it in sync when you change the suite's internals.

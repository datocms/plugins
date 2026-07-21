# Repository Guidelines

Vite + React + TypeScript DatoCMS plugin that translates localized content through external providers (OpenAI, Gemini, Anthropic, DeepL, Yandex Translate). Three flows — field-level, whole-record (sidebar), and bulk — share the translation utilities, so a change to one flow usually needs review in the others.

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

Need a real project to click around in? `npm run test:e2e:manual [-- <vendor>]` forks a throwaway env from the E2E project, pins the plugin to a provider, and opens it in your browser; `npm run test:e2e:manual:cleanup` reclaims the sandboxes. Details in [`e2e/AGENTS.md`](e2e/AGENTS.md).

## Coding Style

- Keep provider-specific code in `src/utils/translation/providers/`; route selection through `ProviderFactory.ts`.
- Keep field-type behavior in the translation utility layer, not hardcoded in entrypoints.
- Follow the existing file style in the touched area; don't normalize unrelated formatting.

## UI & Modals

- Style with the semantic `--color--*` Canvas tokens only — no deprecated legacy tokens (`--base-body-color`, `--accent-color`, …), no `ctx.theme` colors, no hardcoded hex/rgb.
- Never call `ctx.openModal`/`ctx.openConfirm` from inside a `renderModal` — the nested dialog renders *behind* the modal and the await never resolves. Have the modal `ctx.resolve(...)`, then open the follow-up from the top-level handler.
- Render locale/model chips through the shared `chipOption` renderer (`src/components/BulkTranslations/chipOption.tsx`) and pass `classNamePrefix={CHIP_SELECT_CLASS_PREFIX}` so single- and multi-selects match.
- Bulk progress is structured, not stringly-typed: carry per-record data on `ProgressUpdate` fields (`statusText`, `recordLabel`, `itemTypeId`, `updatedAt`, `translated*/copiedLink*` lists, `warnings`, …), never concatenated into `message`. `ProgressRow` renders each row; record-title links use `buildRecordEditorUrl` (`src/utils/recordUrl.ts`), which needs `ctx.site.attributes.internal_domain` + `ctx.isEnvironmentPrimary` because the plugin iframe's origin is not the admin origin. The warning tooltip is `position: fixed` at hover-measured coordinates — a CSS `:hover` absolute tooltip gets clipped by the `.__updates` scroll container.
- CSV export goes through the pure, unit-tested `toCsv`/`buildTranslationReportRows` helpers in `src/utils/csvExport.ts`; add new columns there and to `TRANSLATION_REPORT_HEADERS`. `downloadCsv` prepends a UTF-8 BOM and falls back to a new tab when the sandbox blocks downloads.
- The post-translation **Publish all translated records** action must include only completed records that were actually updated and whose models have `draft_mode_active`; CMA bulk-publish requests must contain no more than 200 records each, and a partial failure can retry only the remaining records.

## Providers

- Supported providers are OpenAI, Gemini, Anthropic, DeepL, and Yandex Translate. Keep provider-specific code in `src/utils/translation/providers/` and route selection through `ProviderFactory.ts`.
- Yandex Translate goes through the same unified engine as the other vendors: v2 API via the built-in DatoCMS CORS proxy, supported-locale resolution (preserving variants like `pt-BR`/`sr-Latn`), HTML-aware requests, placeholder preservation, and Unicode-aware batching within Yandex's 10,000-character-per-request limit (`YandexMap.ts`, `providers/YandexProvider.ts`, `YandexConfig.tsx`). A single segment over the limit is rejected with an actionable error rather than split in a way that could corrupt HTML/Markdown/JSON/ICU/placeholders.
- Prompt placeholders and locale handling are shared, cross-cutting behavior — not one-off UI details. If you touch provider errors, batching, locale mapping, or translation routing, review the corresponding tests before finishing.

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

### Frameless single blocks — a rendering mode, not a field type
`frameless_single_block` is an **`appearance.editor`** on the `single_block` field type, not a field type of its own. The stored value, validators, and CMA payload are byte-identical to `framed_single_block` — verified in `datocms/api` (`lib/dato/field_type.rb`, `lib/dato/editor.rb`; `Dato::Editor::FramelessSingleBlock` is an empty class) and against live schema. **Any data-layer branch on framed-vs-frameless is branching on a CSS choice.**

Worse, "frameless" isn't even stable. The CMS decides at *render time* (`cms/src/components/sub/RichContent/FramelessSingleBlock.tsx:89-95`) and silently falls back to the framed renderer unless **all** of: `validators.required` is present, exactly one block model is allowed, and there is no live validation error. The backend enforces none of this. So a field can be **frameless in the schema and framed on screen** — and a frameless field flips *back* to framed the moment it has an error.

Consequences, in order of importance:

- **Never detect frameless to decide how to translate.** Treat `single_block` uniformly and let `translateFieldValue` recurse (`case 'frameless_single_block'` has routed to `translateBlockValue` since commit `5381127`, Feb 2026). This is what the bulk/CMA path does, and it's why bulk is correct.
- **The one place it legitimately matters is the field dropdown** (`main.tsx`), and even there you don't detect it: in true frameless mode DatoCMS renders *no field header and no kebab* for the parent, so `fieldDropdownActions` can only ever fire on the block's **sub-fields**. Translating such a block as a unit from the dropdown is impossible, permanently. That is what upstream issue #5 was about and why the per-sub-field path exists.
- **`translateRecordFields.ts` (the sidebar) still decomposes frameless blocks** — skipping the parent at `:728`, hoisting sub-fields, writing leaf paths like `hero.it.headline`. That was correct in Nov 2025 (the engine had no frameless case) and has been **obsolete since Feb 2026**. It is obsolete, not dead: it runs on every sidebar translation, it makes the sidebar ignore both the exclusion list and the field-type allowlist, and a leaf write into a not-yet-materialised block produces a block with no `itemTypeId`, which `cms/src/utils/prepareItemPayload.ts:343-347` serialises to **`null`** — silently discarding the translation. See `docs/superpowers/specs/2026-07-13-field-selection-investigation.md`.
- A whole-block write at the parent path **is** honoured — `ctx.setFieldValue` is a pass-through to Formik `setIn`, and the form registers `hero.en` (the parent), not the leaves. It must be in *form* shape (`{ itemId, itemTypeId, ...subValues }`), not CMA shape; a malformed object is serialised to `null` with no error.

### Block sub-fields are never localized
DatoCMS **rejects `localized: true` on any field of a `modular_block` item type with a 422** — `datocms/api/app/models/field.rb:167,235-242`, an unconditional validation (`modular_block` is immutable after creation, so there is no back door). Per-locale block content comes from the **container** field being localized: each locale holds its own independent block instances with distinct IDs. Docs: *"Block fields per se cannot be localized"* (`content-modelling/blocks.md`); the DatoCMS skills file it under "Platform rules, not preferences".

So `localized: false` on a block sub-field does **not** mean "untranslatable" — it's the normal case, and the value is translated directly. `filterTranslatableFields` may filter on `localized` only because it lists **top-level** model fields, where the check is correct; pushing that filter into blocks would silently drop every block field. `processBlockFields` correctly applies no `localized` gate. The `isLocalizedField` branch at `TranslateField.ts:935` is **dead code** — it handles a shape the API 422s.

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

# Translation Quality-Control (Defense-in-Depth) — Design

**Date:** 2026-06-23
**Status:** Finalized — ready for implementation
**Scope:** `ai-translations` plugin — detect and surface incomplete/degraded AI translations instead of saving them silently.

---

## 1. Background & problem

The plugin translates field values via OpenAI, Google/Gemini, Anthropic (free-form chat returning a JSON array we parse) and DeepL (native batch array API). A prior investigation found that the engine **silently degrades** on several failure modes — the value is written/saved as a successful translation while actually containing untranslated source text or dropped content:

- **Length-repair padding** (`translateArray.ts` `parseTranslationResponse`): when the model returns fewer/garbled array elements, missing slots are filled with the **original untranslated segment**. No throw, no signal.
- **Over-merge truncation:** when the model returns *more* elements than sent (e.g. it split one multi-block HTML field into one element per `<p>`), the surplus is truncated. (The single-segment HTML case is now rejoined; the general case is still lossy.)
- **Empty response → `[]`**, then every slot falls back to source.
- **Provider truncation** (`finish_reason: length`) is invisible because providers return a bare string and the flag is discarded.

The current error surface only catches **thrown** errors (provider/transport/parse). The entire class of "we salvaged a malformed response but lost content" is counted as **success** in both single and bulk flows. This design adds a quality-control (QC) layer that **verifies completeness, repairs-then-flags (never silently), and surfaces** the result for human vetting.

A separate research pass confirmed: provider-side array-length enforcement is **not** a clean cross-provider win (only Gemini can pin array length natively; OpenAI/Anthropic require an awkward object-key schema and per-model capability gating). It is therefore **out of scope** — the defensive check on our side is provider-agnostic and is the real guarantee.

## 2. Goals / non-goals

**Goals**
- Detect incomplete/degraded translations deterministically where possible (length, truncation, placeholder loss) and heuristically where not (structure, no-op, ratio).
- Stop counting silently-degraded results as clean successes.
- Surface issues for manual vetting — at translate time in the single-record editor (sidebar bubbles + alert) and warn-after with a retained list in bulk. **Non-blocking:** the plugin surfaces, it never prevents a save.
- Keep prevention as the already-shipped prompt hardening only.

**Non-goals**
- Provider-side structured-output / array-length enforcement (dropped — asymmetric, high-surface, not needed given the defensive check).
- Grading translation *quality*/fluency (out of scope; we only check whether the value is *structurally complete and plausibly translated*).
- Blocking/gating saves (single or bulk). The plugin surfaces issues for manual vetting; it never prevents a save. (A single-record `onBeforeItemUpsert` gate was considered and dropped as too complex for the value — see §12.)

## 3. Architecture — one QC layer, two surfaces

New module `src/utils/translation/qc/`:

- **Flag model** — every check emits a uniform record:
  ```ts
  type QcSeverity = 'error' | 'warning';
  type QcCheckId =
    | 'length-mismatch' | 'truncated' | 'placeholder-loss'   // Phase 1, deterministic, error
    | 'html-structure'  | 'markdown-structure'                // Phase 2, deterministic, error
    | 'no-op' | 'length-ratio';                                // Phase 2, heuristic, warning
  type QcFlag = {
    checkId: QcCheckId;
    severity: QcSeverity;
    fieldPath: string;        // DatoCMS field api key / path
    locale: string;
    segmentIndex?: number;    // when the value is multi-segment
    message: string;          // human-facing, normalized
  };
  ```
- **Checks are pure functions** `(source, translated, kind, meta) => QcFlag | null`, with no I/O, individually unit-testable. They run inside `parseTranslationResponse` / `translateArray` immediately before `detokenize`, plus a per-field aggregation step.
- **Repair-then-flag, never silent:** the existing repair logic keeps running, but `parseTranslationResponse` now returns `{ values, flags }` so callers receive the repaired value *and* the flags describing what was repaired.
- **Two surfaces** consume the flags: single-record editor (sidebar bubble + alert, at translate time) and bulk (progress modal + retained list). See §6.

## 4. Severity model

Two tiers, keyed on the localization-QA industry rule **"does the defect corrupt the stored value?"** (MateCat/Xbench/CheckMate/MQM convention), *not* "is the translation good?":

- **`error`** — corrupts/loses stored content. Repaired then flagged prominently (red bubble + alert at translate time; counted as a failure in bulk). **Non-blocking** — the plugin surfaces, it does not prevent saving. Checks: `length-mismatch`, `truncated`, `placeholder-loss`, `html-structure`, `markdown-structure`.
- **`warning`** — quality suspicion needing a human; never blocks; surfaced for review and dismissible. Checks: `no-op`, `length-ratio`.

**Alert-fatigue controls:** keep the default set small and high-precision; suppress redundant overlapping flags (if `length-mismatch` fires on a segment, suppress `length-ratio` there); heuristic checks aggregate at field level (e.g. no-op only when >50% of non-exempt segments are unchanged).

## 5. Checks catalog

### Phase 1 — deterministic backbone (no provider request changes)

| checkId | severity | definition | inputs (already available) |
|---|---|---|---|
| `length-mismatch` | error | model returned ≠ N elements for an N-segment request; we repair positionally, then flag | `arr` vs `originalSegments` in `parseTranslationResponse` |
| `placeholder-loss` | error | a `⟦PH_n⟧` token injected by `tokenize()` is missing from the output before `detokenize()` | `tokenMaps` + output segments |
| `truncated` | error | provider signalled the response was cut off mid-output | provider `finishReason` (see §7) |

### Phase 2 — heuristic sanity checks (layered on Phase 1 infra)

| checkId | severity | definition | notes |
|---|---|---|---|
| `html-structure` | error | block-level tag **multiset** differs between source & translated HTML | `DOMParser`; compare `tagName` only over a BLOCK_TAGS allowlist `[p,h1-h6,ul,ol,li,blockquote,pre,table,tr,td,th,img,hr,figure]`; **never** compare attributes (so `data-path-to-node`/`data-*` are ignored); run only when `isHTML`, **after** the single-segment over-split rejoin |
| `markdown-structure` | error (struct) / warning (prose) | block-signature multiset differs | ~40-line fenced-code-aware line scanner (no markdown parser in deps): count ATX headings by level, ul/ol items, blockquotes, thematic breaks, table rows, code fences, `[..](..)` links, `![..](..)` images; **error** on drop/add of headings/lists/code/links/images; **warning** on paragraph-count drift only |
| `no-op` | warning | `norm(source) === norm(translated)` and segment is translatable | `norm = s.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase()`; exempt numeric/symbol-only, URL/email/path, code-fenced/`<code>`/`<pre>`, short/atomic (`<3` `\p{L}` letters, or `<8` letters without a space), residual-empty after stripping `⟦PH_n⟧`; aggregate: only warn when >50% of non-exempt segments unchanged (or a single long value wholly unchanged) |
| `length-ratio` | warning | output far shorter than input (truncation suspicion) | per-segment, HTML/placeholder-stripped, only segments ≥20 source chars, flag when `outChars/inChars < 0.3`; **no** upper bound, **no** per-language-pair table (char ratio legitimately spans ~45–300% by pair). Weakest signal; suppressed when a deterministic error already fired on the segment |

For `structured_text`, reuse the existing `collectVisibleTextLeaves` machinery: compare source vs translated **leaf count** and promote the currently-silent `ensureArrayLengthsMatch` pad/truncate into a `length-mismatch` flag.

## 6. Surfacing

### 6a. Single-record editor

Single-record translation is **surfacing-only — no save gate.** When the user translates in the sidebar or via a field-dropdown action, the **full** flag set is computed (full context: chosen source/target locales **and** the provider response, so every check runs) and shown immediately:

- a red **error** bubble per field/locale — the sidebar already renders per-field status bubbles, so `error` reuses that path — and a softer advisory for **warnings**;
- a summarizing `ctx.alert` for errors / `ctx.notice` for warnings, naming the affected fields/locales.

Flags are **advisory**: the user reviews them and decides whether to keep or re-translate before saving. The plugin does **not** block the save — a single-record `onBeforeItemUpsert` gate was considered and dropped as too complex for the value (see §12).

### 6b. Bulk (CMA-driven)

Bulk is also surfacing-only (CMA writes bypass every UI hook). Changes to `ItemsDropdownUtils` / `TranslationProgressModal` / `AIBulkTranslationsPage`:
- **Stop masking:** a record whose fields produced `error` flags is **not** a clean success. Add a `completed-with-warnings` (warning flags) and surface `error` flags as a real failure in the per-record row + counters (today a record counts as success as long as ≥1 field translated).
- **Retain the list:** the modal already returns a `progress` array that both callers currently discard. Persist a **reviewable failure/warning list** (record → field → locale → checkId → message) that survives modal close, so users can vet/re-run. Group by check; allow dismiss.

## 7. Provider metadata refactor (Phase 1)

To support `truncated`, chat providers must stop returning a bare string:
- `completeText(...) → { text: string; finishReason?: string }` (or a parallel `completeTextWithMeta`).
- Map: OpenAI `choices[0].finish_reason === 'length'`; Anthropic `stop_reason === 'max_tokens'`; Gemini `candidates[0].finishReason === 'MAX_TOKENS'`. DeepL: positional array, no per-segment flag — relies on `length-mismatch`.
- `parseTranslationResponse` receives `finishReason`; if truncated, emit a `truncated` error for the chunk.
- **Fix along the way:** `AnthropicProvider` sends `max_output_tokens` (the Messages API field is `max_tokens`) defaulting to 1024 — verify/correct, else `truncated` will false-positive (and large fields are silently truncated today regardless).

## 8. Data flow

```
translate action (sidebar / dropdown / bulk)
  → TranslateField → translateArray → translateWithChatProvider
      → provider.completeText → { text, finishReason }
      → parseTranslationResponse → { values, flags[] }   // length/placeholder/truncated (+ Phase 2 structural/no-op/ratio)
  → flags bubble up with the translated value
single editor:  surface ALL flags at translate time (sidebar bubbles + alert) — advisory, non-blocking
bulk:           aggregate flags per record → progress rows + counters + retained list
```

## 9. Phasing

- **Phase 1:** `length-mismatch`, `placeholder-loss`, `truncated`; provider metadata refactor + Anthropic `max_tokens` fix; flag model; single-editor translate-time surfacing (sidebar bubbles + alert, advisory); bulk accounting (`completed-with-warnings`, accurate counts, retained list).
- **Phase 2:** `html-structure`, `markdown-structure`, `no-op`, `length-ratio`; redundant-flag suppression; structured_text leaf-count flag.

## 10. Testing

- **Per check:** pure-function unit tests (vitest) with fixtures — matched length, short/long, dropped-element, dropped-placeholder, truncated finishReason, HTML drop/added/reordered block, markdown heading/list/code drop, no-op with each exemption class, ratio at boundaries incl. EN→JA contraction (no false positive).
- **Parse integration:** `translateArray.test.ts` — `{ values, flags }` shape, repair-then-flag, no flag on clean responses.
- **Surfacing:** sidebar renders an error bubble + alert on a flag; bulk counts a degraded record as failure and retains the list after the modal closes.
- **Provider:** each provider maps its truncation field to `finishReason`.

## 11. Risks / open items

- **Non-blocking by design** — flags are advisory; nothing prevents a user from saving degraded content (single or bulk). Accepted trade-off after dropping the save gate as too complex (see §12); mitigation is high-precision flags + the bulk retained list.
- **Heuristic tuning** (Phase 2) — the no-op >50% threshold, block-tag allowlist, and 0.3 ratio floor need tuning on real bulk data; keep them warning-only / dismissible until validated.

## 12. Out of scope, future & rejected alternatives

- Provider structured-output enforcement (dropped).
- Fluency/grammar/terminology checks (low precision; explicitly excluded to avoid alert fatigue).
- Auto-retry of flagged segments/records (the retained bulk list is the manual precursor).

**Rejected alternatives (rationale captured so they aren't relitigated):**
- **Single-record `onBeforeItemUpsert` save-gate.** Considered — block or confirm before save when a hard error is present — but dropped as too complex for the value. Lifecycle hooks run in a separate hidden boot iframe, cross-origin to the dashboard, so translate-time flags can't be bridged to the hook: `localStorage`/`sessionStorage` are cross-origin/partitioned, and `ctx.updatePluginParameters` requires `can_edit_schema` (which translators lack). That forced a *stateless* re-derivation at save that only partially overlapped the real checks (no truncation / exact length) and could false-positive on legitimately-divergent locales. → single-record relies on translate-time surfacing instead.
- **Token-count ratio instead of a char ratio** for `length-ratio`. Tokens are *not* a language-invariant "concept" unit: tokenizer fertility varies up to ~15× across languages (CJK/Arabic/Indic fragment toward ~1 token/char; high-resource Latin languages merge to morphemes), so a token ratio conflates content volume with the tokenizer's per-language bias — reliable only *within* a high-resource Latin family, worse than chars across scripts. Practically, provider APIs report token usage per *whole response* (not per segment), and Anthropic/Gemini tokenizers aren't replicable client-side, so a per-segment token ratio isn't even computable across providers. → use a loose char-based lower-bound.
- **Per-language-pair expected-ratio table.** Published localization expansion/contraction figures are UI-layout rules of thumb (~12–24 languages, wide ranges, dominated by source-string length, not corpus measurements), not completeness oracles. → use a single one-sided floor instead.

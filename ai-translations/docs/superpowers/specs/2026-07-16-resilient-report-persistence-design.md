# Resilient Report & Persistence — Design

> **Design spec.** The recoverable, self-documenting report layer for the plan/apply
> engine: a canonical run-state shape, storage/format adapters, and a compact,
> checksummed, self-sufficient wire format for the CSV recovery column. Recoverable
> no matter where a run pauses. Companion to `2026-07-16-translation-plan-design.md`
> (its §7 report + §12 persistence made concrete).
>
> **Revision 2 (2026-07-16)** — incorporates an 18-finding adversarial review.
> Material changes: `flagBits` widened to **uint16** (the invariant/heuristic split
> is per-*severity*, not per-checkId — one checkId can straddle both); resume rule
> covers **all four** buckets; versioning is **per-record** with a defined drift
> action; **policyDigest pinned**; recovery ordinal is a **monotonic checkpoint
> counter**, not wall-clock; CSV is an explicit **best-effort audit tier** with a
> run-header + live-version re-read; storage-tier degrade paths specified.

**Date:** 2026-07-16
**Branch:** `feature/translation-qc`

---

## 1. The thing we're actually building

A **resilient bulk-operation engine**. Translation is its first *operation*; plan →
execute → conform → persist → report, recoverable at any pause, is domain-agnostic.
Built translation-shaped now, with **one clean seam** — the per-cell **operation**
and the **invariant/heuristic registry** — so a generic engine is *extractable
later* without a rewrite. We do not build the abstraction now (YAGNI); we only avoid
walling it off.

## 2. Canonical run state: metadata, never content

Metadata per `(record, locale)` unit, never translated content — content is
redundant everywhere (Written units live in the CMS; Blocked units wrote nothing).

The state is **record-oriented** (the write unit is the record — versions are a
record-level fact, review finding), with locale units nested:

```ts
interface RunUnitState {
  toLocale: string;
  bucket: Bucket;                       // written | blocked | not-attempted | written-unverified
  reasons: { fieldPath: string; code: ReasonCode }[];   // blocked: which field + why (fieldPath kept — plan §7)
  flagCheckIds: QcCheckId[];            // written: heuristic warnings present
  updatedAt: number;                    // epoch ms — DISPLAY ONLY (not the recovery ordinal; see §4)
}
interface RunRecordState {
  recordId: string;
  sourceVersion?: string;               // meta.current_version at plan time (record-level)
  writtenVersion?: string;              // last post-write version (record-level, idempotent resume)
  units: RunUnitState[];
}
interface RunState {
  schemaVersion: number;                // JSON-artifact upcast boundary — DISTINCT from the cell wireVersion (§6)
  runId: string;
  checkpoint: number;                   // monotonic per-run counter, bumped every persist (the recovery ordinal, §4)
  deviceId: string;                     // session/device id, tie-breaks equal checkpoints across devices
  startedAt: number;
  operation: string;                    // 'translate' — the engine seam
  // Policy pin (review finding): resume must run under the SAME rules or refuse/warn.
  policyDigest: string;
  fromLocale: string;
  toLocales: string[];
  records: RunRecordState[];
}
```

- **Messages are rendered from codes** at display time (`describeReasonCode`,
  `describeBucket`), never stored.
- **`fieldPath` is kept** in `reasons` (the rich tiers) so the report can still say
  *which* field blocked (plan §7). The CSV bitset (§6) is a documented *lossy*
  projection of this.
- **Two distinct version axes:** `RunState.schemaVersion` (JSON upcast) vs the cell
  `wireVersion` (§6 wire gate). Independently bumped; never conflated.
- **Scale:** ~300 B/unit → 1,000×10 ≈ 3.5 MB raw → gzip ~500 KB.

## 3. Retry & resume — all four buckets, per-record version, policy-pinned

**No cached cell values** (a blocked unit re-runs all its cells anyway; the win is
not re-running Written units, whose content is in the CMS).

**Resume disposition (exhaustive):**
| Bucket | Action |
| --- | --- |
| `written` | **skip** — idempotent; guarded per §3 version rule |
| `blocked` | **re-run** |
| `not-attempted` | **run** (first time) |
| `written-unverified` | **re-run** — the write's true state is unknown; a fresh re-read + idempotent re-write is REPLACE-not-merge-safe (review finding) |

**Version guard (per record, review finding):** `writtenVersion` is record-level
(one `items.update`/record bumps one version; sibling-locale writes would make a
per-unit copy falsely look "drifted"). On resume, before re-running any of a
record's non-Written locales, **re-read the record's live `current_version`**:
- matches `sourceVersion` → re-run safely.
- differs → the record changed out-of-band (or a human edited it). **Re-read + re-run
  the record's non-Blocked locales under `locale-preservation`, never silent-skip**;
  surface it as `source-drifted` so a human edit is never silently overwritten.

**Policy pin (review finding):** resume re-runs `buildPlan` against the *live* policy.
If the live `policyDigest` ≠ the stored one (a fate flipped, a locale de-selected,
`cannotBeBlank` toggled), **refuse or warn** — never silently run half under old and
half under new rules.

## 4. Adapter axes & recovery ordering

Format × storage compose independently:

| Storage adapter | Format | Recovery role |
| --- | --- | --- |
| **In-memory** (live) | native object | working copy |
| **IndexedDB** (primary local mirror, every checkpoint) | native structured clone | **full-fidelity recovery + latest-wins** |
| **Cloud** (durable, cross-device; one asset/run, `replace_asset`; §5) | gzip'd JSON (`CompressionStream('gzip')`) | **full-fidelity recovery + latest-wins** |
| **CSV export** | RFC-4180 rows + machine column (§6) + a run-header row | **best-effort audit / manual re-import** (see below) |
| **JSON export** | pretty JSON (with per-unit `mrc` token, §6) | full-fidelity |

- **Recovery ordinal = the monotonic `checkpoint` counter, NOT wall-clock**
  (review finding: independent device clocks make `updatedAt` last-writer-wins unsafe
  — a stale copy with a fast clock would win). Latest-wins compares
  `(runId, checkpoint)` with `deviceId` as tie-break; `updatedAt` is display only.
- **The machine token is a cross-format integrity anchor.** The same
  `v<ver>:base64url(…)` token (§6) is embedded in the CSV `machine_readable_status`
  column *and* a per-unit `mrc` field in the JSON. On import, if a unit's structured
  fields and its checksum-valid `mrc` disagree (serializer mangling), the token is
  **authoritative** and the divergence is logged with the row identity — in-flight
  corruption becomes traceable to the exact row.
- **CSV is a best-effort audit tier, deliberately lossy** (review findings): the
  per-cell token round-trips a unit's *status* (bucket/reasons/flags) with integrity,
  but NOT the run-level arbitration keys (`runId`, `checkpoint`) or the version fence.
  So: (a) CSV export writes a **run-header row** (`runId`, `checkpoint`,
  `schemaVersion`, expected unit count) for attribution + completeness-checking;
  (b) CSV import does **not** participate in cross-tier latest-wins; (c) CSV-driven
  resume **re-reads live `current_version` per record before any re-run** and
  skips/flags on divergence — so a human who manually fixed a Blocked locale is never
  silently overwritten. IndexedDB/cloud/JSON remain the authoritative recovery tiers.
- **IndexedDB unavailable** (Safari ITP, private mode — review finding): feature-detect
  at run start (open + probe write). On failure, surface a **visible** "local recovery
  unavailable — enable cloud logging or keep this tab open" warning and, if permitted,
  promote cloud or force a JSON/CSV download checkpoint. Never silent.
- **No per-cell compression, no msgpack** (type tags dominate at per-cell scale).

## 5. Cloud tier specifics (phase 2, additive)

- **One asset per run**, unique id.
- **Single-flight, not just throttled** (review finding): at most one `replace_asset`
  in flight per run; while one uploads, coalesce pending state to the latest snapshot
  and fire exactly one trailing upload on completion (trailing-edge debounce over a
  single-flight guard). Embed the `checkpoint` ordinal in the payload so a late-landing
  write can be detected and rejected — otherwise out-of-order async completion pins the
  asset to a stale state.
- **Degrade to local-only** when the role lacks upload permission.
- A dedicated tag/folder + reaping old logs contains Media-browser clutter.

## 6. The CSV machine column — compact, self-sufficient, checksummed

Editors can be told "don't touch the machine column" but not "don't edit any cell",
so the column must be readable/validatable **from that single cell alone**.

### Framing
```
cell = "v" <wireVersion> ":" base64url(payload)
```
`v<wireVersion>:` — the **wire** version (distinct from `RunState.schemaVersion`) and
a leading letter (CSV formula-injection-guard-safe). base64url has no CSV specials.

### Payload layout (wire v1)
```
 field         type            notes
 -----------   -------------   ---------------------------------------------
 recordIdLen   uLEB128         must be > 0 (validate)
 recordId      UTF-8 bytes
 localeLen     uLEB128         must be > 0 (validate)
 locale        UTF-8 bytes
 bucket        uint8           0..3 only (validate rejects > 3 in v1)
 reasonBits    uint16 LE       bit i = REASON_BIT[code]; 12 codes, 4 spare
 flagBits      uint16 LE       bit i = FLAG_BIT[checkId]; widened from uint8 (see below)
 ext…          TLV*            (tag:uLEB128, len:uLEB128, value:len B) — read until 4 bytes remain
 crc32         uint32 LE       CRC-32( verByte ++ all preceding payload bytes )
```
Self-delimiting via varints; trailing 4 bytes are always the checksum.

### `flagBits` is uint16, and why (review finding — 4 confirmations)
The invariant/heuristic split is **per-flag `severity`, not per-checkId**
(`conform` routes each flag by `tierOf(severity)`). One checkId can appear in **both**
maps: `markdown-structure` is `error` on a dropped heading (→ `reasonBits` via
`md-block-lost`) **and** `warning` on paragraph drift (→ `flagBits`). Counting every
warning/info emitter yields **9 heuristic checkIds** — overflowing uint8 at v1. So:
- `flagBits` is **uint16** (parity with `reasonBits`, headroom for phase-2 checks).
- `REASON_BIT`/`FLAG_BIT` are **not a partition** of `QcCheckId`; a straddling checkId
  gets a bit in each. Both maps carry a **compile-time exhaustiveness guard** (a keyed
  `Record` over the relevant subset) so a new code cannot silently lose its bit.

### `verByte` for the CRC
`verByte` = the numeric wire version as a single byte (e.g. `1`). The encoder computes
`crc32(Uint8Array([verByte, ...payloadWithoutCrc]))` and appends it LE. The decoder
recomputes the same and compares — so a `v1:`→`v2:` prefix swap or a body edit fails.

### Read → validate → import (single cell)
1. split on first `:` → version tag + body; reject unknown wireVersion.
2. base64url-decode (failure ⇒ reject).
3. **length precondition:** require `decoded.length ≥` the fixed minimum before reading
   any field, so a short/mangled cell is rejected *before* an out-of-bounds read
   (honors "a mangled cell never corrupts a resume").
4. parse core fields, then TLVs until 4 bytes remain (misaligned len ⇒ reject);
   reject `recordIdLen==0`, `localeLen==0`, `bucket>3`; decode id/locale with a **fatal**
   UTF-8 decoder.
5. `crc32(verByte ++ payload) === trailing 4 bytes`? No ⇒ reject the row, log, skip.
   Yes ⇒ import.

**Cross-check bonus:** the cell self-contains `recordId`+`locale`, so a CSV importer can
warn if they disagree with the row's human columns (moved/edited rows).

### Forward-compat (precise — review finding)
- **Additive metadata** → new **TLV tags**; old readers skip unknown tags via `len` and
  still validate CRC → forward-readable. **No version bump.**
- **Appending a bit index *within* the current field width** (e.g. a 13th reason bit in
  the existing uint16) → no bump.
- **Widening a fixed pre-TLV field** (e.g. uint16→uint32) shifts all downstream offsets
  → **breaking core-layout change, requires a wireVersion bump.** (This is why we size
  `flagBits` at uint16 *now*.)
- Bit indices are **append-only** (never renumber).

### Size
recordId (~12 B) + locale (~4 B) + status (5 B, flagBits now 2 B) + crc (4 B) ≈ ~26 B →
~35 base64url chars → a **~38-char cell**. ids dominate; the intended cost of surviving
arbitrary edits.

## 7. The RunState reducer (build step 3) — contract

The reducer folds engine outcomes into `RunState`. Pins the review flagged:
- **Pure with an injected clock:** `foldOutcome(state, outcome, ctx)` where
  `ctx = { now: number, runContext }` — `now`/`checkpoint`/`runId`/`deviceId` are
  supplied by the caller, never `Date.now()` inside.
- **Upsert by `(recordId, toLocale)`**, not concat — a unit transitions buckets across
  lifecycle stages (`not-attempted` → `written` → `written-unverified`); the reducer
  replaces the prior state for that key.
- **Enriched input:** `conform` emits only `written`/`blocked` with no versions;
  `not-attempted` (runaway brake) and `written-unverified` (post-send read-back) and the
  versions are attached by later stages. The reducer accepts already-enriched
  `UnitOutcome`s from any stage. Projection: `preVersion→sourceVersion`,
  `postVersion→writtenVersion` (record-level).

## 8. Build order (atomic, resumable)

1. **Primitives** (pure): uLEB128 varint, CRC-32, base64url, code→message renderers. ✅
2. **Bit maps** (`REASON_BIT`/`FLAG_BIT`, append-only, exhaustiveness-guarded) +
   **encode/decode/validate** the machine column (round-trip + corruption-rejection +
   the §6.4 hardening).
3. **`RunState` shape** + the §7 reducer.
4. **CSV column + JSON adapters** (with the `mrc` anchor + run-header row).
5. **IndexedDB adapter** + feature-detect/degrade + retention/quota handling + latest-wins
   by `checkpoint`.
6. **Cloud adapter** (gzip'd JSON + single-flight `replace_asset`) — phase 2.

Steps 1–4 are pure and land first; 5–6 touch browser/CMA.

## 9. Open / to pin

- Exact `meta.current_version` id format (affects any later id byte-packing; not assumed).
- IndexedDB retention policy (keep last K runs / age cap; prune on run start) + explicit
  `QuotaExceededError` handling (stop, warn, offer download — never silent continuation).
- Cloud upload throttle interval + old-log reaping.
- `deviceId` source (a stable per-browser random id in IndexedDB is sufficient).

## 10. Explicitly NOT doing

No stored content/value cache; no per-cell compression; no msgpack/CBOR/protobuf; no
cryptographic hashing; no generic bulk-engine abstraction yet (keep the seam clean).

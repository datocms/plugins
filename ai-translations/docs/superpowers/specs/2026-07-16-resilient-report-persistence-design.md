# Resilient Report & Persistence — Design

> **Design spec.** The recoverable, self-documenting report layer for the plan/apply
> engine: a canonical run-state shape, storage/format adapters, and a compact,
> checksummed, self-sufficient wire format for the CSV recovery column. Recoverable
> no matter where a run pauses. Companion to
> `2026-07-16-translation-plan-design.md` (the engine) — this is its §7 (the report)
> and §12 (persistence) made concrete.

**Date:** 2026-07-16
**Branch:** `feature/translation-qc`

---

## 1. The thing we're actually building

A **resilient bulk-operation engine**. Translation is its first *operation*, but
plan → execute → conform → persist → report, recoverable at any pause, is
domain-agnostic (bulk field updates, AI alt-text, etc.). We build it
translation-shaped now and keep **one seam clean** so a generic engine is
*extractable later* without a rewrite:

- **The pluggable seam:** the per-cell **operation** (today: `translate`) and the
  **invariant/heuristic registry**. Everything else — plan IR, `conform`, this
  report/persistence layer, the adapters — is already operation-agnostic.
- We do **not** build the abstraction now (YAGNI); we only avoid walling it off.

## 2. Canonical run state: metadata, never content

The run artifact stores **metadata per `(record, locale)` unit**, never translated
content. Content is redundant everywhere:

- **Written** units → the content already lives in the DatoCMS record; the CMS *is*
  the store. Re-storing it is a byte-for-byte project clone.
- **Blocked** units → nothing was written; only *why* matters.

Canonical unit shape (the superset all adapters project from):

```ts
interface RunUnitState {
  recordId: string;
  toLocale: string;
  bucket: Bucket;                       // written | blocked | not-attempted | written-unverified
  reasonCodes: ReasonCode[];            // blocked: why (machine codes, not messages)
  flagCheckIds: QcCheckId[];            // written: heuristic warnings present
  sourceVersion?: string;               // meta.current_version at plan time
  writtenVersion?: string;              // post-write version (idempotent resume)
  updatedAt: number;                    // epoch ms, for latest-wins recovery
}
interface RunState {
  schemaVersion: number;                // upcast boundary
  runId: string;
  startedAt: number;
  operation: string;                    // 'translate' — the engine seam
  units: RunUnitState[];
}
```

Messages are **rendered from codes** at display time, never stored — smaller, and
the format stays stable when copy changes.

**Scale:** ~300 B/unit JSON × 1,000 records × 10 locales ≈ 3.5 MB raw → gzip ~500 KB.
Thousands of records fit one artifact. Full response bodies would be the clone.

## 3. Retry & resume (no value cache — decided)

- **No cached cell values.** A `(record,locale)` unit is atomic; if any cell
  blocked, the unit was never written, so retry re-runs *all* its cells anyway.
  Caching would only save provider calls *within* the blocked minority — not worth
  the storage. The resilience that matters — not re-running the tens of thousands of
  **Written** units — comes free because their content is in the CMS.
- **Resume = skip Written (idempotent, guard on `writtenVersion`/live
  `current_version`), re-run Blocked + Not-attempted.**

## 4. Two adapter axes

Format and storage compose independently:

| Storage adapter | Format | Round-trip? |
| --- | --- | --- |
| **In-memory** (live working copy) | native object | — |
| **IndexedDB** (primary local mirror, every checkpoint) | native structured clone (no serialize step) | ✅ recovery source |
| **Cloud** (durable, cross-device; one upload per run, `replace_asset`, throttled) | gzip'd JSON via native `CompressionStream('gzip')` | ✅ recovery source |
| **CSV export** (human view + machine column) | RFC-4180 rows + a self-sufficient machine column (§6) | ✅ best-effort recovery via the column |
| **JSON export** (download) | pretty JSON | ✅ |

- **Cross-device is additive:** the cloud adapter is just another sink over the same
  canonical shape — build IndexedDB + JSON/CSV first, drop cloud in later, zero
  format change.
- **The machine token is a cross-format integrity anchor.** The same
  `v<ver>:base64url(…)` token from §6 is embedded in **every** serialization — the
  CSV `machine_readable_status` column *and* a per-unit `mrc` field in the JSON
  (export + cloud). Normally the human/JSON fields and the decoded token encode
  identical data; the redundancy is ~37 chars/row and buys a cheap, self-validating
  per-row backup. **Divergence rule:** on import, if a unit's structured fields and
  its checksum-valid `mrc` token disagree (e.g. a serializer mangled quoting), the
  token is **authoritative** and the divergence is logged with the row identity —
  so in-flight JSON/CSV corruption is *traceable to the exact row*, not silent.
- **Recovery = latest `(runId, updatedAt)` wins** across whichever tiers are present.
- **No per-cell compression, no msgpack.** Compression is whole-file (cloud tier
  only); at per-cell scale a self-describing codec's type tags dominate.

## 5. Cloud tier specifics (phase 2, additive)

- **One upload per run**, unique id; never a shared file (concurrent runs clobber).
- **Throttle `replace_asset`** — every N records / few seconds, not per cell (each
  replace is a CMA call + asset reprocessing).
- **Degrade to local-only** when the role lacks upload permission.
- A dedicated tag/folder + reaping old logs contains Media-browser clutter.

## 6. The CSV machine column — compact, self-sufficient, checksummed

Editors can be told "don't touch the machine column" but not "don't edit any cell",
so the column must be **readable and validatable from that single cell alone** — no
dependency on the row's other columns.

### Framing
```
cell = "v" <ver> ":" base64url(payload)
```
- `v<ver>:` — schema version (forward-compat gate) **and** a leading letter, so the
  CSV formula-injection guard never fires regardless of the base64 body.
- **base64url** (`A–Za-z0-9-_`) — no CSV special chars → no quoting, lossless through
  any RFC-4180 tool.

### Payload layout (v1)
```
 field         type            notes
 -----------   -------------   ---------------------------------------------
 recordIdLen   uLEB128
 recordId      UTF-8 bytes     self-contained (no row dependency)
 localeLen     uLEB128
 locale        UTF-8 bytes
 bucket        uint8           0=written 1=blocked 2=not-attempted 3=written-unverified
 reasonBits    uint16 LE       bit i = REASON_BIT[code] present
 flagBits      uint8           bit i = FLAG_BIT[checkId] present
 ext…          TLV*            (tag:uLEB128, len:uLEB128, value:len B) — read until 4 bytes remain
 crc32         uint32 LE       CRC-32( verByte ++ all preceding payload bytes )
```
Variable fields are varint-length-prefixed → self-delimiting; the trailing 4 bytes
are always the checksum.

### Checksum — CRC-32, deliberately
- Threat is **accidental corruption** (spreadsheet re-encode, fat-fingered paste),
  not an adversary → integrity detection, **not cryptography**. No SHA/HMAC (20–32
  wasted bytes for a non-problem).
- CRC-32 (zlib/PNG polynomial): 4 bytes, ~15 lines dependency-free, catches all
  ≤32-bit burst errors and >99.99% of the rest. base64url decode already rejects
  gross mangling; CRC catches subtle still-valid-base64 edits.
- **CRC covers the version byte** (folded in though it lives in the text prefix), so
  a `v1:`→`v2:` prefix swap or body/prefix mismatch fails instead of misparsing.

### Read → validate → import (single cell, no other column)
1. split on first `:` → version tag + body; reject unknown version.
2. base64url-decode (failure ⇒ reject).
3. parse core fields, then TLVs until 4 bytes remain (misaligned len ⇒ reject).
4. `crc32(verByte ++ payload) === trailing 4 bytes`? No ⇒ reject the row, log, skip
   (a mangled cell never corrupts a resume). Yes ⇒ import the reconstructed unit.

**Free bonus:** the cell self-contains `recordId`+`locale`, so the importer can
cross-check them against the row's human columns and warn if rows were moved/edited.

### Forward-compat (two independent axes)
- **Additive metadata** → new **TLV tags**; a v1 reader skips unknown tags via `len`
  and still validates CRC → old readers forward-read newer additive cells. No version
  bump for additions.
- **Breaking core-layout change** → bump `v1:`→`v2:`; old readers fail the version
  gate **cleanly** (never misparse).
- **Bit indices are append-only** (never renumber; 16-bit reason field has spare bits,
  widen later).

### Size
recordId (~12 B) + locale (~4 B) + status (4 B) + crc (4 B) ≈ ~25 B → ~34 base64url
chars → a **~37-char cell**. The ids dominate; that is the intended cost of surviving
arbitrary edits.

## 7. Explicitly NOT doing

- No stored translated content / value cache.
- No per-cell compression; no msgpack/CBOR/protobuf (type tags dominate at this size).
- No cryptographic hashing (no adversary).
- No generic bulk-engine abstraction *yet* (keep the seam clean; extract later).

## 8. Build order (atomic, resumable)

1. **Wire-format primitives** (pure TDD): uLEB128 varint, CRC-32, reason/flag bit maps.
2. **encode/decode/validate** the machine column (round-trip + corruption-rejection).
3. **Canonical `RunState` shape** + in-memory reducer that folds `UnitOutcome`s in.
4. **CSV column adapter** (RunUnitState ↔ machine column) + JSON adapter.
5. **IndexedDB adapter** + latest-wins recovery (browser tier).
6. **Cloud adapter** (gzip'd JSON + throttled `replace_asset`) — phase 2, additive.

Steps 1–4 are pure and land first. 5–6 touch browser/CMA and follow.

## 9. Open / to pin

- Exact DatoCMS `meta.current_version` id format (affects any later id byte-packing —
  not assumed in v1).
- IndexedDB store schema (one DB per plugin; object store keyed by `runId`; a
  `latestRunId` pointer).
- Cloud upload throttle interval + reaping policy for old run logs.

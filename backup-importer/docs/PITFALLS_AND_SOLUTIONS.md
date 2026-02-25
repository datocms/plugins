# Pitfalls and Solutions

## 1) Circular links between records
Pitfall:
- Record A links to B and B links to A.

Solution:
- Two-pass model:
  - Bootstrap all records first to obtain destination IDs.
  - Patch link fields in a second pass using the full ID map.

## 2) Structured text with links and embedded blocks
Pitfall:
- References can appear in `document` nodes and in top-level `links[]`/`blocks[]` arrays.

Solution:
- Dedicated DAST rewriter:
  - Rewrite `itemLink` and `inlineItem` references.
  - Rewrite `block` and `inlineBlock` references.
  - Rewrite top-level `links[]` and `blocks[]` arrays.

## 3) Nested blocks in modular/single block fields
Pitfall:
- Block trees can be deep and include nested links/uploads.

Solution:
- Recursive, schema-aware field traversal.
- Depth-safe walker with path tracking.
- Collect unresolved references with exact paths.

## 4) Localized recursive fields
Pitfall:
- References differ by locale and can be missing in some locales.

Solution:
- Rewrite localized values per locale key.
- Preserve locale structure and report missing mandatory locales.

## 5) Upload references without imported assets
Pitfall:
- File/gallery references point to unknown upload IDs.

Solution:
- Require upload ID map for strict mode.
- In non-strict mode, keep unresolved values and report them.

## 6) Schema mismatch across environments
Pitfall:
- Source model/field IDs or API keys do not exist in destination.

Solution:
- Preflight schema compatibility checks before writes.
- Strict mode blocks execution on unresolved schema mappings.

## 7) Partial import failures and retries
Pitfall:
- API/network failures can leave partially imported datasets.

Solution:
- Phase-scoped progress + deterministic job generation.
- Retry transient failures with backoff.
- Persist mapping/checkpoint state for resume (planned next milestone).

## 8) Export payload completeness for block-heavy content
Pitfall:
- Some exports may lack full nested block payloads.

Solution:
- Detect likely incomplete block payloads in preflight.
- Warn/fail early depending on strict mode.

## 9) Duplicate uploads across backups and destination
Pitfall:
- The same file can appear many times across ZIP chunks or already exist in destination.

Solution:
- Build destination upload indexes by checksum and filename+size.
- Reuse existing upload IDs when possible.
- Deduplicate duplicate uploads within the import payload before upload.

## 10) Memory pressure on large patch phases
Pitfall:
- Building all patch payloads for very large projects can increase memory usage and slow down execution.

Solution:
- Generate and execute patch jobs in bounded chunks.
- Persist checkpoints after each chunk to keep resume behavior deterministic.

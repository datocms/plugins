# Unit Testing Plan

## Test Categories
1. Contract validation
- Accept valid `2.0.0` envelope.
- Reject malformed envelope sections.
- Detect duplicate record IDs.
- Flag reference-index inconsistencies.

2. Reference rewriting
- Circular record links are rewritten with mapped IDs.
- Structured text `itemLink`/`inlineItem`/`block` nodes are rewritten.
- Top-level structured text `links[]`/`blocks[]` are rewritten.
- Localized fields are rewritten per locale.
- Unresolved record/upload/block refs are reported with paths.

3. Job planning
- Bootstrap jobs contain source->target model mapping.
- Patch jobs exclude system fields (`id`, `item_type`, `meta`, etc.).
- Unresolved refs are surfaced in strict mode preflight.

## Required Fixtures
- Two-record circular link fixture.
- Structured text fixture with nested links/blocks.
- Nested modular block fixture.
- Missing upload mapping fixture.

## Milestone M1 Tests Implemented
- Validator tests.
- Recursive rewrite tests.

## Milestone M2 Tests Implemented
- CMA executor integration tests (mocked client):
  - circular link import (bootstrap IDs + patch links).
  - multi-chunk patch phase with hundreds of records.
  - synthetic complex payload (structured text + nested block + upload references).
- Retry/backoff behavior tests.

## Milestone M2 Tests Still Planned
- End-to-end import simulation including asset ZIP ingestion and checkpoint-resume replay in one run.

## Milestone M3 Tests Implemented
- Asset dedupe tests:
  - reuse existing destination uploads by checksum.
  - dedupe duplicate uploads inside the same import batch.
- Chunking safety test:
  - chunked `prepareRecordPatchJobs(records: slice)` output matches full-batch output.

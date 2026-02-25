# Implementation Tracker

## Milestone M1 (Foundation)
- [x] Create implementation plan document.
- [x] Document high-risk pitfalls and mitigations.
- [x] Define unit testing strategy.
- [x] Implement contract type definitions.
- [x] Implement preflight validator.
- [x] Implement recursive reference rewriting utilities.
- [x] Implement import job planning primitives.
- [x] Add config-screen JSON upload + preflight UI.
- [x] Add unit tests for validator and rewriting.

## Milestone M2 (Execution)
- [x] Implement CMA executor (bootstrap create + patch update).
- [x] Implement strict/non-strict failure policy.
- [x] Add retries/backoff for transient errors.
- [x] Add publish-state replay.

## Milestone M3 (Assets + hardening)
- [x] Implement asset ZIP ingestion and metadata replay.
- [x] Add checkpoint/resume support.
- [x] Add import report export.
- [x] Run scalability and large-project tests (synthetic unit stress coverage).

## Milestone M4 (2.1.0 Full Clone)
- [x] Upgrade envelope support to `exportVersion: 2.1.0`.
- [x] Implement site baseline import phase.
- [x] Implement schema clone phases (item type skeletons, fieldsets, fields pass A/B, schema finalization).
- [x] Implement non-side-effect configuration phases (`workflows`, `roles`, `plugins`, `modelFilters`, `menuItems`, `schemaMenuItems`).
- [x] Replay scheduled publications/unpublishings after content phases.
- [x] Import side-effect integrations (`webhooks`, `buildTriggers`) as final phase.
- [x] Add post-import verification warnings.
- [x] Update tests for `2.1.0` envelope fixtures.

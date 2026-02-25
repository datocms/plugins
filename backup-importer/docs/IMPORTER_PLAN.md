# Backup Importer Implementation Plan

## Objective
Build a resilient importer for the JSON envelope produced by `project-exporter` (`exportVersion: 2.1.0`) that can handle simple and highly recursive projects, including circular references.

## Scope and Principles
- Source of truth for contract: `project-exporter/README.md` and exporter code.
- Deterministic, resumable multi-pass import.
- Strict validation before any write operations.
- Explicit ID mapping for records, uploads, and block-like references.
- Idempotent behavior where possible.

## Import Phases
1. Intake + validation
- Validate envelope + references.

2. Site baseline
- Apply locale/timezone/site baseline before locale-sensitive phases.

3. Schema core
- Item type skeletons.
- Fieldsets.
- Fields pass A (safe create).
- Fields pass B (full validators/appearance/relationships).
- Final item type patch.

4. Non-side-effect configuration
- Workflows, roles, plugins, model filters, menu items, schema menu items.

5. Assets
- Import ZIP chunks, dedupe, metadata replay, locale sanitization/fallback.

6. Records
- Bootstrap record identities.
- Patch rewritten content/references.

7. Tree + publish
- Parent/position replay + publish rounds.

8. Scheduled actions
- Replay scheduled publication/unpublishing timestamps.

9. Side-effect integrations
- Import webhooks/build triggers at the end.

10. Verification + report
- Count/mapping checks and summary warnings.

## Current Status
- Implemented:
  - JSON contract types + strict envelope validation.
  - Recursive reference rewriting for links/uploads/blocks/structured text.
  - Full schema clone flow (models/fieldsets/fields + finalization).
  - CMA execution flow (site/config/assets/records/tree/publish/schedules/integrations/verify).
  - Asset ZIP ingestion with metadata replay and upload dedupe.
  - Checkpoint/resume and import-report download.
  - Chunked patch execution for large datasets.

- Remaining hardening:
  - Real-world soak testing on very large production datasets.

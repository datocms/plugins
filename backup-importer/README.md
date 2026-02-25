# Backup Importer

Import Project Exporter JSON backups into DatoCMS.

## Current status
- Implemented:
  - JSON drag-and-drop upload.
  - Asset ZIP drag-and-drop upload (multi-file chunks).
  - Envelope validation (`exportVersion: 2.1.0`).
  - Preflight simulation with unresolved-reference reporting.
  - Full-clone import flow aligned with `project-exporter` 2.1.0:
    - site baseline update;
    - plugin bootstrap import (pre-schema, so plugin-driven field appearances can resolve);
    - schema skeleton import (`itemTypes`), fieldsets, fields pass A/pass B, schema finalization;
    - non-side-effect configuration import (`workflows`, `roles`, `modelFilters`, `menuItems`, `schemaMenuItems`);
    - asset ZIP ingestion + upload metadata replay;
    - upload dedupe against existing destination uploads and within import batches;
    - optional "skip assets" mode (no asset import + blank file/gallery fields);
    - optional debug logging toggle (browser console) across all import phases;
    - bootstrap record creation + chunked record patch updates;
    - tree relation replay + publish replay;
    - scheduled publication/unpublishing replay with exported timestamps;
    - side-effect integrations last (`webhooks`, `buildTriggers`);
    - post-import verification warnings in report.
  - Retry/backoff for transient CMA failures.
  - Checkpoint/resume support.
  - Import report export (JSON + CSV download).
- Still pending:
  - Real-world soak testing on very large production datasets.

## Internal docs
- `docs/IMPORTER_PLAN.md`
- `docs/PITFALLS_AND_SOLUTIONS.md`
- `docs/UNIT_TESTING_PLAN.md`
- `docs/IMPLEMENTATION_TRACKER.md`

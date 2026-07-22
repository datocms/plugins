# AI Translations v4 — what changed, and why

## Why

The plugin translates DatoCMS records with AI. In practice the old version was quietly
unreliable: some records didn't translate, long fields got silently cut off, and when a bulk
run went wrong there was no report of *which* records failed or *why* — you'd find out later,
if at all. **v4 is a reliability overhaul.** The goal is simple: when you run a bulk
translation it either works, or it tells you exactly what didn't — and lets you fix or retry
it. Nothing fails silently.

## What we added

Every field now goes through one engine that **checks its own work before writing anything**.
A bad translation — dropped content, broken formatting, or a value that would violate a
field's rules — is **held back and reported** instead of silently corrupting your record. On
top of that you get a live progress view, a per-record report you can export and re-import,
the ability to **pause and resume** long runs (even after a page reload), and clear,
plain-language messages when something needs a human look.

---

## How (the major pieces)

- **Quality checks before saving.** Each translated field is validated — character limits,
  HTML/Markdown structure, dropped `{{placeholders}}`, "translations" that came back
  unchanged or truncated. Anything that would corrupt the record is withheld and flagged,
  never silently written or cropped.
- **One engine for single-record *and* bulk.** The sidebar and the bulk page share the same
  translate → check → write pipeline, so they behave identically.
- **A real progress + report UI.** A live modal shows each record as it translates (including
  the field being worked on); flagged records expand inline to show why; and the report
  exports/copies as **Plaintext / CSV / JSON**, with the CSV/JSON carrying a checksummed,
  re-importable *machine-readable status* column.
- **Pause, resume, recovery.** Rate limits auto-retry with backoff; you can pause manually;
  and an interrupted run is detected the next time you open the bulk screen and resumes only
  the records it didn't finish.
- **Honest error messages.** Provider and DatoCMS errors become clear, actionable text
  ("this field is over its character limit", "set this slug manually for non-Latin locales")
  instead of cryptic failures.
- **Reliability tests.** A browser-driven end-to-end suite (fault-injected, plus a real
  provider lane) exercises the pause/resume/withhold/report behaviors for real.

---

## Changelog (vs. master 3.7.0)

### Merged up from master — Marcelo's work preserved
- Merged the shipped `master` (3.7.0) into this branch and kept his features intact: the
  **Yandex provider**, **auto-publish** of translated records, the **linked-record
  reference-copy** fix, and his security dependency bumps.
- Re-instated the **CSV report** master had removed — it's now part of the review workflow.
- Replaced master's transient toast/alert progress (which capped at ~20 rows and vanished on
  dismiss) with the persistent modal + report below.

### Added — biggest to smallest
Everything below is net-new vs. master; it's built as **one engine** with a clean
plan → translate → check → write pipeline (pure, unit-tested functions; the UI is a thin shell).

- **Plan-then-write engine.** Each record is *planned*, translated, quality-checked, and
  *conformed* into a final payload before a single CMA write — the same pipeline for the
  sidebar and bulk, so they can't drift.
- **Conform gate.** Any error-tier problem blocks that record+locale write: the bad value is
  **withheld and reported**, never silently written or truncated (the core reliability change).
- **Tiered quality-control layer.** ~a dozen post-response checks graded error / warning / info
  — CMA length validators, HTML/Markdown block structure, dropped `{{placeholders}}`,
  truncation, no-op output, locale preservation, block structure & id provenance.
- **Durable, checksummed audit trail.** Every run keeps per-(record, locale) state carrying a
  **CRC-32-checksummed machine token**, exported and re-imported as CSV/JSON — a record of
  exactly what happened that survives, and validates from a single cell.
- **Cross-session resume.** An interrupted run is checkpointed to IndexedDB, detected on your
  next visit, and resumes **only the unfinished records** — guarded by a policy digest so a
  changed config never resumes incompatibly.
- **Progress + per-record report UI.** A live modal (per-record status, the field in flight,
  expandable failure detail) plus an on-page report with Copy/Export as Plaintext/CSV/JSON,
  import, and last-run persistence.
- **Adaptive pacing, retry & pause.** An AIMD concurrency scheduler + a self-widening request
  pacer, systemic-error auto-retry with backoff (honoring `Retry-After`), and a manual pause.
- **Normalized error handling.** Six sources (five providers + DatoCMS CMA) collapse into one
  actionable `{code, source, message, hint}` shape; fixed the silent-per-field-failure bug the
  original DM described (an error's code could collapse to "unknown" and skip the pause).
- **Projectwide field-fate tree.** Set every field (and block sub-field) to Translate / Copy /
  Skip once, applied as locked rules across single and bulk runs.
- **Live per-field snippet, accordion failure detail, manual pause, before-unload guard,
  DatoCMS-native icons, and click-order-preserving field selection** — UX correctness fixes.
- **Plain-language QC/error copy** — every warning/error says what was expected, the mismatch,
  and what to do.
- **End-to-end test suite** — a fault-injected, real-provider (DeepL) browser lane covering the
  withhold/pause/resume/report behaviors, run per pull request.
- **Assorted correctness fixes** — deterministic single-quote/JSON-array recovery (the
  "3–4 tries" bug), empty-slug detection, HTML-node-count parity, and SEO-truncation flagging.

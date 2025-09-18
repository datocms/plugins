# DatoCMS Schema Import/Export Plugin

Powerful, safe schema migration for DatoCMS. Export models/blocks and plugins as JSON, then import them into another project with guided conflict resolution.

## Highlights

- Export from anywhere: start from a single model’s “Export as JSON…” action, select multiple models/blocks, or export the entire schema.
- Dependency-aware: auto-detects linked models/blocks and plugins; add them with one click (“Select all dependencies”).
- Scales to large projects: graph preview for small selections, fast list view with search and relation counts for big ones.
- Guided imports: detect conflicts, choose to reuse or rename, and confirm sensitive actions with typed confirmation.
- Post-action summaries: clear, filterable summaries after export/import with connections and plugin usage.
- Safe by design: imports are additive; existing models/blocks and plugins are never modified unless you explicitly opt to reuse.

## Where To Find It

- Settings > Plugins > Schema Import/Export > Export: start a new export, select multiple models/blocks, or export the entire current environment.
- Settings > Plugins > Schema Import/Export > Import: upload an export file (or paste a recipe URL) and import safely into the current environment.
- From a model/block: in Schema, open a model/block, click the three dots beside the model/block name, and pick “Export as JSON…” to export starting from that entity.

## Installation

- In DatoCMS, open your project, go to Plugins, search for “Schema Import/Export”, then install. The plugin only requests `currentUserAccessToken`.

## Export

- Start from a model/block
  - Open Schema, select a model/block.
  - Click the three dots beside the model/block name.
  - Choose “Export as JSON…”.
  - Preview dependencies and optionally include related models/blocks and plugins.
  - Download the generated `export.json`.

- Start a new export (Schema > Export)
  - Pick one or more starting models/blocks, then refine the selection.
  - Use “Select all dependencies” to include all linked models/blocks and any used plugins.
  - Search and filter in list view; see inbound/outbound relation counts and “Why included?” explanations.
- For large projects the graph is replaced with a fast list view.

- Export the entire schema (one click)
  - From Schema > Export, choose “Export entire schema” to include all models/blocks and plugins.
  - A progress overlay appears with a cancel button and a stall notice if rate limited; the JSON is downloaded when done.

- After export
  - A Post‑export summary shows counts (models, blocks, fields, fieldsets, plugins) and, for each model/block, the number of linked models/blocks and used plugins.
  - You can re-download the JSON and close back to the export screen.

## Import

- Start an import (Schema > Import)
  - Drag and drop an exported JSON file, or provide a recipe URL via `?recipe_url=https://…` (optional `recipe_title=…`).
  - The plugin prepares a conflicts view by comparing the file against your project’s schema.

- Resolve conflicts safely
  - For models/blocks: choose “Reuse existing” or “Rename” (typed confirmation required if you select any renames).
  - For plugins: choose “Reuse existing” or “Skip”.
  - The graph switches to a searchable list for large selections; click “Open details” to focus an entity.

- Run the import
  - The operation is additive: new models/blocks/plugins/fields/fieldsets are created; existing ones are never changed unless “reuse” is chosen.
  - Field appearances are reconstructed safely: built‑in editors are preserved; external plugin editors/addons are mapped when included, otherwise sensible defaults are applied.
  - A progress overlay (with cancel) shows what’s happening and warns if progress stalls due to API rate limits.

- After import
  - A Post‑import summary shows what was created, what was reused/skipped, any renames applied, and the connections to other models/blocks and plugins.

## Notes & Limits

- Plugin detection: editor/addon plugins used by fields are included when “Select all dependencies” is used. If the list of installed plugins cannot be fetched, the UI warns and detection may be incomplete.
- Appearance portability: if an editor plugin is not selected, that field falls back to a valid built‑in editor; addons are included only if selected or already installed.
- Rate limiting: long operations show a gentle notice if progress stalls; they usually resume automatically. You can cancel exports/imports at any time.

## Development Notes

- Shared hooks:
  - `useProjectSchema` memoizes CMA access per context.
  - `useLongTask` drives all long-running progress overlays.
  - `useExportGraph`, `useExportAllHandler`, and `useConflictsBuilder` encapsulate schema loading logic.
- Shared UI:
  - `ProgressOverlay` renders the full-screen overlay with accessible ARIA props and cancel handling.
  - `ExportLandingPanel` and `ExportSelectionPanel` handle the two-step export start flow in both ExportHome and ImportPage.
- Graph utilities expose a single entry point (`@/utils/graph`) with `SchemaProgressUpdate` progress typing.

## Export File Format

- Version 2 (current): `{ version: '2', rootItemTypeId, entities: […] }` — preserves the explicit root model/block used to seed the export, to re-generate the export graph deterministically.
- Version 1 (legacy): `{ version: '1', entities: […] }` — still supported for import; the root is inferred from references.

## Safety

- Imports are additive and non‑destructive. The plugin never overwrites existing models/blocks or plugins. When conflicts are detected, you explicitly pick “Reuse existing” or “Rename”.

## Troubleshooting

- “Why did the graph disappear?” For very large selections, the UI switches to a faster list view.
- “Fields lost their editor?” If you don’t include a custom editor plugin in the export/import, the plugin selects a safe, built‑in editor so the field remains valid in the target project.

# DatoCMS Schema Import/Export Plugin

Powerful, safe schema migration for DatoCMS. Export models/blocks and plugins as JSON, then import them into another project with guided conflict resolution.

## What it does

- Builds dependency-aware exports: collects selected models, blocks, fieldsets, fields, and any referenced plugins while trimming validators that point to out-of-scope item types.
- Keeps exports portable: rewrites field appearances to rely only on bundled or built-in editors and downloads a prettified `export.json` when each task completes.
- Imports additively: compares the bundle against the target project, walks you through reuse/rename/skip decisions, and creates new entities without mutating existing ones unless you opt in.
- Restores editors safely: reinstalls plugin editors/addons when present, falling back to core editors so fields always remain valid in the destination project.
- Handles long tasks gracefully: surfaces cancellable overlays with stall notices, honors rate-limit throttling, and stops at the next safe checkpoint if you cancel mid-flight.
- Loads shared recipes: accepts `recipe_url` query parameters to pull an export from a URL so collaborators can hand off ready-to-import snapshots.

## Where To Find It

- Configuration > Export: start a new export, select multiple models/blocks, or export the entire current environment.
- Configuration > Import: upload an export file (or paste a recipe URL) and import safely into the current environment.
- From a model/block: in Schema, open a model/block, click the three dots beside the model/block name, and pick “Export as JSON…”—the plugin opens the Export page preloaded with that entity so you can jump straight to the graph.

## Installation

- In DatoCMS, open your project, go to Plugins, search for “Schema Import/Export”, then install. The plugin only requests `currentUserAccessToken`.

## Export

- Start from a model/block
  - Open Schema, select a model/block.
  - Click the three dots beside the model/block name and choose “Export as JSON…”.
  - The Export page opens with that entity locked in the selection; inspect the graph/list, run “Select all dependencies” to pull in linked models/blocks/plugins, and undo it with “Unselect dependencies” if you change your mind.
  - Start the export when ready; the long-task overlay shows progress/cancel options, and the prettified `export.json` downloads automatically once the task completes.

- Start a new export (Schema > Export)
  - The landing panel lets you either pick specific starting models/blocks or go straight to “Export entire schema”.
  - Use the multi-select to seed the graph; the graph animates selections for small/medium schemas, while large schemas (>60 nodes) fall back to the list view with search, metrics (counts, components, cycles), and “Why included?” explanations.
  - “Select all dependencies” adds related models/blocks/plugins in bulk and logs a notice showing how many were added; “Unselect dependencies” removes the auto-added ones.
  - Plugin dependencies come from installed plugin lookups; if the CMA call fails you’ll see a warning so you know selections may be incomplete.

- Export the entire schema (one click)
  - Confirm the dialog to queue up every model, block, and plugin in the current environment.
  - The overlay reports progress, handles cancellable requests, and falls back gracefully if the CMA throttles; the final file downloads as `export.json`.

- After export
  - You get a success notice (or cancellation/error messaging) plus the downloaded file; the selection stays in place so you can tweak it and run another export without leaving the page.

## Import

- Start an import (Schema > Import)
  - Drag and drop an exported JSON file or use the “Select a JSON export file…” button; invalid JSON triggers an alert so you can retry.
  - To hydrate directly from a shared recipe, append `?recipe_url=https://…` (optional `recipe_title=…`)—the plugin fetches it and switches to import mode automatically.

- Resolve conflicts safely
  - The plugin builds a conflict summary in the background with progress feedback; you can refresh it if the schema changes while you wait.
  - For models/blocks: choose “Reuse existing” or “Rename” with inline validation for name/API key (preset suggestions are provided for fast renames).
  - For plugins: choose “Reuse existing” or “Skip”.
  - Use “Show only unresolved conflicts” to focus the list; entities marked “reuse” drop out of the graph/list so you stay focused on what will be created.
  - The import graph mirrors the export graph for smaller selections and switches to the list view with metrics/search once the node count crosses the same 60-node threshold.

- Run the import
  - Imports are additive: new models/blocks/fields/fieldsets/plugins are created with fresh IDs, and existing assets are touched only when you explicitly reuse them.
  - Field validators and appearances are remapped to the target project; missing plugin editors fall back to safe defaults and localized defaults expand to every locale in the target environment.
  - The progress overlay includes a cancel affordance with the required warning dialog; if you cancel, the task stops at the next safe checkpoint.

- After import
  - Successful runs raise a notice and clear the loaded export; cancellations leave the file in place so you can try again, and failures keep the conflict form available for fixes.

## Notes & Limits

- Plugin detection: editor/addon plugins used by fields are included when “Select all dependencies” is used. If the installed plugin list cannot be fetched you’ll see a one-time banner (per session) so you know detection may be incomplete.
- Graph threshold: when the graph would exceed ~60 nodes the UI switches to the large-selection layout with search, metrics (counts/components/cycles), and “Why included?” reasoning instead of rendering an unreadable canvas.
- Rate limiting & throttling: long operations show a stall notice if progress pauses, and `ProjectSchema` throttles CMA calls by default (override with something like `localStorage.setItem('schemaThrottleMax', '8')`; valid values are 1–15 for local debugging).
- Appearance portability: if an editor plugin is not selected, that field falls back to a valid built‑in editor; addons are included only if selected or already installed.
- Debug logging: run `localStorage.setItem('schemaDebug', '1')` in the iframe console to enable detailed `debugLog` output.

## Development Notes

- Entry points:
  - `src/main.tsx` registers plugin pages, schema dropdown shortcuts, and preserves environment-prefixed routing when navigating between Import/Export.
  - `src/entrypoints/Config` uses `ctx.navigateTo` so config links jump directly to Schema, Import, or Export without reloading the iframe.
- Shared hooks:
  - `useProjectSchema` memoizes the CMA client, caches item types/plugins/fields, and honors the `schemaThrottleMax` localStorage override.
  - `useLongTask` tracks cancellable progress state shared by exports, imports, and conflict analysis.
  - `useExportSelection` hydrates item types once and keeps the selection stable when the import page toggles between modes.
  - `useExportGraph` assembles the React Flow graph/list data and streams progress updates for the preparation overlay.
  - `useExportAllHandler` and `useSchemaExportTask` wrap `buildExportDoc`, download handling, progress overlays, and cancellation.
  - `useConflictsBuilder` drives conflict analysis with `useLongTask`; `useRecipeLoader` watches `recipe_url` query params for shared exports.
- Shared UI:
  - `TaskOverlayStack` + `TaskProgressOverlay` render cancellable overlays with `ProgressOverlay` stall detection.
  - `GraphCanvas`, `LargeSelectionLayout`, and the Schema Overview components keep the export/import visualizations consistent.
- Schema utilities:
  - `ProjectSchema` provides cached lookups plus concurrency-limited `getItemTypeFieldsAndFieldsets` calls.
  - `buildExportDoc` trims validators/appearances so exports stay self-contained; `buildImportDoc` + `importSchema` orchestrate plugin installs, item type creation, field migrations, and reorder passes.
- Local development:
  - `npm run dev` starts Vite, `npm run build` runs `tsc -b` followed by `vite build`, `npm run analyze` builds with bundle analysis, and `npm run format` runs Biome in `--write` mode.

## Export File Format

- Version 2 (current): `{ version: '2', rootItemTypeId, entities: […] }` — preserves the explicit root model/block used to seed the export, to re-generate the export graph deterministically.
- Version 1 (legacy): `{ version: '1', entities: […] }` — still supported for import; the root is inferred from references.
- Field validators referencing models outside the selection are trimmed, and appearances are rewritten to include only allowed plugin editors/addons so the export remains self-contained.

## Safety

- Imports are additive and non‑destructive. The plugin never overwrites existing models/blocks or plugins. When conflicts are detected, you explicitly pick “Reuse existing” or “Rename”.

## Troubleshooting

- “Why did the graph disappear?” For very large selections, the UI switches to a faster list view.
- “Fields lost their editor?” If you don’t include a custom editor plugin in the export/import, the plugin selects a safe, built‑in editor so the field remains valid in the target project.
- “Plugin dependencies were skipped?” Check for the banner warning about incomplete plugin detection and rerun “Select all dependencies” after reopening the page once the CMA call succeeds.
- “Cancel didn’t stop immediately?” The import/export pipeline stops at the next safe checkpoint; keep the overlay open until it confirms cancellation.

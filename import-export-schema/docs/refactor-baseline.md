# Refactor Baseline (September 17, 2025)

## Current Critical Flows

### Export: Start From Selection
- Launch Export page with no preselected item type.
- Select one or more models/blocks via multiselect.
- Press `Start export` and wait for graph to render.
- Toggle dependency selection; confirm auto-selection adds linked models/plugins.
- Export selection; expect download named `export.json` and success toast.

### Export: From Schema Dropdown
- From schema dropdown action (`Export as JSON...`) load `ExportPage` with initial item type.
- Confirm overlay progresses through scan/build phases and hides when graph ready.
- Export without modifying selection; ensure download + toast.
- Trigger cancel during export; verify notice and overlay update.

### Export: Entire Schema
- On Export landing, choose `Export entire schema`.
- Confirm confirmation dialog text.
- Ensure overlay tracks progress and cancel immediately hides overlay while still cancelling.
- Validate success toast when done, or graceful alert if schema empty.

### Import: File Upload Flow
- Drop valid export file; spinner shows while parsing.
- Conflicts list populates with models/blocks/plugins grouped and sorted.
- Adjust resolutions (reuse/rename) and submit.
- Import progress overlay updates counts and finishes with success toast.

### Import: Recipe URL Parameters
- Open Import page with `?recipe_url=...` query parameters.
- Verify remote JSON fetch, fallback name assignment, and conflict build once loaded.
- Cancel import via bottom action; ensure confirmation dialog resets state.

### Import: Cancel During Import
- Start import and trigger cancel; confirm warning dialog and partial state handling.
- Verify overlay message switches to "Stopping" label while waiting.

### Import: Export Tab Within Import Page
- Switch to Export tab, select models/blocks, run export.
- Ensure shared overlays behave like Export page variant.
- Confirm back navigation keeps selections when returning.

## Manual QA Checklist
- [x] `npm run build` succeeds (baseline).
- [ ] Export: Start from selection flow works (selection, dependency toggle, download).
- [ ] Export: Schema dropdown entry works (overlay, cancel path).
- [ ] Export: Entire schema exports all models/plugins without crash.
- [ ] Import: Upload flow handles conflicts and completes import (test with sandbox project).
- [ ] Import: Recipe URL auto-load works and sets title.
- [ ] Import: Cancel during import stops gracefully without crashing.
- [ ] Import Page Export tab mirrors main export flow.

## Observations / Known Debt
- Dependency auto-selection logic in `ExportInner` remains complex; consider extracting into a dedicated hook with tests.
- Graph QA still manual; adding smoke tests for `useExportGraph` and `useConflictsBuilder` would improve confidence.
- Global CSS (`index.css`) still houses most styles; future work could migrate node/toolbar styling to CSS modules.

## Next Steps
- Execute manual QA checklist before release (export flows, import flows, cancel paths).
- Update component docs/readme snippets if any UX tweaks occur during QA.

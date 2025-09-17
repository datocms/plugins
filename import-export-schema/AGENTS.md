# Repository Guidelines

## Project Structure & Module Organization
- `src/entrypoints/`: Plugin pages (`Config`, `ExportPage`, `ImportPage`) with local helpers and `index.tsx`.
- `src/components/`: Reusable React components shared across entrypoints.
- `src/utils/`: Helpers (schema builders, rendering, types, download utilities).
- `src/icons/`: SVG assets.
- `public/`, `index.html`: Vite app shell; production build in `dist/` (plugin entry is `dist/index.html`).
- `docs/`: Cover/preview assets included in the package.

## Build, Test, and Development Commands
- `npm run build` — check for errors
Notes: Use Node 18+ and npm (repo uses `package-lock.json`).

## Coding Style & Naming Conventions
- Language: TypeScript + React 18; Vite.
- Formatting: Biome; 2-space indent, single quotes, organized imports.
- Naming: PascalCase for components/files (e.g., `ExportPluginNodeRenderer.tsx`); camelCase for functions/vars; PascalCase for types.
- Styles: Prefer CSS modules when present (e.g., `styles.module.css`).
- UI: Follow DatoCMS-like design using `datocms-react-ui` and `ctx.theme` vars.

I want to make a refactor to make this whole code way smaller, as DRY as possible, and as legible and simple as possible

## Security & Configuration Tips
- Never hardcode or log tokens; rely on `@datocms/cma-client`.
- Avoid mutating existing schema objects; make additive, safe changes.
- Do not commit secrets or personal access tokens. Review diffs for sensitive data.

# Refactor Roadmap (Sept 2025)

## Stage Overview
1. Baseline & Safeguards
   - Capture current UX (screenshots, flows, manual QA list).
   - Ensure `npm run build` passes; note regressions.
2. Shared Infrastructure Layer
   - Hooks for CMA/schema access and async state.
   - Shared progress/task utilities and contexts.
3. UI Composition Cleanup
   - Shared layout, blank-slate, and selector components.
   - Replace inline overlay markup with reusable components.
4. Export Workflow Refactor
   - Consolidate ExportHome/ExportPage logic via hooks.
   - Break `Inner` into smaller focused components/utilities.
5. Import Workflow Refactor
   - Mirror export improvements; simplify conflicts UI.
6. Graph Utilities Consolidation
   - Centralize analysis helpers; document graph contracts.
7. Styling Rationalization
   - Move inline styles to CSS modules or tokens.
   - Normalize color/spacing variables.
8. Types & Utilities Cleanup
   - Strengthen progress/event types; remove duplication.
9. Validation & Documentation
   - Run build + manual QA per stage; update README/notes.

## Active Checklist
- [x] Stage 0: Baseline docs + QA scenarios recorded
- [x] Stage 1: Shared infrastructure primitives extracted
- [x] Stage 2: Common UI components introduced
- [x] Stage 3: Export workflow streamlined
- [x] Stage 4: Import workflow streamlined
- [x] Stage 5: Graph utilities consolidated
- [x] Stage 6: Styling centralized
- [x] Stage 7: Type/util cleanup complete
- [x] Stage 8: Validation + docs refreshed

## Worklog
- 2025-09-17: Created refactor roadmap, documented baseline QA in `docs/refactor-baseline.md`, introduced shared hooks (`useCmaClient`, `useProjectSchema`) plus long-task controller (`useLongTask`), and updated export/import entrypoints to rely on the shared schema hook.
- 2025-09-17: Replaced bespoke busy/progress state in ExportHome, ExportPage, and ImportPage with `useLongTask`, unified cancel handling, and refreshed overlays to read from shared controllers (build verified).
- 2025-09-17: Added reusable `ProgressOverlay`, `ExportStartPanel`, and `useExportAllHandler` to DRY export/import entrypoints; refactored `ExportPage/Inner` to use `useExportGraph` for graph prep.
- 2025-09-17: Streamlined import/export panels via shared hooks (`useExportAllHandler`, `useConflictsBuilder`) and components, leaving ImportPage/ExportHome with leaner startup flows.
- 2025-09-17: Centralized graph progress wiring via `useExportGraph`, shared `SchemaProgressUpdate` type, and index exports for graph utilities.
- 2025-09-17: Introduced `ProgressOverlay` styling tokens (`--overlay-gradient`, `.progress-overlay`) and DRY `ExportStartPanel`, eliminating repeated inline overlay/selector styles.
- 2025-09-17: Refreshed README + docs with new shared infrastructure and updated baseline observations; build validated via `npm run build`.
- 2025-09-17: Added reusable progress types (`SchemaProgressUpdate`, `LongTaskProgress`) and shared hooks (`useConflictsBuilder`, `useExportGraph`) to remove duplicated state management and tighten typing across workflows.

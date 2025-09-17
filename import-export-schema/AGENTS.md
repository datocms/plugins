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


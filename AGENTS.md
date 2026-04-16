# Repository Guidelines

## Monorepo Structure
- This repository is a collection of standalone DatoCMS plugins. Each plugin lives in its own directory with its own `package.json`.
- There is no workspace tooling here. Run package commands from the plugin directory you are changing.
- Plugins do not share runtime source code, but many implementation patterns repeat. Before inventing a new DatoCMS SDK, CMA, or UI pattern, check sibling plugins for an existing approach.
- Prefer the nearest nested `AGENTS.md` when working inside a plugin directory.

## Build, Test, and Development Commands
From an individual plugin directory:
- `npm install`
- `npm run build`
- `npm run lint` / `npm run lint:fix` when that plugin defines them
- `npm run test` when that plugin defines it

From the repo root:
- `./foreach.sh <command>` runs the same command in every plugin directory.
- `node run-checks.js` runs lint and build on a subset of plugins.

## Shared Conventions
- Stack: TypeScript, React, Vite, `datocms-plugin-sdk`, and `@datocms/cma-client-browser`.
- Prefer `datocms-react-ui` for plugin UI unless the package already follows an established alternative.
- The root `biome.json` is the common formatting and lint baseline: single quotes, space indentation, no `any`, no non-null assertions, no CommonJS, and prefer `for...of` over `.forEach()`.
- Generated build output lives in package-level `dist/` or `build/` directories; do not hand-edit generated artifacts.
- Do not assume every plugin has tests, lint scripts, or the same file layout. Verify in the local `package.json` first.

## Validation
- `npm run build` in the touched plugin is the default validation step.
- Also run that plugin's test or lint commands when your change affects logic they cover.
- Do not assume there is a usable root-level `package.json`.

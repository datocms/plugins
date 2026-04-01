# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a monorepo of ~50 independent DatoCMS plugins. Each plugin is its own directory with a standalone `package.json` — there is no workspace tooling (no pnpm-workspace, lerna, or yarn workspaces). Plugins do not share code with each other.

When building a new plugin or implementing a feature, search other plugins for similar functionality first. Many patterns recur across plugins — DatoCMS API calls, CMA client usage, SDK hooks, UI patterns — and existing implementations are the best reference. Don't reinvent what another plugin already solved.

Some plugins have their own `CLAUDE.md` or `AGENTS.md` with plugin-specific instructions — always check for those when working inside a plugin directory.

## Common Commands

All commands must be run from within a specific plugin directory, not the root:

```bash
npm install          # Install dependencies for a plugin
npm run build        # TypeScript check + Vite production build
npm run lint         # Biome lint check
npm run lint:fix     # Biome lint auto-fix
```

Root-level utilities:
- `./foreach.sh <command>` — runs a command in every plugin directory
- `node run-checks.js` — runs lint + build on a subset of plugins

## Tech Stack

- **Language:** TypeScript (strict mode)
- **UI:** React 18/19 with `datocms-react-ui` component library
- **Build:** Vite
- **Plugin SDK:** `datocms-plugin-sdk` with `connect()` entry point
- **CMS Client:** `@datocms/cma-client-browser`
- **Package Manager:** npm

## Code Style (Biome)

The root `biome.json` enforces strict rules across all plugins:

- Single quotes, space indentation
- `noExplicitAny` and `noImplicitAnyLet` — no `any` types
- `noNonNullAssertion` — no `!` postfix assertions
- `noForEach` — use `for...of` loops instead of `.forEach()`
- `noCommonJs` — use ES modules only
- `noBarrelFile` — no index re-export files
- `noDoubleEquals` — use `===` / `!==`
- CSS linting is disabled

## Testing

Only `ai-translations` and `record-comments` have test suites (Vitest with jsdom). Most plugins have no tests.

```bash
npm run test         # Run tests (in plugins that have them)
npm run test:watch   # Watch mode
```

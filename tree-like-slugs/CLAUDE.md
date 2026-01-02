# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

- `npm run dev` - Start the Vite dev server for local development
- `npm run build` - Type-check with `tsc -b` and build with Vite
- `npm run preview` - Preview the production build locally

## Architecture

This is a DatoCMS plugin that propagates hierarchical slugs through parent-child record relationships. When a parent record's slug is updated, all descendant records automatically inherit the updated path prefix.

### Key Files

- `src/index.tsx` - Plugin entry point. Registers the field extension and the `onBeforeItemUpsert` hook that triggers slug propagation
- `src/entrypoints/ConfigScreen.tsx` - Plugin configuration UI (displays usage instructions)
- `src/entrypoints/SlugExtension.tsx` - Field addon component (currently renders nothing, serves as hook anchor)
- `src/utils/updateAllChildrenSlugs.ts` - Recursive function that updates all descendant slugs via the CMA client
- `src/utils/render.tsx` - React 18 render helper for plugin components

### How It Works

1. Plugin registers as a field addon for slug fields via `manualFieldExtensions()`
2. On record save (`onBeforeItemUpsert`), checks if a slug field using this plugin was modified
3. If modified, recursively fetches all child records and updates their slugs with the new parent prefix
4. Uses `@datocms/cma-client-browser` to make API calls with the current user's access token

### Dependencies

- `datocms-plugin-sdk` - DatoCMS plugin framework
- `datocms-react-ui` - DatoCMS UI component library
- `@datocms/cma-client-browser` - DatoCMS Content Management API client

### Requirements

- The model must use "Hierarchical sorting" (tree-like collection) as its default ordering
- The slug field must have "Match a specific pattern" validation DISABLED to allow `/` characters

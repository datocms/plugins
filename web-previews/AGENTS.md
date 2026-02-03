# Web Previews DatoCMS Plugin

## Purpose

This plugin enables side-by-side website previews within the DatoCMS editor. It provides:
- **Sidebar previews**: iframe-based previews of web pages alongside record editing
- **Visual editing mode**: full-screen inspector with draft mode integration
- **Preview links**: quick access to published/draft versions via API endpoint integration

**Not handled here**: The preview API endpoints themselves live in frontend applications (Next.js, Nuxt, etc.). This plugin consumes those endpoints but doesn't implement them.

## Architecture Overview

```
main.tsx                     → Plugin entry point, registers all DatoCMS hooks
types.ts                     → Central type definitions and parameter normalization
src/entrypoints/            → Four distinct UI surfaces (each is a DatoCMS entry point)
  ├── ConfigScreen/         → Plugin configuration UI in DatoCMS settings
  ├── SidebarPanel/         → Collapsed panel showing preview link list
  ├── SidebarFrame/         → Full sidebar with iframe preview (main UI)
  └── Inspector/            → Full-screen visual editing mode
src/components/             → Shared UI components (Browser, ButtonGroup)
src/utils/                  → Shared utilities (rendering, persisted width)
```

### The Five Entry Points

DatoCMS plugins use a hook-based system. This plugin implements:

1. **`renderConfigScreen`** → `ConfigScreen/` - Configure frontends, API endpoints, viewports
2. **`renderItemFormSidebarPanel`** → `SidebarPanel/` - Shows clickable preview link list
3. **`renderItemFormSidebar`** → `SidebarFrame/` - Main preview iframe with toolbar
4. **`renderInspector`** → `Inspector/` - Visual editing mode (draft mode integration)
5. **`mainNavigationTabs`** → Conditionally adds "Visual" tab when visual editing is enabled

Each entry point receives a DatoCMS context object (`ctx`) with access to the current record, site, plugin parameters, etc.

## Preview Flow

```
User edits record in DatoCMS
  ↓
Plugin calls configured API endpoint(s) with item/itemType/locale payload
  ↓
Frontend returns { previewLinks: [{ label, url, reloadPreviewOnRecordUpdate? }] }
  ↓
SidebarFrame displays URLs in iframe with viewport selector
```

### Visual Editing Flow

When `visualEditing.enableDraftModeUrl` is configured:
1. Plugin adds "Visual" main navigation tab
2. Inspector entrypoint renders full-screen iframe
3. Contains address bar + draft mode toggle
4. Uses ContentLinkContext for bidirectional communication with frontend

## Critical Invariants

### Type System
- **Always normalize parameters**: Raw plugin parameters from DatoCMS are loose. Use `normalizeParameters()` from `types.ts` to convert to `NormalizedParameters` before use.
- **Viewport dimensions**: Must be between `MIN_VIEWPORT_DIMENSION` (200px) and `MAX_VIEWPORT_DIMENSION` (3840px)

### API Endpoint Contract
Frontend API endpoints must:
- Accept POST with `{ item, itemType, currentUser, siteId, environmentId, locale }`
- Return `200` with `{ previewLinks: PreviewLink[] }`
- Be CORS-ready (plugin runs from `https://plugins-cdn.datocms.com`)
- Implement validation via `isValidResponse()` guard

### CSP Requirements
If frontend implements Content Security Policy, must include:
```
Content-Security-Policy: frame-ancestors 'self' https://plugins-cdn.datocms.com;
```

### State Persistence
- Sidebar width persists via `utils/persistedWidth.ts` (localStorage keyed by site ID)
- Plugin parameters are stored in DatoCMS, not locally

## Common Patterns

### Adding a New Viewport Option
1. Edit `ConfigScreen/index.tsx` to add form field for custom viewport
2. Update `types.ts` `RawViewport` if adding new properties
3. Ensure `normalizeParameters()` handles the new structure
4. `ViewportSelector` component automatically picks up normalized viewports

### Adding a New Toolbar Action
1. Add new `ToolbarButton` in `SidebarFrame/index.tsx` or `Inspector/UI/index.tsx`
2. Use FontAwesome icons from `@fortawesome/free-solid-svg-icons` (library loaded in `main.tsx`)
3. Follow pattern: `<ToolbarButton icon={...} tooltip="..." onClick={...} />`

### Fetching Preview Links
See `utils/common.ts` `useStatusByFrontend()`:
- Fetches from all enabled frontends in parallel
- Handles custom headers
- Returns `{ [frontendName]: { previewLinks } | { error } }`
- Guards responses with `isValidResponse()` type guard

### Iframe Reload Strategy
Auto-reload on record save is opt-in:
```typescript
{
  label: "Draft",
  url: "...",
  reloadPreviewOnRecordUpdate: { delayInMs: 100 }  // or just `true` for 100ms
}
```
Implementation in `SidebarFrame/index.tsx:98-113` uses effect watching `ctx.item.meta.current_version`

## Anti-patterns

### Don't Bypass Parameter Normalization
```typescript
// ❌ WRONG - raw parameters have inconsistent types
const { frontends } = ctx.plugin.attributes.parameters;

// ✅ CORRECT - normalized parameters have reliable types
const { frontends } = normalizeParameters(ctx.plugin.attributes.parameters);
```

### Don't Construct Preview URLs Client-Side
The plugin **never** builds preview URLs itself. Always call the configured API endpoint. The frontend knows its routing, the plugin doesn't.

### Don't Share State Between Entry Points
Each entry point is isolated (separate React render). Use `ctx.parameters` or `ctx.notice()` to coordinate, not global state.

### Don't Mutate ctx.item
The context object is read-only. To update records, use DatoCMS SDK methods on `ctx.item.meta`.

## Visual Editing

When enabled:

- Adds "Visual" tab to main navigation
- Full-screen inspector at `/p/{pluginId}/inspectors/visual`
- Expects frontend to implement draft mode toggle endpoint
- Uses `ContentLinkContext` for edit mode coordination

**Key files**:
- `src/entrypoints/Inspector/` - Full UI
- `src/entrypoints/Inspector/ContentLinkContext/` - Context bridge for edit mode

## Troubleshooting

### Preview not loading
1. Check CSP headers on frontend (must allow `https://plugins-cdn.datocms.com`)
2. Verify API endpoint returns valid JSON (use browser network inspector)
3. Check CORS headers on API endpoint
4. Look for validation errors in `isValidResponse()`

### Iframe blank after reload
Likely cross-origin issue. If `reloadPreviewOnRecordUpdate` is enabled, scroll position cannot be maintained due to browser security.

### Visual editing mode not appearing
Ensure `visualEditing.enableDraftModeUrl` is set in plugin configuration. The main navigation tab is conditionally rendered based on this parameter (`main.tsx:22-33`).

## Development

```bash
npm run dev          # Vite dev server on :3000
npm run build        # TypeScript + Vite build
npm run typecheck    # TypeScript validation
npm run format       # Biome formatter
```

The plugin is loaded into DatoCMS via iframe from `dist/index.html` after build.

## Intent Layer

**Before modifying code in this directory, this is the primary context file.** There are currently no child AGENTS.md nodes. Given the focused scope (~50k tokens, single responsibility), all architectural context lives here.

### Global Invariants
- All DatoCMS SDK interactions go through the `ctx` object passed to entry points
- FontAwesome icons are globally available via library setup in `main.tsx:14`
- React 18 with TypeScript, using Vite for bundling
- UI components from `datocms-react-ui` should be preferred for consistency
- Plugin runs in sandboxed iframe, no direct localStorage access (use `ctx` methods)
- The type `Parameters` represents the plugin stored settings. It should always be kept retro-compatible, even if it becomes ugly. The normalized representation of the same settings we use everywhere else is `NormalizedParameters`.

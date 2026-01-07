# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- `npm run dev` - Start Vite dev server
- `npm run build` - TypeScript check + production build
- `npm run preview` - Preview built plugin

## Test Commands

- `npm run test` - Run tests in watch mode
- `npm run test:unit` - Run all unit tests once
- `npm run test:unit:watch` - Run tests in watch mode
- `npm run test:unit:coverage` - Run tests with coverage report

Tests are in `tests/unit/` using Vitest (node environment). Fixtures in `tests/unit/fixtures/`.

## Project Overview

DatoCMS plugin for collaborative commenting with threaded replies, upvoting, real-time updates, and rich mentions. Two entry points: sidebar panel (per-record) and Comments Dashboard (project-wide).

## Architecture

### Entry Points

- **CommentsBar.tsx** - Sidebar for per-record comments
- **CommentsDashboard.tsx** - Full page with global channel, "My Mentions", "Recent Comments"
- **ConfigScreen.tsx** - Plugin settings (CDA token, dashboard toggle)
- **main.tsx** - Plugin lifecycle: auto-creates `project_comment` model, registers sidebar/dashboard/config

### Path Aliases

| Alias | Path |
|-------|------|
| `@/*` | `src/*` |
| `@components/*` | `src/entrypoints/components/*` |
| `@hooks/*` | `src/entrypoints/hooks/*` |
| `@utils/*` | `src/entrypoints/utils/*` |
| `@ctypes/*` | `src/entrypoints/types/*` |
| `@styles/*` | `src/entrypoints/styles/*` |

### Key Patterns

**Queue-Based State (useOperationQueue.ts):** FIFO queue with exponential backoff (15 attempts, 2-min timeout). Fetches fresh server state before each operation. Idempotent operations.

**Optimistic UI:** Immediate local updates, async queue processing, 8-second sync cooldown prevents stale subscriptions overwriting changes.

**Real-time:** GraphQL subscriptions via `useQuerySubscription`. Requires CDA token in settings.

**Context Providers:** Navigation callbacks wrapped per entry point (`SidebarNavigationProvider`, `PageNavigationProvider`). Project data and mention permissions shared via context.

### Mention System

| Trigger | Type | Behavior |
|---------|------|----------|
| `@` | User | Searches users + SSO users |
| `#` | Field | Nested fields from modular/structured text |
| `&` | Record | Opens record picker |
| `^` | Asset | Opens upload picker |
| `$` | Model | Searches project models |

Serialized as `CommentSegment[]`. Field paths use underscores: `sections_0_heading`.

### Comment Structure

```typescript
type CommentType = {
  id: string;                // UUID for lookups
  dateISO: string;           // Timestamp for display/sorting
  content: CommentSegment[];
  author: { name: string; email: string };
  usersWhoUpvoted: Upvoter[];
  replies?: CommentType[];
  parentCommentId?: string;
};
```

### Key Files

| Change Type | File(s) |
|-------------|---------|
| Sidebar UI/state | `CommentsBar.tsx` |
| Dashboard UI/state | `CommentsDashboard.tsx` |
| Plugin config | `ConfigScreen.tsx` |
| Operation persistence | `useOperationQueue.ts` |
| State updates | `operationApplicators.ts` |
| Mention encoding | `tipTapSerializer.ts` |
| Comment rendering | `Comment.tsx`, `CommentContentRenderer.tsx` |
| TipTap editor | `TipTapComposer.tsx` |
| Constants/timing | `constants.ts` |

### Global vs Record Comments

- **Record:** `model_id` = model ID, `record_id` = record ID
- **Global:** `model_id` = `__global__`, `record_id` = `__project__`

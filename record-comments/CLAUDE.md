# CLAUDE.md

## Build Commands

- `npm run dev` - Start Vite dev server
- `npm run build` - TypeScript check + production build
- `npm run preview` - Preview built plugin

## Project Overview

DatoCMS plugin for collaborative commenting with threaded replies, upvoting, real-time updates, and rich mentions. Two entry points: sidebar panel (per-record) and Comments Dashboard (project-wide).

## Architecture

### Entry Points

- **CommentsBar.tsx** - Sidebar for per-record comments
- **CommentsDashboard.tsx** - Full page with global channel, "My Mentions", "Recent Comments"
- **main.tsx** - Plugin lifecycle: auto-creates `project_comment` model, registers sidebar/dashboard

### Key Patterns

**Queue-Based State (useOperationQueue.ts):** FIFO queue with infinite retry + exponential backoff. Fetches fresh server state before each operation. Idempotent operations.

**Optimistic UI:** Immediate local updates, async queue processing, 8-second sync cooldown prevents stale subscriptions overwriting changes.

**Real-time:** GraphQL subscriptions via `useQuerySubscription`. Requires CDA token in settings.

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
  dateISO: string;           // Unique ID
  content: CommentSegment[];
  author: { name: string; email: string };
  usersWhoUpvoted: Upvoter[];
  replies?: CommentType[];
  parentCommentISO?: string;
};
```

### Key Files

| Change Type | File(s) |
|-------------|---------|
| Sidebar UI/state | `CommentsBar.tsx` |
| Dashboard UI/state | `CommentsDashboard.tsx` |
| Operation persistence | `useOperationQueue.ts` |
| State updates | `operationApplicators.ts` |
| Mention encoding | `mentionSerializer.ts` |
| Comment rendering | `Comment.tsx`, `CommentContentRenderer.tsx` |
| TipTap editor | `TipTapComposer.tsx` |

### Global vs Record Comments

- **Record:** `model_id` = model ID, `record_id` = record ID
- **Global:** `model_id` = `__global__`, `record_id` = `__project__`

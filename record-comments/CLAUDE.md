# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- `npm run dev` - Start Vite dev server for local development
- `npm run build` - TypeScript check + Vite production build (outputs to `dist/`)
- `npm run preview` - Preview the built plugin

## Project Overview

DatoCMS plugin enabling collaborative commenting on records with threaded replies, upvoting, real-time updates, and rich mentions. Provides both a sidebar panel for per-record comments and a project-wide Comments Dashboard.

## Architecture

### Plugin Lifecycle (main.tsx)

- **onBoot:** Auto-creates `project_comment` model with fields (model_id, record_id, content JSON)
- **itemFormSidebars:** Registers "Comments" sidebar panel for record editing
- **contentAreaSidebarItems:** Adds "Comments" navigation item for Dashboard page
- **renderPage:** Renders CommentsDashboard for project-wide comments view

### Two Entry Points

1. **CommentsBar.tsx** - Sidebar panel for per-record comments
2. **CommentsDashboard.tsx** - Full page with global channel, "My Mentions", and "Recent Comments"

### Key Patterns

**Queue-Based State Management (useOperationQueue.ts):**
- FIFO queue for comment operations (ADD_COMMENT, DELETE_COMMENT, EDIT_COMMENT, UPVOTE_COMMENT, ADD_REPLY)
- Infinite retry with exponential backoff for STALE_ITEM_VERSION conflicts
- Always fetches fresh server state before applying each operation
- Operations are idempotent via explicit `action: 'add' | 'remove'` for upvotes

**Optimistic UI:**
- Local state updates immediately on user action
- Operations queued and processed asynchronously
- 8-second sync cooldown prevents stale subscription data from overwriting local changes

**Real-time Updates:**
- GraphQL subscriptions via `react-datocms` useQuerySubscription
- `isSyncAllowed` flag controls when subscription data can update local state
- Requires CDA token configured in plugin settings

### Mention System

Five mention types with distinct triggers:
- `@` - User mentions (searches users + SSO users)
- `#` - Field mentions (supports nested fields from modular content/structured text)
- `&` - Record mentions (opens DatoCMS record picker)
- `^` - Asset mentions (opens upload picker)
- `$` - Model mentions (searches project models)

**Serialization (mentionSerializer.ts):**
- Comments stored as `CommentSegment[]` array (text segments or mention segments)
- Field paths encoded with underscores: `sections_0_heading` for nested paths
- `createMentionKey()` generates lookup keys like `field:blocks_0_title`

### Comment Structure

```typescript
type CommentType = {
  dateISO: string;           // ISO timestamp (serves as unique ID)
  content: CommentSegment[]; // Array of text + mention segments
  author: { name: string; email: string };
  usersWhoUpvoted: Upvoter[];
  replies?: CommentType[];
  parentCommentISO?: string; // For replies, references parent's dateISO
};
```

### Data Flow

1. User action → optimistic local state update via `setComments`
2. Operation enqueued via `enqueue()` with all necessary data
3. Queue processor fetches current server state via CMA client
4. `applyOperation()` merges operation into server state
5. Save with `meta.current_version` for optimistic locking
6. On conflict → retry with fresh state; on success → start 8-second cooldown
7. Real-time subscription blocked during cooldown, then syncs

### Key Files for Common Changes

| Change Type | Primary File(s) |
|-------------|-----------------|
| Sidebar UI/state | `CommentsBar.tsx` |
| Dashboard UI/state | `CommentsDashboard.tsx` |
| Operation persistence | `useOperationQueue.ts` |
| State update logic | `operationApplicators.ts` |
| Mention encoding/decoding | `mentionSerializer.ts` |
| Comment rendering | `Comment.tsx`, `CommentContentRenderer.tsx` |
| TipTap rich editor | `components/tiptap/TipTapComposer.tsx` |
| Permissions logic | `useMentionPermissions.ts` |

### Global vs Record Comments

- **Record comments:** `model_id` = actual model ID, `record_id` = actual record ID
- **Global comments:** `model_id` = `__global__`, `record_id` = `__project__` (from `constants.ts`)

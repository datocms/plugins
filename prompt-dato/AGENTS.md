# Prompt Dato — working notes

## Release status

This plugin has never been released and is still in active development.
Backward compatibility with previous internal iterations is not required for
now. Prefer the current desired behavior, parameter shape, and prompt wording
over preserving old paths unless explicitly requested.

## Remote MCP source is the ground truth

The hosted DatoCMS MCP server is the main runtime tool surface for this plugin.
Before changing chat runtime behavior, approval handling, OAuth, script execution
guidance, or any claim about available MCP capabilities, inspect the source at:

**`/Users/marcelofinamorvieira/datoCMS/dev/remote-mcp`**

Do not infer MCP behavior from old prompt text, memory, or plugin-side names.
Check the implementation every time the task touches tool behavior. In
particular:
- `src/server.ts` for the registered tool list.
- `src/tools/upsertScript/index.ts` for script tool names, descriptions, input
  schema, verification-token requirements, and safe/unsafe variants.
- `src/lib/scripts/executeInSandbox.ts` for sandbox permissions, headers, network
  restrictions, execution mode, and read-only/destructive handling.
- `src/lib/verificationTokens.ts` and `src/tools/getApi*` for the
  introspection-to-script flow.
- `src/tools/whenWorkingWith/index.ts` for topic-specific script guidance.
- `src/http.ts` and `src/lib/oauth/datocmsProvider.ts` for auth and CORS flow.

When this plugin's prompt text or documentation disagrees with `remote-mcp`,
treat `remote-mcp` as authoritative and update the plugin side to match it.
Current important detail: `upsert_and_execute_safe_script` is a read-only script
execution path that aborts destructive DatoCMS requests; use
`upsert_and_execute_unsafe_script` for actual create/update/delete/schema
mutations that need approval.

## Debugging reference — remote MCP server

When something feels off about how chat uses its tools, what data comes back, how authentication behaves, or what the runtime is allowed/expected to do, cross-check against the actual MCP server source at:

**`/Users/marcelofinamorvieira/datoCMS/dev/remote-mcp`**

Keep that directory mentally attached to this plugin. Treat its source as ground truth for:
- Which tools are registered and their exact names (`src/server.ts`, `src/tools/*`).
- The OAuth flow shape (`src/http.ts`, `src/lib/oauth/datocmsProvider.ts`).
- The introspection → script-execution model (don't trust the system prompt's tooling list over what the server actually exposes).
- Any CORS, auth, or routing quirks — verify there, not in guesswork.

Whenever a system-prompt claim about MCP capabilities changes, re-audit it against this folder.

## Scope constraints
- **This plugin must not handle translations.** Translation flows belong to the dedicated translation plugins (`yandex-translate`, `locale-duplicate`, and the legacy translation plugin) — do not add translate-to-locale features, locale switchers, or per-locale rewrite logic here. Suggestion copy and UI examples that reference "translate" should be removed or rephrased to a non-translation use case.

## Architecture (current state)
- **Per-record sidebar only:** `itemFormSidebars` / `renderItemFormSidebar` → `src/entrypoints/PromptSidebar.tsx`. Scoped to a single record. It reads `ctx.item`, `ctx.formValues`, `ctx.itemType`, `ctx.locale`, and `ctx.itemStatus` to build the prompt snapshot. It may use `ctx.scrollToField` only for user-clicked field mention links. The chat runtime must not expose direct editor write/save functions. Best for "help me with this record" — the snapshot from `lib/recordContext.ts` contains schema plus dirty field values only. The iframe **unmounts** when the user navigates to another record (chat history is lost).
- **Chat runtime:** Responses API, called directly from the browser with `dangerouslyAllowBrowser: true`. Wrapper lives in `src/lib/openai.ts` (`sendChatTurn`, `submitApprovalDecisions`). The wrapper exposes MCP approval requests. The record sidebar receives only the remote MCP tool; do not add client-side helper tools.
- **Tool surface:** the hosted DatoCMS MCP at `https://mcp.datocms.com/`, passed as a single `{ type: 'mcp' }` tool with the user's bearer token in `headers.Authorization`. The MCP server only accepts OAuth-issued tokens (introspection against `oauth.datocms.com`); raw CMA PATs are rejected.
- **Auth:** OAuth 2.1 + PKCE + RFC 7591 dynamic client registration, run from the browser. All four endpoints (`/register`, `/authorize`, `/token`, `/revoke`) on `mcp.datocms.com` have CORS enabled by the MCP SDK auth router. Logic lives in `src/lib/oauth.ts`.
- **Stored state (plugin global parameters):** `oauthClientId`, `oauthClientIssuedAt`, `oauthRedirectUri` (one-time registration); `datoAccessToken` (per-connection); `openaiApiKey`; `openaiMainModel` (drives chat); `openaiMiniModel` (reserved for upcoming suggestion utilities — not consumed by the chat yet); `systemPrompt` (optional override of the bundled default at `src/lib/systemPrompt.md`; when empty or equal to the default, stored as `undefined` so future default updates propagate). Backward-compat: the legacy `openaiModel` key is still read as a fallback for `openaiMainModel`. Typed accessors in `src/lib/pluginParams.ts`; `resolveSystemPrompt()` returns the effective value.
- **System prompt structure:** `buildInstructions()` in `src/lib/openai.ts` concatenates (1) the user/default base prompt, (2) a runtime project-pin section with site_id + environment, (3) an optional record-snapshot JSON block (when present), (4) an optional scoped-fields emphasis block. The base is editable; sections 2–4 are always appended automatically and aren't user-customizable.
- **Debug logging:** a boolean param `debugMode` (toggled in the Settings → Developer section) flips on compact console-only output via `src/lib/debugLog.ts`. Chat turns log `turn:start`, `turn:done`, `turn:blocked`, and `turn:error` packets with request size, project/environment, record dirty/write-blocker counts, approval counts, compact MCP action sequences, missing method-token hints, and recent reasoning summaries. Sensitive keys (`apiKey`, `accessToken`, `code`, `code_verifier`, `client_secret`, `Authorization`, `Bearer …`, `sk-…`) are auto-replaced with `<redacted, len=N>` by `redactForLog`. Errors fire via `derror` regardless of the flag, but stack traces are included only when debug mode is on.
- **Project scope:** chat is auto-pinned to the project hosting the plugin via `ctx.site.id`, hinted in the system prompt. It should not call `search_projects` unless the user explicitly asks about another project.
- **Popup callback:** the plugin's own URL with `?oauth_callback=1` is the OAuth `redirect_uri`. `main.tsx` short-circuits before `connect()` if it detects this query param — the popup posts the code+state to its opener and closes.
- **Tool approvals:** read-only MCP tools are allowlisted with object-form `require_approval`; unsafe script execution still pauses for approval.
- **"Accept all edits" toggle:** the sidebar renders an "Accept all edits" pill in `composerTools`. Clicking it from off→on triggers `ctx.openConfirm` with a danger-framed dialog; if the user confirms, the toggle goes loud-red and every subsequent MCP approval request is silently approved (no proposal card, no chip) for the rest of the session. The toggle resets when the chat component unmounts (switching records). It is *not* persisted to plugin params or `localStorage`. `buildInstructions()` makes no mention of it.

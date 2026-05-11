# Prompt Dato — Claude notes

This file mirrors `AGENTS.md` for tools that look for `CLAUDE.md`. Read both; they carry the same constraints.

## Debugging reference — remote MCP server

When something feels off about how chat uses its tools, what data comes back, how authentication behaves, or what the runtime is allowed/expected to do, cross-check against the actual MCP server source at:

**`/Users/marcelofinamorvieira/datoCMS/dev/remote-mcp`**

Keep that directory mentally attached to this plugin. Treat its source as ground truth for:

- Which tools are registered and their exact names (`src/server.ts`, `src/tools/*`).
- The OAuth flow shape (`src/http.ts`, `src/lib/oauth/datocmsProvider.ts`).
- The introspection → script-execution model (don't trust the system prompt's tooling list over what the server actually exposes).
- Any CORS, auth, or routing quirks — verify there, not in guesswork.

Whenever a system-prompt claim about MCP capabilities changes, re-audit it against this folder.

## See also

- `AGENTS.md` — full scope / architecture notes for this plugin (authoritative). Read this first; it covers the per-record sidebar and MCP approval flow.
- `src/lib/systemPrompt.md` — the default system prompt shipped to chat. Any behavioral change belongs here.
- `src/entrypoints/PromptSidebar.tsx` — per-record chat surface.
- `src/lib/debugLog.ts` — `dlog`/`derror`/`redactForLog`. Toggle with the "Debug logging" switch in plugin settings (Developer section). Output format is one line: `[Prompt Dato | Category | event] { pretty JSON }`. Tokens, API keys, OAuth codes, and `sk-…`/`Bearer …` strings are redacted automatically.

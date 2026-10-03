Dato Agent is still in beta. The Remote MCP can access the whole DatoCMS project
through the connected user's account; it is not confined to the record or
environment currently open in the CMS. Within that user's permissions, it can
read and change data across the project, including other environments, and can
perform destructive operations that may be difficult or impossible to undo.
Auto-approve lets those operations run without review. Manually approving an
operation without reading its details carries the same risk.

During the required DatoCMS connection, select only the project where this
plugin is installed. Do not authorize any additional projects.

For now, we strongly recommend using this plugin only with a dedicated sandbox
or test project, never a production project or one containing irreplaceable
data. Review every operation before approving it and keep recoverable backups.

If you encounter any error, contact
[support@datocms.com](mailto:support@datocms.com) and include your request, the
error message, and what you expected to happen.

Dato Agent helps editors and marketers work with DatoCMS using natural language.
It can explain a project, find and open records, answer questions about content,
and prepare content changes.

## Get started

1. A project administrator selects OpenAI or Anthropic, adds the provider API
   key, and chooses a model in the plugin settings.
2. Each user connects their own DatoCMS account and, when asked which projects
   to authorize, selects only the project where this plugin is installed.
3. Open **Agent (Beta)** or the record sidebar and describe what you need.

## Access, approvals, and privacy

- The Remote MCP can access the whole project, including other environments,
  wherever the connected user's DatoCMS permissions allow it.
- It can perform destructive operations throughout the project. Read-only
  actions can run automatically; changes require approval unless auto-approve
  is enabled.
- The provider API key is configured for the project. Your DatoCMS connection
  and recent chats are stored in your browser.

- The plugin's Read Only setting, OAuth access level, and project role all apply.
  **Only read content** disables every agent write, including local asset creation.
  **Read and edit content** permits content changes while schema and management
  restrictions remain enforced by Remote MCP.
- If access cannot be verified, reads remain available and writes pause. Use
  **Check access again** to refresh it. A narrower access level invalidates pending
  write approvals; Auto-approve stays off after writes become available again.
- If authentication expires, click **Reconnect DatoCMS**. Chat history and local
  attachments stay available. Reconnection never repeats an uncertain write.

## Large projects

The agent can continue up to 100 provider steps and 200 tool calls in one turn,
including approved continuations. Auto-approve retains the same access, editor
state and durable dispatch checks throughout the turn. Reaching a limit leaves
the operation incomplete and does not replay or undo completed changes.

Anthropic keeps bounded tool-result previews and compacts older tool outputs
while preserving signed assistant blocks and tool identifiers. Truncated output
is marked incomplete; a model-context limit stops before another request.

The agent uses bounded context and result samples. A sample or truncated result
does not establish an exhaustive record or asset selection. Generated scripts
are instructed to paginate incrementally, limit concurrency, respect endpoint
and bulk limits, and preserve localized values, nested blocks and references.
These instructions guide the model; the plugin does not implement the remote
script runner or validate every generated transformation.

The [MCP server](https://www.datocms.com/docs/mcp-server) has finite execution
time, output and account usage budgets. A client timeout cannot extend the
runner's execution limit. Operations over 200,000 records or 10,000 assets
cannot be guaranteed to finish through this finite runner; a durable
server-side execution capability would be needed for workloads that exceed it.
Stopping or losing a connection does not undo remote changes. An unconfirmed
result prevents automatic replay; verify the affected data before explicitly
requesting another write.

## Development validation

Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` from
this directory. Synthetic tests exercise large collections, bounded context
and journal storage without creating DatoCMS entities. They do not establish
production throughput or remote runner capacity.

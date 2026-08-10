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

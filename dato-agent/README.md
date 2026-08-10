Dato Agent is still in beta and can execute real write operations against your
project. It may misunderstand a request and perform destructive operations
that modify or delete project data and may be difficult or impossible to undo.
Auto-approve lets those operations run without review. Manually approving an
operation without reading its details carries the same risk.

For now, we strongly recommend using this plugin only in a sandbox or test
project/environment, never with production or irreplaceable content. Review
every operation before approving it and keep recoverable backups.

If you encounter any error, contact
[support@datocms.com](mailto:support@datocms.com) and include your request, the
error message, and what you expected to happen.

Dato Agent helps editors and marketers work with DatoCMS using natural language.
It can explain a project, find and open records, answer questions about content,
and prepare content changes.

## Get started

1. A project administrator selects OpenAI or Anthropic, adds the provider API
   key, and chooses a model in the plugin settings.
2. Each user connects their own DatoCMS account.
3. Open **Agent (Beta)** or the record sidebar and describe what you need.

## Safety and privacy

- The agent is limited to the current project, environment, and your DatoCMS
  permissions.
- Read-only actions can run automatically. Content changes require approval
  unless auto-approve is enabled.
- The provider API key is configured for the project. Your DatoCMS connection
  and recent chats are stored in your browser.

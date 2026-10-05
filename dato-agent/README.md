# Dato Agent (Beta)

Dato Agent lets editors and marketers work with DatoCMS in natural language. It can explain how a project is set up, find and open records, answer questions about content and prepare content changes.

## Before you use it

Dato Agent is in beta. It works through the DatoCMS [MCP server](https://www.datocms.com/docs/mcp-server) with the connected user's account, so it isn't limited to the record or environment you have open. Within that user's permissions it can read and change data anywhere in the project, other environments included, and it can run destructive operations that may be hard or impossible to undo.

Changes wait for your approval unless you turn on auto-approve, which lets them run without review. Approving an operation without reading its details is just as risky.

For now, use it only on a sandbox or test project, never on production or on a project with data you can't replace. Review every operation before approving it and keep backups you can restore.

## Setup

1. A project administrator picks OpenAI or Anthropic in the plugin settings, adds the provider API key and chooses a model.
2. Each user connects their own DatoCMS account. When asked which projects to authorize, select only the project where the plugin is installed.
3. Open **Agent (Beta)** or the record sidebar and describe what you need.

The provider API key is shared by the whole project. Each user's DatoCMS connection and recent chats are stored in their browser.

## Permissions

The agent can never do more than the user's role allows. On top of that, the access level chosen when connecting DatoCMS applies (**Only read content** blocks every write), and the plugin's **Read Only** setting turns off all agent writes for everyone.

If the plugin can't verify access, reads keep working and writes pause until you click **Check access again**. If the DatoCMS connection expires, click **Reconnect DatoCMS**; your chats are kept.

## Limitations

A single request stops after 100 model steps or 200 tool calls. The agent often works from samples of your content, so treat lists and counts it gives you as possibly incomplete. Operations over 200,000 records or 10,000 assets may not finish within the MCP server's time and usage limits.

Stopping a request, hitting a limit or losing the connection never undoes changes already made, and the agent won't retry a write it couldn't confirm. Check the affected content before asking for it again.

If something goes wrong, email [support@datocms.com](mailto:support@datocms.com) with your request, the error message and what you expected to happen.

## Development

```sh
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```
